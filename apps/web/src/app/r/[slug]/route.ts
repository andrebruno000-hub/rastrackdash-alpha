import { NextRequest, NextResponse } from "next/server";
import {
  getTenant,
  getTenantFilePath,
  normalizeBrazilianPhone,
  readJsonSafe,
  readTenantLeads,
  sanitizeTenantSlug,
  writeJsonAtomic,
  writeTenantLeads,
  type GoogleTenantConfig,
  type TenantAttendant,
} from "../../../lib/google-tenants";

export const dynamic = "force-dynamic";

/**
 * PASSO M2: ROTA DINÂMICA LIMPA DE REDIRECIONAMENTO & RASTREAMENTO (/r/[slug])
 * Caminho no GitHub: apps/web/src/app/r/[slug]/route.ts
 *
 * - Substitui a pasta fixa "cnac" mantendo /r/cnac 100% compatível via slug = "cnac"
 * - Suporta modo padrão 1 WhatsApp ("single") e Roleta opcional ("roulette") persistente em disco
 * - Grava leads isolados em /data/tenants/<slug>/leads.json
 * - Injeta tag invisível Zero-Width Unicode (GCLID + keyword + campaign + adGroup) na mensagem inicial do cliente
 */

const ZW = ["\u200B", "\u200C", "\u200D", "\u2060"];

function encodeZeroWidth(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  let result = "";
  for (const b of bytes) {
    result += ZW[(b >> 6) & 3] + ZW[(b >> 4) & 3] + ZW[(b >> 2) & 3] + ZW[b & 3];
  }
  return result;
}

function selectTenantAttendant(tenant: GoogleTenantConfig): TenantAttendant | null {
  const validAttendants = (tenant.attendants || []).filter(
    (a) => Boolean(normalizeBrazilianPhone(a.phone))
  );
  if (validAttendants.length === 0) return null;

  const activeAttendants = validAttendants.filter((a) => a.active !== false);
  const pool = activeAttendants.length > 0 ? activeAttendants : validAttendants;

  if (tenant.routingMode !== "roulette" || pool.length === 1) {
    return pool[0];
  }

  const statePath = getTenantFilePath(tenant.slug, "roulette_state");
  const prevState = readJsonSafe<{ index?: number; updatedAt?: string }>(statePath, { index: -1 });
  const prevIndex = typeof prevState?.index === "number" ? prevState.index : -1;
  const nextIndex = (prevIndex + 1) % pool.length;

  try {
    writeJsonAtomic(statePath, {
      index: nextIndex,
      lastAttendant: pool[nextIndex].name,
      updatedAt: new Date().toISOString(),
    });
  } catch {}

  return pool[nextIndex];
}

function recordTenantClickLead(
  tenant: GoogleTenantConfig,
  lead: {
    id: string;
    leadPhone: string;
    attendantName: string;
    keyword: string;
    campaign: string;
    adGroup: string;
    gclid: string;
    stage: "clique_anuncio";
    conversionType: "clique_anuncio";
    status: "queued";
    occurredAt: string;
  }
) {
  try {
    const leads = readTenantLeads(tenant.slug, tenant);
    leads.unshift(lead);
    writeTenantLeads(tenant.slug, leads);
  } catch (err) {
    console.error(`Erro ao registrar clique no disco para cliente ${tenant.slug}:`, err);
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> | { slug: string } }
) {
  const resolvedParams = await Promise.resolve(context.params);
  const rawSlug = resolvedParams?.slug || "";
  const slug = sanitizeTenantSlug(rawSlug);

  const tenant = slug ? getTenant(slug) : null;
  if (!tenant || !tenant.active) {
    return NextResponse.json(
      { error: "Link de rastreamento inválido ou cliente desativado." },
      { status: 404 }
    );
  }

  const chosen = selectTenantAttendant(tenant);
  const cleanPhone = chosen ? normalizeBrazilianPhone(chosen.phone) : "";
  if (!chosen || !cleanPhone) {
    return NextResponse.json(
      { error: `Cliente "${tenant.name}" sem telefone de WhatsApp configurado.` },
      { status: 400 }
    );
  }

  const searchParams = request.nextUrl.searchParams;
  const gclid =
    searchParams.get("gclid") ||
    searchParams.get("wbraid") ||
    searchParams.get("gbraid") ||
    "";
  const keyword = searchParams.get("utm_term") || "";
  const campaign = searchParams.get("utm_campaign") || "";
  const adGroup =
    searchParams.get("utm_content") ||
    searchParams.get("utm_medium") ||
    searchParams.get("utm_adgroup") ||
    "";

  // Só registra pré-lead (etapa Clique no Anúncio) se for clique real de anúncio Google
  // e nunca grava o telefone do atendente como leadPhone
  const isRealGoogleAd = Boolean(gclid || keyword);

  if (isRealGoogleAd) {
    recordTenantClickLead(tenant, {
      id: gclid ? `g_${gclid.slice(0, 15)}_${Date.now()}` : `lead_${Date.now()}`,
      leadPhone: "Aguardando envio no WhatsApp...",
      attendantName: chosen.name,
      keyword: keyword || "Google Ads Search",
      campaign: campaign || "Campanha Google",
      adGroup: adGroup || "Conjunto Geral",
      gclid: gclid || "sem_gclid",
      stage: "clique_anuncio",
      conversionType: "clique_anuncio",
      status: "queued",
      occurredAt: new Date().toISOString(),
    });
  }

  let text =
    String(tenant.initialMessage || "").trim() ||
    `Olá! Vim pelo site da ${tenant.name} e gostaria de um orçamento.`;

  if (gclid) {
    let tag = `ref:${gclid}`;
    if (keyword) tag += `|kw:${keyword.trim()}`;
    if (campaign) tag += `|cmp:${campaign.trim()}`;
    if (adGroup) tag += `|adg:${adGroup.trim()}`;
    text += encodeZeroWidth(tag);
  }

  const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(text)}`;

  return NextResponse.redirect(whatsappUrl, {
    status: 307,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "X-Alpha-Tenant": tenant.slug,
      "X-Alpha-Attendant": chosen.name.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import {
  appendTenantAudit,
  extractUazapiChatLabels,
  findTenantByUazapiToken,
  getTenant,
  getTenantAttendantPhones,
  getTenantFilePath,
  getTenantResolvedUazapi,
  isSamePhone,
  isTenantAttendantPhone,
  listTenants,
  matchRuleLabel,
  normalizeText,
  readJsonSafe,
  readTenantLeads,
  readTenantRules,
  resolveRequestTenant,
  writeJsonAtomic,
  writeTenantLeads,
  type GoogleTenantConfig,
} from "../../../../lib/google-tenants";

export const dynamic = "force-dynamic";

/**
 * PASSO M2: WEBHOOK MULTI-CLIENTE IDEMPOTENTE + REGRAS DINÂMICAS (FRASES + ETIQUETAS WHATSAPP BUSINESS)
 * Caminho no GitHub: apps/web/src/app/api/webhooks/google-whatsapp/route.ts
 *
 * Recursos:
 * 1. Isolamento total por cliente (?client=<slug> na URL ou detecção automática por token/instância Uazapi).
 * 2. Fallback automático para "cnac" quando não vier ?client= (100% compatível com webhooks legados).
 * 3. Suporta eventos de mensagens ("messages") E eventos de etiquetas ("chat_labels", "chats", "labels", wa_label).
 * 4. Idempotência por messageId isolada por tenant + proteção contra duplicidade de etiqueta na mesma etapa.
 * 5. Suporta clientes com 1 único WhatsApp ("single") ou múltiplos atendentes ("roulette").
 * 6. Reconciliação pontual Uazapi para resgatar GCLID caso o webhook da 1ª mensagem tenha falhado.
 */

function isPendingPlaceholder(tenant: GoogleTenantConfig, phone?: string): boolean {
  const p = String(phone || "").trim();
  return !p || /aguardando/i.test(p) || isTenantAttendantPhone(tenant, p);
}

function extractCleanPhoneFromCandidates(candidates: unknown[]): string {
  const strings = candidates
    .map((c) => String(c || "").trim())
    .filter(Boolean);

  for (const s of strings) {
    if (s.includes("@g.us") || s.includes("status@broadcast") || s.includes("@lid")) continue;
    const digits = s.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) return digits;
  }

  for (const s of strings) {
    if (s.includes("@g.us") || s.includes("status@broadcast") || s.includes("@lid")) continue;
    const digits = s.replace(/\D/g, "");
    if (digits.length >= 8) return digits;
  }

  return "";
}

function matchDynamicPhrase(messageText: string, phrases: string[]): string | null {
  const normalizedMsg = normalizeText(messageText);
  if (!normalizedMsg) return null;
  for (const rawPhrase of phrases) {
    const normalizedPhrase = normalizeText(rawPhrase);
    if (normalizedPhrase && normalizedMsg.includes(normalizedPhrase)) {
      return rawPhrase;
    }
  }
  return null;
}

/**
 * Extrai texto de mensagens de texto simples OU legendas de arquivos/mídias
 * (PDF/documento, imagem, vídeo, documentWithCaptionMessage, ephemeral/viewOnce).
 * Nunca lê quotedMessage/contextInfo para evitar falsos positivos ao responder mensagens antigas.
 */
function extractWhatsAppMessageText(msgOrBody: any, rootBody?: any): string {
  const m = msgOrBody && typeof msgOrBody === "object" ? msgOrBody : {};
  const r = rootBody && typeof rootBody === "object" ? rootBody : {};
  const inner = m.message && typeof m.message === "object" ? m.message : m;
  const unwrapped =
    inner.documentWithCaptionMessage?.message ||
    inner.viewOnceMessage?.message ||
    inner.viewOnceMessageV2?.message ||
    inner.viewOnceMessageV2Extension?.message ||
    inner.ephemeralMessage?.message ||
    m.documentWithCaptionMessage?.message ||
    m.viewOnceMessage?.message ||
    m.viewOnceMessageV2?.message ||
    m.ephemeralMessage?.message ||
    null;

  const contentObj = m.content && typeof m.content === "object" ? m.content : {};
  const mediaObj = m.media && typeof m.media === "object" ? m.media : {};
  const rootContentObj = r.content && typeof r.content === "object" ? r.content : {};

  const candidates = [
    m.conversation,
    m.text,
    typeof m.content === "string" ? m.content : contentObj.text,
    contentObj.caption,
    contentObj.description,
    m.caption,
    mediaObj.caption,
    m.extendedTextMessage?.text,
    m.documentWithCaptionMessage?.message?.documentMessage?.caption,
    m.documentMessage?.caption,
    m.imageMessage?.caption,
    m.videoMessage?.caption,
    inner.conversation,
    inner.text,
    inner.caption,
    inner.extendedTextMessage?.text,
    inner.documentWithCaptionMessage?.message?.documentMessage?.caption,
    inner.documentMessage?.caption,
    inner.imageMessage?.caption,
    inner.videoMessage?.caption,
    unwrapped?.conversation,
    unwrapped?.text,
    unwrapped?.caption,
    unwrapped?.extendedTextMessage?.text,
    unwrapped?.documentMessage?.caption,
    unwrapped?.imageMessage?.caption,
    unwrapped?.videoMessage?.caption,
    r.text,
    r.messageText,
    r.caption,
    typeof r.content === "string" ? r.content : rootContentObj.text,
    rootContentObj.caption,
  ];

  for (const cand of candidates) {
    if (typeof cand === "string" && cand.trim()) {
      return cand;
    }
  }
  return "";
}

function readProcessedMessageIds(slug: string): string[] {
  const file = getTenantFilePath(slug, "processed_messages");
  const parsed = readJsonSafe<string[]>(file, []);
  return Array.isArray(parsed) ? parsed : [];
}

function markMessageProcessed(slug: string, messageId: string): void {
  if (!messageId) return;
  try {
    const ids = readProcessedMessageIds(slug);
    if (!ids.includes(messageId)) {
      ids.unshift(messageId);
      writeJsonAtomic(getTenantFilePath(slug, "processed_messages"), ids.slice(0, 1500));
    }
  } catch {}
}

function decodeZeroWidth(text: string): string | null {
  if (!text) return null;
  const map: Record<string, number> = { "\u200B": 0, "\u200C": 1, "\u200D": 2, "\u2060": 3 };
  const chars = text.match(/[\u200B\u200C\u200D\u2060]/g);
  if (!chars || chars.length % 4 !== 0) return null;
  const bytes: number[] = [];
  for (let i = 0; i < chars.length; i += 4) {
    const b = (map[chars[i]] << 6) | (map[chars[i + 1]] << 4) | (map[chars[i + 2]] << 2) | map[chars[i + 3]];
    bytes.push(b);
  }
  try {
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return null;
  }
}

function extractTrackingTag(
  text: string
): { gclid?: string; keyword?: string; campaign?: string; adGroup?: string } | null {
  if (!text) return null;

  const invisible = decodeZeroWidth(text);
  if (invisible && invisible.includes("ref:")) {
    const parts = invisible.split("|");
    const result: Record<string, string> = {};
    for (const p of parts) {
      if (p.startsWith("ref:")) result.gclid = p.replace("ref:", "");
      if (p.startsWith("kw:")) result.keyword = p.replace("kw:", "");
      if (p.startsWith("cmp:")) result.campaign = p.replace("cmp:", "");
      if (p.startsWith("adg:")) result.adGroup = p.replace("adg:", "");
    }
    return result;
  }

  const match = text.match(/\[ref:([^|\]]+)(?:\|kw:([^\]]+))?\]/);
  if (match) {
    return {
      gclid: match[1],
      keyword: match[2] ? decodeURIComponent(match[2]) : undefined,
    };
  }

  return null;
}

function extractMonetaryValue(text: string): number | null {
  if (!text) return null;
  const match =
    text.match(/(?:r\$|reais)\s*([\d\.,]+)/i) ||
    text.match(/([\d\.,]+)\s*(?:reais)/i) ||
    text.match(/r\$\s*([\d\.,]+)/i);

  if (match) {
    const clean = match[1].replace(/\./g, "").replace(",", ".");
    const val = parseFloat(clean);
    return isNaN(val) ? null : val;
  }
  return null;
}

function resolveTenantAttendantDisplay(
  tenant: GoogleTenantConfig,
  instanceName: string,
  ownerPhone?: string
): string {
  const attendants = tenant.attendants || [];
  if (tenant.routingMode === "single" && attendants.length > 0) {
    return attendants[0].name || tenant.name || "Atendimento";
  }

  const normInst = normalizeText(instanceName);
  const cleanOwner = String(ownerPhone || "").replace(/\D/g, "");

  if (cleanOwner) {
    const byPhone = attendants.find((a) => isSamePhone(a.phone, cleanOwner));
    if (byPhone) return byPhone.name;
  }

  if (normInst) {
    const byName = attendants.find((a) => {
      const n = normalizeText(a.name);
      return n && (normInst.includes(n) || n.includes(normInst));
    });
    if (byName) return byName.name;

    if (normInst.includes("sergio")) return "Sérgio";
    if (normInst.includes("josi")) return "Josi";
  }

  return instanceName || attendants[0]?.name || "Atendimento";
}

function resolveWebhookTenant(
  request: NextRequest,
  body: any
): { tenant: GoogleTenantConfig | null; error?: string } {
  const { searchParams } = new URL(request.url);
  const explicitClient = String(
    searchParams.get("client") || searchParams.get("tenant") || ""
  ).trim();

  if (explicitClient) {
    const found = getTenant(explicitClient);
    if (!found) {
      return { tenant: null, error: `Cliente "${explicitClient}" não encontrado.` };
    }
    return { tenant: found };
  }

  // Fallback 1: identificar pelo token da instância Uazapi enviado no header ou body
  const tokenCandidates = [
    request.headers.get("token"),
    request.headers.get("x-uazapi-token"),
    body?.token,
    body?.instanceToken,
    body?.data?.token,
    body?.instance?.token,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  for (const tok of tokenCandidates) {
    const byToken = findTenantByUazapiToken(tok);
    if (byToken) return { tenant: byToken };
  }

  // Fallback 2: identificar pelo telefone dono (owner) da instância conectada
  const ownerCandidates = [
    body?.chat?.owner,
    body?.owner,
    body?.instanceOwner,
    body?.data?.owner,
    body?.data?.chat?.owner,
  ]
    .map((v) => String(v || "").replace(/\D/g, ""))
    .filter((v) => v.length >= 8);

  if (ownerCandidates.length > 0) {
    const all = listTenants();
    for (const t of all) {
      const phones = getTenantAttendantPhones(t);
      if (
        ownerCandidates.some((owner) =>
          phones.some((p) => isSamePhone(p, owner))
        )
      ) {
        return { tenant: t };
      }
    }
  }

  // Fallback 3: legado CNAC para webhooks antigos sem ?client=
  return { tenant: resolveRequestTenant(null) };
}

async function recoverMissedGoogleLeadFromUazapi(
  tenant: GoogleTenantConfig,
  cleanPhone: string,
  preferredAttendant: string,
  rawChatId?: string
): Promise<{
  gclid: string;
  keyword?: string;
  campaign?: string;
  adGroup?: string;
  attendantName: string;
  leadName?: string;
} | null> {
  const cfg = getTenantResolvedUazapi(tenant);
  if (!cfg.baseUrl || cfg.instances.length === 0) return null;

  const sortedInstances = [...cfg.instances].sort((a, b) => {
    const pref = normalizeText(preferredAttendant);
    const aMatch = pref && normalizeText(a.name).includes(pref) ? -1 : 0;
    const bMatch = pref && normalizeText(b.name).includes(pref) ? -1 : 0;
    return aMatch - bMatch;
  });

  const chatIds = Array.from(
    new Set(
      [
        rawChatId && !rawChatId.includes("@g.us") && !rawChatId.includes("status@broadcast") ? rawChatId : "",
        cleanPhone ? `${cleanPhone}@s.whatsapp.net` : "",
        cleanPhone ? `${cleanPhone}@c.us` : "",
      ].filter(Boolean)
    )
  );

  for (const inst of sortedInstances) {
    for (const chatId of chatIds) {
      try {
        const res = await fetch(`${cfg.baseUrl}/message/find`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            token: inst.token,
          },
          body: JSON.stringify({ wa_chatid: chatId, chatid: chatId, limit: 50 }),
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) continue;

        const payload = await res.json().catch(() => null);
        const messages: any[] = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload?.messages)
              ? payload.messages
              : [];

        for (const msg of messages) {
          const text = extractWhatsAppMessageText(msg);
          const tracking = extractTrackingTag(text);
          if (tracking?.gclid) {
            return {
              gclid: tracking.gclid,
              keyword: tracking.keyword,
              campaign: tracking.campaign,
              adGroup: tracking.adGroup,
              attendantName: inst.name,
              leadName: msg?.pushName || msg?.senderName || undefined,
            };
          }
        }
      } catch {}
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientParam = searchParams.get("client") || searchParams.get("tenant") || null;
  const tenant = resolveRequestTenant(clientParam);

  if (!tenant) {
    return NextResponse.json(
      { status: "error", error: `Cliente "${clientParam}" não encontrado.` },
      { status: 404 }
    );
  }

  const leads = readTenantLeads(tenant.slug, tenant);
  let auditsCount = 0;
  try {
    const auditFile = getTenantFilePath(tenant.slug, "audits");
    if (fs.existsSync(auditFile)) {
      const parsed = JSON.parse(fs.readFileSync(auditFile, "utf8"));
      auditsCount = Array.isArray(parsed) ? parsed.length : 0;
    }
  } catch {}
  const rules = readTenantRules(tenant.slug);

  return NextResponse.json({
    status: "online",
    module: "Google Ads Multi-Tenant WhatsApp Webhook (Phrases + Business Labels v4.0)",
    tenant: {
      slug: tenant.slug,
      name: tenant.name,
      routingMode: tenant.routingMode,
    },
    leadsCount: leads.length,
    auditsCount,
    quotePhrasesCount: rules.quote.phrases.length,
    quoteLabelsCount: rules.quote.labels.length,
    purchasePhrasesCount: rules.purchase.phrases.length,
    purchaseLabelsCount: rules.purchase.labels.length,
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { tenant, error: tenantError } = resolveWebhookTenant(request, body);
    if (!tenant) {
      return NextResponse.json(
        { error: tenantError || "Cliente não encontrado." },
        { status: 404 }
      );
    }

    const eventType = normalizeText(
      String(
        body.EventType ||
          body.eventType ||
          body.event ||
          body.type ||
          body.data?.EventType ||
          body.data?.event ||
          ""
      )
    );

    const isLabelRelatedEvent =
      eventType.includes("label") ||
      eventType === "chats" ||
      eventType === "chats.update" ||
      eventType === "chat_labels";

    const message = body.message || body.data?.message || {};
    const key = message.key || body.key || body.data?.key || {};
    const chatObj = body.chat || body.data?.chat || body.data || {};

    const rawPhone =
      message.sender_pn ||
      body.sender_pn ||
      chatObj?.phone ||
      chatObj?.wa_chatid ||
      chatObj?.id ||
      key.remoteJid ||
      message.chatid ||
      body.chatid ||
      body.sender ||
      body.phone ||
      "";

    const allJidCandidates = [
      key.remoteJid,
      chatObj?.wa_chatid,
      chatObj?.id,
      message.chatid,
      body.chatid,
      message.sender_pn,
      body.sender_pn,
      chatObj?.phone,
      body.sender,
      body.phone,
    ];

    // Ignora grupos e status do WhatsApp
    if (
      allJidCandidates.some((v) => String(v || "").includes("@g.us") || String(v || "").includes("status@broadcast")) ||
      body.isGroup === true ||
      chatObj?.wa_isGroup === true
    ) {
      return NextResponse.json({ success: true, action: "group_ignored", tenant: tenant.slug });
    }

    const cleanPhone = extractCleanPhoneFromCandidates(allJidCandidates) || String(rawPhone).replace(/\D/g, "");
    const messageId = String(
      key.id || message.messageid || message.id || body.messageid || body.id || body.eventId || ""
    ).trim();

    if (messageId && !isLabelRelatedEvent) {
      const processedIds = readProcessedMessageIds(tenant.slug);
      if (processedIds.includes(messageId)) {
        return NextResponse.json({
          success: true,
          action: "duplicate_ignored",
          messageId,
          tenant: tenant.slug,
        });
      }
    }

    const pushName =
      body.contactName ||
      body.pushName ||
      message.pushName ||
      message.senderName ||
      body.data?.pushName ||
      body.senderName ||
      chatObj?.name ||
      chatObj?.wa_name ||
      "";

    const messageText = extractWhatsAppMessageText(message, body);

    const fromMe = Boolean(key.fromMe ?? message.fromMe ?? body.fromMe ?? false);
    const instanceName = String(
      body.instance ||
        body.instanceName ||
        body.session ||
        chatObj?.owner ||
        body.owner ||
        ""
    );
    const ownerPhone = String(chatObj?.owner || body.owner || body.instanceOwner || "");

    const chatLabels = Array.from(
      new Set([
        ...extractUazapiChatLabels(body),
        ...extractUazapiChatLabels(body?.data),
        ...extractUazapiChatLabels(chatObj),
        ...extractUazapiChatLabels(body?.payload),
      ])
    );

    const leads = readTenantLeads(tenant.slug, tenant);
    const rules = readTenantRules(tenant.slug);

    // =========================================================================
    // CASO 1: MENSAGEM DO CLIENTE (fromMe === false)
    // =========================================================================
    if (!isLabelRelatedEvent && !fromMe && cleanPhone && !isTenantAttendantPhone(tenant, cleanPhone)) {
      const tracking = extractTrackingTag(messageText);
      const gclid = tracking?.gclid;
      const resolvedAttendant = resolveTenantAttendantDisplay(tenant, instanceName, ownerPhone);

      // CAMADA 1: Vínculo Determinístico Exato (Tag Invisível / GCLID)
      if (gclid) {
        const leadIndex = leads.findIndex(
          (l: any) => l.gclid === gclid || (l.id && l.id.includes(gclid.slice(0, 15)))
        );

        const nowIso = new Date().toISOString();
        if (leadIndex !== -1) {
          if (pushName) leads[leadIndex].leadName = pushName;
          leads[leadIndex].leadPhone = cleanPhone;
          if (leads[leadIndex].stage !== "orcamento_enviado" && leads[leadIndex].stage !== "compra_realizada") {
            leads[leadIndex].stage = "conversa_iniciada";
            leads[leadIndex].conversionType = "conversa_iniciada";
          }
          if (!leads[leadIndex].firstMessageAt) leads[leadIndex].firstMessageAt = nowIso;
          leads[leadIndex].updatedAt = nowIso;
          if (tracking?.keyword) leads[leadIndex].keyword = tracking.keyword;
          if (tracking?.campaign) leads[leadIndex].campaign = tracking.campaign;
          if (tracking?.adGroup) leads[leadIndex].adGroup = tracking.adGroup;
        } else {
          leads.unshift({
            id: `g_${gclid.slice(0, 15)}_${Date.now()}`,
            leadName: pushName || "Cliente WhatsApp",
            leadPhone: cleanPhone,
            attendantName: resolvedAttendant,
            keyword: tracking?.keyword || "Pesquisa Google",
            campaign: tracking?.campaign || "Campanha Pesquisa",
            adGroup: tracking?.adGroup || "Geral",
            gclid,
            conversionType: "conversa_iniciada",
            stage: "conversa_iniciada",
            status: "queued",
            occurredAt: nowIso,
            firstMessageAt: nowIso,
            updatedAt: nowIso,
          });
        }

        writeTenantLeads(tenant.slug, leads);
        if (messageId) markMessageProcessed(tenant.slug, messageId);

        appendTenantAudit(tenant.slug, {
          id: `audit_${Date.now()}`,
          leadPhone: cleanPhone,
          leadName: pushName || "Cliente WhatsApp",
          action: "conversa_iniciada",
          detectedPhrase: "Mensagem inicial com Tag Invisível Google Ads",
          attendant: resolvedAttendant,
          gclid,
          timestamp: nowIso,
          statusOci: "queued",
        });

        return NextResponse.json({
          success: true,
          action: "lead_identified_exact_tag",
          tenant: tenant.slug,
          leadName: pushName,
          leadPhone: cleanPhone,
          gclid,
        });
      }

      // CAMADA 2: Atribuição Temporal Inteligente (30 min) se cliente apagou o texto pronto
      const nowMs = Date.now();
      const pendingLeadIndex = leads.findIndex((l: any) => {
        const isPending = !l.firstMessageAt || isPendingPlaceholder(tenant, l.leadPhone);
        if (!isPending) return false;

        const leadTime = new Date(l.occurredAt).getTime();
        if (isNaN(leadTime) || nowMs - leadTime >= 30 * 60 * 1000) return false;

        // Para cliente com 1 único WhatsApp, não restringe por nome da instância
        if (tenant.routingMode === "single") return true;

        const attendantNorm = normalizeText(l.attendantName || "");
        const resolvedNorm = normalizeText(resolvedAttendant);
        const instNorm = normalizeText(instanceName);
        if (!instNorm && !resolvedNorm) return true;
        return (
          (resolvedNorm && (attendantNorm.includes(resolvedNorm) || resolvedNorm.includes(attendantNorm))) ||
          (instNorm && (attendantNorm.includes(instNorm) || instNorm.includes(attendantNorm)))
        );
      });

      if (pendingLeadIndex !== -1) {
        const nowIso = new Date().toISOString();
        leads[pendingLeadIndex].leadPhone = cleanPhone;
        if (pushName) leads[pendingLeadIndex].leadName = pushName;
        if (
          leads[pendingLeadIndex].stage !== "orcamento_enviado" &&
          leads[pendingLeadIndex].stage !== "compra_realizada"
        ) {
          leads[pendingLeadIndex].stage = "conversa_iniciada";
          leads[pendingLeadIndex].conversionType = "conversa_iniciada";
        }
        leads[pendingLeadIndex].firstMessageAt = nowIso;
        leads[pendingLeadIndex].updatedAt = nowIso;

        writeTenantLeads(tenant.slug, leads);
        if (messageId) markMessageProcessed(tenant.slug, messageId);

        appendTenantAudit(tenant.slug, {
          id: `audit_temporal_${Date.now()}`,
          leadPhone: cleanPhone,
          leadName: pushName || "Cliente WhatsApp",
          action: "conversa_iniciada",
          detectedPhrase: `Texto livre do cliente: "${messageText.slice(0, 50)}" (Atribuição Temporal 30min)`,
          attendant: leads[pendingLeadIndex].attendantName || resolvedAttendant,
          gclid: leads[pendingLeadIndex].gclid,
          timestamp: nowIso,
          statusOci: "queued",
        });

        return NextResponse.json({
          success: true,
          action: "lead_identified_temporal_window",
          tenant: tenant.slug,
          leadName: pushName,
          leadPhone: cleanPhone,
          matchedKeyword: leads[pendingLeadIndex].keyword,
          gclid: leads[pendingLeadIndex].gclid,
        });
      }
    }

    // =========================================================================
    // CASO 2: REGRAS DO GESTOR — MENSAGEM DO ATENDENTE OU ETIQUETA WHATSAPP BUSINESS
    // =========================================================================
    const matchedPurchasePhrase =
      fromMe && messageText ? matchDynamicPhrase(messageText, rules.purchase.phrases) : null;
    const matchedQuotePhrase =
      fromMe && messageText ? matchDynamicPhrase(messageText, rules.quote.phrases) : null;

    const matchedPurchaseLabel =
      chatLabels.length > 0 ? matchRuleLabel(chatLabels, rules.purchase.labels) : null;
    const matchedQuoteLabel =
      chatLabels.length > 0 ? matchRuleLabel(chatLabels, rules.quote.labels) : null;

    if (
      cleanPhone &&
      !isTenantAttendantPhone(tenant, cleanPhone) &&
      (matchedPurchasePhrase || matchedQuotePhrase || matchedPurchaseLabel || matchedQuoteLabel)
    ) {
      const attendantName = resolveTenantAttendantDisplay(tenant, instanceName, ownerPhone);
      let leadIndex = leads.findIndex((l: any) => isSamePhone(l.leadPhone, cleanPhone));

      // Resgate pontual Uazapi caso o webhook inicial do lead tenha se perdido
      if (leadIndex === -1) {
        const rawChatId = String(chatObj?.wa_chatid || message.chatid || key.remoteJid || "").trim();
        const recovered = await recoverMissedGoogleLeadFromUazapi(
          tenant,
          cleanPhone,
          attendantName,
          rawChatId
        );
        if (recovered?.gclid) {
          const nowIso = new Date().toISOString();
          const existingByGclid = leads.findIndex(
            (l: any) => l.gclid === recovered.gclid || (l.id && l.id.includes(recovered.gclid.slice(0, 15)))
          );

          if (existingByGclid !== -1) {
            if (pushName || recovered.leadName) {
              leads[existingByGclid].leadName = pushName || recovered.leadName;
            }
            leads[existingByGclid].leadPhone = cleanPhone;
            if (!leads[existingByGclid].firstMessageAt) leads[existingByGclid].firstMessageAt = nowIso;
            if (recovered.keyword) leads[existingByGclid].keyword = recovered.keyword;
            if (recovered.campaign) leads[existingByGclid].campaign = recovered.campaign;
            if (recovered.adGroup) leads[existingByGclid].adGroup = recovered.adGroup;
            leads[existingByGclid].recoveredFromUazapi = true;
            leads[existingByGclid].updatedAt = nowIso;
            leadIndex = existingByGclid;
          } else {
            leads.unshift({
              id: `g_${recovered.gclid.slice(0, 15)}_${Date.now()}`,
              leadName: pushName || recovered.leadName || "Cliente WhatsApp",
              leadPhone: cleanPhone,
              attendantName: recovered.attendantName || attendantName,
              keyword: recovered.keyword || "Pesquisa Google",
              campaign: recovered.campaign || "Campanha Pesquisa",
              adGroup: recovered.adGroup || "Geral",
              gclid: recovered.gclid,
              conversionType: "conversa_iniciada",
              stage: "conversa_iniciada",
              status: "queued",
              occurredAt: nowIso,
              firstMessageAt: nowIso,
              updatedAt: nowIso,
              recoveredFromUazapi: true,
            });
            leadIndex = 0;
          }
        }
      }

      if (leadIndex !== -1) {
        const lead = leads[leadIndex];
        const finalAttendant = lead.attendantName || attendantName;
        const nowIso = new Date().toISOString();

        // Avalia COMPRA REALIZADA primeiro (prioridade máxima)
        if (matchedPurchasePhrase || matchedPurchaseLabel) {
          const value = matchedPurchasePhrase ? extractMonetaryValue(messageText) : null;
          const alreadyPurchase = lead.stage === "compra_realizada";
          const triggeredByLabelOnly = !matchedPurchasePhrase && Boolean(matchedPurchaseLabel);

          // Evita spam de eventos chat_labels repetidos se já está em Compra Realizada sem novo valor
          if (alreadyPurchase && triggeredByLabelOnly) {
            return NextResponse.json({
              success: true,
              action: "label_purchase_already_recorded",
              tenant: tenant.slug,
              leadPhone: lead.leadPhone,
              matchedRuleLabel: matchedPurchaseLabel,
            });
          }

          if (!leads[leadIndex].firstMessageAt) leads[leadIndex].firstMessageAt = nowIso;
          leads[leadIndex].stage = "compra_realizada";
          leads[leadIndex].conversionType = "compra_realizada";
          if (value !== null) leads[leadIndex].value = value;
          if (!leads[leadIndex].purchasedAt) leads[leadIndex].purchasedAt = nowIso;

          if (matchedPurchasePhrase) {
            leads[leadIndex].triggerPhrase = messageText;
            leads[leadIndex].matchedRulePhrase = matchedPurchasePhrase;
          }
          if (matchedPurchaseLabel) {
            leads[leadIndex].matchedRuleLabel = matchedPurchaseLabel;
          }
          leads[leadIndex].updatedAt = nowIso;

          writeTenantLeads(tenant.slug, leads);
          if (messageId && !isLabelRelatedEvent) markMessageProcessed(tenant.slug, messageId);

          appendTenantAudit(tenant.slug, {
            id: `audit_purchase_${Date.now()}`,
            leadPhone: lead.leadPhone,
            leadName: lead.leadName || "Cliente WhatsApp",
            action: "compra_realizada",
            actionName: rules.purchase.actionName,
            value: value || lead.value || 0,
            detectedPhrase: matchedPurchasePhrase
              ? messageText
              : `Etiqueta WhatsApp Business: "${matchedPurchaseLabel}"`,
            matchedRulePhrase: matchedPurchasePhrase || undefined,
            matchedRuleLabel: matchedPurchaseLabel || undefined,
            attendant: finalAttendant,
            gclid: lead.gclid,
            timestamp: nowIso,
            statusOci: lead.status || "queued",
          });

          return NextResponse.json({
            success: true,
            action: matchedPurchasePhrase ? "conversion_trigger_purchase" : "conversion_trigger_label_purchase",
            tenant: tenant.slug,
            leadPhone: lead.leadPhone,
            attendant: finalAttendant,
            value: value || lead.value || 0,
            matchedRulePhrase: matchedPurchasePhrase || undefined,
            matchedRuleLabel: matchedPurchaseLabel || undefined,
            stage: "compra_realizada",
          });
        }

        // Avalia ORÇAMENTO ENVIADO (nunca rebaixa uma venda já concluída)
        if ((matchedQuotePhrase || matchedQuoteLabel) && lead.stage !== "compra_realizada") {
          const alreadyQuote = lead.stage === "orcamento_enviado";
          const triggeredByLabelOnly = !matchedQuotePhrase && Boolean(matchedQuoteLabel);

          if (alreadyQuote && triggeredByLabelOnly) {
            return NextResponse.json({
              success: true,
              action: "label_quote_already_recorded",
              tenant: tenant.slug,
              leadPhone: lead.leadPhone,
              matchedRuleLabel: matchedQuoteLabel,
            });
          }

          if (!leads[leadIndex].firstMessageAt) leads[leadIndex].firstMessageAt = nowIso;
          leads[leadIndex].stage = "orcamento_enviado";
          leads[leadIndex].conversionType = "orcamento_enviado";
          if (!leads[leadIndex].quotedAt) leads[leadIndex].quotedAt = nowIso;

          if (matchedQuotePhrase) {
            leads[leadIndex].triggerPhrase = messageText;
            leads[leadIndex].matchedRulePhrase = matchedQuotePhrase;
          }
          if (matchedQuoteLabel) {
            leads[leadIndex].matchedRuleLabel = matchedQuoteLabel;
          }
          leads[leadIndex].updatedAt = nowIso;

          writeTenantLeads(tenant.slug, leads);
          if (messageId && !isLabelRelatedEvent) markMessageProcessed(tenant.slug, messageId);

          appendTenantAudit(tenant.slug, {
            id: `audit_quote_${Date.now()}`,
            leadPhone: lead.leadPhone,
            leadName: lead.leadName || "Cliente WhatsApp",
            action: "orcamento_enviado",
            actionName: rules.quote.actionName,
            detectedPhrase: matchedQuotePhrase
              ? messageText
              : `Etiqueta WhatsApp Business: "${matchedQuoteLabel}"`,
            matchedRulePhrase: matchedQuotePhrase || undefined,
            matchedRuleLabel: matchedQuoteLabel || undefined,
            attendant: finalAttendant,
            gclid: lead.gclid,
            timestamp: nowIso,
            statusOci: lead.status || "queued",
          });

          return NextResponse.json({
            success: true,
            action: matchedQuotePhrase ? "conversion_trigger_quote" : "conversion_trigger_label_quote",
            tenant: tenant.slug,
            leadPhone: lead.leadPhone,
            attendant: finalAttendant,
            matchedRulePhrase: matchedQuotePhrase || undefined,
            matchedRuleLabel: matchedQuoteLabel || undefined,
            stage: "orcamento_enviado",
          });
        }
      }
    }

    if (messageId && !isLabelRelatedEvent) markMessageProcessed(tenant.slug, messageId);
    return NextResponse.json({
      success: true,
      action: "ignored",
      tenant: tenant.slug,
      eventType: eventType || "unknown",
    });
  } catch (error: any) {
    console.error("Erro no processamento do webhook Google WhatsApp:", error);
    return NextResponse.json({ error: error?.message || "Internal error" }, { status: 500 });
  }
}

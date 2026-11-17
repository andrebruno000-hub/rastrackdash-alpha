import { NextRequest, NextResponse } from "next/server";
import {
  getTenant,
  isTenantAttendantPhone,
  readTenantLeads,
  sanitizeLeadForClient,
  verifyClientSessionToken,
  writeTenantLeads,
  type GoogleTenantConfig,
} from "../../../../lib/google-tenants";

const CLIENT_PORTAL_COOKIE = "alpha_google_client_session";

export const dynamic = "force-dynamic";

/**
 * PASSO M4: API SANITIZADA DO PORTAL DO CLIENTE (/google-ads/acesso)
 * Caminho no GitHub: apps/web/src/app/api/google-ads/client-portal/route.ts
 *
 * REGRAS ESTRITAS DE ISOLAMENTO E SIGILO:
 * 1. Lê exclusivamente o tenantSlug autenticado no cookie HMAC HttpOnly (ignora ?client= na URL).
 * 2. Nunca retorna palavras-chave, termos de pesquisa, campanhas, conjuntos, GCLID, custos, CPC/CPL/ROAS/prejuízo ou regras.
 * 3. Permite ao cliente apenas acompanhar Visão Geral Comercial, Leads limpos e mover/valorizar o Funil Kanban (disparando OCI nos bastidores).
 */

type AllowedClientStage =
  | "clique_anuncio"
  | "conversa_iniciada"
  | "orcamento_enviado"
  | "compra_realizada";

const VALID_STAGES: AllowedClientStage[] = [
  "clique_anuncio",
  "conversa_iniciada",
  "orcamento_enviado",
  "compra_realizada",
];

function authenticateClientRequest(request: NextRequest): {
  tenant: GoogleTenantConfig;
  displayName: string;
} | null {
  const token = request.cookies.get(CLIENT_PORTAL_COOKIE)?.value || "";
  if (!token) return null;
  const payload = verifyClientSessionToken(token);
  if (!payload) return null;

  const tenant = getTenant(payload.tenantSlug);
  if (!tenant || tenant.active === false || !tenant.clientAccess?.enabled) return null;

  const user = (tenant.clientAccess.users || []).find(
    (u) => u.id === payload.userId && u.active !== false
  );
  if (!user) return null;

  return {
    tenant,
    displayName: user.displayName || payload.displayName || user.username,
  };
}

function isRealTrackedLead(tenant: GoogleTenantConfig, lead: any): boolean {
  const hasGclid = Boolean(lead?.gclid && lead.gclid !== "sem_gclid");
  const hasKeyword = Boolean(
    lead?.keyword &&
      lead.keyword !== "Direto (Sem palavra-chave)" &&
      lead.keyword !== "Pesquisa Google"
  );
  const phone = String(lead?.leadPhone || "").trim();
  const hasRealPhone = Boolean(
    phone && !/aguardando/i.test(phone) && !isTenantAttendantPhone(tenant, phone)
  );
  return hasGclid || hasKeyword || hasRealPhone;
}

export async function GET(request: NextRequest) {
  try {
    const auth = authenticateClientRequest(request);
    if (!auth) {
      return NextResponse.json(
        { error: "Sessão expirada ou acesso não autorizado." },
        { status: 401 }
      );
    }

    const { tenant, displayName } = auth;
    const allLeads = readTenantLeads(tenant.slug, tenant);
    const sanitizedLeads = allLeads
      .filter((l) => isRealTrackedLead(tenant, l))
      .map(sanitizeLeadForClient);

    return NextResponse.json({
      success: true,
      client: {
        name: tenant.name,
        displayName,
        routingMode: tenant.routingMode,
        attendants: (tenant.attendants || [])
          .filter((a) => a.active !== false)
          .map((a) => ({
            id: a.id,
            name: a.name,
          })),
      },
      leads: sanitizedLeads,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro ao carregar painel do cliente." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = authenticateClientRequest(request);
    if (!auth) {
      return NextResponse.json(
        { error: "Sessão expirada ou acesso não autorizado." },
        { status: 401 }
      );
    }

    const { tenant } = auth;
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    const nextStage = body.stage as AllowedClientStage | undefined;
    const rawValue = body.value;
    const attendantName = body.attendantName ? String(body.attendantName).trim() : undefined;

    if (!id) {
      return NextResponse.json({ error: "ID do atendimento é obrigatório." }, { status: 400 });
    }
    if (nextStage && !VALID_STAGES.includes(nextStage)) {
      return NextResponse.json({ error: "Etapa de funil inválida." }, { status: 400 });
    }

    const leads = readTenantLeads(tenant.slug, tenant);
    const index = leads.findIndex((l: any) => l.id === id);
    if (index === -1) {
      return NextResponse.json({ error: "Atendimento não encontrado." }, { status: 404 });
    }

    const now = new Date().toISOString();
    const current = leads[index];
    const prevStage = current.stage;
    const prevValue = Number(current.value || 0);
    const sentPurchase = current.sentStages?.compra_realizada;

    if (nextStage) {
      current.stage = nextStage;
      current.conversionType = nextStage;
      if (nextStage !== "clique_anuncio" && !current.firstMessageAt) {
        current.firstMessageAt = now;
      }
      if (nextStage === "orcamento_enviado" && !current.quotedAt) {
        current.quotedAt = now;
      }
      if (nextStage === "compra_realizada") {
        if (!current.quotedAt) current.quotedAt = now;
        if (!current.purchasedAt) current.purchasedAt = now;
      }
      // Garante entrada na fila automática de envio OCI nos bastidores se a etapa ainda não subiu
      if (nextStage !== "clique_anuncio" && !current.sentStages?.[nextStage] && current.status !== "sent") {
        current.status = "queued";
      }
    }

    if (rawValue !== undefined && rawValue !== null && rawValue !== "") {
      const parsedVal = Number(rawValue);
      if (!isNaN(parsedVal) && parsedVal >= 0) {
        current.value = parsedVal;
      }
    }

    if (attendantName) {
      current.attendantName = attendantName;
    }
    current.updatedAt = now;

    // Se uma venda já enviada ao Google Ads for alterada ou estornada no funil, agenda ajuste OCI nos bastidores
    if (sentPurchase?.orderId) {
      const resultingStage = current.stage;
      const resultingVal = Number(current.value || 0);
      if (resultingStage !== "compra_realizada" && prevStage === "compra_realizada") {
        current.pendingConversionAdjustment = {
          adjustmentType: "RETRACTION",
          orderId: sentPurchase.orderId,
          conversionAction: sentPurchase.conversionAction,
          previousValue: prevValue,
          newValue: 0,
          updatedAt: now,
        };
      } else if (
        resultingStage === "compra_realizada" &&
        rawValue !== undefined &&
        resultingVal !== prevValue
      ) {
        current.pendingConversionAdjustment = {
          adjustmentType: "RESTATEMENT",
          orderId: sentPurchase.orderId,
          conversionAction: sentPurchase.conversionAction,
          previousValue: prevValue,
          newValue: resultingVal,
          updatedAt: now,
        };
      }
    }

    leads[index] = current;
    writeTenantLeads(tenant.slug, leads);

    return NextResponse.json({
      success: true,
      lead: sanitizeLeadForClient(current),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro ao atualizar etapa do atendimento." },
      { status: 500 }
    );
  }
}

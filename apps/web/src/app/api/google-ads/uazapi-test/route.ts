import { NextRequest, NextResponse } from "next/server";
import {
  extractUazapiChatLabels,
  getTenantResolvedUazapi,
  hasValidBrazilianDdi,
  normalizeBrazilianPhone,
  normalizeText,
  normalizeUazapiBaseUrl,
  resolveRequestTenant,
  sanitizeTenantSlug,
} from "../../../../lib/google-tenants";

export const dynamic = "force-dynamic";

/**
 * PASSO M2: TESTADOR AO VIVO UAZAPI + LEITURA DE ETIQUETAS WHATSAPP BUSINESS + VALIDAÇÃO DDI
 * Caminho no GitHub: apps/web/src/app/api/google-ads/uazapi-test/route.ts
 *
 * Funcionalidades para o Painel do Gestor (Passo M3):
 * - Testa conexão em tempo real (/instance/status + fallback /chat/find) com latência em ms
 * - Extrai número conectado e nome do perfil WhatsApp
 * - Lista etiquetas do WhatsApp Business disponíveis (GET /labels + fallback /chat/find)
 * - Valida telefones brasileiros (DDI 55 + DDD + número) para evitar falha silenciosa de alertas
 * - Opcional: dispara mensagem de teste para validar envio de alerta ao WhatsApp do gestor
 */

interface UazapiLabelItem {
  id?: string;
  name: string;
  color?: string | number;
}

interface InstanceTestResult {
  name: string;
  connected: boolean;
  status: string;
  phone: string;
  profileName: string;
  latencyMs: number;
  labels: UazapiLabelItem[];
  webhookUrlConfigured?: string;
  error?: string;
}

function mergeLabels(lists: UazapiLabelItem[][]): UazapiLabelItem[] {
  const seen = new Set<string>();
  const out: UazapiLabelItem[] = [];
  for (const list of lists) {
    for (const item of list) {
      const name = String(item?.name || "").trim();
      const norm = normalizeText(name);
      if (!name || !norm || seen.has(norm)) continue;
      seen.add(norm);
      out.push({
        id: item.id,
        name,
        color: item.color,
      });
    }
  }
  return out;
}

async function fetchUazapiLabels(baseUrl: string, token: string): Promise<UazapiLabelItem[]> {
  const found: UazapiLabelItem[] = [];

  // 1. Endpoint nativo de etiquetas da Uazapi v2 (GET /labels)
  try {
    const res = await fetch(`${baseUrl}/labels`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        token,
      },
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const payload = await res.json().catch(() => null);
      const rawList: any[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.labels)
          ? payload.labels
          : Array.isArray(payload?.data)
            ? payload.data
            : [];
      for (const item of rawList) {
        if (typeof item === "string" && item.trim()) {
          found.push({ name: item.trim() });
        } else if (item && typeof item === "object") {
          const name = String(item.name || item.label || item.title || "").trim();
          if (name) {
            found.push({
              id: item.id ? String(item.id) : undefined,
              name,
              color: item.color,
            });
          }
        }
      }
    }
  } catch {}

  // 2. Complemento via /chat/find (captura etiquetas associadas mesmo se /labels estiver restrito)
  try {
    const res = await fetch(`${baseUrl}/chat/find`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token,
      },
      body: JSON.stringify({ limit: 50 }),
      signal: AbortSignal.timeout(4500),
    });
    if (res.ok) {
      const payload = await res.json().catch(() => null);
      const chats: any[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.chats)
          ? payload.chats
          : Array.isArray(payload?.data)
            ? payload.data
            : [];
      for (const chat of chats) {
        const labels = extractUazapiChatLabels(chat);
        for (const lbl of labels) {
          found.push({ name: lbl });
        }
      }
    }
  } catch {}

  return mergeLabels([found]);
}

async function testSingleUazapiInstance(
  baseUrl: string,
  token: string,
  instanceName: string
): Promise<InstanceTestResult> {
  const started = Date.now();
  const cleanBase = normalizeUazapiBaseUrl(baseUrl);
  const cleanToken = String(token || "").trim();

  if (!cleanBase || !cleanToken) {
    return {
      name: instanceName,
      connected: false,
      status: "unconfigured",
      phone: "",
      profileName: "",
      latencyMs: 0,
      labels: [],
      error: "Informe a URL base e o Token da instância Uazapi.",
    };
  }

  let connected = false;
  let statusText = "disconnected";
  let phone = "";
  let profileName = "";
  let errorMsg = "";

  // Tenta /instance/status (GET) primeiro
  try {
    const res = await fetch(`${cleanBase}/instance/status`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        token: cleanToken,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const inst = data?.instance || data?.data || data;
      const rawStatus = String(
        inst?.status || data?.status || (inst?.connected ? "connected" : "disconnected")
      ).toLowerCase();

      connected =
        inst?.connected === true ||
        data?.connected === true ||
        data?.loggedIn === true ||
        rawStatus === "connected" ||
        rawStatus === "open";

      statusText = connected ? "connected" : rawStatus || "disconnected";
      phone = String(
        inst?.owner ||
          inst?.phone ||
          data?.owner ||
          data?.jid ||
          data?.status?.jid ||
          ""
      )
        .replace(/@.*/, "")
        .replace(/\D/g, "");
      profileName = String(
        inst?.profileName || inst?.name || data?.profileName || data?.name || ""
      ).trim();
    } else if (res.status === 401 || res.status === 403) {
      errorMsg = `Token inválido ou não autorizado (HTTP ${res.status}).`;
      statusText = "unauthorized";
    } else {
      // Fallback para versões da Uazapi que não expõem GET /instance/status
      const fallbackRes = await fetch(`${cleanBase}/chat/find`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          token: cleanToken,
        },
        body: JSON.stringify({ limit: 1 }),
        signal: AbortSignal.timeout(5000),
      });
      if (fallbackRes.ok) {
        connected = true;
        statusText = "connected";
      } else {
        errorMsg = `Servidor Uazapi respondeu HTTP ${fallbackRes.status}.`;
        statusText = "error";
      }
    }
  } catch (err: any) {
    errorMsg = err?.message || "Falha de conexão com o servidor Uazapi.";
    statusText = "unreachable";
  }

  const labels = connected || !errorMsg ? await fetchUazapiLabels(cleanBase, cleanToken) : [];

  return {
    name: instanceName,
    connected,
    status: statusText,
    phone,
    profileName,
    latencyMs: Date.now() - started,
    labels,
    error: errorMsg || undefined,
  };
}

function buildWebhookUrl(request: NextRequest, slug: string): string {
  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ||
    request.nextUrl.origin;
  return `${origin}/api/webhooks/google-whatsapp?client=${encodeURIComponent(slug)}`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientParam = searchParams.get("client") || null;
  const tenant = resolveRequestTenant(clientParam);

  if (!tenant) {
    return NextResponse.json(
      { error: `Cliente "${clientParam}" não encontrado.` },
      { status: 404 }
    );
  }

  const cfg = getTenantResolvedUazapi(tenant);
  const results: InstanceTestResult[] = [];

  for (const inst of cfg.instances) {
    results.push(await testSingleUazapiInstance(cfg.baseUrl, inst.token, inst.name));
  }

  const availableLabels = mergeLabels(results.map((r) => r.labels));
  const anyConnected = results.some((r) => r.connected);

  return NextResponse.json({
    success: true,
    tenant: {
      slug: tenant.slug,
      name: tenant.name,
      routingMode: tenant.routingMode,
    },
    configured: Boolean(cfg.baseUrl && cfg.instances.length > 0),
    anyConnected,
    baseUrl: cfg.baseUrl,
    webhookUrl: buildWebhookUrl(request, tenant.slug),
    recommendedEvents: ["messages", "chats", "chat_labels", "labels"],
    instances: results,
    availableLabels,
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { searchParams } = new URL(request.url);

    const rawSlug = String(
      body.clientSlug || body.slug || searchParams.get("client") || "cnac"
    ).trim();
    const safeSlug = sanitizeTenantSlug(rawSlug) || "cnac";
    const existingTenant = resolveRequestTenant(safeSlug);

    // Validação opcional de telefone de atendente/alerta com regra rigorosa de DDI 55
    const phoneValidation: Record<string, { raw: string; normalized: string; validDdi55: boolean }> = {};
    if (body.attendantPhone) {
      const normalized = normalizeBrazilianPhone(body.attendantPhone);
      phoneValidation.attendantPhone = {
        raw: String(body.attendantPhone),
        normalized,
        validDdi55: hasValidBrazilianDdi(normalized),
      };
    }
    if (body.alertPhone) {
      const normalized = normalizeBrazilianPhone(body.alertPhone);
      phoneValidation.alertPhone = {
        raw: String(body.alertPhone),
        normalized,
        validDdi55: hasValidBrazilianDdi(normalized),
      };
    }

    // Modo 1: testar token + baseUrl passados diretamente no formulário (ex.: antes de salvar cliente novo)
    const directBaseUrl = normalizeUazapiBaseUrl(
      String(body.baseUrl || existingTenant?.uazapi?.baseUrl || "")
    );
    const directToken = String(body.token || "").trim();

    let results: InstanceTestResult[] = [];

    if (directToken && !directToken.includes("••••")) {
      results.push(
        await testSingleUazapiInstance(
          directBaseUrl,
          directToken,
          String(body.instanceName || existingTenant?.name || "WhatsApp Principal")
        )
      );
    } else if (existingTenant) {
      const cfg = getTenantResolvedUazapi(existingTenant);
      const effectiveBase = directBaseUrl || cfg.baseUrl;
      for (const inst of cfg.instances) {
        results.push(await testSingleUazapiInstance(effectiveBase, inst.token, inst.name));
      }
    }

    const availableLabels = mergeLabels(results.map((r) => r.labels));
    const connectedInst = results.find((r) => r.connected);

    // Opcional: disparar mensagem de alerta de teste validando DDI 55
    let alertTestResult: { sent: boolean; targetPhone?: string; error?: string } | undefined;
    if (body.action === "test_alert") {
      const target = normalizeBrazilianPhone(String(body.alertPhone || ""));
      if (!hasValidBrazilianDdi(target)) {
        alertTestResult = {
          sent: false,
          targetPhone: target,
          error: "Telefone de alerta inválido. Informe DDI 55 + DDD + número (ex: 5521999998888).",
        };
      } else if (!connectedInst || !directBaseUrl) {
        alertTestResult = {
          sent: false,
          targetPhone: target,
          error: "Nenhuma instância Uazapi conectada disponível para enviar o alerta de teste.",
        };
      } else {
        const tokenToUse =
          directToken && !directToken.includes("••••")
            ? directToken
            : existingTenant
              ? getTenantResolvedUazapi(existingTenant).instances.find(
                  (i) => i.name === connectedInst.name
                )?.token || ""
              : "";
        try {
          const sendRes = await fetch(`${directBaseUrl}/send/text`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              token: tokenToUse,
            },
            body: JSON.stringify({
              number: target,
              text: `Teste de alerta Alpha Rastreamento (${existingTenant?.name || safeSlug}): conexão Uazapi ativa!`,
            }),
            signal: AbortSignal.timeout(5000),
          });
          alertTestResult = sendRes.ok
            ? { sent: true, targetPhone: target }
            : { sent: false, targetPhone: target, error: `Falha HTTP ${sendRes.status} ao enviar.` };
        } catch (err: any) {
          alertTestResult = {
            sent: false,
            targetPhone: target,
            error: err?.message || "Erro ao disparar alerta.",
          };
        }
      }
    }

    return NextResponse.json({
      success: results.length > 0 && Boolean(connectedInst),
      anyConnected: Boolean(connectedInst),
      baseUrl: directBaseUrl,
      webhookUrl: buildWebhookUrl(request, safeSlug),
      recommendedEvents: ["messages", "chats", "chat_labels", "labels"],
      instances: results,
      availableLabels,
      phoneValidation,
      alertTestResult,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro ao testar conexão Uazapi" },
      { status: 500 }
    );
  }
}

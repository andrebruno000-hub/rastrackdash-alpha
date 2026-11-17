import { NextRequest, NextResponse } from "next/server";
import path from "path";
import {
  getStorageDir,
  getTenantResolvedUazapi,
  hasValidBrazilianDdi,
  listTenants,
  normalizeBrazilianPhone,
  normalizeUazapiBaseUrl,
  readJsonSafe,
  writeJsonAtomic,
  type GoogleTenantConfig,
} from "../../../../lib/google-tenants";

export const dynamic = "force-dynamic";

/**
 * PASSO M5: MONITOR GLOBAL DE QUEDA UAZAPI + ALERTA AUTOMÁTICO NO WHATSAPP DO GESTOR
 * Caminho no GitHub: apps/web/src/app/api/google-ads/uazapi-monitor/route.ts
 *
 * - Verifica instâncias Uazapi de todos os clientes ativos cadastrados
 * - Usa qualquer instância saudável conectada para alertar o Gestor caso outro cliente desconecte
 * - Valida rigorosamente DDI 55 + DDD + número no telefone do Gestor
 * - Possui trava anti-spam (cooldown configurável) e aviso automático quando reconecta
 */

interface MonitorInstanceState {
  key: string;
  tenantSlug: string;
  tenantName: string;
  instanceName: string;
  connected: boolean;
  status: string;
  phone?: string;
  latencyMs?: number;
  error?: string | null;
  downSince?: string | null;
  lastAlertSentAt?: string | null;
  lastCheckedAt: string;
}

interface MonitorAlertLog {
  id: string;
  tenantSlug: string;
  tenantName: string;
  instanceName: string;
  type: "down" | "recovered" | "test";
  sent: boolean;
  message: string;
  timestamp: string;
  error?: string | null;
}

interface UazapiMonitorStore {
  enabled: boolean;
  managerPhone: string;
  senderTenantSlug?: string;
  cooldownMinutes: number;
  lastCheckedAt?: string | null;
  lastAlertAt?: string | null;
  lastAlertError?: string | null;
  instanceStates: Record<string, MonitorInstanceState>;
  recentAlerts: MonitorAlertLog[];
}

function getMonitorFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_uazapi_monitor.json");
}

function readMonitorStore(): UazapiMonitorStore {
  const stored = readJsonSafe<Partial<UazapiMonitorStore>>(getMonitorFilePath(), {});
  return {
    enabled: Boolean(stored.enabled),
    managerPhone: String(stored.managerPhone || ""),
    senderTenantSlug: stored.senderTenantSlug ? String(stored.senderTenantSlug) : undefined,
    cooldownMinutes: Number(stored.cooldownMinutes || 120),
    lastCheckedAt: stored.lastCheckedAt || null,
    lastAlertAt: stored.lastAlertAt || null,
    lastAlertError: stored.lastAlertError || null,
    instanceStates:
      stored.instanceStates && typeof stored.instanceStates === "object"
        ? stored.instanceStates
        : {},
    recentAlerts: Array.isArray(stored.recentAlerts) ? stored.recentAlerts : [],
  };
}

function writeMonitorStore(store: UazapiMonitorStore): void {
  writeJsonAtomic(getMonitorFilePath(), {
    ...store,
    recentAlerts: (store.recentAlerts || []).slice(0, 50),
  });
}

async function probeUazapiInstance(baseUrl: string, token: string): Promise<{
  connected: boolean;
  status: string;
  phone: string;
  latencyMs: number;
  error: string | null;
}> {
  const started = Date.now();
  const cleanBase = normalizeUazapiBaseUrl(baseUrl);
  const cleanToken = String(token || "").trim();

  if (!cleanBase || !cleanToken) {
    return {
      connected: false,
      status: "unconfigured",
      phone: "",
      latencyMs: 0,
      error: "URL ou Token Uazapi não configurado.",
    };
  }

  try {
    const res = await fetch(`${cleanBase}/instance/status`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        token: cleanToken,
      },
      signal: AbortSignal.timeout(4500),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const inst = data?.instance || data?.data || data;
      const rawStatus = String(
        inst?.status || data?.status || (inst?.connected ? "connected" : "disconnected")
      ).toLowerCase();

      const connected =
        inst?.connected === true ||
        data?.connected === true ||
        data?.loggedIn === true ||
        rawStatus === "connected" ||
        rawStatus === "open";

      const phone = String(
        inst?.owner || inst?.phone || data?.owner || data?.jid || data?.status?.jid || ""
      )
        .replace(/@.*/, "")
        .replace(/\D/g, "");

      return {
        connected,
        status: connected ? "connected" : rawStatus || "disconnected",
        phone,
        latencyMs: Date.now() - started,
        error: connected ? null : `Instância desconectada (${rawStatus || "offline"})`,
      };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        connected: false,
        status: "unauthorized",
        phone: "",
        latencyMs: Date.now() - started,
        error: `Token Uazapi inválido (HTTP ${res.status})`,
      };
    }

    const fallbackRes = await fetch(`${cleanBase}/chat/find`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: cleanToken,
      },
      body: JSON.stringify({ limit: 1 }),
      signal: AbortSignal.timeout(4500),
    });

    if (fallbackRes.ok) {
      return {
        connected: true,
        status: "connected",
        phone: "",
        latencyMs: Date.now() - started,
        error: null,
      };
    }

    return {
      connected: false,
      status: "error",
      phone: "",
      latencyMs: Date.now() - started,
      error: `Uazapi respondeu HTTP ${fallbackRes.status}`,
    };
  } catch (err: any) {
    return {
      connected: false,
      status: "unreachable",
      phone: "",
      latencyMs: Date.now() - started,
      error: err?.message || "Servidor Uazapi inacessível",
    };
  }
}

async function sendWhatsAppMessage(
  baseUrl: string,
  token: string,
  targetPhone: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const cleanBase = normalizeUazapiBaseUrl(baseUrl);
    const res = await fetch(`${cleanBase}/send/text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token,
      },
      body: JSON.stringify({
        number: targetPhone,
        text,
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      return { ok: false, error: `Uazapi HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Falha de rede ao enviar alerta" };
  }
}

async function runMonitorSweep(forceCheck: boolean): Promise<{
  store: UazapiMonitorStore;
  results: MonitorInstanceState[];
  alertsDispatchedNow: number;
}> {
  const store = readMonitorStore();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Respeita intervalo mínimo de 4 minutos para chamadas automáticas (evita carga extra)
  if (!forceCheck && store.lastCheckedAt) {
    const elapsed = nowMs - new Date(store.lastCheckedAt).getTime();
    if (!isNaN(elapsed) && elapsed < 4 * 60 * 1000) {
      return {
        store,
        results: Object.values(store.instanceStates || {}),
        alertsDispatchedNow: 0,
      };
    }
  }

  const tenants = listTenants().filter((t) => t.active !== false);
  const probedList: Array<{
    state: MonitorInstanceState;
    baseUrl: string;
    token: string;
    tenant: GoogleTenantConfig;
  }> = [];

  for (const tenant of tenants) {
    const cfg = getTenantResolvedUazapi(tenant);
    if (!cfg.baseUrl || cfg.instances.length === 0) continue;

    for (const inst of cfg.instances) {
      const key = `${tenant.slug}::${inst.name}`;
      const probe = await probeUazapiInstance(cfg.baseUrl, inst.token);
      const prev = store.instanceStates[key];

      const nextState: MonitorInstanceState = {
        key,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        instanceName: inst.name,
        connected: probe.connected,
        status: probe.status,
        phone: probe.phone,
        latencyMs: probe.latencyMs,
        error: probe.error,
        downSince: probe.connected ? null : prev?.downSince || nowIso,
        lastAlertSentAt: prev?.lastAlertSentAt || null,
        lastCheckedAt: nowIso,
      };
      probedList.push({ state: nextState, baseUrl: cfg.baseUrl, token: inst.token, tenant });
    }
  }

  // Escolhe uma instância conectada saudável para disparar alertas ao Gestor
  const healthySender =
    probedList.find(
      (p) => p.state.connected && store.senderTenantSlug && p.tenant.slug === store.senderTenantSlug
    ) || probedList.find((p) => p.state.connected);

  let alertsDispatchedNow = 0;
  const cooldownMs = Math.max(15, Number(store.cooldownMinutes || 120)) * 60 * 1000;
  const canSendAlerts =
    store.enabled && hasValidBrazilianDdi(store.managerPhone) && Boolean(healthySender);

  const nextStatesMap: Record<string, MonitorInstanceState> = {};

  for (const item of probedList) {
    const prev = store.instanceStates[item.state.key];
    const st = item.state;

    if (canSendAlerts && healthySender) {
      if (!st.connected) {
        const lastSentMs = st.lastAlertSentAt ? new Date(st.lastAlertSentAt).getTime() : 0;
        const cooldownExpired = !lastSentMs || nowMs - lastSentMs >= cooldownMs;

        if (cooldownExpired) {
          const text =
            `⚠️ *ALERTA ALPHA RASTREAMENTO (UAZAPI OFFLINE)*\n\n` +
            `• Cliente: *${st.tenantName}* (/r/${st.tenantSlug})\n` +
            `• Instância: *${st.instanceName}*\n` +
            `• Motivo: ${st.error || st.status}\n\n` +
            `Reconecte o QR Code na Uazapi para não perder webhooks nem travar leads na Etapa 1.`;

          const sentRes = await sendWhatsAppMessage(
            healthySender.baseUrl,
            healthySender.token,
            store.managerPhone,
            text
          );

          store.recentAlerts.unshift({
            id: `al_down_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
            tenantSlug: st.tenantSlug,
            tenantName: st.tenantName,
            instanceName: st.instanceName,
            type: "down",
            sent: sentRes.ok,
            message: `Instância offline (${st.status})`,
            timestamp: nowIso,
            error: sentRes.error || null,
          });

          if (sentRes.ok) {
            st.lastAlertSentAt = nowIso;
            store.lastAlertAt = nowIso;
            store.lastAlertError = null;
            alertsDispatchedNow++;
          } else {
            store.lastAlertError = sentRes.error || "Falha ao enviar alerta WhatsApp";
          }
        }
      } else if (prev && prev.connected === false && prev.lastAlertSentAt) {
        // Aviso de recuperação automática quando a instância volta a conectar
        const text =
          `✅ *UAZAPI RECONECTADA*\n\n` +
          `• Cliente: *${st.tenantName}* (/r/${st.tenantSlug})\n` +
          `• Instância: *${st.instanceName}*\n` +
          `• Status: Conectada novamente (${st.latencyMs}ms).`;

        const sentRes = await sendWhatsAppMessage(
          healthySender.baseUrl,
          healthySender.token,
          store.managerPhone,
          text
        );

        store.recentAlerts.unshift({
          id: `al_rec_${nowMs}_${Math.random().toString(36).slice(2, 6)}`,
          tenantSlug: st.tenantSlug,
          tenantName: st.tenantName,
          instanceName: st.instanceName,
          type: "recovered",
          sent: sentRes.ok,
          message: "Instância reconectada com sucesso",
          timestamp: nowIso,
          error: sentRes.error || null,
        });

        st.lastAlertSentAt = null;
      }
    }

    nextStatesMap[st.key] = st;
  }

  store.instanceStates = nextStatesMap;
  store.lastCheckedAt = nowIso;
  writeMonitorStore(store);

  return {
    store,
    results: probedList.map((p) => p.state),
    alertsDispatchedNow,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shouldCheck = searchParams.get("check") === "true";
    const force = searchParams.get("force") === "true";

    if (shouldCheck || force) {
      const { store, results, alertsDispatchedNow } = await runMonitorSweep(force);
      const onlineCount = results.filter((r) => r.connected).length;
      const offlineCount = results.filter((r) => !r.connected).length;
      return NextResponse.json({
        success: true,
        config: {
          enabled: store.enabled,
          managerPhone: store.managerPhone,
          validDdi55: hasValidBrazilianDdi(store.managerPhone),
          senderTenantSlug: store.senderTenantSlug || "",
          cooldownMinutes: store.cooldownMinutes,
          lastCheckedAt: store.lastCheckedAt,
          lastAlertAt: store.lastAlertAt,
          lastAlertError: store.lastAlertError,
        },
        summary: {
          totalInstances: results.length,
          onlineCount,
          offlineCount,
          alertsDispatchedNow,
          instances: results,
        },
        recentAlerts: store.recentAlerts.slice(0, 15),
      });
    }

    const store = readMonitorStore();
    const instances = Object.values(store.instanceStates || {});
    return NextResponse.json({
      success: true,
      config: {
        enabled: store.enabled,
        managerPhone: store.managerPhone,
        validDdi55: hasValidBrazilianDdi(store.managerPhone),
        senderTenantSlug: store.senderTenantSlug || "",
        cooldownMinutes: store.cooldownMinutes,
        lastCheckedAt: store.lastCheckedAt,
        lastAlertAt: store.lastAlertAt,
        lastAlertError: store.lastAlertError,
      },
      summary: {
        totalInstances: instances.length,
        onlineCount: instances.filter((r) => r.connected).length,
        offlineCount: instances.filter((r) => !r.connected).length,
        alertsDispatchedNow: 0,
        instances,
      },
      recentAlerts: store.recentAlerts.slice(0, 15),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro ao consultar monitor Uazapi" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "save_config").trim();
    const store = readMonitorStore();

    if (action === "save_config") {
      const normalizedPhone = normalizeBrazilianPhone(String(body.managerPhone || ""));
      if (body.enabled !== false && normalizedPhone && !hasValidBrazilianDdi(normalizedPhone)) {
        return NextResponse.json(
          {
            error:
              "Informe o WhatsApp do Gestor com DDI 55 + DDD + número (ex: 5521999998888).",
          },
          { status: 400 }
        );
      }

      store.managerPhone = normalizedPhone;
      store.enabled =
        body.enabled !== undefined ? Boolean(body.enabled) : Boolean(normalizedPhone);
      store.cooldownMinutes = Math.max(15, Number(body.cooldownMinutes || store.cooldownMinutes || 120));
      store.senderTenantSlug = body.senderTenantSlug
        ? String(body.senderTenantSlug).trim()
        : undefined;

      writeMonitorStore(store);

      return NextResponse.json({
        success: true,
        message: store.enabled
          ? `Monitor de quedas ativo! Alertas serão enviados para ${store.managerPhone}.`
          : "Monitor de quedas salvo (alertas desativados).",
        config: {
          enabled: store.enabled,
          managerPhone: store.managerPhone,
          validDdi55: hasValidBrazilianDdi(store.managerPhone),
          senderTenantSlug: store.senderTenantSlug || "",
          cooldownMinutes: store.cooldownMinutes,
        },
      });
    }

    if (action === "send_test_alert") {
      const targetPhone = normalizeBrazilianPhone(
        String(body.managerPhone || store.managerPhone || "")
      );
      if (!hasValidBrazilianDdi(targetPhone)) {
        return NextResponse.json(
          {
            error:
              "Número inválido para teste. Use DDI 55 + DDD + número (ex: 5521999998888).",
          },
          { status: 400 }
        );
      }

      // Salva o número já validado no monitor
      store.managerPhone = targetPhone;
      store.enabled = true;
      if (body.senderTenantSlug !== undefined) {
        store.senderTenantSlug = String(body.senderTenantSlug || "").trim() || undefined;
      }

      const { results } = await runMonitorSweep(true);
      const tenants = listTenants().filter((t) => t.active !== false);

      let chosenBase = "";
      let chosenToken = "";
      let chosenSenderLabel = "";

      const preferredOrder = store.senderTenantSlug
        ? [
            ...tenants.filter((t) => t.slug === store.senderTenantSlug),
            ...tenants.filter((t) => t.slug !== store.senderTenantSlug),
          ]
        : tenants;

      for (const tenant of preferredOrder) {
        const cfg = getTenantResolvedUazapi(tenant);
        if (!cfg.baseUrl) continue;
        for (const inst of cfg.instances) {
          const matchOnline = results.find(
            (r) => r.tenantSlug === tenant.slug && r.instanceName === inst.name && r.connected
          );
          if (matchOnline) {
            chosenBase = cfg.baseUrl;
            chosenToken = inst.token;
            chosenSenderLabel = `${tenant.name} (${inst.name})`;
            break;
          }
        }
        if (chosenToken) break;
      }

      if (!chosenBase || !chosenToken) {
        writeMonitorStore(store);
        return NextResponse.json(
          {
            error:
              "Configuração salva, mas nenhuma instância Uazapi conectada foi encontrada agora para disparar o teste.",
          },
          { status: 400 }
        );
      }

      const onlineCount = results.filter((r) => r.connected).length;
      const offlineCount = results.filter((r) => !r.connected).length;
      const text =
        `✅ *TESTE DE MONITORAMENTO ALPHA*\n\n` +
        `Seu WhatsApp de gestor está ativo para alertas automáticos de queda da Uazapi.\n` +
        `• Remetente usado: ${chosenSenderLabel}\n` +
        `• Monitoramento atual: ${onlineCount} online • ${offlineCount} offline.`;

      const sendRes = await sendWhatsAppMessage(chosenBase, chosenToken, targetPhone, text);
      const nowIso = new Date().toISOString();

      store.recentAlerts.unshift({
        id: `al_test_${Date.now()}`,
        tenantSlug: "monitor",
        tenantName: "Monitor Global",
        instanceName: chosenSenderLabel,
        type: "test",
        sent: sendRes.ok,
        message: `Alerta de teste para ${targetPhone}`,
        timestamp: nowIso,
        error: sendRes.error || null,
      });

      if (sendRes.ok) {
        store.lastAlertAt = nowIso;
        store.lastAlertError = null;
      } else {
        store.lastAlertError = sendRes.error || "Erro ao enviar teste";
      }
      writeMonitorStore(store);

      if (!sendRes.ok) {
        return NextResponse.json(
          { error: `Falha ao enviar WhatsApp de teste: ${sendRes.error}` },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: `Alerta de teste enviado para ${targetPhone} via ${chosenSenderLabel}!`,
        recentAlerts: store.recentAlerts.slice(0, 15),
      });
    }

    if (action === "check_now") {
      const { store: updated, results, alertsDispatchedNow } = await runMonitorSweep(true);
      const onlineCount = results.filter((r) => r.connected).length;
      const offlineCount = results.filter((r) => !r.connected).length;
      return NextResponse.json({
        success: true,
        message:
          offlineCount > 0
            ? `Verificação concluída: ${onlineCount} online, ${offlineCount} offline.${alertsDispatchedNow > 0 ? ` ${alertsDispatchedNow} alerta(s) enviado(s) no WhatsApp!` : ""}`
            : `Tudo saudável! Todas as ${onlineCount} instância(s) Uazapi estão conectadas.`,
        summary: {
          totalInstances: results.length,
          onlineCount,
          offlineCount,
          alertsDispatchedNow,
          instances: results,
        },
        recentAlerts: updated.recentAlerts.slice(0, 15),
      });
    }

    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro no monitor Uazapi" },
      { status: 500 }
    );
  }
}

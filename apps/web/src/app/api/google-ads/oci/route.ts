import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  type GoogleTenantConfig,
  getStorageDir,
  getTenantFilePath,
  isTenantAttendantPhone,
  normalizeText,
  readJsonSafe,
  readTenantAudits,
  readTenantLeads,
  readTenantRules,
  resolveRequestTenant,
  writeJsonAtomic,
  writeTenantLeads,
} from "../../../../lib/google-tenants";

export const dynamic = "force-dynamic";

/**
 * PASSO M1 — OCI MULTI-CLIENTE + DATA MANAGER API v1 + ENHANCED CONVERSIONS (SHA-256)
 * Caminho no GitHub: apps/web/src/app/api/google-ads/oci/route.ts
 *
 * - 100% isolado por cliente em /data/tenants/<slug>/
 * - Usa 1 único Refresh Token da MCC, enviando conversões para tenant.googleCustomerId
 * - Data Manager API v1 (datamanager.googleapis.com/v1/events:ingest) + Enhanced SHA-256
 * - Suporta Ajustes de Conversão (RESTATEMENT / RETRACTION) por orderId
 * - Trava absoluta de idempotência: eventos "sent" NUNCA são reenviados
 */

type FunnelStage = "conversa_iniciada" | "orcamento_enviado" | "compra_realizada";

interface ConversionActionOption {
  id: string;
  name: string;
  resourceName: string;
  type: string;
  status: string;
  category: string;
}

interface ActionMapping {
  conversa_iniciada?: string;
  orcamento_enviado?: string;
  compra_realizada?: string;
}

interface SentIndexEntry {
  key: string;
  leadId: string;
  stage: FunnelStage;
  orderId: string;
  conversionAction: string;
  conversionActionName?: string;
  value: number;
  hashedPhoneUsed: boolean;
  sentAt: string;
  apiVersion?: string;
}

interface OfficialDiagnosticsCache {
  fetchedAt: string;
  apiConnected: boolean;
  apiVersionUsed?: string;
  loginCustomerIdUsed?: string;
  error?: string | null;
  availableConversionActions: ConversionActionOption[];
  clientSummary: {
    client: string;
    status: string;
    totalEventCount: number;
    successfulEventCount: number;
    pendingEventCount: number;
    successRate: number;
    pendingRate: number;
    lastUploadDateTime?: string | null;
    alerts: Array<{ errorCode?: string; errorMessage?: string; count?: number }>;
  }[];
  actionSummaries: {
    conversionActionId: string;
    conversionActionName: string;
    client: string;
    status: string;
    totalEventCount: number;
    successfulEventCount: number;
    pendingEventCount: number;
    lastUploadDateTime?: string | null;
    alerts: Array<{ errorCode?: string; errorMessage?: string; count?: number }>;
  }[];
}

const MATURATION_TIME_MS = 4 * 60 * 60 * 1000;
const DIAGNOSTICS_CACHE_TTL_MS = 15 * 60 * 1000;

function readSentIndex(slug: string): Record<string, SentIndexEntry> {
  return readJsonSafe<Record<string, SentIndexEntry>>(getTenantFilePath(slug, "oci_sent_index"), {});
}

function writeSentIndex(slug: string, index: Record<string, SentIndexEntry>): void {
  try {
    const entries = Object.entries(index);
    const trimmed =
      entries.length > 2500 ? Object.fromEntries(entries.slice(entries.length - 2500)) : index;
    writeJsonAtomic(getTenantFilePath(slug, "oci_sent_index"), trimmed);
  } catch (err) {
    console.error("Erro ao gravar índice de idempotência OCI:", err);
  }
}

function readActionMapping(slug: string): ActionMapping {
  return readJsonSafe<ActionMapping>(getTenantFilePath(slug, "oci_actions_map"), {});
}

function writeActionMapping(slug: string, mapping: ActionMapping): void {
  writeJsonAtomic(getTenantFilePath(slug, "oci_actions_map"), mapping);
}

function readRulesActionNames(slug: string): { quoteActionName: string; purchaseActionName: string } {
  const rules = readTenantRules(slug);
  return {
    quoteActionName: String(rules?.quote?.actionName || "WhatsApp - Orçamento Enviado").trim(),
    purchaseActionName: String(rules?.purchase?.actionName || "WhatsApp - Compra Realizada").trim(),
  };
}

function isWaitingWhatsApp(tenant: GoogleTenantConfig, lead: any): boolean {
  if (lead?.stage === "clique_anuncio") return true;
  const p = String(lead?.leadPhone || "").trim();
  const placeholder = !p || /aguardando/i.test(p) || isTenantAttendantPhone(tenant, p);
  return !lead?.firstMessageAt && placeholder;
}

function normalizePhoneE164(tenant: GoogleTenantConfig, rawPhone?: string): string | null {
  if (!rawPhone || /aguardando/i.test(rawPhone)) return null;
  if (isTenantAttendantPhone(tenant, rawPhone)) return null;
  let digits = String(rawPhone).replace(/\D/g, "");
  if (!digits || digits.length < 10 || digits.length > 15) return null;
  digits = digits.replace(/^0+/, "");
  if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`;
  }
  if (digits.length < 12) return null;
  return `+${digits}`;
}

function hashPhoneSha256(e164Phone: string): string {
  return crypto.createHash("sha256").update(e164Phone.trim().toLowerCase()).digest("hex");
}

function getLeadStage(lead: any): FunnelStage {
  const raw = lead?.stage || lead?.conversionType || "conversa_iniciada";
  if (raw === "compra_realizada") return "compra_realizada";
  if (raw === "orcamento_enviado") return "orcamento_enviado";
  return "conversa_iniciada";
}

function buildStageKey(leadId: string, stage: FunnelStage): string {
  return `${leadId}::${stage}`;
}

function buildDeterministicOrderId(leadId: string, stage: FunnelStage): string {
  const safeId = String(leadId || "lead")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 36);
  const shortSuffix =
    stage === "compra_realizada" ? "cmp" : stage === "orcamento_enviado" ? "orc" : "cnv";
  return `alpha_${safeId}_${shortSuffix}`;
}

function isStageAlreadySent(
  lead: any,
  stage: FunnelStage,
  sentIndex: Record<string, SentIndexEntry>
): boolean {
  const key = buildStageKey(lead.id, stage);
  if (sentIndex[key]) return true;
  if (lead?.sentStages?.[stage]?.sentAt) return true;
  if (lead?.status === "sent") {
    const recordedStage = lead?.lastUploadedStage || lead?.stage || lead?.conversionType || "conversa_iniciada";
    if (recordedStage === stage) return true;
  }
  return false;
}

function formatGoogleAdsDateTime(isoOrMs: string | number): string {
  const d = new Date(isoOrMs);
  const valid = isNaN(d.getTime()) ? new Date() : d;
  return valid.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "+00:00");
}

function extractClickIdentifiers(lead: any): {
  kind: "gclid" | "gbraid" | "wbraid" | null;
  value: string | null;
} {
  if (lead?.wbraid && String(lead.wbraid).trim() && lead.wbraid !== "sem_gclid") {
    return { kind: "wbraid", value: String(lead.wbraid).trim() };
  }
  if (lead?.gbraid && String(lead.gbraid).trim() && lead.gbraid !== "sem_gclid") {
    return { kind: "gbraid", value: String(lead.gbraid).trim() };
  }
  const raw = String(lead?.gclid || "").trim();
  if (!raw || raw === "sem_gclid") return { kind: null, value: null };
  if (lead?.clickIdType === "wbraid") return { kind: "wbraid", value: raw };
  if (lead?.clickIdType === "gbraid") return { kind: "gbraid", value: raw };
  return { kind: "gclid", value: raw };
}

function getActiveApiVersions(): string[] {
  const configured = process.env.GOOGLE_ADS_API_VERSION?.trim();
  const base = ["v25", "v26", "v24", "v23"];
  if (!configured) return base;
  return [configured, ...base.filter((v) => v !== configured)];
}

function getMissingGoogleAdsEnvVars(): string[] {
  const required = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
  ];
  return required.filter((k) => !process.env[k]?.trim());
}

async function getGoogleAdsAccessToken(): Promise<{ token: string | null; error?: string }> {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim();

  if (!clientId || !clientSecret || !refreshToken) {
    return {
      token: null,
      error: "Variáveis OAuth ausentes no runtime do Dokploy.",
    };
  }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.access_token) {
      return { token: data.access_token };
    }
    return {
      token: null,
      error: `OAuth2 erro ${res.status}: ${data.error_description || data.error || "Token inválido"}`,
    };
  } catch (err: any) {
    return { token: null, error: `Falha OAuth2: ${err?.message || "desconhecida"}` };
  }
}

async function executeGaqlStream(params: {
  version: string;
  customerId: string;
  accessToken: string;
  devToken: string;
  query: string;
  loginCustomerId?: string;
}): Promise<{ ok: boolean; status: number; rows: any[]; errorText?: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.accessToken}`,
    "developer-token": params.devToken,
    "Content-Type": "application/json",
  };
  if (params.loginCustomerId) {
    headers["login-customer-id"] = params.loginCustomerId.replace(/\D/g, "");
  }

  const res = await fetch(
    `https://googleads.googleapis.com/${params.version}/customers/${params.customerId}/googleAds:searchStream`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ query: params.query }),
    }
  );

  const rawText = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, rows: [], errorText: rawText.slice(0, 500) };
  }

  try {
    const parsed = JSON.parse(rawText);
    const rows: any[] = [];
    if (Array.isArray(parsed)) {
      for (const batch of parsed) {
        if (Array.isArray(batch?.results)) rows.push(...batch.results);
      }
    } else if (Array.isArray(parsed?.results)) {
      rows.push(...parsed.results);
    }
    return { ok: true, status: res.status, rows };
  } catch {
    return { ok: false, status: res.status, rows: [], errorText: "JSON inválido da Google Ads API." };
  }
}

async function discoverManagerLoginCustomerId(params: {
  version: string;
  targetCustomerId: string;
  accessToken: string;
  devToken: string;
}): Promise<string | undefined> {
  try {
    const listRes = await fetch(
      `https://googleads.googleapis.com/${params.version}/customers:listAccessibleCustomers`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          "developer-token": params.devToken,
        },
      }
    );
    if (!listRes.ok) return undefined;
    const listData = await listRes.json().catch(() => ({}));
    const resourceNames: string[] = Array.isArray(listData?.resourceNames) ? listData.resourceNames : [];

    for (const rn of resourceNames) {
      const candidateId = String(rn).replace("customers/", "").replace(/\D/g, "");
      if (!candidateId) continue;

      const check = await executeGaqlStream({
        version: params.version,
        customerId: candidateId,
        loginCustomerId: candidateId,
        accessToken: params.accessToken,
        devToken: params.devToken,
        query: `SELECT customer_client.id, customer_client.manager FROM customer_client WHERE customer_client.id = ${params.targetCustomerId}`,
      });

      if (check.ok && check.rows.length > 0) {
        return candidateId;
      }
    }
  } catch {}
  return undefined;
}

async function resolveWorkingGoogleAdsContext(tenant: GoogleTenantConfig): Promise<{
  ok: boolean;
  customerId: string;
  accessToken?: string;
  devToken?: string;
  version?: string;
  loginCustomerId?: string;
  conversionActions: ConversionActionOption[];
  error?: string;
}> {
  const customerId = String(tenant.googleCustomerId || "").replace(/\D/g, "");
  if (!customerId) {
    return {
      ok: false,
      customerId: "",
      conversionActions: [],
      error: `Customer ID do Google Ads não configurado para o cliente "${tenant.name}".`,
    };
  }

  const missingEnv = getMissingGoogleAdsEnvVars();
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  if (!devToken || missingEnv.length > 0) {
    return {
      ok: false,
      customerId,
      conversionActions: [],
      error: `Variáveis ausentes no Dokploy: ${missingEnv.join(", ")}`,
    };
  }

  const oauth = await getGoogleAdsAccessToken();
  if (!oauth.token) {
    return { ok: false, customerId, conversionActions: [], error: oauth.error || "Falha OAuth2" };
  }

  const entitiesMeta = readJsonSafe<any>(getTenantFilePath(tenant.slug, "entities_meta"), {});
  const explicitLoginId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/\D/g, "") || undefined;
  let loginCustomerId: string | undefined = explicitLoginId || entitiesMeta?.loginCustomerIdUsed;

  const versions = getActiveApiVersions();
  const actionQuery = `
    SELECT
      conversion_action.id,
      conversion_action.name,
      conversion_action.resource_name,
      conversion_action.type,
      conversion_action.status,
      conversion_action.category
    FROM conversion_action
    WHERE conversion_action.status != 'REMOVED'
  `;

  let lastError: string | undefined;
  for (const version of versions) {
    let res = await executeGaqlStream({
      version,
      customerId,
      accessToken: oauth.token,
      devToken,
      query: actionQuery,
      loginCustomerId,
    });

    if (
      !res.ok &&
      (res.status === 404 || (res.errorText && /UNSUPPORTED_VERSION|deprecated|sunset/i.test(res.errorText)))
    ) {
      lastError = `Versão ${version} indisponível (${res.status})`;
      continue;
    }

    if (
      !res.ok &&
      !explicitLoginId &&
      (res.status === 403 || (res.errorText && /USER_PERMISSION_DENIED|PERMISSION_DENIED/i.test(res.errorText)))
    ) {
      if (loginCustomerId) {
        const directRes = await executeGaqlStream({
          version,
          customerId,
          accessToken: oauth.token,
          devToken,
          query: actionQuery,
        });
        if (directRes.ok) {
          loginCustomerId = undefined;
          res = directRes;
        }
      }
      if (!res.ok) {
        const mcc = await discoverManagerLoginCustomerId({
          version,
          targetCustomerId: customerId,
          accessToken: oauth.token,
          devToken,
        });
        if (mcc) {
          loginCustomerId = mcc;
          res = await executeGaqlStream({
            version,
            customerId,
            accessToken: oauth.token,
            devToken,
            query: actionQuery,
            loginCustomerId,
          });
        }
      }
    }

    if (res.ok) {
      const actions: ConversionActionOption[] = res.rows
        .map((r: any) => ({
          id: String(r.conversionAction?.id || ""),
          name: String(r.conversionAction?.name || ""),
          resourceName: String(
            r.conversionAction?.resourceName ||
              `customers/${customerId}/conversionActions/${r.conversionAction?.id}`
          ),
          type: String(r.conversionAction?.type || ""),
          status: String(r.conversionAction?.status || ""),
          category: String(r.conversionAction?.category || ""),
        }))
        .filter((a) => Boolean(a.id && a.name));

      return {
        ok: true,
        customerId,
        accessToken: oauth.token,
        devToken,
        version,
        loginCustomerId,
        conversionActions: actions,
      };
    }

    lastError = `Google Ads API (${version}) erro ${res.status}: ${res.errorText || "erro"}`;
    break;
  }

  return {
    ok: false,
    customerId,
    conversionActions: [],
    error: lastError || "Não foi possível conectar na Google Ads API.",
  };
}

function resolveStageConversionAction(
  stage: FunnelStage,
  availableActions: ConversionActionOption[],
  manualMap: ActionMapping,
  ruleNames: { quoteActionName: string; purchaseActionName: string }
): ConversionActionOption | null {
  if (!availableActions || availableActions.length === 0) return null;

  const manualIdOrRn = manualMap?.[stage];
  if (manualIdOrRn) {
    const cleanId = String(manualIdOrRn).replace("customers/", "").split("/").pop();
    const foundManual = availableActions.find(
      (a) => a.id === manualIdOrRn || a.resourceName === manualIdOrRn || a.id === cleanId
    );
    if (foundManual) return foundManual;
  }

  const enabled = availableActions.filter((a) => a.status === "ENABLED");
  const pool = enabled.length > 0 ? enabled : availableActions;

  const sortedPool = [...pool].sort((a, b) => {
    const score = (t: string) =>
      t === "UPLOAD_CLICKS" ? 3 : t.includes("UPLOAD") || t.includes("ENHANCED") ? 2 : 1;
    return score(b.type) - score(a.type);
  });

  const targetNames: string[] =
    stage === "compra_realizada"
      ? [
          ruleNames.purchaseActionName,
          "WhatsApp - Compra Realizada",
          "Compra WhatsApp",
          "Compra Realizada",
          "Compra",
          "Purchase",
        ]
      : stage === "orcamento_enviado"
        ? [
            ruleNames.quoteActionName,
            "WhatsApp - Orçamento Enviado",
            "Orçamento WhatsApp",
            "Orçamento Enviado",
            "Orçamento",
            "Qualified Lead",
          ]
        : [
            "WhatsApp - Conversa Iniciada",
            "Conversa WhatsApp",
            "Conversa Iniciada",
            "WhatsApp",
            "Lead",
          ];

  for (const target of targetNames) {
    const normTarget = normalizeText(target);
    const exact = sortedPool.find((a) => normalizeText(a.name) === normTarget);
    if (exact) return exact;
  }

  const keywordTokens =
    stage === "compra_realizada"
      ? ["compra", "venda", "pedido", "purchase"]
      : stage === "orcamento_enviado"
        ? ["orcamento", "proposta", "qualified"]
        : ["conversa", "whatsapp", "lead", "contato"];

  for (const token of keywordTokens) {
    const partial = sortedPool.find((a) => normalizeText(a.name).includes(token));
    if (partial) return partial;
  }

  return null;
}

async function fetchOrReadOfficialDiagnostics(
  tenant: GoogleTenantConfig,
  forceRefresh = false
): Promise<OfficialDiagnosticsCache> {
  const diagPath = getTenantFilePath(tenant.slug, "oci_diagnostics");
  const cached = readJsonSafe<OfficialDiagnosticsCache | null>(diagPath, null);

  if (!forceRefresh && cached?.fetchedAt) {
    const age = Date.now() - new Date(cached.fetchedAt).getTime();
    if (age < DIAGNOSTICS_CACHE_TTL_MS && (cached.apiConnected || age < 60 * 1000)) {
      return cached;
    }
  }

  const ctx = await resolveWorkingGoogleAdsContext(tenant);
  if (!ctx.ok || !ctx.version || !ctx.accessToken || !ctx.devToken || !ctx.customerId) {
    const fallback: OfficialDiagnosticsCache = {
      fetchedAt: new Date().toISOString(),
      apiConnected: false,
      error: ctx.error || "API desconectada",
      availableConversionActions: cached?.availableConversionActions || [],
      clientSummary: cached?.clientSummary || [],
      actionSummaries: cached?.actionSummaries || [],
    };
    try {
      writeJsonAtomic(diagPath, fallback);
    } catch {}
    return fallback;
  }

  const clientSummaryQuery = `
    SELECT
      offline_conversion_upload_client_summary.client,
      offline_conversion_upload_client_summary.status,
      offline_conversion_upload_client_summary.total_event_count,
      offline_conversion_upload_client_summary.successful_event_count,
      offline_conversion_upload_client_summary.success_rate,
      offline_conversion_upload_client_summary.pending_event_count,
      offline_conversion_upload_client_summary.pending_rate,
      offline_conversion_upload_client_summary.last_upload_date_time,
      offline_conversion_upload_client_summary.alerts
    FROM offline_conversion_upload_client_summary
  `;

  const actionSummaryQuery = `
    SELECT
      offline_conversion_upload_conversion_action_summary.conversion_action_id,
      offline_conversion_upload_conversion_action_summary.conversion_action_name,
      offline_conversion_upload_conversion_action_summary.client,
      offline_conversion_upload_conversion_action_summary.status,
      offline_conversion_upload_conversion_action_summary.total_event_count,
      offline_conversion_upload_conversion_action_summary.successful_event_count,
      offline_conversion_upload_conversion_action_summary.pending_event_count,
      offline_conversion_upload_conversion_action_summary.last_upload_date_time,
      offline_conversion_upload_conversion_action_summary.alerts
    FROM offline_conversion_upload_conversion_action_summary
  `;

  const [clientRes, actionRes] = await Promise.all([
    executeGaqlStream({
      version: ctx.version,
      customerId: ctx.customerId,
      accessToken: ctx.accessToken,
      devToken: ctx.devToken,
      loginCustomerId: ctx.loginCustomerId,
      query: clientSummaryQuery,
    }),
    executeGaqlStream({
      version: ctx.version,
      customerId: ctx.customerId,
      accessToken: ctx.accessToken,
      devToken: ctx.devToken,
      loginCustomerId: ctx.loginCustomerId,
      query: actionSummaryQuery,
    }),
  ]);

  const mapAlerts = (rawAlerts: any): Array<{ errorCode?: string; errorMessage?: string; count?: number }> => {
    if (!Array.isArray(rawAlerts)) return [];
    return rawAlerts.slice(0, 10).map((al: any) => ({
      errorCode: al?.error ? JSON.stringify(al.error) : al?.errorCode,
      errorMessage: al?.errorMessage || al?.message || undefined,
      count: Number(al?.count || al?.errorCount || 0) || undefined,
    }));
  };

  const clientSummary = clientRes.ok
    ? clientRes.rows.map((r: any) => {
        const s = r.offlineConversionUploadClientSummary || {};
        return {
          client: String(s.client || "GOOGLE_ADS_API"),
          status: String(s.status || "UNKNOWN"),
          totalEventCount: Number(s.totalEventCount || 0),
          successfulEventCount: Number(s.successfulEventCount || 0),
          pendingEventCount: Number(s.pendingEventCount || 0),
          successRate: Number(s.successRate || 0),
          pendingRate: Number(s.pendingRate || 0),
          lastUploadDateTime: s.lastUploadDateTime || null,
          alerts: mapAlerts(s.alerts),
        };
      })
    : [];

  const actionSummaries = actionRes.ok
    ? actionRes.rows.map((r: any) => {
        const s = r.offlineConversionUploadConversionActionSummary || {};
        return {
          conversionActionId: String(s.conversionActionId || ""),
          conversionActionName: String(s.conversionActionName || ""),
          client: String(s.client || "GOOGLE_ADS_API"),
          status: String(s.status || "UNKNOWN"),
          totalEventCount: Number(s.totalEventCount || 0),
          successfulEventCount: Number(s.successfulEventCount || 0),
          pendingEventCount: Number(s.pendingEventCount || 0),
          lastUploadDateTime: s.lastUploadDateTime || null,
          alerts: mapAlerts(s.alerts),
        };
      })
    : [];

  const result: OfficialDiagnosticsCache = {
    fetchedAt: new Date().toISOString(),
    apiConnected: true,
    apiVersionUsed: ctx.version,
    loginCustomerIdUsed: ctx.loginCustomerId,
    error: null,
    availableConversionActions: ctx.conversionActions,
    clientSummary,
    actionSummaries,
  };

  try {
    writeJsonAtomic(diagPath, result);
  } catch {}

  return result;
}

function parsePartialFailureErrors(resJson: any, totalItems: number): {
  hasAnyFailure: boolean;
  perItemError: Record<number, string>;
  globalMessage?: string;
} {
  const pf = resJson?.partialFailureError;
  if (!pf) return { hasAnyFailure: false, perItemError: {} };

  const perItemError: Record<number, string> = {};
  const details: any[] = Array.isArray(pf?.details) ? pf.details : [];

  for (const detail of details) {
    const errors: any[] = Array.isArray(detail?.errors) ? detail.errors : [];
    for (const err of errors) {
      const msg = String(err?.message || pf?.message || "Erro na conversão OCI");
      const codeObj = err?.errorCode && typeof err.errorCode === "object" ? err.errorCode : null;
      const codeStr = codeObj
        ? Object.entries(codeObj)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")
        : "";
      const fullMsg = codeStr ? `[${codeStr}] ${msg}` : msg;

      const fieldElems: any[] = Array.isArray(err?.location?.fieldPathElements)
        ? err.location.fieldPathElements
        : [];
      const convElem = fieldElems.find(
        (f: any) =>
          (f?.fieldName === "conversions" ||
            f?.fieldName === "conversion_adjustments" ||
            f?.fieldName === "conversionAdjustments") &&
          f?.index !== undefined
      );
      if (convElem && Number.isInteger(Number(convElem.index))) {
        const idx = Number(convElem.index);
        perItemError[idx] = perItemError[idx] ? `${perItemError[idx]} | ${fullMsg}` : fullMsg;
      }
    }
  }

  if (Object.keys(perItemError).length === 0) {
    for (let i = 0; i < totalItems; i++) {
      const itemRes = Array.isArray(resJson?.results) ? resJson.results[i] : null;
      const isEmptyResult = !itemRes || Object.keys(itemRes).length === 0;
      if (isEmptyResult || totalItems === 1) {
        perItemError[i] = String(pf?.message || "Falha parcial retornada pelo Google Ads API.");
      }
    }
  }

  return {
    hasAnyFailure: true,
    perItemError,
    globalMessage: String(pf?.message || "Falha parcial no lote OCI."),
  };
}

function buildFriendlyGoogleOciError(rawMessage: string): string {
  const msg = String(rawMessage || "Erro desconhecido na API do Google");
  if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes|Request had insufficient authentication scopes/i.test(msg)) {
    return `${msg} — Falta o escopo https://www.googleapis.com/auth/datamanager no Refresh Token.`;
  }
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(msg)) {
    return `${msg} — Ative a API "Data Manager API" (datamanager.googleapis.com) no Google Cloud Console.`;
  }
  if (/CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE/i.test(msg)) {
    return `${msg} — A conta exige envio via Data Manager API (datamanager.googleapis.com/v1/events:ingest).`;
  }
  if (/EXPIRED_EVENT/i.test(msg)) {
    return `${msg} — Evento expirado (>90 dias desde o clique no anúncio).`;
  }
  if (/CLICK_NOT_FOUND/i.test(msg)) {
    return `${msg} — GCLID não localizado ou ainda fora da janela de indexação do Google.`;
  }
  if (/CONVERSION_ACTION_NOT_FOUND|INVALID_CONVERSION_ACTION/i.test(msg)) {
    return `${msg} — Ação de conversão inválida ou pertence a outra conta.`;
  }
  return msg;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientParam = searchParams.get("client");
  const tenant = resolveRequestTenant(clientParam);

  if (!tenant) {
    return NextResponse.json({ error: `Cliente "${clientParam}" não encontrado.` }, { status: 404 });
  }

  const forceRefresh = searchParams.get("refresh") === "true";
  const customerId = String(tenant.googleCustomerId || "").replace(/\D/g, "");

  const leads = readTenantLeads(tenant.slug, tenant);
  const sentIndex = readSentIndex(tenant.slug);
  const actionMapping = readActionMapping(tenant.slug);
  const ruleNames = readRulesActionNames(tenant.slug);
  const diagnostics = await fetchOrReadOfficialDiagnostics(tenant, forceRefresh);

  const now = Date.now();
  const stats = {
    totalWithClickId: 0,
    waitingWhatsApp: 0,
    waitingMaturation: 0,
    readyToUpload: 0,
    totalSent: 0,
    failedCount: 0,
  };

  const items = leads
    .filter((l) => Boolean(extractClickIdentifiers(l).value))
    .map((l) => {
      stats.totalWithClickId += 1;
      const stage = getLeadStage(l);
      const alreadySent = isStageAlreadySent(l, stage, sentIndex);
      const waitingWpp = isWaitingWhatsApp(tenant, l);
      const clickId = extractClickIdentifiers(l);
      const e164Phone = normalizePhoneE164(tenant, l.leadPhone);
      const orderId = l.ociOrderId || buildDeterministicOrderId(l.id, stage);
      const resolvedAction = resolveStageConversionAction(
        stage,
        diagnostics.availableConversionActions,
        actionMapping,
        ruleNames
      );

      const occurredTime = new Date(l.occurredAt || l.firstMessageAt || now).getTime();
      const ageMs = now - occurredTime;
      const isMatured = ageMs >= MATURATION_TIME_MS;
      const hoursRemaining = Math.max(
        0,
        Number(((MATURATION_TIME_MS - ageMs) / (1000 * 60 * 60)).toFixed(1))
      );

      let effectiveStatus: "sent" | "failed" | "waiting_whatsapp" | "queued" = "queued";
      if (alreadySent) {
        effectiveStatus = "sent";
        stats.totalSent += 1;
      } else if (l.status === "failed") {
        effectiveStatus = "failed";
        stats.failedCount += 1;
      } else if (waitingWpp) {
        effectiveStatus = "waiting_whatsapp";
        stats.waitingWhatsApp += 1;
      } else {
        effectiveStatus = "queued";
        if (isMatured) stats.readyToUpload += 1;
        else stats.waitingMaturation += 1;
      }

      return {
        id: l.id,
        leadName: l.leadName || "Cliente WhatsApp",
        leadPhone: l.leadPhone,
        hasHashedPhone: Boolean(e164Phone && clickId.kind === "gclid"),
        gclid: clickId.value,
        clickIdType: clickId.kind,
        stage,
        conversionType: l.conversionType || stage,
        orderId,
        resolvedConversionAction: resolvedAction
          ? { id: resolvedAction.id, name: resolvedAction.name, resourceName: resolvedAction.resourceName }
          : null,
        value: Number(l.value || 0),
        occurredAt: l.occurredAt,
        sentAt: l.sentStages?.[stage]?.sentAt || l.sentAt || null,
        status: effectiveStatus,
        isMatured,
        hoursRemaining,
        ociError: l.ociError || null,
        ociResult: l.ociResult || null,
        sentStages: l.sentStages || {},
      };
    });

  const stageMappingSummary = (["conversa_iniciada", "orcamento_enviado", "compra_realizada"] as FunnelStage[]).map(
    (st) => {
      const resolved = resolveStageConversionAction(
        st,
        diagnostics.availableConversionActions,
        actionMapping,
        ruleNames
      );
      return {
        stage: st,
        manualActionId: actionMapping[st] || "",
        resolvedActionId: resolved?.id || null,
        resolvedActionName: resolved?.name || null,
        resolvedResourceName: resolved?.resourceName || null,
      };
    }
  );

  const adjustableConversions = leads
    .filter((l: any) => Boolean(l?.sentStages?.compra_realizada?.orderId))
    .map((l: any) => ({
      id: l.id,
      leadName: l.leadName || "Cliente WhatsApp",
      leadPhone: l.leadPhone,
      stage: l.stage,
      value: Number(l.value || 0),
      orderId: l.sentStages.compra_realizada.orderId,
      conversionAction: l.sentStages.compra_realizada.conversionAction,
      sentValue: Number(l.sentStages.compra_realizada.value || 0),
      sentAt: l.sentStages.compra_realizada.sentAt,
      pendingConversionAdjustment: l.pendingConversionAdjustment || null,
      conversionAdjustments: l.conversionAdjustments || [],
    }));

  return NextResponse.json(
    {
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      customerId,
      storageDir: getStorageDir(),
      missingEnvVars: getMissingGoogleAdsEnvVars(),
      hasApiCredentials: getMissingGoogleAdsEnvVars().length === 0,
      apiConnected: diagnostics.apiConnected,
      apiVersionUsed: diagnostics.apiVersionUsed || null,
      loginCustomerIdUsed: diagnostics.loginCustomerIdUsed || null,
      stats,
      availableConversionActions: diagnostics.availableConversionActions,
      actionMapping,
      stageMappingSummary,
      officialDiagnostics: {
        fetchedAt: diagnostics.fetchedAt,
        error: diagnostics.error || null,
        clientSummary: diagnostics.clientSummary,
        actionSummaries: diagnostics.actionSummaries,
      },
      items,
      adjustableConversions,
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const body = await request.json().catch(() => ({}));
    const clientParam = searchParams.get("client") || body?.clientSlug || body?.client || null;
    const tenant = resolveRequestTenant(clientParam);

    if (!tenant) {
      return NextResponse.json({ error: `Cliente "${clientParam}" não encontrado.` }, { status: 404 });
    }

    if (body?.action === "save_action_mapping" && body?.mapping) {
      const clean: ActionMapping = {
        conversa_iniciada: String(body.mapping.conversa_iniciada || "").trim() || undefined,
        orcamento_enviado: String(body.mapping.orcamento_enviado || "").trim() || undefined,
        compra_realizada: String(body.mapping.compra_realizada || "").trim() || undefined,
      };
      writeActionMapping(tenant.slug, clean);
      return NextResponse.json({ success: true, actionMapping: clean });
    }

    if (body?.action === "refresh_diagnostics") {
      const diag = await fetchOrReadOfficialDiagnostics(tenant, true);
      return NextResponse.json({ success: diag.apiConnected, officialDiagnostics: diag });
    }

    if (body?.action === "upload_adjustment") {
      const leadId = String(body?.leadId || "").trim();
      const adjustmentType: "RESTATEMENT" | "RETRACTION" =
        body?.adjustmentType === "RETRACTION" ? "RETRACTION" : "RESTATEMENT";
      const adjustedValue = Number(body?.adjustedValue ?? 0);

      if (!leadId) {
        return NextResponse.json({ success: false, error: "leadId é obrigatório" }, { status: 400 });
      }

      const leads = readTenantLeads(tenant.slug, tenant);
      const idx = leads.findIndex((l: any) => l.id === leadId);
      if (idx === -1) {
        return NextResponse.json({ success: false, error: "Lead não encontrado" }, { status: 404 });
      }

      const sentStage =
        leads[idx]?.sentStages?.compra_realizada ||
        leads[idx]?.sentStages?.[getLeadStage(leads[idx])];

      const orderId = String(
        body?.orderId || sentStage?.orderId || leads[idx]?.ociOrderId || ""
      ).trim();
      if (!orderId) {
        return NextResponse.json(
          { success: false, error: "Lead sem orderId enviado anteriormente ao Google Ads." },
          { status: 400 }
        );
      }

      const ctxAdj = await resolveWorkingGoogleAdsContext(tenant);
      if (!ctxAdj.ok || !ctxAdj.version || !ctxAdj.accessToken || !ctxAdj.devToken || !ctxAdj.customerId) {
        return NextResponse.json(
          { success: false, error: ctxAdj.error || "Google Ads API indisponível." },
          { status: 400 }
        );
      }

      const conversionAction =
        sentStage?.conversionAction ||
        resolveStageConversionAction(
          "compra_realizada",
          ctxAdj.conversionActions,
          readActionMapping(tenant.slug),
          readRulesActionNames(tenant.slug)
        )?.resourceName;

      if (!conversionAction) {
        return NextResponse.json(
          { success: false, error: "Ação de conversão não encontrada para ajuste." },
          { status: 400 }
        );
      }

      const adjustmentEntry: Record<string, any> = {
        conversionAction,
        orderId,
        adjustmentType,
        adjustmentDateTime: formatGoogleAdsDateTime(Date.now()),
      };
      if (adjustmentType === "RESTATEMENT") {
        adjustmentEntry.restatementValue = {
          adjustedValue: isNaN(adjustedValue) ? 0 : adjustedValue,
          currencyCode: "BRL",
        };
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${ctxAdj.accessToken}`,
        "developer-token": ctxAdj.devToken,
        "Content-Type": "application/json",
      };
      if (ctxAdj.loginCustomerId) headers["login-customer-id"] = ctxAdj.loginCustomerId;

      const adjRes = await fetch(
        `https://googleads.googleapis.com/${ctxAdj.version}/customers/${ctxAdj.customerId}:uploadConversionAdjustments`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ conversionAdjustments: [adjustmentEntry], partialFailure: true }),
        }
      );

      const adjJson = await adjRes.json().catch(() => ({}));
      const pf = parsePartialFailureErrors(adjJson, 1);

      if (!adjRes.ok || pf.hasAnyFailure) {
        const rawErr =
          pf.perItemError[0] ||
          pf.globalMessage ||
          adjJson?.error?.message ||
          `Erro HTTP ${adjRes.status} no ajuste`;
        return NextResponse.json(
          { success: false, error: buildFriendlyGoogleOciError(rawErr), apiResponse: adjJson },
          { status: 400 }
        );
      }

      if (!Array.isArray(leads[idx].conversionAdjustments)) {
        leads[idx].conversionAdjustments = [];
      }
      leads[idx].conversionAdjustments.unshift({
        adjustmentType,
        orderId,
        adjustedValue: adjustmentType === "RESTATEMENT" ? adjustedValue : 0,
        adjustedAt: new Date().toISOString(),
        apiVersion: ctxAdj.version,
      });
      if (adjustmentType === "RESTATEMENT") {
        leads[idx].value = adjustedValue;
        if (leads[idx].sentStages?.compra_realizada) {
          leads[idx].sentStages.compra_realizada.value = adjustedValue;
        }
      } else {
        leads[idx].stage = "orcamento_enviado";
        leads[idx].conversionType = "orcamento_enviado";
        leads[idx].value = 0;
      }
      leads[idx].pendingConversionAdjustment = null;
      leads[idx].updatedAt = new Date().toISOString();
      writeTenantLeads(tenant.slug, leads);

      return NextResponse.json({
        success: true,
        adjustmentType,
        orderId,
        adjustedValue,
        apiVersionUsed: ctxAdj.version,
        lead: leads[idx],
      });
    }

    if (body?.action === "retract_false_positives") {
      const dryRun = body?.dryRun !== false;
      const requestedStages: FunnelStage[] = Array.isArray(body?.stages) && body.stages.length > 0
        ? body.stages.filter((s: any): s is FunnelStage =>
            s === "conversa_iniciada" || s === "orcamento_enviado" || s === "compra_realizada"
          )
        : ["conversa_iniciada", "orcamento_enviado", "compra_realizada"];

      const leads = readTenantLeads(tenant.slug, tenant);
      const audits = readTenantAudits(tenant.slug);
      const sentIndex = readSentIndex(tenant.slug);

      const isTemporalAudit = (a: any): boolean => {
        const aid = String(a?.id || "");
        const phrase = String(a?.detectedPhrase || "");
        return (
          aid.startsWith("audit_temporal_") ||
          aid.startsWith("audit_uazapi_temp_") ||
          /atribui[çc][ãa]o temporal|janela 30min|janela 5min/i.test(phrase)
        );
      };

      const isExactTagAudit = (a: any): boolean => {
        const phrase = String(a?.detectedPhrase || "");
        return (
          /tag invis[íi]vel/i.test(phrase) ||
          /lead recuperado automaticamente via reconcilia[çc][ãa]o uazapi/i.test(phrase)
        );
      };

      const exactTagGclids = new Set<string>();
      const temporalGclids = new Set<string>();
      const temporalPhonesNoGclid = new Set<string>();

      for (const a of audits) {
        const g = String(a?.gclid || "").trim();
        const p = String(a?.leadPhone || "").replace(/\D/g, "");
        if (isExactTagAudit(a) && g && g !== "sem_gclid") {
          exactTagGclids.add(g);
        }
        if (isTemporalAudit(a)) {
          if (g && g !== "sem_gclid") {
            temporalGclids.add(g);
          } else if (p) {
            temporalPhonesNoGclid.add(p);
          }
        }
      }

      const sentIndexByLeadId = new Map<string, SentIndexEntry[]>();
      for (const entry of Object.values(sentIndex)) {
        if (!entry?.leadId) continue;
        const arr = sentIndexByLeadId.get(entry.leadId) || [];
        arr.push(entry);
        sentIndexByLeadId.set(entry.leadId, arr);
      }

      interface RetractCandidate {
        leadIndex: number;
        leadId: string;
        gclid: string;
        keyword: string;
        stage: FunnelStage;
        orderId: string;
        conversionAction?: string;
        conversionActionName?: string;
        sentAt?: string;
        value: number;
        reason: string;
      }

      const candidates: RetractCandidate[] = [];
      const seenOrderIds = new Set<string>();
      let preservedExactCount = 0;
      let totalFalsePositiveLeads = 0;
      let skippedAlreadyRetractedCount = 0;

      for (let i = 0; i < leads.length; i++) {
        const l = leads[i];
        const g = String(l?.gclid || "").trim();
        const p = String(l?.leadPhone || "").replace(/\D/g, "");

        // Trava absoluta: NUNCA estornar leads confirmados por Tag Invisível Zero-Width
        if (g && exactTagGclids.has(g)) {
          preservedExactCount++;
          continue;
        }

        const isCleanedTemporal = Boolean(l?.cleanedTemporalAt);
        const isClickOnly =
          l?.stage === "clique_anuncio" && (!p || /aguardando/i.test(String(l?.leadPhone || "")));
        const matchedTemporalAudit =
          Boolean(g && temporalGclids.has(g)) || Boolean(!g && p && temporalPhonesNoGclid.has(p));

        if (!isCleanedTemporal && !isClickOnly && !matchedTemporalAudit) {
          continue;
        }

        const reason = isCleanedTemporal
          ? "limpo_janela_temporal"
          : isClickOnly
            ? "clique_sem_conversa_enviado_oci"
            : "auditoria_janela_temporal";

        let leadHasCandidate = false;

        for (const stage of requestedStages) {
          const stageRecords: Array<{
            orderId: string;
            conversionAction?: string;
            conversionActionName?: string;
            sentAt?: string;
            value: number;
            alreadyRetracted: boolean;
          }> = [];

          const sentStageObj = l?.sentStages?.[stage];
          if (sentStageObj?.orderId || sentStageObj?.sentAt) {
            const oid = String(sentStageObj.orderId || buildDeterministicOrderId(l.id, stage));
            const alreadyRetracted =
              Boolean(sentStageObj.retractedAt) ||
              (Array.isArray(l?.conversionAdjustments) &&
                l.conversionAdjustments.some(
                  (adj: any) => adj?.adjustmentType === "RETRACTION" && adj?.orderId === oid
                ));
            stageRecords.push({
              orderId: oid,
              conversionAction: sentStageObj.conversionAction,
              conversionActionName: sentStageObj.conversionActionName,
              sentAt: sentStageObj.sentAt,
              value: Number(sentStageObj.value || 0),
              alreadyRetracted,
            });
          }

          const idxEntries = (sentIndexByLeadId.get(String(l.id || "")) || []).filter(
            (e) => e.stage === stage
          );
          for (const e of idxEntries) {
            if (!e.orderId) continue;
            if (stageRecords.some((r) => r.orderId === e.orderId)) continue;
            const alreadyRetracted =
              Boolean(l?.sentStages?.[stage]?.retractedAt) ||
              (Array.isArray(l?.conversionAdjustments) &&
                l.conversionAdjustments.some(
                  (adj: any) => adj?.adjustmentType === "RETRACTION" && adj?.orderId === e.orderId
                ));
            stageRecords.push({
              orderId: e.orderId,
              conversionAction: e.conversionAction,
              conversionActionName: e.conversionActionName,
              sentAt: e.sentAt,
              value: Number(e.value || 0),
              alreadyRetracted,
            });
          }

          // Fallback legado: lead antigo marcado como status="sent" sem sentStages
          if (
            stageRecords.length === 0 &&
            l?.status === "sent" &&
            (l?.lastUploadedStage === stage || (!l?.lastUploadedStage && stage === "conversa_iniciada"))
          ) {
            const oid = String(l?.ociOrderId || buildDeterministicOrderId(l.id, stage));
            const alreadyRetracted =
              Array.isArray(l?.conversionAdjustments) &&
              l.conversionAdjustments.some(
                (adj: any) => adj?.adjustmentType === "RETRACTION" && adj?.orderId === oid
              );
            stageRecords.push({
              orderId: oid,
              sentAt: l?.sentAt || undefined,
              value: Number(l?.value || 0),
              alreadyRetracted,
            });
          }

          for (const rec of stageRecords) {
            if (seenOrderIds.has(rec.orderId)) continue;
            seenOrderIds.add(rec.orderId);
            if (rec.alreadyRetracted) {
              skippedAlreadyRetractedCount++;
              continue;
            }
            leadHasCandidate = true;
            candidates.push({
              leadIndex: i,
              leadId: String(l.id || ""),
              gclid: g,
              keyword: String(l.keyword || ""),
              stage,
              orderId: rec.orderId,
              conversionAction: rec.conversionAction,
              conversionActionName: rec.conversionActionName,
              sentAt: rec.sentAt,
              value: rec.value,
              reason,
            });
          }
        }

        if (leadHasCandidate) {
          totalFalsePositiveLeads++;
        }
      }

      const byStage: Record<FunnelStage, number> = {
        conversa_iniciada: 0,
        orcamento_enviado: 0,
        compra_realizada: 0,
      };
      for (const c of candidates) {
        byStage[c.stage]++;
      }

      if (dryRun) {
        return NextResponse.json({
          success: true,
          dryRun: true,
          tenantSlug: tenant.slug,
          requestedStages,
          totalFalsePositiveLeads,
          totalCandidates: candidates.length,
          skippedAlreadyRetractedCount,
          preservedExactCount,
          byStage,
          items: candidates.map((c) => ({
            leadId: c.leadId,
            stage: c.stage,
            orderId: c.orderId,
            keyword: c.keyword,
            gclid: c.gclid ? `${c.gclid.slice(0, 18)}...` : "",
            conversionActionName: c.conversionActionName || c.conversionAction || "(resolver via API)",
            sentAt: c.sentAt || null,
            value: c.value,
            reason: c.reason,
          })),
        });
      }

      if (candidates.length === 0) {
        return NextResponse.json({
          success: true,
          dryRun: false,
          tenantSlug: tenant.slug,
          retractedCount: 0,
          failedCount: 0,
          skippedAlreadyRetractedCount,
          preservedExactCount,
          message: "Nenhuma conversão falsa pendente de estorno (RETRACT) encontrada.",
          results: [],
        });
      }

      const ctxAdj = await resolveWorkingGoogleAdsContext(tenant);
      if (!ctxAdj.ok || !ctxAdj.version || !ctxAdj.accessToken || !ctxAdj.devToken || !ctxAdj.customerId) {
        return NextResponse.json(
          { success: false, error: ctxAdj.error || "Google Ads API indisponível." },
          { status: 400 }
        );
      }

      const actionMapping = readActionMapping(tenant.slug);
      const rulesNames = readRulesActionNames(tenant.slug);
      const adjustmentDateTime = formatGoogleAdsDateTime(Date.now());

      const resolvedBatch: Array<{ candidate: RetractCandidate; conversionAction: string }> = [];
      const results: Array<{
        leadId: string;
        stage: FunnelStage;
        orderId: string;
        status: "retracted" | "failed";
        error?: string;
      }> = [];

      for (const c of candidates) {
        const actionResource =
          c.conversionAction ||
          resolveStageConversionAction(c.stage, ctxAdj.conversionActions, actionMapping, rulesNames)
            ?.resourceName;

        if (!actionResource) {
          results.push({
            leadId: c.leadId,
            stage: c.stage,
            orderId: c.orderId,
            status: "failed",
            error: `Ação de conversão Google Ads não encontrada para etapa "${c.stage}".`,
          });
          continue;
        }
        resolvedBatch.push({ candidate: c, conversionAction: actionResource });
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${ctxAdj.accessToken}`,
        "developer-token": ctxAdj.devToken,
        "Content-Type": "application/json",
      };
      if (ctxAdj.loginCustomerId) headers["login-customer-id"] = ctxAdj.loginCustomerId;

      let retractedCount = 0;
      let failedCount = results.length;
      const byStageRetracted: Record<FunnelStage, number> = {
        conversa_iniciada: 0,
        orcamento_enviado: 0,
        compra_realizada: 0,
      };
      const nowIso = new Date().toISOString();
      let leadsMutated = false;

      const CHUNK_SIZE = 500;
      for (let start = 0; start < resolvedBatch.length; start += CHUNK_SIZE) {
        const chunk = resolvedBatch.slice(start, start + CHUNK_SIZE);
        const payload = {
          conversionAdjustments: chunk.map((item) => ({
            conversionAction: item.conversionAction,
            orderId: item.candidate.orderId,
            adjustmentType: "RETRACTION",
            adjustmentDateTime,
          })),
          partialFailure: true,
        };

        const adjRes = await fetch(
          `https://googleads.googleapis.com/${ctxAdj.version}/customers/${ctxAdj.customerId}:uploadConversionAdjustments`,
          {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
          }
        );

        const adjJson = await adjRes.json().catch(() => ({}));

        if (!adjRes.ok) {
          const rawErr =
            adjJson?.error?.message ||
            adjJson?.error?.details?.[0]?.errors?.[0]?.message ||
            `Erro HTTP ${adjRes.status} ao enviar RETRACTION em lote`;
          const friendly = buildFriendlyGoogleOciError(rawErr);
          for (const item of chunk) {
            failedCount++;
            results.push({
              leadId: item.candidate.leadId,
              stage: item.candidate.stage,
              orderId: item.candidate.orderId,
              status: "failed",
              error: friendly,
            });
          }
          continue;
        }

        const pf = parsePartialFailureErrors(adjJson, chunk.length);
        const resItems: any[] = Array.isArray(adjJson?.results) ? adjJson.results : [];

        for (let j = 0; j < chunk.length; j++) {
          const item = chunk[j];
          const itemRes = resItems[j];
          const isEmptyRes = pf.hasAnyFailure && (!itemRes || Object.keys(itemRes).length === 0);
          const itemErr = pf.perItemError[j] || (isEmptyRes ? pf.globalMessage || "Falha parcial Google Ads" : null);

          if (itemErr) {
            failedCount++;
            results.push({
              leadId: item.candidate.leadId,
              stage: item.candidate.stage,
              orderId: item.candidate.orderId,
              status: "failed",
              error: buildFriendlyGoogleOciError(itemErr),
            });
          } else {
            const lead = leads[item.candidate.leadIndex];
            if (!Array.isArray(lead.conversionAdjustments)) {
              lead.conversionAdjustments = [];
            }
            lead.conversionAdjustments.unshift({
              adjustmentType: "RETRACTION",
              stage: item.candidate.stage,
              orderId: item.candidate.orderId,
              adjustedValue: 0,
              adjustedAt: nowIso,
              apiVersion: ctxAdj.version,
              reason: item.candidate.reason,
            });
            if (!lead.sentStages) lead.sentStages = {};
            if (!lead.sentStages[item.candidate.stage]) {
              lead.sentStages[item.candidate.stage] = {
                orderId: item.candidate.orderId,
                conversionAction: item.conversionAction,
                sentAt: item.candidate.sentAt || nowIso,
                value: item.candidate.value,
              };
            }
            lead.sentStages[item.candidate.stage].retractedAt = nowIso;
            lead.updatedAt = nowIso;
            leadsMutated = true;

            retractedCount++;
            byStageRetracted[item.candidate.stage]++;
            results.push({
              leadId: item.candidate.leadId,
              stage: item.candidate.stage,
              orderId: item.candidate.orderId,
              status: "retracted",
            });
          }
        }
      }

      if (leadsMutated) {
        writeTenantLeads(tenant.slug, leads);
      }

      return NextResponse.json({
        success: true,
        dryRun: false,
        tenantSlug: tenant.slug,
        apiVersionUsed: ctxAdj.version,
        retractedCount,
        failedCount,
        skippedAlreadyRetractedCount,
        preservedExactCount,
        byStageRetracted,
        results,
      });
    }

    const mode: "retry_failed" | "auto" = body?.mode === "retry_failed" ? "retry_failed" : "auto";
    const targetId: string | undefined = body?.id ? String(body.id) : undefined;

    const ctx = await resolveWorkingGoogleAdsContext(tenant);
    if (!ctx.ok || !ctx.version || !ctx.accessToken || !ctx.devToken || !ctx.customerId) {
      return NextResponse.json(
        {
          success: false,
          uploadedCount: 0,
          failedCount: 0,
          skippedSentCount: 0,
          hasApiCredentials: getMissingGoogleAdsEnvVars().length === 0,
          error: ctx.error || "Credenciais Google Ads API indisponíveis.",
        },
        { status: 400 }
      );
    }

    const leads = readTenantLeads(tenant.slug, tenant);
    const sentIndex = readSentIndex(tenant.slug);
    const actionMapping = readActionMapping(tenant.slug);
    const ruleNames = readRulesActionNames(tenant.slug);
    const now = Date.now();

    interface Candidate {
      leadIndex: number;
      lead: any;
      stage: FunnelStage;
      stageKey: string;
      orderId: string;
      conversionAction: ConversionActionOption;
      stageMs: number;
      conversionValue: number;
      clickIdKind: "gclid" | "gbraid" | "wbraid";
      clickIdValue: string;
      hashedPhoneHex: string | null;
      hashedPhoneUsed: boolean;
    }

    const candidates: Candidate[] = [];
    let skippedSentCount = 0;
    let leadsMutated = false;
    const preCheckErrors: Array<{ id: string; status: string; error: string }> = [];

    for (let i = 0; i < leads.length; i++) {
      const l = leads[i];
      if (targetId && l.id !== targetId) continue;

      const clickId = extractClickIdentifiers(l);
      if (!clickId.value || !clickId.kind) continue;

      const stage = getLeadStage(l);
      const stageKey = buildStageKey(l.id, stage);

      if (isStageAlreadySent(l, stage, sentIndex)) {
        skippedSentCount += 1;
        continue;
      }

      if (mode === "retry_failed" && l.status !== "failed") {
        continue;
      }

      if (isWaitingWhatsApp(tenant, l) && l.status !== "failed") {
        continue;
      }

      const occurredTime = new Date(l.occurredAt || l.firstMessageAt || now).getTime();
      const isMatured = now - occurredTime >= MATURATION_TIME_MS;

      if (mode === "auto" && !isMatured && l.status !== "failed") {
        continue;
      }

      const resolvedAction = resolveStageConversionAction(
        stage,
        ctx.conversionActions,
        actionMapping,
        ruleNames
      );

      if (!resolvedAction) {
        const errMsg = `Nenhuma ação de conversão ativa do Google Ads mapeada para "${stage}". Configure o vínculo na Aba 5 -> Central OCI.`;
        leads[i].status = "failed";
        leads[i].ociError = errMsg;
        leadsMutated = true;
        preCheckErrors.push({ id: l.id, status: "failed", error: errMsg });
        continue;
      }

      const stageRawTime =
        stage === "compra_realizada"
          ? l.purchasedAt || l.updatedAt || l.occurredAt
          : stage === "orcamento_enviado"
            ? l.quotedAt || l.updatedAt || l.occurredAt
            : l.firstMessageAt || l.occurredAt;
      const stageMs = Math.max(occurredTime, new Date(stageRawTime || now).getTime());

      const orderId = buildDeterministicOrderId(l.id, stage);
      const conversionValue =
        l.value !== undefined && l.value !== null && !isNaN(Number(l.value))
          ? Number(l.value)
          : stage === "compra_realizada"
            ? 1
            : 0;

      let hashedPhoneHex: string | null = null;
      if (clickId.kind === "gclid") {
        const e164 = normalizePhoneE164(tenant, l.leadPhone);
        if (e164) {
          hashedPhoneHex = hashPhoneSha256(e164);
        }
      }

      candidates.push({
        leadIndex: i,
        lead: l,
        stage,
        stageKey,
        orderId,
        conversionAction: resolvedAction,
        stageMs,
        conversionValue,
        clickIdKind: clickId.kind,
        clickIdValue: clickId.value,
        hashedPhoneHex,
        hashedPhoneUsed: Boolean(hashedPhoneHex),
      });
    }

    let uploadedCount = 0;
    let failedCount = preCheckErrors.length;
    const results: any[] = [...preCheckErrors];

    if (candidates.length > 0) {
      const destinationsMap = new Map<string, Record<string, any>>();
      for (const c of candidates) {
        const ref = `dest_${c.conversionAction.id}`;
        if (!destinationsMap.has(ref)) {
          const destObj: Record<string, any> = {
            reference: ref,
            operatingAccount: {
              accountType: "GOOGLE_ADS",
              accountId: ctx.customerId,
            },
            productDestinationId: String(c.conversionAction.id),
          };
          if (ctx.loginCustomerId) {
            destObj.loginAccount = {
              accountType: "GOOGLE_ADS",
              accountId: ctx.loginCustomerId,
            };
          }
          destinationsMap.set(ref, destObj);
        }
      }

      const anyUserData = candidates.some((c) => Boolean(c.hashedPhoneHex));
      const eventsPayload = candidates.map((c) => {
        const eventObj: Record<string, any> = {
          destinationReferences: [`dest_${c.conversionAction.id}`],
          eventTimestamp: new Date(c.stageMs).toISOString(),
          eventSource: "WEB",
          transactionId: c.orderId,
          conversionValue: c.conversionValue,
          currency: "BRL",
          adIdentifiers: {
            [c.clickIdKind]: c.clickIdValue,
          },
        };
        if (c.hashedPhoneHex) {
          eventObj.userData = {
            userIdentifiers: [
              {
                phoneNumber: c.hashedPhoneHex,
              },
            ],
          };
        }
        return eventObj;
      });

      const dmRequestBody: Record<string, any> = {
        destinations: Array.from(destinationsMap.values()),
        events: eventsPayload,
        consent: {
          adUserData: "CONSENT_GRANTED",
          adPersonalization: "CONSENT_GRANTED",
        },
      };
      if (anyUserData) {
        dmRequestBody.encoding = "HEX";
      }

      const uploadRes = await fetch("https://datamanager.googleapis.com/v1/events:ingest", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ctx.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(dmRequestBody),
      });

      const resJson = await uploadRes.json().catch(() => ({}));

      if (!uploadRes.ok) {
        const rawErr =
          resJson?.error?.message ||
          resJson?.error?.details?.[0]?.reason ||
          resJson?.error?.details?.[0]?.message ||
          `Erro HTTP ${uploadRes.status} na Data Manager API v1`;
        const friendlyErr = buildFriendlyGoogleOciError(rawErr);

        for (const c of candidates) {
          leads[c.leadIndex].status = "failed";
          leads[c.leadIndex].ociError = friendlyErr;
          leads[c.leadIndex].ociOrderId = c.orderId;
          failedCount += 1;
          results.push({ id: c.lead.id, stage: c.stage, orderId: c.orderId, status: "failed", error: friendlyErr });
        }
        leadsMutated = true;
      } else {
        const nowIso = new Date().toISOString();
        const requestId = resJson?.requestId ? String(resJson.requestId) : null;
        const warningsCount = Array.isArray(resJson?.fieldWarnings) ? resJson.fieldWarnings.length : 0;

        for (const c of candidates) {
          leads[c.leadIndex].status = "sent";
          leads[c.leadIndex].sentAt = nowIso;
          leads[c.leadIndex].lastUploadedStage = c.stage;
          leads[c.leadIndex].ociOrderId = c.orderId;
          leads[c.leadIndex].ociError = null;
          leads[c.leadIndex].ociResult = `Enviado Data Manager API v1${requestId ? ` (${requestId})` : ""}${c.hashedPhoneUsed ? " + Enhanced SHA-256" : ""}${warningsCount > 0 ? ` [${warningsCount} aviso(s)]` : ""}`;
          if (!leads[c.leadIndex].sentStages) leads[c.leadIndex].sentStages = {};
          leads[c.leadIndex].sentStages[c.stage] = {
            orderId: c.orderId,
            sentAt: nowIso,
            conversionAction: c.conversionAction.resourceName,
            conversionActionName: c.conversionAction.name,
            value: c.conversionValue,
            hashedPhoneUsed: c.hashedPhoneUsed,
            requestId,
          };

          sentIndex[c.stageKey] = {
            key: c.stageKey,
            leadId: c.lead.id,
            stage: c.stage,
            orderId: c.orderId,
            conversionAction: c.conversionAction.resourceName,
            conversionActionName: c.conversionAction.name,
            value: c.conversionValue,
            hashedPhoneUsed: c.hashedPhoneUsed,
            sentAt: nowIso,
            apiVersion: "datamanager-v1",
          };

          uploadedCount += 1;
          leadsMutated = true;
          results.push({
            id: c.lead.id,
            stage: c.stage,
            orderId: c.orderId,
            hashedPhoneUsed: c.hashedPhoneUsed,
            conversionAction: c.conversionAction.name,
            requestId,
            status: "sent",
          });
        }
      }
    }

    if (leadsMutated) {
      writeTenantLeads(tenant.slug, leads);
      writeSentIndex(tenant.slug, sentIndex);
    }

    return NextResponse.json({
      success: failedCount === 0,
      tenantSlug: tenant.slug,
      customerId: ctx.customerId,
      mode,
      apiVersionUsed: ctx.version,
      uploadedCount,
      failedCount,
      skippedSentCount,
      processedCandidates: candidates.length,
      hasApiCredentials: true,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Erro no processamento OCI" },
      { status: 500 }
    );
  }
}

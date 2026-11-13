import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * PASSO 3: OCI À PROVA DE FALHAS + ENHANCED CONVERSIONS (SHA-256) + DIAGNÓSTICO OFICIAL GOOGLE
 * Caminho no GitHub: apps/web/src/app/api/google-ads/oci/route.ts
 *
 * - Google Ads API ativa (v25/v26 com fallback v24/v23) + descoberta automática de MCC
 * - Lookup real de conversion_action via GAQL (sem slugs fictícios nem v17)
 * - Enhanced Conversions for Leads: telefone E.164 (+55...) normalizado e hasheado em SHA-256
 * - Anti-duplicidade nativa via orderId determinístico por (leadId + stage)
 * - Trava absoluta de idempotência no backend (/data/alpha_google_oci_sent_index.json):
 *   eventos "sent" NUNCA são reenviados (mesmo com force: true)
 * - Parsing completo de partialFailureError (mesmo em HTTP 200)
 * - Diagnóstico assíncrono oficial via offline_conversion_upload_client_summary e conversion_action_summary
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

const CUSTOMER_ID = (process.env.GOOGLE_ADS_CUSTOMER_ID || "3228136878").replace(/\D/g, "");
const MATURATION_TIME_MS = 4 * 60 * 60 * 1000; // 4 horas mínimas para maturação de GCLID
const DIAGNOSTICS_CACHE_TTL_MS = 15 * 60 * 1000; // 15 min (preserva cota Exploração 2.880 ops/dia)
const ATTENDANT_PHONES = ["5521980659269", "5521994060206", "21980659269", "21994060206"];

function getStorageDir(): string {
  if (process.env.GOOGLE_ADS_DATA_DIR) {
    try {
      if (!fs.existsSync(process.env.GOOGLE_ADS_DATA_DIR)) {
        fs.mkdirSync(process.env.GOOGLE_ADS_DATA_DIR, { recursive: true });
      }
      return process.env.GOOGLE_ADS_DATA_DIR;
    } catch {}
  }
  try {
    if (fs.existsSync("/data")) return "/data";
  } catch {}
  return "/tmp";
}

function getLeadsFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_leads.json");
}

function getRulesFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_conversion_rules.json");
}

function getSentIndexFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_oci_sent_index.json");
}

function getActionMappingFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_oci_actions_map.json");
}

function getDiagnosticsCacheFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_oci_diagnostics.json");
}

function getEntitiesMetaFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_entities_meta.json");
}

function writeJsonAtomic(filePath: string, payload: unknown): void {
  const json = JSON.stringify(payload, null, 2);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, json, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function readJsonSafe<T>(primaryPath: string, fallbackTmpPath: string | null, defaultValue: T): T {
  try {
    if (fs.existsSync(primaryPath)) {
      return JSON.parse(fs.readFileSync(primaryPath, "utf8")) as T;
    }
    if (fallbackTmpPath && fs.existsSync(fallbackTmpPath)) {
      return JSON.parse(fs.readFileSync(fallbackTmpPath, "utf8")) as T;
    }
  } catch {}
  return defaultValue;
}

function readLeads(): any[] {
  return readJsonSafe<any[]>(getLeadsFilePath(), "/tmp/alpha_google_leads.json", []);
}

function writeLeads(leads: any[]): void {
  const trimmed = leads.slice(0, 500);
  try {
    const file = getLeadsFilePath();
    writeJsonAtomic(file, trimmed);
    if (file !== "/tmp/alpha_google_leads.json") {
      try {
        writeJsonAtomic("/tmp/alpha_google_leads.json", trimmed);
      } catch {}
    }
  } catch (err) {
    console.error("Erro ao salvar leads OCI:", err);
  }
}

function readSentIndex(): Record<string, SentIndexEntry> {
  return readJsonSafe<Record<string, SentIndexEntry>>(
    getSentIndexFilePath(),
    "/tmp/alpha_google_oci_sent_index.json",
    {}
  );
}

function writeSentIndex(index: Record<string, SentIndexEntry>): void {
  try {
    const entries = Object.entries(index);
    const trimmed =
      entries.length > 2500 ? Object.fromEntries(entries.slice(entries.length - 2500)) : index;
    writeJsonAtomic(getSentIndexFilePath(), trimmed);
  } catch (err) {
    console.error("Erro ao gravar índice de idempotência OCI:", err);
  }
}

function readActionMapping(): ActionMapping {
  return readJsonSafe<ActionMapping>(getActionMappingFilePath(), null, {});
}

function writeActionMapping(mapping: ActionMapping): void {
  writeJsonAtomic(getActionMappingFilePath(), mapping);
}

function readRulesActionNames(): { quoteActionName: string; purchaseActionName: string } {
  const rules = readJsonSafe<any>(
    getRulesFilePath(),
    "/tmp/alpha_google_conversion_rules.json",
    {}
  );
  return {
    quoteActionName: String(rules?.quote?.actionName || "WhatsApp - Orçamento Enviado").trim(),
    purchaseActionName: String(rules?.purchase?.actionName || "WhatsApp - Compra Realizada").trim(),
  };
}

function normalizeText(text: string): string {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isAttendantPhone(phone?: string): boolean {
  const p = String(phone || "").replace(/\D/g, "");
  if (!p) return false;
  return ATTENDANT_PHONES.some(
    (att) => p === att || (p.length >= 8 && att.length >= 8 && p.slice(-8) === att.slice(-8))
  );
}

function isWaitingWhatsApp(lead: any): boolean {
  const p = String(lead?.leadPhone || "").trim();
  const placeholder = !p || /aguardando/i.test(p) || isAttendantPhone(p);
  return !lead?.firstMessageAt && placeholder;
}

function normalizePhoneE164(rawPhone?: string): string | null {
  if (!rawPhone || /aguardando/i.test(rawPhone)) return null;
  if (isAttendantPhone(rawPhone)) return null;
  let digits = String(rawPhone).replace(/\D/g, "");
  if (!digits || digits.length < 10 || digits.length > 15) return null;
  // Remove 0 à esquerda se houver
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
  // Compatibilidade com leads já enviados antes do PASSO 3
  if (lead?.status === "sent") {
    const recordedStage = lead?.lastUploadedStage || lead?.stage || lead?.conversionType || "conversa_iniciada";
    if (recordedStage === stage) return true;
  }
  return false;
}

function formatGoogleAdsDateTime(isoOrMs: string | number): string {
  const d = new Date(isoOrMs);
  const valid = isNaN(d.getTime()) ? new Date() : d;
  // Google Ads API exige estritamente YYYY-MM-DD HH:MM:SS+|-HH:MM (sem milissegundos)
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

async function resolveWorkingGoogleAdsContext(): Promise<{
  ok: boolean;
  accessToken?: string;
  devToken?: string;
  version?: string;
  loginCustomerId?: string;
  conversionActions: ConversionActionOption[];
  error?: string;
}> {
  const missingEnv = getMissingGoogleAdsEnvVars();
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  if (!devToken || missingEnv.length > 0) {
    return {
      ok: false,
      conversionActions: [],
      error: `Variáveis ausentes no Dokploy: ${missingEnv.join(", ")}`,
    };
  }

  const oauth = await getGoogleAdsAccessToken();
  if (!oauth.token) {
    return { ok: false, conversionActions: [], error: oauth.error || "Falha OAuth2" };
  }

  const entitiesMeta = readJsonSafe<any>(getEntitiesMetaFilePath(), null, {});
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
      customerId: CUSTOMER_ID,
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
          customerId: CUSTOMER_ID,
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
          targetCustomerId: CUSTOMER_ID,
          accessToken: oauth.token,
          devToken,
        });
        if (mcc) {
          loginCustomerId = mcc;
          res = await executeGaqlStream({
            version,
            customerId: CUSTOMER_ID,
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
              `customers/${CUSTOMER_ID}/conversionActions/${r.conversionAction?.id}`
          ),
          type: String(r.conversionAction?.type || ""),
          status: String(r.conversionAction?.status || ""),
          category: String(r.conversionAction?.category || ""),
        }))
        .filter((a) => Boolean(a.id && a.name));

      return {
        ok: true,
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

  // 1) Mapeamento explícito configurado pelo usuário na Aba 5
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

  // Ordenar preferindo ações compatíveis com importação offline (UPLOAD_CLICKS)
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

  // 2) Match exato normalizado (sem acento/maiúscula)
  for (const target of targetNames) {
    const normTarget = normalizeText(target);
    const exact = sortedPool.find((a) => normalizeText(a.name) === normTarget);
    if (exact) return exact;
  }

  // 3) Match por palavra-chave contida + tipo offline preferencial
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

async function fetchOrReadOfficialDiagnostics(forceRefresh = false): Promise<OfficialDiagnosticsCache> {
  const cached = readJsonSafe<OfficialDiagnosticsCache | null>(
    getDiagnosticsCacheFilePath(),
    null,
    null
  );

  if (!forceRefresh && cached?.fetchedAt) {
    const age = Date.now() - new Date(cached.fetchedAt).getTime();
    if (age < DIAGNOSTICS_CACHE_TTL_MS && (cached.apiConnected || age < 60 * 1000)) {
      return cached;
    }
  }

  const ctx = await resolveWorkingGoogleAdsContext();
  if (!ctx.ok || !ctx.version || !ctx.accessToken || !ctx.devToken) {
    const fallback: OfficialDiagnosticsCache = {
      fetchedAt: new Date().toISOString(),
      apiConnected: false,
      error: ctx.error || "API desconectada",
      availableConversionActions: cached?.availableConversionActions || [],
      clientSummary: cached?.clientSummary || [],
      actionSummaries: cached?.actionSummaries || [],
    };
    try {
      writeJsonAtomic(getDiagnosticsCacheFilePath(), fallback);
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
      customerId: CUSTOMER_ID,
      accessToken: ctx.accessToken,
      devToken: ctx.devToken,
      loginCustomerId: ctx.loginCustomerId,
      query: clientSummaryQuery,
    }),
    executeGaqlStream({
      version: ctx.version,
      customerId: CUSTOMER_ID,
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
    writeJsonAtomic(getDiagnosticsCacheFilePath(), result);
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
      const convElem = fieldElems.find((f: any) => f?.fieldName === "conversions" && f?.index !== undefined);
      if (convElem && Number.isInteger(Number(convElem.index))) {
        const idx = Number(convElem.index);
        perItemError[idx] = perItemError[idx] ? `${perItemError[idx]} | ${fullMsg}` : fullMsg;
      }
    }
  }

  // Fallback se partialFailureError veio sem índice explícito
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
  const msg = String(rawMessage || "Erro desconhecido na Google Ads API");
  if (/CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE/i.test(msg)) {
    return `${msg} — A conta/projeto ainda não foi habilitado para UploadClickConversions legado ou requer vínculo/uso da Data Manager API (escopo datamanager).`;
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
  const forceRefresh = searchParams.get("refresh") === "true";

  const leads = readLeads();
  const sentIndex = readSentIndex();
  const actionMapping = readActionMapping();
  const ruleNames = readRulesActionNames();
  const diagnostics = await fetchOrReadOfficialDiagnostics(forceRefresh);

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
      const waitingWpp = isWaitingWhatsApp(l);
      const clickId = extractClickIdentifiers(l);
      const e164Phone = normalizePhoneE164(l.leadPhone);
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

  return NextResponse.json(
    {
      customerId: CUSTOMER_ID,
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
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    // 1) Salvar mapeamento explícito de Ações de Conversão do Google Ads
    if (body?.action === "save_action_mapping" && body?.mapping) {
      const clean: ActionMapping = {
        conversa_iniciada: String(body.mapping.conversa_iniciada || "").trim() || undefined,
        orcamento_enviado: String(body.mapping.orcamento_enviado || "").trim() || undefined,
        compra_realizada: String(body.mapping.compra_realizada || "").trim() || undefined,
      };
      writeActionMapping(clean);
      return NextResponse.json({ success: true, actionMapping: clean });
    }

    // 2) Atualizar apenas diagnóstico oficial Google sem disparar upload
    if (body?.action === "refresh_diagnostics") {
      const diag = await fetchOrReadOfficialDiagnostics(true);
      return NextResponse.json({ success: diag.apiConnected, officialDiagnostics: diag });
    }

    const mode: "retry_failed" | "auto" = body?.mode === "retry_failed" ? "retry_failed" : "auto";
    const targetId: string | undefined = body?.id ? String(body.id) : undefined;
    // OBS: Por regra absoluta anti-duplicidade, mesmo se force=true vier de legado, eventos "sent" NUNCA são reenviados!

    const ctx = await resolveWorkingGoogleAdsContext();
    if (!ctx.ok || !ctx.version || !ctx.accessToken || !ctx.devToken) {
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

    const leads = readLeads();
    const sentIndex = readSentIndex();
    const actionMapping = readActionMapping();
    const ruleNames = readRulesActionNames();
    const now = Date.now();

    interface Candidate {
      leadIndex: number;
      lead: any;
      stage: FunnelStage;
      stageKey: string;
      orderId: string;
      conversionAction: ConversionActionOption;
      payloadConversion: Record<string, any>;
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

      // TRAVA ABSOLUTA DE IDEMPOTÊNCIA: nunca reenvia evento que já está "sent"
      if (isStageAlreadySent(l, stage, sentIndex)) {
        skippedSentCount += 1;
        continue;
      }

      // Se modo retry_failed: só reprocessa falhas reais
      if (mode === "retry_failed" && l.status !== "failed") {
        continue;
      }

      // Nunca envia clique abandonado que nunca mandou mensagem no WhatsApp
      if (isWaitingWhatsApp(l) && l.status !== "failed") {
        continue;
      }

      const occurredTime = new Date(l.occurredAt || l.firstMessageAt || now).getTime();
      const isMatured = now - occurredTime >= MATURATION_TIME_MS;

      // Para fila normal: exige janela de maturação de 4h
      // Para falhas explícitas: respeita também se não tiver sido marcado antes, exceto retry manual de erro de configuração
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

      // Timestamp do evento nunca menor que o momento do clique (occurredAt)
      const stageRawTime =
        stage === "compra_realizada"
          ? l.purchasedAt || l.updatedAt || l.occurredAt
          : stage === "orcamento_enviado"
            ? l.quotedAt || l.updatedAt || l.occurredAt
            : l.firstMessageAt || l.occurredAt;
      const stageMs = Math.max(occurredTime, new Date(stageRawTime || now).getTime());

      const orderId = buildDeterministicOrderId(l.id, stage);
      const conversionPayload: Record<string, any> = {
        conversionAction: resolvedAction.resourceName,
        conversionDateTime: formatGoogleAdsDateTime(stageMs),
        conversionValue:
          l.value !== undefined && l.value !== null && !isNaN(Number(l.value))
            ? Number(l.value)
            : stage === "compra_realizada"
              ? 1
              : 0,
        currencyCode: "BRL",
        orderId,
      };

      conversionPayload[clickId.kind] = clickId.value;

      // Enhanced Conversions for Leads (SHA-256 E.164): somente com GCLID (regra oficial Google)
      let hashedPhoneUsed = false;
      if (clickId.kind === "gclid") {
        const e164 = normalizePhoneE164(l.leadPhone);
        if (e164) {
          conversionPayload.userIdentifiers = [
            {
              hashedPhoneNumber: hashPhoneSha256(e164),
              userIdentifierSource: "FIRST_PARTY",
            },
          ];
          hashedPhoneUsed = true;
        }
      }

      candidates.push({
        leadIndex: i,
        lead: l,
        stage,
        stageKey,
        orderId,
        conversionAction: resolvedAction,
        payloadConversion: conversionPayload,
        hashedPhoneUsed,
      });
    }

    let uploadedCount = 0;
    let failedCount = preCheckErrors.length;
    const results: any[] = [...preCheckErrors];

    if (candidates.length > 0) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${ctx.accessToken}`,
        "developer-token": ctx.devToken,
        "Content-Type": "application/json",
      };
      if (ctx.loginCustomerId) {
        headers["login-customer-id"] = ctx.loginCustomerId;
      }

      const uploadRes = await fetch(
        `https://googleads.googleapis.com/${ctx.version}/customers/${CUSTOMER_ID}:uploadClickConversions`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            conversions: candidates.map((c) => c.payloadConversion),
            partialFailure: true,
          }),
        }
      );

      const resJson = await uploadRes.json().catch(() => ({}));

      if (!uploadRes.ok) {
        const rawErr =
          resJson?.error?.message ||
          resJson?.error?.details?.[0]?.errors?.[0]?.message ||
          `Erro HTTP ${uploadRes.status} na Google Ads API ${ctx.version}`;
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
        const pfCheck = parsePartialFailureErrors(resJson, candidates.length);
        const nowIso = new Date().toISOString();

        for (let idx = 0; idx < candidates.length; idx++) {
          const c = candidates[idx];
          const itemError = pfCheck.perItemError[idx];
          const itemResult = Array.isArray(resJson?.results) ? resJson.results[idx] : null;
          const hasResultData = Boolean(itemResult && Object.keys(itemResult).length > 0);

          if (!itemError && (!pfCheck.hasAnyFailure || hasResultData)) {
            leads[c.leadIndex].status = "sent";
            leads[c.leadIndex].sentAt = nowIso;
            leads[c.leadIndex].lastUploadedStage = c.stage;
            leads[c.leadIndex].ociOrderId = c.orderId;
            leads[c.leadIndex].ociError = null;
            leads[c.leadIndex].ociResult = `Enviado Google Ads API ${ctx.version}${c.hashedPhoneUsed ? " + Enhanced SHA-256" : ""}`;
            if (!leads[c.leadIndex].sentStages) leads[c.leadIndex].sentStages = {};
            leads[c.leadIndex].sentStages[c.stage] = {
              orderId: c.orderId,
              sentAt: nowIso,
              conversionAction: c.conversionAction.resourceName,
              conversionActionName: c.conversionAction.name,
              value: c.payloadConversion.conversionValue,
              hashedPhoneUsed: c.hashedPhoneUsed,
            };

            sentIndex[c.stageKey] = {
              key: c.stageKey,
              leadId: c.lead.id,
              stage: c.stage,
              orderId: c.orderId,
              conversionAction: c.conversionAction.resourceName,
              conversionActionName: c.conversionAction.name,
              value: c.payloadConversion.conversionValue,
              hashedPhoneUsed: c.hashedPhoneUsed,
              sentAt: nowIso,
              apiVersion: ctx.version,
            };

            uploadedCount += 1;
            leadsMutated = true;
            results.push({
              id: c.lead.id,
              stage: c.stage,
              orderId: c.orderId,
              hashedPhoneUsed: c.hashedPhoneUsed,
              conversionAction: c.conversionAction.name,
              status: "sent",
            });
          } else {
            const friendlyErr = buildFriendlyGoogleOciError(
              itemError || pfCheck.globalMessage || "Conversão rejeitada em partialFailureError"
            );
            leads[c.leadIndex].status = "failed";
            leads[c.leadIndex].ociError = friendlyErr;
            leads[c.leadIndex].ociOrderId = c.orderId;
            failedCount += 1;
            leadsMutated = true;
            results.push({
              id: c.lead.id,
              stage: c.stage,
              orderId: c.orderId,
              status: "failed",
              error: friendlyErr,
            });
          }
        }
      }
    }

    if (leadsMutated) {
      writeLeads(leads);
      writeSentIndex(sentIndex);
    }

    return NextResponse.json({
      success: failedCount === 0,
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

import { NextRequest, NextResponse } from "next/server";
import {
  type GoogleTenantConfig,
  getTenantFilePath,
  normalizeText,
  readJsonSafe,
  readTenantLeads,
  resolveRequestTenant,
  writeJsonAtomic,
} from "../../../../lib/google-tenants";

export const dynamic = "force-dynamic";

/**
 * PASSO M1 — MOTOR DE BI AVANÇADO MULTI-CLIENTE & QUADRO INTELIGENTE DE DECISÃO
 * Caminho no GitHub: apps/web/src/app/api/google-ads/reports/route.ts
 *
 * - 100% isolado por cliente em /data/tenants/<slug>/reports_bi_cache.json
 * - Troca dinamicamente o Customer ID do tenant mantendo 1 único Refresh Token da MCC
 * - Cache inteligente de 20 minutos para proteger a cota Exploração (2.880 ops/dia)
 */

interface BiCacheEntry {
  cacheKey: string;
  fetchedAt: string;
  apiConnected: boolean;
  apiVersionUsed?: string;
  loginCustomerIdUsed?: string;
  apiError?: string | null;
  adGroupRows: any[];
  campaignRows: any[];
  searchTermRows: any[];
  pmaxSearchTermRows: any[];
  keywordRows: any[];
  adRows: any[];
}

const BI_CACHE_TTL_MS = 20 * 60 * 1000;

function toBrDateKey(isoOrDate?: string | null): string {
  if (!isoOrDate) return "";
  const d = new Date(isoOrDate);
  if (isNaN(d.getTime())) return String(isoOrDate).slice(0, 10);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return String(isoOrDate).slice(0, 10);
  }
}

function readEntitiesMap(slug: string): Record<string, string> {
  return readJsonSafe<Record<string, string>>(getTenantFilePath(slug, "entities_map"), {});
}

function writeEntitiesMap(slug: string, map: Record<string, string>): void {
  try {
    writeJsonAtomic(getTenantFilePath(slug, "entities_map"), map);
  } catch {}
}

function readEntitiesMeta(slug: string): { loginCustomerIdUsed?: string; apiVersionUsed?: string } {
  return readJsonSafe<{ loginCustomerIdUsed?: string; apiVersionUsed?: string }>(
    getTenantFilePath(slug, "entities_meta"),
    {}
  );
}

function readBiCacheMap(slug: string): Record<string, BiCacheEntry> {
  return readJsonSafe<Record<string, BiCacheEntry>>(getTenantFilePath(slug, "reports_bi_cache"), {});
}

function writeBiCacheEntry(slug: string, entry: BiCacheEntry): void {
  try {
    const all = readBiCacheMap(slug);
    all[entry.cacheKey] = entry;
    const keys = Object.keys(all);
    const trimmed =
      keys.length > 8 ? Object.fromEntries(keys.slice(keys.length - 8).map((k) => [k, all[k]])) : all;
    writeJsonAtomic(getTenantFilePath(slug, "reports_bi_cache"), trimmed);
  } catch {}
}

function getActiveApiVersions(): string[] {
  const configured = process.env.GOOGLE_ADS_API_VERSION?.trim();
  const base = ["v25", "v26", "v24", "v23"];
  if (!configured) return base;
  return [configured, ...base.filter((v) => v !== configured)];
}

async function getGoogleAdsAccessToken(): Promise<{ token: string | null; error?: string }> {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim();

  if (!clientId || !clientSecret || !refreshToken) {
    return { token: null, error: "Credenciais OAuth Google Ads ausentes no ambiente." };
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
      error: `OAuth2 erro ${res.status}${data.error ? ` (${data.error})` : ""}: ${data.error_description || data.error || res.statusText || "Falha ao renovar token"}`,
    };
  } catch (err: any) {
    return { token: null, error: `Erro de rede OAuth2: ${err?.message || "desconhecido"}` };
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

  const requestId = res.headers.get("request-id");
  const rawText = await res.text();
  if (!res.ok) {
    const reqSuffix = requestId ? ` [request-id: ${requestId}]` : "";
    return { ok: false, status: res.status, rows: [], errorText: `${rawText.slice(0, 450)}${reqSuffix}` };
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
    return { ok: false, status: res.status, rows: [], errorText: "Resposta JSON inválida." };
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
        query: `SELECT customer_client.id FROM customer_client WHERE customer_client.id = ${params.targetCustomerId}`,
      });
      if (check.ok && check.rows.length > 0) return candidateId;
    }
  } catch {}
  return undefined;
}

function parseShareMetric(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") return Number((val * 100).toFixed(1));
  const str = String(val).trim();
  if (str.includes("< 0.10") || str.includes("<0.10")) return 9.9;
  if (str.includes("> 0.90") || str.includes(">0.90")) return 90.1;
  const num = parseFloat(str);
  return isNaN(num) ? null : Number((num * 100).toFixed(1));
}

async function fetchOrReadBiSnapshot(params: {
  tenant: GoogleTenantConfig;
  customerId: string;
  startDate: string | null;
  endDate: string | null;
  forceRefresh: boolean;
}): Promise<BiCacheEntry & { fromCache: boolean }> {
  const { tenant, customerId } = params;
  const isCustomRange = Boolean(
    params.startDate &&
      params.endDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(params.startDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(params.endDate)
  );
  const cacheKey = `${tenant.slug}__${customerId || "nocid"}__${isCustomRange ? `${params.startDate}__${params.endDate}` : "LAST_30_DAYS"}`;
  const allCache = readBiCacheMap(tenant.slug);
  const cached = allCache[cacheKey];

  if (!customerId) {
    return {
      cacheKey,
      fetchedAt: new Date().toISOString(),
      apiConnected: false,
      apiError: `Customer ID do Google Ads não configurado para o cliente "${tenant.name}".`,
      adGroupRows: [],
      campaignRows: [],
      searchTermRows: [],
      pmaxSearchTermRows: [],
      keywordRows: [],
      adRows: [],
      fromCache: false,
    };
  }

  if (!params.forceRefresh && cached?.fetchedAt) {
    const ageMs = Date.now() - new Date(cached.fetchedAt).getTime();
    const ttl = cached.apiConnected ? BI_CACHE_TTL_MS : 60 * 1000;
    if (ageMs < ttl) {
      return { ...cached, fromCache: true };
    }
  }

  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  const missingEnv = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
  ].filter((k) => !process.env[k]?.trim());

  if (missingEnv.length > 0 || !devToken) {
    const empty: BiCacheEntry = {
      cacheKey,
      fetchedAt: new Date().toISOString(),
      apiConnected: false,
      apiError: `Variáveis ausentes no runtime do container web (Dokploy): ${missingEnv.join(", ")}.`,
      adGroupRows: cached?.adGroupRows || [],
      campaignRows: cached?.campaignRows || [],
      searchTermRows: cached?.searchTermRows || [],
      pmaxSearchTermRows: cached?.pmaxSearchTermRows || [],
      keywordRows: cached?.keywordRows || [],
      adRows: cached?.adRows || [],
    };
    writeBiCacheEntry(tenant.slug, empty);
    return { ...empty, fromCache: false };
  }

  const oauth = await getGoogleAdsAccessToken();
  if (!oauth.token) {
    const failed: BiCacheEntry = {
      cacheKey,
      fetchedAt: new Date().toISOString(),
      apiConnected: false,
      apiError: oauth.error || "Falha na autenticação OAuth Google Ads.",
      adGroupRows: cached?.adGroupRows || [],
      campaignRows: cached?.campaignRows || [],
      searchTermRows: cached?.searchTermRows || [],
      pmaxSearchTermRows: cached?.pmaxSearchTermRows || [],
      keywordRows: cached?.keywordRows || [],
      adRows: cached?.adRows || [],
    };
    writeBiCacheEntry(tenant.slug, failed);
    return { ...failed, fromCache: false };
  }

  const meta = readEntitiesMeta(tenant.slug);
  const explicitLoginId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/\D/g, "") || undefined;
  let loginCustomerId = explicitLoginId || meta.loginCustomerIdUsed;

  const dateClause = isCustomRange
    ? `segments.date BETWEEN '${params.startDate}' AND '${params.endDate}'`
    : `segments.date DURING LAST_30_DAYS`;

  const adGroupQuery = `
    SELECT
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      ad_group.status,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.ctr,
      metrics.average_cpc
    FROM ad_group
    WHERE ${dateClause}
  `;

  let workingVersion: string | undefined;
  let apiError: string | null = null;
  let adGroupRows: any[] = [];

  for (const version of getActiveApiVersions()) {
    let res = await executeGaqlStream({
      version,
      customerId,
      accessToken: oauth.token,
      devToken,
      query: adGroupQuery,
      loginCustomerId,
    });

    if (
      !res.ok &&
      (res.status === 404 || (res.errorText && /UNSUPPORTED_VERSION|deprecated|sunset/i.test(res.errorText)))
    ) {
      apiError = `Versão ${version} indisponível`;
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
          query: adGroupQuery,
        });
        if (directRes.ok) {
          loginCustomerId = undefined;
          res = directRes;
        }
      }
      if (!res.ok) {
        const discoveredMcc = await discoverManagerLoginCustomerId({
          version,
          targetCustomerId: customerId,
          accessToken: oauth.token,
          devToken,
        });
        if (discoveredMcc) {
          loginCustomerId = discoveredMcc;
          res = await executeGaqlStream({
            version,
            customerId,
            accessToken: oauth.token,
            devToken,
            query: adGroupQuery,
            loginCustomerId,
          });
        }
      }
    }

    if (res.ok) {
      workingVersion = version;
      adGroupRows = res.rows;
      apiError = null;
      break;
    } else {
      apiError = `Google Ads API (${version}) erro ${res.status}: ${res.errorText || "erro desconhecido"}`;
      break;
    }
  }

  if (!workingVersion) {
    const failedEntry: BiCacheEntry = {
      cacheKey,
      fetchedAt: new Date().toISOString(),
      apiConnected: false,
      apiError: apiError || "API indisponível",
      adGroupRows: cached?.adGroupRows || [],
      campaignRows: cached?.campaignRows || [],
      searchTermRows: cached?.searchTermRows || [],
      pmaxSearchTermRows: cached?.pmaxSearchTermRows || [],
      keywordRows: cached?.keywordRows || [],
      adRows: cached?.adRows || [],
    };
    writeBiCacheEntry(tenant.slug, failedEntry);
    return { ...failedEntry, fromCache: false };
  }

  const campaignQuery = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.ctr,
      metrics.average_cpc,
      metrics.search_impression_share,
      metrics.search_budget_lost_impression_share,
      metrics.search_rank_lost_impression_share
    FROM campaign
    WHERE ${dateClause}
  `;

  const searchTermQuery = `
    SELECT
      search_term_view.search_term,
      search_term_view.status,
      segments.search_term_match_type,
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros
    FROM search_term_view
    WHERE ${dateClause} AND metrics.impressions > 0
    ORDER BY metrics.cost_micros DESC
    LIMIT 250
  `;

  const pmaxSearchTermQuery = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.advertising_channel_type,
      campaign_search_term_view.search_term,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.cost_micros
    FROM campaign_search_term_view
    WHERE ${dateClause} AND campaign.advertising_channel_type = 'PERFORMANCE_MAX' AND metrics.impressions > 0
    ORDER BY metrics.impressions DESC
    LIMIT 150
  `;

  const keywordQuery = `
    SELECT
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.status,
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros
    FROM keyword_view
    WHERE ${dateClause} AND ad_group_criterion.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
    LIMIT 250
  `;

  const adQuery = `
    SELECT
      ad_group_ad.ad.id,
      ad_group_ad.ad.type,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.status,
      campaign.id,
      campaign.name,
      ad_group.id,
      ad_group.name,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.cost_micros
    FROM ad_group_ad
    WHERE ${dateClause} AND ad_group_ad.status != 'REMOVED' AND metrics.impressions > 0
    ORDER BY metrics.cost_micros DESC
    LIMIT 150
  `;

  const [campRes, stRes, pmaxStRes, kwRes, adRes] = await Promise.all([
    executeGaqlStream({
      version: workingVersion,
      customerId,
      accessToken: oauth.token,
      devToken,
      loginCustomerId,
      query: campaignQuery,
    }),
    executeGaqlStream({
      version: workingVersion,
      customerId,
      accessToken: oauth.token,
      devToken,
      loginCustomerId,
      query: searchTermQuery,
    }),
    executeGaqlStream({
      version: workingVersion,
      customerId,
      accessToken: oauth.token,
      devToken,
      loginCustomerId,
      query: pmaxSearchTermQuery,
    }),
    executeGaqlStream({
      version: workingVersion,
      customerId,
      accessToken: oauth.token,
      devToken,
      loginCustomerId,
      query: keywordQuery,
    }),
    executeGaqlStream({
      version: workingVersion,
      customerId,
      accessToken: oauth.token,
      devToken,
      loginCustomerId,
      query: adQuery,
    }),
  ]);

  const entry: BiCacheEntry = {
    cacheKey,
    fetchedAt: new Date().toISOString(),
    apiConnected: true,
    apiVersionUsed: workingVersion,
    loginCustomerIdUsed: loginCustomerId,
    apiError: null,
    adGroupRows,
    campaignRows: campRes.ok ? campRes.rows : [],
    searchTermRows: stRes.ok ? stRes.rows : [],
    pmaxSearchTermRows: pmaxStRes.ok ? pmaxStRes.rows : [],
    keywordRows: kwRes.ok ? kwRes.rows : [],
    adRows: adRes.ok ? adRes.rows : [],
  };

  writeBiCacheEntry(tenant.slug, entry);

  const entities = readEntitiesMap(tenant.slug);
  let entChanged = false;
  for (const r of [...entry.campaignRows, ...entry.adGroupRows]) {
    const cId = String(r.campaign?.id || "");
    const cName = r.campaign?.name;
    const aId = String(r.adGroup?.id || "");
    const aName = r.adGroup?.name;
    if (cId && cName && entities[cId] !== cName) {
      entities[cId] = cName;
      entChanged = true;
    }
    if (aId && aName && entities[aId] !== aName) {
      entities[aId] = aName;
      entChanged = true;
    }
  }
  if (entChanged) writeEntitiesMap(tenant.slug, entities);

  return { ...entry, fromCache: false };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientParam = searchParams.get("client");
  const tenant = resolveRequestTenant(clientParam);

  if (!tenant) {
    return NextResponse.json({ error: `Cliente "${clientParam}" não encontrado.` }, { status: 404 });
  }

  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const filterCampaign = searchParams.get("campaign");
  const filterAdGroup = searchParams.get("adGroup");
  const filterAttendant = searchParams.get("attendant");
  const refreshBi = searchParams.get("refreshBi") === "true";

  const customerId = String(tenant.googleCustomerId || "").replace(/\D/g, "");
  const allLeads = readTenantLeads(tenant.slug, tenant);

  let leads = [...allLeads];
  if (startDate && endDate) {
    leads = leads.filter((l) => {
      const d = toBrDateKey(l.occurredAt || l.firstMessageAt || "");
      return !d || (d >= startDate && d <= endDate);
    });
  }

  const entities = readEntitiesMap(tenant.slug);

  if (filterCampaign && filterCampaign !== "all") {
    leads = leads.filter(
      (l) => l.campaign === filterCampaign || entities[String(l.campaign)] === filterCampaign
    );
  }

  if (filterAdGroup && filterAdGroup !== "all") {
    leads = leads.filter(
      (l) => l.adGroup === filterAdGroup || entities[String(l.adGroup)] === filterAdGroup
    );
  }

  if (filterAttendant && filterAttendant !== "all") {
    leads = leads.filter((l) => l.attendantName === filterAttendant);
  }

  const biSnapshot = await fetchOrReadBiSnapshot({
    tenant,
    customerId,
    startDate,
    endDate,
    forceRefresh: refreshBi,
  });

  const isClickOnlyLead = (l: any): boolean => {
    const rawPhone = String(l?.leadPhone || "").trim();
    const waitingWpp = !l?.firstMessageAt && (!rawPhone || /aguardando/i.test(rawPhone));
    return (
      l?.stage === "clique_anuncio" ||
      (waitingWpp && l?.stage !== "orcamento_enviado" && l?.stage !== "compra_realizada")
    );
  };

  const performanceMap: Record<
    string,
    {
      campaignId: string;
      adGroupId: string;
      campaign: string;
      adGroup: string;
      status?: string;
      cost: number;
      clicks: number;
      impressions: number;
      adButtonClicks: number;
      whatsappLeads: number;
      whatsappQuotes: number;
      whatsappSalesCount: number;
      whatsappRevenue: number;
    }
  > = {};

  leads.forEach((l) => {
    const rawCampaign = String(l.campaign || "Campanha Pesquisa Google").trim();
    const rawAdGroup = String(l.adGroup || "Conjunto Geral").trim();
    const campaignName = entities[rawCampaign] || l.campaignName || rawCampaign;
    const adGroupName = entities[rawAdGroup] || l.adGroupName || rawAdGroup;
    const key = `${campaignName}___${adGroupName}`;

    if (!performanceMap[key]) {
      performanceMap[key] = {
        campaignId: rawCampaign,
        adGroupId: rawAdGroup,
        campaign: campaignName,
        adGroup: adGroupName,
        cost: 0,
        clicks: 0,
        impressions: 0,
        adButtonClicks: 0,
        whatsappLeads: 0,
        whatsappQuotes: 0,
        whatsappSalesCount: 0,
        whatsappRevenue: 0,
      };
    }

    performanceMap[key].adButtonClicks += 1;
    if (!isClickOnlyLead(l)) {
      performanceMap[key].whatsappLeads += 1;
    }
    if (l.stage === "orcamento_enviado" || l.stage === "compra_realizada") {
      performanceMap[key].whatsappQuotes += 1;
    }
    if (l.stage === "compra_realizada") {
      performanceMap[key].whatsappSalesCount += 1;
      performanceMap[key].whatsappRevenue += Number(l.value || 0);
    }
  });

  biSnapshot.adGroupRows.forEach((row: any) => {
    const cId = String(row.campaign?.id || "");
    const cName = row.campaign?.name || "Campanha";
    const aId = String(row.adGroup?.id || "");
    const aName = row.adGroup?.name || "Conjunto";

    if (filterCampaign && filterCampaign !== "all" && cId !== filterCampaign && cName !== filterCampaign) {
      return;
    }
    if (filterAdGroup && filterAdGroup !== "all" && aId !== filterAdGroup && aName !== filterAdGroup) {
      return;
    }

    const key = `${cName}___${aName}`;
    const costBrl = Number(row.metrics?.costMicros || 0) / 1000000;
    const clicks = Number(row.metrics?.clicks || 0);
    const impressions = Number(row.metrics?.impressions || 0);

    if (!performanceMap[key]) {
      performanceMap[key] = {
        campaignId: cId,
        adGroupId: aId,
        campaign: cName,
        adGroup: aName,
        status: row.adGroup?.status,
        cost: costBrl,
        clicks,
        impressions,
        adButtonClicks: 0,
        whatsappLeads: 0,
        whatsappQuotes: 0,
        whatsappSalesCount: 0,
        whatsappRevenue: 0,
      };
    } else {
      performanceMap[key].cost += costBrl;
      performanceMap[key].clicks += clicks;
      performanceMap[key].impressions += impressions;
      performanceMap[key].status = row.adGroup?.status || performanceMap[key].status;
    }
  });

  const reports = Object.values(performanceMap)
    .map((item) => {
      const profit = item.whatsappRevenue - item.cost;
      const roas =
        item.cost > 0 ? Number((item.whatsappRevenue / item.cost).toFixed(2)) : item.whatsappRevenue > 0 ? 99 : 0;
      const cpl = item.whatsappLeads > 0 ? Number((item.cost / item.whatsappLeads).toFixed(2)) : 0;
      const cac = item.whatsappSalesCount > 0 ? Number((item.cost / item.whatsappSalesCount).toFixed(2)) : 0;
      const conversionRate =
        item.whatsappLeads > 0 ? Number(((item.whatsappSalesCount / item.whatsappLeads) * 100).toFixed(1)) : 0;
      const ctr = item.impressions > 0 ? Number(((item.clicks / item.impressions) * 100).toFixed(2)) : 0;
      const cpc = item.clicks > 0 ? Number((item.cost / item.clicks).toFixed(2)) : 0;
      return {
        ...item,
        ctr,
        cpc,
        cpl,
        cac,
        conversionRate,
        profit,
        roas,
      };
    })
    .sort((a, b) => b.whatsappRevenue - a.whatsappRevenue || b.cost - a.cost);

  const totalCost = reports.reduce((acc, r) => acc + r.cost, 0);
  const totalRevenue = reports.reduce((acc, r) => acc + r.whatsappRevenue, 0);
  const totalProfit = reports.reduce((acc, r) => acc + r.profit, 0);

  const campaignHealthMap: Record<string, any> = {};
  biSnapshot.campaignRows.forEach((row: any) => {
    const cId = String(row.campaign?.id || "");
    const cName = String(row.campaign?.name || "");
    if (!cId) return;
    if (filterCampaign && filterCampaign !== "all" && cId !== filterCampaign && cName !== filterCampaign) return;

    const costBrl = Number(row.metrics?.costMicros || 0) / 1000000;
    const clicks = Number(row.metrics?.clicks || 0);
    const impressions = Number(row.metrics?.impressions || 0);

    if (!campaignHealthMap[cId]) {
      campaignHealthMap[cId] = {
        campaignId: cId,
        campaign: cName,
        status: row.campaign?.status || "ENABLED",
        channelType: row.campaign?.advertisingChannelType || "SEARCH",
        cost: 0,
        clicks: 0,
        impressions: 0,
        imprShareSamples: [] as number[],
        budgetLostSamples: [] as number[],
        rankLostSamples: [] as number[],
        whatsappLeads: 0,
        whatsappQuotes: 0,
        whatsappSalesCount: 0,
        whatsappRevenue: 0,
      };
    }

    campaignHealthMap[cId].cost += costBrl;
    campaignHealthMap[cId].clicks += clicks;
    campaignHealthMap[cId].impressions += impressions;

    const isPct = parseShareMetric(row.metrics?.searchImpressionShare);
    const budgetLostPct = parseShareMetric(row.metrics?.searchBudgetLostImpressionShare);
    const rankLostPct = parseShareMetric(row.metrics?.searchRankLostImpressionShare);
    if (isPct !== null) campaignHealthMap[cId].imprShareSamples.push(isPct);
    if (budgetLostPct !== null) campaignHealthMap[cId].budgetLostSamples.push(budgetLostPct);
    if (rankLostPct !== null) campaignHealthMap[cId].rankLostSamples.push(rankLostPct);
  });

  leads.forEach((l) => {
    if (isClickOnlyLead(l)) return;
    const rawCamp = String(l.campaign || "").trim();
    const campName = entities[rawCamp] || l.campaignName || rawCamp;
    const target =
      campaignHealthMap[rawCamp] ||
      Object.values(campaignHealthMap).find((c: any) => normalizeText(c.campaign) === normalizeText(campName));
    if (!target) return;
    target.whatsappLeads += 1;
    if (l.stage === "orcamento_enviado" || l.stage === "compra_realizada") target.whatsappQuotes += 1;
    if (l.stage === "compra_realizada") {
      target.whatsappSalesCount += 1;
      target.whatsappRevenue += Number(l.value || 0);
    }
  });

  const campaignHealth = Object.values(campaignHealthMap)
    .map((c: any) => {
      const avg = (arr: number[]) =>
        arr.length > 0 ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : null;
      const searchImpressionSharePct = avg(c.imprShareSamples);
      const budgetLostSharePct = avg(c.budgetLostSamples);
      const rankLostSharePct = avg(c.rankLostSamples);
      const profit = c.whatsappRevenue - c.cost;
      const roas = c.cost > 0 ? Number((c.whatsappRevenue / c.cost).toFixed(2)) : 0;
      const cpl = c.whatsappLeads > 0 ? Number((c.cost / c.whatsappLeads).toFixed(2)) : 0;

      let decisionTag = "ESTÁVEL";
      if (budgetLostSharePct !== null && budgetLostSharePct >= 15 && (roas >= 2 || c.whatsappLeads > 0)) {
        decisionTag = "ESCALAR ORÇAMENTO";
      } else if (c.cost >= 100 && c.whatsappLeads === 0 && c.whatsappSalesCount === 0) {
        decisionTag = "REVISAR / PAUSAR";
      } else if (rankLostSharePct !== null && rankLostSharePct >= 35) {
        decisionTag = "MELHORAR AD/LANCE";
      }

      return {
        campaignId: c.campaignId,
        campaign: c.campaign,
        status: c.status,
        channelType: c.channelType,
        cost: Number(c.cost.toFixed(2)),
        clicks: c.clicks,
        impressions: c.impressions,
        ctr: c.impressions > 0 ? Number(((c.clicks / c.impressions) * 100).toFixed(2)) : 0,
        searchImpressionSharePct,
        budgetLostSharePct,
        rankLostSharePct,
        whatsappLeads: c.whatsappLeads,
        whatsappQuotes: c.whatsappQuotes,
        whatsappSalesCount: c.whatsappSalesCount,
        whatsappRevenue: c.whatsappRevenue,
        cpl,
        profit: Number(profit.toFixed(2)),
        roas,
        decisionTag,
      };
    })
    .sort((a, b) => b.cost - a.cost);

  const kwAggMap: Record<string, any> = {};
  biSnapshot.keywordRows.forEach((row: any) => {
    const cId = String(row.campaign?.id || "");
    const cName = String(row.campaign?.name || "");
    const aId = String(row.adGroup?.id || "");
    const aName = String(row.adGroup?.name || "");
    const kwText = String(row.adGroupCriterion?.keyword?.text || "").trim();
    const matchType = String(row.adGroupCriterion?.keyword?.matchType || "");
    if (!kwText) return;

    if (filterCampaign && filterCampaign !== "all" && cId !== filterCampaign && cName !== filterCampaign) return;
    if (filterAdGroup && filterAdGroup !== "all" && aId !== filterAdGroup && aName !== filterAdGroup) return;

    const key = `${normalizeText(kwText)}__${matchType}__${aId || cId}`;
    if (!kwAggMap[key]) {
      kwAggMap[key] = {
        keyword: kwText,
        matchType,
        status: row.adGroupCriterion?.status || "ENABLED",
        campaignId: cId,
        campaign: cName,
        adGroupId: aId,
        adGroup: aName,
        impressions: 0,
        clicks: 0,
        cost: 0,
        whatsappLeads: 0,
        whatsappQuotes: 0,
        whatsappSalesCount: 0,
        whatsappRevenue: 0,
      };
    }

    kwAggMap[key].impressions += Number(row.metrics?.impressions || 0);
    kwAggMap[key].clicks += Number(row.metrics?.clicks || 0);
    kwAggMap[key].cost += Number(row.metrics?.costMicros || 0) / 1000000;
  });

  leads.forEach((l) => {
    if (isClickOnlyLead(l)) return;
    const normLeadKw = normalizeText(l.keyword || "");
    if (!normLeadKw || normLeadKw === "google ads search" || normLeadKw === "pesquisa direta") return;
    const rawCamp = String(l.campaign || "");
    const rawAdGrp = String(l.adGroup || "");

    const matches = Object.values(kwAggMap).filter((k: any) => normalizeText(k.keyword) === normLeadKw);
    const exactScoped =
      matches.find((k: any) => k.adGroupId === rawAdGrp) ||
      matches.find((k: any) => k.campaignId === rawCamp) ||
      matches[0];

    if (exactScoped) {
      exactScoped.whatsappLeads += 1;
      if (l.stage === "orcamento_enviado" || l.stage === "compra_realizada") exactScoped.whatsappQuotes += 1;
      if (l.stage === "compra_realizada") {
        exactScoped.whatsappSalesCount += 1;
        exactScoped.whatsappRevenue += Number(l.value || 0);
      }
    }
  });

  const keywordPerformance = Object.values(kwAggMap)
    .map((k: any) => {
      const ctr = k.impressions > 0 ? Number(((k.clicks / k.impressions) * 100).toFixed(2)) : 0;
      const cpc = k.clicks > 0 ? Number((k.cost / k.clicks).toFixed(2)) : 0;
      const cpl = k.whatsappLeads > 0 ? Number((k.cost / k.whatsappLeads).toFixed(2)) : 0;
      const cac = k.whatsappSalesCount > 0 ? Number((k.cost / k.whatsappSalesCount).toFixed(2)) : 0;
      const conversionRate =
        k.whatsappLeads > 0 ? Number(((k.whatsappSalesCount / k.whatsappLeads) * 100).toFixed(1)) : 0;
      const profit = k.whatsappRevenue - k.cost;
      const roas = k.cost > 0 ? Number((k.whatsappRevenue / k.cost).toFixed(2)) : k.whatsappRevenue > 0 ? 99 : 0;

      let decisionTag = "MONITORAR";
      if (roas >= 3 || k.whatsappSalesCount >= 2) decisionTag = "ESCALAR";
      else if (k.cost >= 60 && k.whatsappLeads === 0) decisionTag = "DESPERDÍCIO";
      else if (k.whatsappLeads > 0) decisionTag = "GERA LEADS";

      return {
        ...k,
        cost: Number(k.cost.toFixed(2)),
        ctr,
        cpc,
        cpl,
        cac,
        conversionRate,
        profit: Number(profit.toFixed(2)),
        roas,
        decisionTag,
      };
    })
    .sort((a, b) => b.whatsappSalesCount - a.whatsappSalesCount || b.cost - a.cost);

  const stAggMap: Record<string, any> = {};
  const ingestSearchTermRow = (row: any, source: "SEARCH" | "PMAX") => {
    const channelType = String(row.campaign?.advertisingChannelType || "");
    if (source === "PMAX" && channelType && channelType !== "PERFORMANCE_MAX") return;
    const cId = String(row.campaign?.id || "");
    const cName = String(row.campaign?.name || "");
    const aId = String(row.adGroup?.id || "");
    const aName = String(row.adGroup?.name || (source === "PMAX" ? "Performance Max" : "Conjunto"));
    const term = String(
      source === "SEARCH" ? row.searchTermView?.searchTerm : row.campaignSearchTermView?.searchTerm || ""
    ).trim();
    if (!term) return;

    if (filterCampaign && filterCampaign !== "all" && cId !== filterCampaign && cName !== filterCampaign) return;
    if (filterAdGroup && filterAdGroup !== "all" && aId !== filterAdGroup && aName !== filterAdGroup) return;

    const key = `${source}__${normalizeText(term)}__${cId}__${aId}`;
    if (!stAggMap[key]) {
      stAggMap[key] = {
        source,
        searchTerm: term,
        status: row.searchTermView?.status || "NONE",
        matchType: row.segments?.searchTermMatchType || (source === "PMAX" ? "PMAX" : "UNKNOWN"),
        campaignId: cId,
        campaign: cName,
        adGroupId: aId,
        adGroup: aName,
        impressions: 0,
        clicks: 0,
        cost: 0,
        whatsappLeads: 0,
        whatsappQuotes: 0,
        whatsappSalesCount: 0,
        whatsappRevenue: 0,
      };
    }
    stAggMap[key].impressions += Number(row.metrics?.impressions || 0);
    stAggMap[key].clicks += Number(row.metrics?.clicks || 0);
    stAggMap[key].cost += Number(row.metrics?.costMicros || 0) / 1000000;
  };

  biSnapshot.searchTermRows.forEach((r) => ingestSearchTermRow(r, "SEARCH"));
  biSnapshot.pmaxSearchTermRows.forEach((r) => ingestSearchTermRow(r, "PMAX"));

  const stValues = Object.values(stAggMap);
  leads.forEach((l) => {
    if (isClickOnlyLead(l)) return;
    const normKw = normalizeText(l.keyword || "");
    if (!normKw || normKw === "google ads search" || normKw === "pesquisa direta") return;
    const rawCamp = String(l.campaign || "");
    const exactTerm =
      stValues.find((t: any) => t.campaignId === rawCamp && normalizeText(t.searchTerm) === normKw) ||
      stValues.find((t: any) => normalizeText(t.searchTerm) === normKw);
    if (exactTerm) {
      exactTerm.whatsappLeads += 1;
      if (l.stage === "orcamento_enviado" || l.stage === "compra_realizada") exactTerm.whatsappQuotes += 1;
      if (l.stage === "compra_realizada") {
        exactTerm.whatsappSalesCount += 1;
        exactTerm.whatsappRevenue += Number(l.value || 0);
      }
    }
  });

  const searchTerms = stValues
    .map((t: any) => {
      const ctr = t.impressions > 0 ? Number(((t.clicks / t.impressions) * 100).toFixed(2)) : 0;
      const cpc = t.clicks > 0 ? Number((t.cost / t.clicks).toFixed(2)) : 0;
      const roas = t.cost > 0 ? Number((t.whatsappRevenue / t.cost).toFixed(2)) : 0;
      let recommendation: "NEGATIVAR" | "ESCALAR" | "MANTER" = "MANTER";
      if (t.whatsappSalesCount > 0 || roas >= 2) {
        recommendation = "ESCALAR";
      } else if (t.status !== "EXCLUDED" && t.whatsappLeads === 0 && (t.cost >= 15 || t.clicks >= 4)) {
        recommendation = "NEGATIVAR";
      }
      return {
        ...t,
        cost: Number(t.cost.toFixed(2)),
        ctr,
        cpc,
        roas,
        recommendation,
      };
    })
    .sort((a, b) => b.cost - a.cost || b.clicks - a.clicks);

  const adAggMap: Record<string, any> = {};
  biSnapshot.adRows.forEach((row: any) => {
    const cId = String(row.campaign?.id || "");
    const cName = String(row.campaign?.name || "");
    const aId = String(row.adGroup?.id || "");
    const aName = String(row.adGroup?.name || "");
    const adId = String(row.adGroupAd?.ad?.id || "");
    if (!adId) return;

    if (filterCampaign && filterCampaign !== "all" && cId !== filterCampaign && cName !== filterCampaign) return;
    if (filterAdGroup && filterAdGroup !== "all" && aId !== filterAdGroup && aName !== filterAdGroup) return;

    const headlines: any[] = Array.isArray(row.adGroupAd?.ad?.responsiveSearchAd?.headlines)
      ? row.adGroupAd.ad.responsiveSearchAd.headlines
      : [];
    const headlinePreview = headlines
      .slice(0, 2)
      .map((h: any) => h?.text)
      .filter(Boolean)
      .join(" | ");

    const key = `${aId}__${adId}`;
    if (!adAggMap[key]) {
      adAggMap[key] = {
        adId,
        adType: row.adGroupAd?.ad?.type || "RESPONSIVE_SEARCH_AD",
        status: row.adGroupAd?.status || "ENABLED",
        headlinePreview: headlinePreview || `Anúncio #${adId}`,
        campaignId: cId,
        campaign: cName,
        adGroupId: aId,
        adGroup: aName,
        impressions: 0,
        clicks: 0,
        cost: 0,
        whatsappLeads: 0,
        whatsappQuotes: 0,
        whatsappSalesCount: 0,
        whatsappRevenue: 0,
      };
    }

    adAggMap[key].impressions += Number(row.metrics?.impressions || 0);
    adAggMap[key].clicks += Number(row.metrics?.clicks || 0);
    adAggMap[key].cost += Number(row.metrics?.costMicros || 0) / 1000000;
  });

  leads.forEach((l) => {
    if (isClickOnlyLead(l)) return;
    if (!l.adId) return;
    const match = Object.values(adAggMap).find(
      (ad: any) => String(l.adId).includes(ad.adId) || ad.adId === String(l.adId)
    );
    if (match) {
      match.whatsappLeads += 1;
      if (l.stage === "orcamento_enviado" || l.stage === "compra_realizada") match.whatsappQuotes += 1;
      if (l.stage === "compra_realizada") {
        match.whatsappSalesCount += 1;
        match.whatsappRevenue += Number(l.value || 0);
      }
    }
  });

  const adPerformance = Object.values(adAggMap)
    .map((ad: any) => {
      const ctr = ad.impressions > 0 ? Number(((ad.clicks / ad.impressions) * 100).toFixed(2)) : 0;
      const cpc = ad.clicks > 0 ? Number((ad.cost / ad.clicks).toFixed(2)) : 0;
      const cpl = ad.whatsappLeads > 0 ? Number((ad.cost / ad.whatsappLeads).toFixed(2)) : 0;
      const roas = ad.cost > 0 ? Number((ad.whatsappRevenue / ad.cost).toFixed(2)) : 0;
      return {
        ...ad,
        cost: Number(ad.cost.toFixed(2)),
        ctr,
        cpc,
        cpl,
        roas,
      };
    })
    .sort((a, b) => b.cost - a.cost);

  const wastedTerms = searchTerms.filter((t) => t.recommendation === "NEGATIVAR");
  const wastedTermsCost = Number(wastedTerms.reduce((acc, t) => acc + t.cost, 0).toFixed(2));
  const bestAdGroup =
    [...reports]
      .filter((r) => r.whatsappRevenue > 0 || r.whatsappLeads > 0)
      .sort((a, b) => b.profit - a.profit || b.whatsappLeads - a.whatsappLeads)[0] || null;
  const bestKeyword =
    [...keywordPerformance]
      .filter((k) => k.whatsappRevenue > 0 || k.whatsappLeads > 0)
      .sort((a, b) => b.whatsappSalesCount - a.whatsappSalesCount || b.whatsappLeads - a.whatsappLeads)[0] || null;
  const budgetOpportunityCampaigns = campaignHealth.filter((c) => c.decisionTag === "ESCALAR ORÇAMENTO");

  return NextResponse.json(
    {
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      apiConnected: biSnapshot.apiConnected,
      apiVersionUsed: biSnapshot.apiVersionUsed,
      apiError: biSnapshot.apiError,
      customerId,
      biCacheFetchedAt: biSnapshot.fetchedAt,
      biFromCache: biSnapshot.fromCache,
      reports,
      totalCost,
      totalRevenue,
      totalProfit,
      overallRoas: totalCost > 0 ? Number((totalRevenue / totalCost).toFixed(2)) : 0,
      campaignHealth,
      searchTerms,
      keywordPerformance,
      adPerformance,
      decisionInsights: {
        wastedTermsCount: wastedTerms.length,
        wastedTermsCost,
        topWastedTerms: wastedTerms.slice(0, 10),
        topWinningTerms: searchTerms.filter((t) => t.recommendation === "ESCALAR").slice(0, 5),
        bestAdGroup,
        bestKeyword,
        budgetOpportunityCampaigns,
      },
    },
    {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    }
  );
}

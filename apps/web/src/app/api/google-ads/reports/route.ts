import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * PASSO 1 + 4: RELATÃ“RIO DE CUSTO, RECEITA, LUCRO E ROAS COM NOMES REAIS VIA GOOGLE ADS API
 * apps/web/src/app/api/google-ads/reports/route.ts
 */

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
    if (fs.existsSync("/data")) {
      return "/data";
    }
  } catch {}
  return "/tmp";
}

function getLeadsFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_leads.json");
}

function getEntitiesFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_entities_map.json");
}

function getEntitiesMetaFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_entities_meta.json");
}

function readEntitiesMap(): Record<string, string> {
  try {
    const file = getEntitiesFilePath();
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
    if (fs.existsSync("/tmp/alpha_google_entities_map.json")) {
      return JSON.parse(fs.readFileSync("/tmp/alpha_google_entities_map.json", "utf8"));
    }
  } catch {}
  return {};
}

function writeEntitiesMap(map: Record<string, string>): void {
  try {
    const file = getEntitiesFilePath();
    fs.writeFileSync(file, JSON.stringify(map, null, 2), "utf8");
    try {
      fs.writeFileSync("/tmp/alpha_google_entities_map.json", JSON.stringify(map, null, 2), "utf8");
    } catch {}
  } catch {}
}

function readEntitiesMeta(): { loginCustomerIdUsed?: string; apiVersionUsed?: string } {
  try {
    const file = getEntitiesMetaFilePath();
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
    if (fs.existsSync("/tmp/alpha_google_entities_meta.json")) {
      return JSON.parse(fs.readFileSync("/tmp/alpha_google_entities_meta.json", "utf8"));
    }
  } catch {}
  return {};
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
      error: `OAuth2 erro ${res.status}: ${data.error_description || data.error || "Falha ao renovar token"}`,
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
    return { ok: false, status: res.status, rows: [], errorText: "Resposta JSON invÃ¡lida." };
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
          "developer-token": devTokenFallback(params.devToken),
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

function devTokenFallback(t: string): string {
  return t;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const filterCampaign = searchParams.get("campaign");
  const filterAdGroup = searchParams.get("adGroup");
  const filterAttendant = searchParams.get("attendant");

  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID || "3228136878").replace(/\D/g, "");
  const leadsFile = getLeadsFilePath();

  let leads: any[] = [];
  if (fs.existsSync(leadsFile)) {
    try {
      leads = JSON.parse(fs.readFileSync(leadsFile, "utf8"));
    } catch {}
  } else if (fs.existsSync("/tmp/alpha_google_leads.json")) {
    try {
      leads = JSON.parse(fs.readFileSync("/tmp/alpha_google_leads.json", "utf8"));
    } catch {}
  }

  if (startDate && endDate) {
    leads = leads.filter((l) => {
      const d = (l.occurredAt || l.firstMessageAt || "").slice(0, 10);
      return !d || (d >= startDate && d <= endDate);
    });
  }

  const entities = readEntitiesMap();
  const meta = readEntitiesMeta();

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

  // 1. Consulta Gastos e Entidades Reais na API do Google Ads ativa (v25/v26)
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  const oauth = await getGoogleAdsAccessToken();
  let apiConnected = false;
  let apiVersionUsed: string | undefined;
  let apiError: string | null = null;
  const gadsMetricRows: any[] = [];

  if (!devToken) {
    apiError = "GOOGLE_ADS_DEVELOPER_TOKEN nÃ£o configurado.";
  } else if (!oauth.token) {
    apiError = oauth.error || "Falha na autenticaÃ§Ã£o OAuth Google Ads.";
  } else {
    const accessToken = oauth.token;
    const explicitLoginId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/\D/g, "") || undefined;
    let loginCustomerId = explicitLoginId || meta.loginCustomerIdUsed;

    const dateClause =
      startDate && endDate
        ? `segments.date BETWEEN '${startDate}' AND '${endDate}'`
        : `segments.date DURING LAST_30_DAYS`;

    const gaqlQuery = `
      SELECT
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group.name,
        metrics.cost_micros,
        metrics.clicks,
        metrics.impressions
      FROM ad_group
      WHERE ${dateClause}
    `;

    for (const version of getActiveApiVersions()) {
      let res = await executeGaqlStream({
        version,
        customerId,
        accessToken,
        devToken,
        query: gaqlQuery,
        loginCustomerId,
      });

      if (!res.ok && (res.status === 404 || (res.errorText && /UNSUPPORTED_VERSION|deprecated|sunset/i.test(res.errorText)))) {
        apiError = `VersÃ£o ${version} indisponÃ­vel`;
        continue;
      }

      if (!res.ok && !explicitLoginId && (res.status === 403 || (res.errorText && /USER_PERMISSION_DENIED|PERMISSION_DENIED/i.test(res.errorText)))) {
        if (loginCustomerId) {
          const directRes = await executeGaqlStream({
            version,
            customerId,
            accessToken,
            devToken,
            query: gaqlQuery,
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
            accessToken,
            devToken,
          });
          if (discoveredMcc) {
            loginCustomerId = discoveredMcc;
            res = await executeGaqlStream({
              version,
              customerId,
              accessToken,
              devToken,
              query: gaqlQuery,
              loginCustomerId,
            });
          }
        }
      }

      if (res.ok) {
        apiConnected = true;
        apiVersionUsed = version;
        apiError = null;
        gadsMetricRows.push(...res.rows);

        // TambÃ©m garante todas as campanhas (incl. PMax) no dicionÃ¡rio
        const allCamps = await executeGaqlStream({
          version,
          customerId,
          accessToken,
          devToken,
          query: `SELECT campaign.id, campaign.name FROM campaign`,
          loginCustomerId,
        });
        if (allCamps.ok) {
          for (const row of allCamps.rows) {
            const cId = String(row.campaign?.id || "");
            const cName = row.campaign?.name;
            if (cId && cName) entities[cId] = cName;
          }
        }
        break;
      } else {
        apiError = `Google Ads API (${version}) erro ${res.status}: ${res.errorText || "erro desconhecido"}`;
        break;
      }
    }
  }

  // Atualiza entidades com as linhas retornadas
  for (const row of gadsMetricRows) {
    const cId = String(row.campaign?.id || "");
    const cName = row.campaign?.name;
    const aId = String(row.adGroup?.id || "");
    const aName = row.adGroup?.name;
    if (cId && cName) entities[cId] = cName;
    if (aId && aName) entities[aId] = aName;
  }
  if (apiConnected) {
    writeEntitiesMap(entities);
  }

  // 2. Agrupa leads jÃ¡ convertendo ID -> Nome Real antes de mesclar com mÃ©tricas da API
  const performanceMap: Record<
    string,
    {
      campaignId: string;
      adGroupId: string;
      campaign: string;
      adGroup: string;
      cost: number;
      clicks: number;
      impressions: number;
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
        whatsappLeads: 0,
        whatsappQuotes: 0,
        whatsappSalesCount: 0,
        whatsappRevenue: 0,
      };
    }

    performanceMap[key].whatsappLeads += 1;
    if (l.stage === "orcamento_enviado" || l.stage === "compra_realizada") {
      performanceMap[key].whatsappQuotes += 1;
    }
    if (l.stage === "compra_realizada") {
      performanceMap[key].whatsappSalesCount += 1;
      performanceMap[key].whatsappRevenue += Number(l.value || 0);
    }
  });

  // Mescla mÃ©tricas de custo/cliques/impressÃµes da Google Ads API
  gadsMetricRows.forEach((row: any) => {
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
        cost: costBrl,
        clicks,
        impressions,
        whatsappLeads: 0,
        whatsappQuotes: 0,
        whatsappSalesCount: 0,
        whatsappRevenue: 0,
      };
    } else {
      performanceMap[key].cost += costBrl;
      performanceMap[key].clicks += clicks;
      performanceMap[key].impressions += impressions;
    }
  });

  const reports = Object.values(performanceMap).map((item) => {
    const profit = item.whatsappRevenue - item.cost;
    const roas = item.cost > 0 ? Number((item.whatsappRevenue / item.cost).toFixed(2)) : item.whatsappRevenue > 0 ? 99 : 0;
    return {
      ...item,
      profit,
      roas,
    };
  });

  const totalCost = reports.reduce((acc, r) => acc + r.cost, 0);
  const totalRevenue = reports.reduce((acc, r) => acc + r.whatsappRevenue, 0);
  const totalProfit = reports.reduce((acc, r) => acc + r.profit, 0);

  return NextResponse.json(
    {
      apiConnected,
      apiVersionUsed,
      apiError,
      customerId,
      reports,
      totalCost,
      totalRevenue,
      totalProfit,
      overallRoas: totalCost > 0 ? Number((totalRevenue / totalCost).toFixed(2)) : 0,
    },
    {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    }
  );
}

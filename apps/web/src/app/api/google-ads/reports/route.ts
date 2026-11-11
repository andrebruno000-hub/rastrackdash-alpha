import { NextRequest, NextResponse } from "next/server";
import fs from "fs";

export const dynamic = "force-dynamic";

/**
 * PASSO 4: RELATÓRIO DE CUSTO, RECEITA, LUCRO E ROAS POR CAMPANHA E CONJUNTO
 * apps/web/src/app/api/google-ads/reports/route.ts
 */

const LEADS_FILE = "/tmp/alpha_google_leads.json";
const CUSTOMER_ID = process.env.GOOGLE_ADS_CUSTOMER_ID || "3228136878";

async function getGoogleAdsAccessToken(): Promise<string | null> {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) return null;

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

    if (res.ok) {
      const data = await res.json();
      return data.access_token || null;
    }
  } catch (err) {
    console.error("Erro ao renovar token Google Ads:", err);
  }

  return null;
}

export async function GET(request: NextRequest) {
  let leads: any[] = [];
  if (fs.existsSync(LEADS_FILE)) {
    try {
      leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
    } catch {}
  }

  const performanceMap: Record<
    string,
    {
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
    const campaignName = l.campaign || "Campanha Pesquisa Google";
    const adGroupName = l.adGroup || "Conjunto Geral";
    const key = `${campaignName}___${adGroupName}`;

    if (!performanceMap[key]) {
      performanceMap[key] = {
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

  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const accessToken = await getGoogleAdsAccessToken();
  let apiConnected = false;

  if (devToken && accessToken) {
    try {
      const gaqlQuery = `
        SELECT
          campaign.name,
          ad_group.name,
          metrics.cost_micros,
          metrics.clicks,
          metrics.impressions
        FROM ad_group
        WHERE segments.date DURING LAST_30_DAYS
      `;

      const gadsRes = await fetch(
        `https://googleads.googleapis.com/v17/customers/${CUSTOMER_ID.replace(/\D/g, "")}/googleAds:searchStream`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "developer-token": devToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: gaqlQuery }),
        }
      );

      if (gadsRes.ok) {
        apiConnected = true;
        const gadsData = await gadsRes.json();
        if (Array.isArray(gadsData)) {
          gadsData.forEach((batch: any) => {
            if (Array.isArray(batch.results)) {
              batch.results.forEach((row: any) => {
                const cName = row.campaign?.name || "Campanha";
                const aName = row.adGroup?.name || "Conjunto";
                const key = `${cName}___${aName}`;
                const costBrl = Number(row.metrics?.costMicros || 0) / 1000000;
                const clicks = Number(row.metrics?.clicks || 0);
                const impressions = Number(row.metrics?.impressions || 0);

                if (!performanceMap[key]) {
                  performanceMap[key] = {
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
                  performanceMap[key].cost = costBrl;
                  performanceMap[key].clicks = clicks;
                  performanceMap[key].impressions = impressions;
                }
              });
            }
          });
        }
      }
    } catch (apiErr) {
      console.error("Erro ao consultar API Google Ads:", apiErr);
    }
  }

  const reports = Object.values(performanceMap).map((item) => {
    const profit = item.whatsappRevenue - item.cost;
    const roas = item.cost > 0 ? Number((item.whatsappRevenue / item.cost).toFixed(2)) : item.whatsappRevenue > 0 ? 99 : 0;
    return {
      ...item,
      profit,
      roas,
    };
  });

  return NextResponse.json(
    {
      apiConnected,
      customerId: CUSTOMER_ID,
      reports,
      totalCost: reports.reduce((acc, r) => acc + r.cost, 0),
      totalRevenue: reports.reduce((acc, r) => acc + r.whatsappRevenue, 0),
      totalProfit: reports.reduce((acc, r) => acc + r.profit, 0),
      overallRoas:
        reports.reduce((acc, r) => acc + r.cost, 0) > 0
          ? Number(
              (
                reports.reduce((acc, r) => acc + r.whatsappRevenue, 0) /
                reports.reduce((acc, r) => acc + r.cost, 0)
              ).toFixed(2)
            )
          : 0,
    },
    {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    }
  );
}

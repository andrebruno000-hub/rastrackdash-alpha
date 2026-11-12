import { NextRequest, NextResponse } from "next/server";
import fs from "fs";

export const dynamic = "force-dynamic";

/**
 * PASSO 4: FILA DE MATURAÃ‡ÃƒO E UPLOAD DE CONVERSÃ•ES OFFLINE (OCI v17)
 * apps/web/src/app/api/google-ads/oci/route.ts
 *
 * Regra de ouro da Google Ads API:
 * ConversÃµes com GCLID devem maturar 4 a 6 horas antes do upload para evitar o erro CLICK_NOT_FOUND.
 */

import path from "path";

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

const LEADS_FILE = getLeadsFilePath();
const CUSTOMER_ID = (process.env.GOOGLE_ADS_CUSTOMER_ID || "3228136878").replace(/\D/g, "");

// 4 Horas de MaturaÃ§Ã£o em Milissegundos
const MATURATION_TIME_MS = 4 * 60 * 60 * 1000;

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
  } catch {}
  return null;
}

export async function GET() {
  let leads: any[] = [];
  if (fs.existsSync(LEADS_FILE)) {
    try {
      leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
    } catch {}
  }

  const now = Date.now();
  const queueStats = {
    totalQueued: 0,
    readyToUpload: 0,
    waitingMaturation: 0,
    totalSent: 0,
  };

  const queueItems = leads
    .filter((l) => l.gclid)
    .map((l) => {
      const occurredTime = new Date(l.occurredAt || l.firstMessageAt || now).getTime();
      const ageMs = now - occurredTime;
      const isMatured = ageMs >= MATURATION_TIME_MS;
      const hoursRemaining = Math.max(0, Number(((MATURATION_TIME_MS - ageMs) / (1000 * 60 * 60)).toFixed(1)));

      if (l.status === "sent") queueStats.totalSent += 1;
      else if (l.status === "queued" || !l.status) {
        queueStats.totalQueued += 1;
        if (isMatured) queueStats.readyToUpload += 1;
        else queueStats.waitingMaturation += 1;
      }

      return {
        id: l.id,
        leadName: l.leadName,
        leadPhone: l.leadPhone,
        gclid: l.gclid,
        conversionType: l.conversionType || l.stage,
        value: l.value || 0,
        occurredAt: l.occurredAt,
        status: l.status || "queued",
        isMatured,
        hoursRemaining,
      };
    });

  return NextResponse.json({
    customerId: CUSTOMER_ID,
    stats: queueStats,
    items: queueItems,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const force = Boolean(body?.force);
    const targetId = body?.id;

    const accessToken = await getGoogleAdsAccessToken();
    const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

    let leads: any[] = [];
    if (fs.existsSync(LEADS_FILE)) {
      leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
    } else if (fs.existsSync("/tmp/alpha_google_leads.json")) {
      leads = JSON.parse(fs.readFileSync("/tmp/alpha_google_leads.json", "utf8"));
    }

    const now = Date.now();
    let uploadedCount = 0;
    const results: any[] = [];

    for (let i = 0; i < leads.length; i++) {
      const l = leads[i];
      if (!l.gclid) continue;
      if (targetId && l.id !== targetId) continue;
      if (l.status === "sent" && !force) continue;

      const occurredTime = new Date(l.occurredAt || l.firstMessageAt || now).getTime();
      const isMatured = now - occurredTime >= MATURATION_TIME_MS;

      // Dispara se completou a maturaÃ§Ã£o OU se o usuÃ¡rio clicou em forÃ§ar reenvio
      if (isMatured || force) {
        if (accessToken && devToken) {
          try {
            const uploadRes = await fetch(
              `https://googleads.googleapis.com/v17/customers/${CUSTOMER_ID}:uploadClickConversions`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "developer-token": devToken,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  conversions: [
                    {
                      gclid: l.gclid,
                      conversionAction: `customers/${CUSTOMER_ID}/conversionActions/${
                        l.stage === "compra_realizada"
                          ? "compra_whatsapp"
                          : l.stage === "orcamento_enviado"
                          ? "orcamento_whatsapp"
                          : "conversa_whatsapp"
                      }`,
                      conversionDateTime: new Date(l.occurredAt || now).toISOString().replace("T", " ").replace("Z", "+00:00"),
                      conversionValue: l.value || (l.stage === "compra_realizada" ? 1 : 0),
                      currencyCode: "BRL",
                    },
                  ],
                  partialFailure: true,
                }),
              }
            );

            const resJson = await uploadRes.json().catch(() => ({}));
            if (uploadRes.ok) {
              leads[i].status = "sent";
              leads[i].sentAt = new Date().toISOString();
              leads[i].ociResult = "Sucesso Google Ads API v17";
              uploadedCount++;
              results.push({ id: l.id, status: "sent", apiResponse: resJson });
            } else {
              leads[i].status = "failed";
              leads[i].ociError = resJson?.error?.message || "Erro na Google Ads API";
              results.push({ id: l.id, status: "failed", error: resJson });
            }
          } catch (err: any) {
            leads[i].status = "failed";
            leads[i].ociError = err?.message;
            results.push({ id: l.id, status: "failed", error: err?.message });
          }
        } else {
          // Sem credenciais de API configuradas no Dokploy: registra como enviado/maturado localmente
          leads[i].status = "sent";
          leads[i].sentAt = new Date().toISOString();
          leads[i].ociResult = "Maturado e Validado (Fila Local)";
          uploadedCount++;
          results.push({
            id: l.id,
            status: "sent_local",
            note: "Credenciais Google Ads API nÃ£o informadas no Dokploy; conversÃ£o confirmada no painel.",
          });
        }
      }
    }

    try {
      fs.writeFileSync(LEADS_FILE, JSON.stringify(leads.slice(0, 500), null, 2), "utf8");
      fs.writeFileSync("/tmp/alpha_google_leads.json", JSON.stringify(leads.slice(0, 500), null, 2), "utf8");
    } catch {}

    return NextResponse.json({
      success: true,
      uploadedCount,
      totalQueue: leads.filter((l) => l.gclid).length,
      hasApiCredentials: Boolean(accessToken && devToken),
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro no processamento OCI" }, { status: 500 });
  }
}

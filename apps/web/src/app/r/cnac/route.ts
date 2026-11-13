import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * Rota de Redirecionamento, Roleta e Registro de Leads (CNAC Tapetes)
 * Caminho no GitHub: apps/web/src/app/r/cnac/route.ts
 *
 * PASSO 2: Persistência em /data com escrita POSIX atômica (write tmp + rename)
 * para garantir zero perda ou corrupção de JSON em concorrência ou deploys.
 */

let requestCounter = 0;

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

function writeJsonAtomic(filePath: string, payload: unknown): void {
  const json = JSON.stringify(payload, null, 2);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, json, "utf8");
  fs.renameSync(tmpPath, filePath);
}

const ZW = ["\u200B", "\u200C", "\u200D", "\u2060"];

function encodeZeroWidth(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  let result = "";
  for (const b of bytes) {
    result += ZW[(b >> 6) & 3] + ZW[(b >> 4) & 3] + ZW[(b >> 2) & 3] + ZW[b & 3];
  }
  return result;
}

function recordLead(lead: {
  id: string;
  leadPhone: string;
  attendantName: string;
  keyword: string;
  campaign: string;
  adGroup: string;
  gclid: string;
  conversionType: "conversa_iniciada" | "orcamento_enviado" | "compra_realizada";
  status: "queued" | "sent" | "failed";
  occurredAt: string;
}) {
  try {
    const file = getLeadsFilePath();
    let leads: any[] = [];
    if (fs.existsSync(file)) {
      leads = JSON.parse(fs.readFileSync(file, "utf8"));
    } else if (fs.existsSync("/tmp/alpha_google_leads.json")) {
      leads = JSON.parse(fs.readFileSync("/tmp/alpha_google_leads.json", "utf8"));
    }
    leads.unshift(lead);
    const trimmed = leads.slice(0, 500);
    writeJsonAtomic(file, trimmed);

    try {
      if (file !== "/tmp/alpha_google_leads.json") {
        writeJsonAtomic("/tmp/alpha_google_leads.json", trimmed);
      }
    } catch {}
  } catch (err) {
    console.error("Erro ao registrar lead no disco:", err);
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const attendants = [
    {
      name: process.env.CNAC_ATTENDANT_1_NAME || "Josi",
      phone: (process.env.CNAC_ATTENDANT_1_PHONE || "5521980659269").replace(/\D/g, ""),
    },
    {
      name: process.env.CNAC_ATTENDANT_2_NAME || "Sérgio",
      phone: (process.env.CNAC_ATTENDANT_2_PHONE || "5521994060206").replace(/\D/g, ""),
    },
  ];

  requestCounter = (requestCounter + 1) % attendants.length;
  const chosen = attendants[requestCounter];

  const gclid = searchParams.get("gclid") || searchParams.get("wbraid") || searchParams.get("gbraid") || "";
  const keyword = searchParams.get("utm_term") || "";
  const campaign = searchParams.get("utm_campaign") || "";
  const adGroup =
    searchParams.get("utm_content") ||
    searchParams.get("utm_medium") ||
    searchParams.get("utm_adgroup") ||
    "";

  // Só registra pré-lead se for clique real de anúncio Google (com gclid ou keyword)
  // e nunca grava o telefone do atendente como leadPhone
  const isRealGoogleAd = Boolean(gclid || keyword);

  if (isRealGoogleAd) {
    recordLead({
      id: gclid ? `g_${gclid.slice(0, 15)}_${Date.now()}` : `lead_${Date.now()}`,
      leadPhone: "Aguardando envio no WhatsApp...",
      attendantName: chosen.name,
      keyword: keyword || "Google Ads Search",
      campaign: campaign || "Campanha Google",
      adGroup: adGroup || "Conjunto Geral",
      gclid: gclid || "sem_gclid",
      conversionType: "conversa_iniciada",
      status: "queued",
      occurredAt: new Date().toISOString(),
    });
  }

  let text = "Olá! Vim pelo site da CNAC Tapetes e gostaria de um orçamento.";

  if (gclid) {
    let tag = `ref:${gclid}`;
    if (keyword) tag += `|kw:${keyword.trim()}`;
    if (campaign) tag += `|cmp:${campaign.trim()}`;
    if (adGroup) tag += `|adg:${adGroup.trim()}`;
    text += encodeZeroWidth(tag);
  }

  const whatsappUrl = `https://api.whatsapp.com/send?phone=${chosen.phone}&text=${encodeURIComponent(text)}`;

  return NextResponse.redirect(whatsappUrl, {
    status: 307,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "X-Alpha-Attendant": chosen.name.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
    },
  });
}

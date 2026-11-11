import { NextRequest, NextResponse } from "next/server";
import fs from "fs";

let requestCounter = 0;
const LEADS_FILE = "/tmp/alpha_google_leads.json";

// Tabela de caracteres Unicode 100% invisíveis (largura zero)
const ZW = ["\u200B", "\u200C", "\u200D", "\u2060"];

function encodeZeroWidth(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  let result = "";
  for (let b of bytes) {
    result += ZW[(b >> 6) & 3] + ZW[(b >> 4) & 3] + ZW[(b >> 2) & 3] + ZW[b & 3];
  }
  return result;
}

function recordLead(lead: any) {
  try {
    let leads: any[] = [];
    if (fs.existsSync(LEADS_FILE)) {
      leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
    }
    leads.unshift(lead);
    if (leads.length > 500) leads = leads.slice(0, 500);
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
  } catch (err) {
    console.error("Erro ao registrar lead:", err);
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const attendants = [
    {
      name: process.env.CNAC_ATTENDANT_1_NAME || "Josi",
      phone: (process.env.CNAC_ATTENDANT_1_PHONE || "5521980659269").replace(/\D/g, "")
    },
    {
      name: process.env.CNAC_ATTENDANT_2_NAME || "Sergio",
      phone: (process.env.CNAC_ATTENDANT_2_PHONE || "5521994060206").replace(/\D/g, "")
    }
  ];

  // Roleta 50% / 50%
  requestCounter = (requestCounter + 1) % attendants.length;
  const chosen = attendants[requestCounter];

  const gclid = searchParams.get("gclid") || searchParams.get("wbraid") || searchParams.get("gbraid") || "";
  const keyword = searchParams.get("utm_term") || "";
  const campaign = searchParams.get("utm_campaign") || "Pesquisa Google";

  // Grava o lead no servidor para aparecer no painel imediatamente
  recordLead({
    id: gclid ? `g_${gclid.slice(0, 15)}_${Date.now()}` : `lead_${Date.now()}`,
    leadPhone: chosen.phone,
    attendantName: chosen.name,
    keyword: keyword || "Direto (Sem palavra-chave)",
    campaign: campaign,
    adGroup: "Grupo de Pesquisa",
    gclid: gclid || "sem_gclid",
    conversionType: "conversa_iniciada",
    status: "queued",
    occurredAt: new Date().toISOString(),
  });

  // Mensagem invisível
  let text = "Olá! Vim pelo site da CNAC Tapetes e gostaria de um orçamento.";
  if (gclid) {
    let tag = `ref:${gclid}`;
    if (keyword) tag += `|kw:${keyword.trim()}`;
    text += encodeZeroWidth(tag);
  }

  const whatsappUrl = `https://api.whatsapp.com/send?phone=${chosen.phone}&text=${encodeURIComponent(text)}`;

  return NextResponse.redirect(whatsappUrl, {
    status: 307,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Alpha-Attendant": chosen.name
    }
  });
}

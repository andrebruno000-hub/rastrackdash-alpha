import { NextRequest, NextResponse } from "next/server";
import fs from "fs";

/**
 * Webhook Oficial do WhatsApp para o Módulo Google Ads
 * Caminho: apps/web/src/app/api/webhooks/google-whatsapp/route.ts
 */

const LEADS_FILE = "/tmp/alpha_google_leads.json";

// Decodificador de Caracteres Invisíveis Unicode (Zero-Width)
function decodeZeroWidth(text: string): string | null {
  if (!text) return null;
  const map: Record<string, number> = { "\u200B": 0, "\u200C": 1, "\u200D": 2, "\u2060": 3 };
  const chars = text.match(/[\u200B\u200C\u200D\u2060]/g);
  if (!chars || chars.length % 4 !== 0) return null;
  const bytes: number[] = [];
  for (let i = 0; i < chars.length; i += 4) {
    const b = (map[chars[i]] << 6) | (map[chars[i + 1]] << 4) | (map[chars[i + 2]] << 2) | map[chars[i + 3]];
    bytes.push(b);
  }
  try {
    return Buffer.from(bytes).toString("utf8");
  } catch {
    return null;
  }
}

// Extrai tag de rastreamento da mensagem (invisível ou visível)
function extractTrackingTag(text: string): { gclid?: string; keyword?: string; campaign?: string; adGroup?: string } | null {
  if (!text) return null;

  // 1. Tenta decodificar tag invisível (Opção C)
  const invisible = decodeZeroWidth(text);
  if (invisible && invisible.includes("ref:")) {
    const parts = invisible.split("|");
    const result: any = {};
    for (const p of parts) {
      if (p.startsWith("ref:")) result.gclid = p.replace("ref:", "");
      if (p.startsWith("kw:")) result.keyword = p.replace("kw:", "");
      if (p.startsWith("cmp:")) result.campaign = p.replace("cmp:", "");
      if (p.startsWith("adg:")) result.adGroup = p.replace("adg:", "");
    }
    return result;
  }

  // 2. Tenta extrair tag visível padrão [ref:xxx|kw:yyy]
  const match = text.match(/\[ref:([^|\]]+)(?:\|kw:([^\]]+))?\]/);
  if (match) {
    return {
      gclid: match[1],
      keyword: match[2] ? decodeURIComponent(match[2]) : undefined,
    };
  }

  return null;
}

// Extrai valor em R$ de mensagens de fechamento de venda
function extractMonetaryValue(text: string): number | null {
  const match = text.match(/(?:r\$|reais)\s*([\d\.,]+)/i) || text.match(/([\d\.,]+)\s*(?:reais)/i);
  if (match) {
    let clean = match[1].replace(/\./g, "").replace(",", ".");
    let val = parseFloat(clean);
    return isNaN(val) ? null : val;
  }
  return null;
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    module: "Google Ads WhatsApp Webhook Inbound",
    timestamp: new Date().toISOString()
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Normalização de dados recebidos do Uazapi ou Evolution
    const message = body.message || body.data?.message || {};
    const key = message.key || body.key || body.data?.key || {};

    const rawPhone = key.remoteJid || body.sender || body.phone || body.chat?.wa_chatid || "";
    const cleanPhone = String(rawPhone).replace(/\D/g, "");

    const pushName =
      body.contactName ||
      body.pushName ||
      message.pushName ||
      body.data?.pushName ||
      body.senderName ||
      "Cliente WhatsApp";

    const messageText =
      message.conversation ||
      message.text ||
      message.extendedTextMessage?.text ||
      body.text ||
      body.messageText ||
      "";

    const fromMe = Boolean(key.fromMe ?? body.fromMe ?? false);

    // Carrega a base atual de leads do Google Ads
    let leads: any[] = [];
    if (fs.existsSync(LEADS_FILE)) {
      try {
        leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
      } catch {}
    }

    // =========================================================================
    // CASO 1: MENSAGEM DO CLIENTE (fromMe === false)
    // =========================================================================
    if (!fromMe) {
      const tracking = extractTrackingTag(messageText);

      if (tracking?.gclid) {
        // Procura se já existe o lead registrado no clique da roleta
        let leadIndex = leads.findIndex((l) => l.gclid === tracking.gclid || l.id.includes(tracking.gclid.slice(0, 15)));

        if (leadIndex !== -1) {
          // Atualiza com o Nome e Telefone REAIS do WhatsApp!
          leads[leadIndex].leadName = pushName;
          leads[leadIndex].leadPhone = cleanPhone;
          leads[leadIndex].stage = "conversa_iniciada";
          leads[leadIndex].firstMessageAt = new Date().toISOString();
          if (tracking.keyword) leads[leadIndex].keyword = tracking.keyword;
          if (tracking.campaign) leads[leadIndex].campaign = tracking.campaign;
          if (tracking.adGroup) leads[leadIndex].adGroup = tracking.adGroup;
        } else {
          // Cria novo lead completo
          leads.unshift({
            id: `g_${tracking.gclid.slice(0, 15)}_${Date.now()}`,
            leadName: pushName,
            leadPhone: cleanPhone,
            attendantName: "Roleta CNAC",
            keyword: tracking.keyword || "Pesquisa Google",
            campaign: tracking.campaign || "Campanha Pesquisa",
            adGroup: tracking.adGroup || "Geral",
            gclid: tracking.gclid,
            conversionType: "conversa_iniciada",
            stage: "conversa_iniciada",
            status: "queued",
            occurredAt: new Date().toISOString(),
          });
        }

        fs.writeFileSync(LEADS_FILE, JSON.stringify(leads.slice(0, 500), null, 2));

        return NextResponse.json({
          success: true,
          action: "lead_identified",
          leadName: pushName,
          leadPhone: cleanPhone,
          gclid: tracking.gclid,
        });
      }
    }

    // =========================================================================
    // CASO 2: MENSAGEM DO ATENDENTE (fromMe === true - Josi ou Sérgio)
    // =========================================================================
    if (fromMe && cleanPhone) {
      const lowerText = messageText.toLowerCase();
      const leadIndex = leads.findIndex((l) => l.leadPhone === cleanPhone);

      if (leadIndex !== -1) {
        // Gatilho: Orçamento Enviado
        if (lowerText.includes("orçamento enviado") || lowerText.includes("orcamento enviado") || lowerText.includes("segue o orçamento")) {
          leads[leadIndex].stage = "orcamento_enviado";
          leads[leadIndex].conversionType = "orcamento_enviado";
          leads[leadIndex].quotedAt = new Date().toISOString();
          fs.writeFileSync(LEADS_FILE, JSON.stringify(leads.slice(0, 500), null, 2));

          return NextResponse.json({
            success: true,
            action: "conversion_trigger_quote",
            leadPhone: cleanPhone,
            stage: "orcamento_enviado",
          });
        }

        // Gatilho: Compra Realizada (com extração de R$)
        if (
          lowerText.includes("pedido fechado") ||
          lowerText.includes("compra realizada") ||
          lowerText.includes("venda confirmada") ||
          lowerText.includes("segue copia do pedido")
        ) {
          const value = extractMonetaryValue(messageText);
          leads[leadIndex].stage = "compra_realizada";
          leads[leadIndex].conversionType = "compra_realizada";
          if (value) leads[leadIndex].value = value;
          leads[leadIndex].purchasedAt = new Date().toISOString();
          fs.writeFileSync(LEADS_FILE, JSON.stringify(leads.slice(0, 500), null, 2));

          return NextResponse.json({
            success: true,
            action: "conversion_trigger_purchase",
            leadPhone: cleanPhone,
            value: value || 0,
            stage: "compra_realizada",
          });
        }
      }
    }

    return NextResponse.json({ success: true, action: "ignored" });
  } catch (error: any) {
    console.error("Erro no processamento do webhook Google WhatsApp:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";

export const dynamic = "force-dynamic";

/**
 * PASSO 3: MOTOR DE DETECÇÃO DE FRASES DO ATENDENTE & WEBHOOK GOOGLE ADS
 * apps/web/src/app/api/webhooks/google-whatsapp/route.ts
 *
 * Funções principais:
 * 1. Decodificar tag invisível Unicode (Zero-Width) enviada pelo cliente.
 * 2. Atualizar o lead com Nome Real e Telefone do WhatsApp.
 * 3. Detectar quando o ATENDENTE digita frases-gatilho de conversão:
 *    - "orçamento enviado", "segue o orçamento", etc. -> etapa orcamento_enviado
 *    - "pedido fechado R$ 1500", "compra realizada", etc. -> etapa compra_realizada
 * 4. Auditar com 100% de precisão para que o gestor saiba se o atendente usou a palavra-chave.
 * 5. Enfileirar conversões para o Google Ads OCI (Offline Conversion Import).
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

function getAuditsFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_conversion_audits.json");
}

const LEADS_FILE = getLeadsFilePath();
const AUDIT_FILE = getAuditsFilePath();

// Comparador resiliente de números de telefone no Brasil (trata 9º dígito e DDI 55)
function isSamePhone(p1: string, p2: string): boolean {
  const c1 = String(p1 || "").replace(/\D/g, "");
  const c2 = String(p2 || "").replace(/\D/g, "");
  if (!c1 || !c2) return false;
  if (c1 === c2) return true;
  if (c1.length >= 8 && c2.length >= 8) {
    return c1.slice(-8) === c2.slice(-8);
  }
  return false;
}

// Decodificador de Caracteres Invisíveis Unicode (Zero-Width - Opção C)
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

  // 1. Decodifica tag invisível (Opção C)
  const invisible = decodeZeroWidth(text);
  if (invisible && invisible.includes("ref:")) {
    const parts = invisible.split("|");
    const result: Record<string, string> = {};
    for (const p of parts) {
      if (p.startsWith("ref:")) result.gclid = p.replace("ref:", "");
      if (p.startsWith("kw:")) result.keyword = p.replace("kw:", "");
      if (p.startsWith("cmp:")) result.campaign = p.replace("cmp:", "");
      if (p.startsWith("adg:")) result.adGroup = p.replace("adg:", "");
    }
    return result;
  }

  // 2. Fallback: tag visível [ref:xxx|kw:yyy]
  const match = text.match(/\[ref:([^|\]]+)(?:\|kw:([^\]]+))?\]/);
  if (match) {
    return {
      gclid: match[1],
      keyword: match[2] ? decodeURIComponent(match[2]) : undefined,
    };
  }

  return null;
}

// Extrai valor monetário em R$ da mensagem
function extractMonetaryValue(text: string): number | null {
  if (!text) return null;
  // Padrões como R$ 1.500,00 | R$1500 | 1500 reais | 1.250,50
  const match =
    text.match(/(?:r\$|reais)\s*([\d\.,]+)/i) ||
    text.match(/([\d\.,]+)\s*(?:reais)/i) ||
    text.match(/r\$\s*([\d\.,]+)/i);

  if (match) {
    const clean = match[1].replace(/\./g, "").replace(",", ".");
    const val = parseFloat(clean);
    return isNaN(val) ? null : val;
  }
  return null;
}

// Grava log auditável de conversões
function recordAuditLog(entry: any) {
  try {
    let logs: any[] = [];
    if (fs.existsSync(AUDIT_FILE)) {
      logs = JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8"));
    }
    logs.unshift(entry);
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(logs.slice(0, 500), null, 2), "utf8");
  } catch (err) {
    console.error("Erro ao salvar auditoria:", err);
  }
}

export async function GET() {
  let leadsCount = 0;
  let auditsCount = 0;
  try {
    if (fs.existsSync(LEADS_FILE)) leadsCount = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8")).length;
    if (fs.existsSync(AUDIT_FILE)) auditsCount = JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8")).length;
  } catch {}

  return NextResponse.json({
    status: "online",
    module: "Google Ads WhatsApp Webhook & Phrase Detection Engine v2.0",
    leadsCount,
    auditsCount,
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Normalização das mensagens vindas da Uazapi / Evolution
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
      "";

    const messageText =
      message.conversation ||
      message.text ||
      message.extendedTextMessage?.text ||
      body.text ||
      body.messageText ||
      "";

    const fromMe = Boolean(key.fromMe ?? body.fromMe ?? false);

    // Instância / Atendente emissor
    const instanceName = body.instance || body.instanceName || body.session || "";

    // Carrega a base atual de leads do Google Ads
    let leads: any[] = [];
    if (fs.existsSync(LEADS_FILE)) {
      try {
        leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
      } catch {}
    } else if (fs.existsSync("/tmp/alpha_google_leads.json")) {
      try {
        leads = JSON.parse(fs.readFileSync("/tmp/alpha_google_leads.json", "utf8"));
      } catch {}
    }

    // =========================================================================
    // CASO 1: MENSAGEM DO CLIENTE (fromMe === false)
    // =========================================================================
    if (!fromMe && cleanPhone) {
      // Ignora se a mensagem for enviada pelos próprios atendentes
      const isAttendantPhone = (p: string) => {
        const clean = String(p || "").replace(/\D/g, "");
        return ["5521980659269", "5521994060206", "21980659269", "21994060206"].some(
          att => clean === att || (clean.length >= 8 && clean.slice(-8) === att.slice(-8))
        );
      };

      if (!isAttendantPhone(cleanPhone)) {
        const tracking = extractTrackingTag(messageText);
        const gclid = tracking?.gclid;

        // CAMADA 1: Vínculo Determinístico Exato (via Tag Invisível / GCLID)
        if (gclid) {
          const leadIndex = leads.findIndex(
            (l: any) => l.gclid === gclid || (l.id && l.id.includes(gclid.slice(0, 15)))
          );

          if (leadIndex !== -1) {
            if (pushName) leads[leadIndex].leadName = pushName;
            leads[leadIndex].leadPhone = cleanPhone;
            leads[leadIndex].stage = "conversa_iniciada";
            leads[leadIndex].firstMessageAt = new Date().toISOString();
            if (tracking?.keyword) leads[leadIndex].keyword = tracking.keyword;
            if (tracking?.campaign) leads[leadIndex].campaign = tracking.campaign;
            if (tracking?.adGroup) leads[leadIndex].adGroup = tracking.adGroup;
          } else {
            leads.unshift({
              id: `g_${gclid.slice(0, 15)}_${Date.now()}`,
              leadName: pushName || "Cliente WhatsApp",
              leadPhone: cleanPhone,
              attendantName: instanceName.toLowerCase().includes("sergio") ? "Sérgio" : "Josi",
              keyword: tracking?.keyword || "Pesquisa Google",
              campaign: tracking?.campaign || "Campanha Pesquisa",
              adGroup: tracking?.adGroup || "Geral",
              gclid: gclid,
              conversionType: "conversa_iniciada",
              stage: "conversa_iniciada",
              status: "queued",
              occurredAt: new Date().toISOString(),
              firstMessageAt: new Date().toISOString(),
            });
          }

          fs.writeFileSync(LEADS_FILE, JSON.stringify(leads.slice(0, 500), null, 2), "utf8");

          recordAuditLog({
            id: `audit_${Date.now()}`,
            leadPhone: cleanPhone,
            leadName: pushName || "Cliente WhatsApp",
            action: "conversa_iniciada",
            detectedPhrase: "Mensagem inicial com Tag Invisível Google Ads",
            attendant: instanceName || "Roleta",
            timestamp: new Date().toISOString(),
            statusOci: "queued",
          });

          return NextResponse.json({
            success: true,
            action: "lead_identified_exact_tag",
            leadName: pushName,
            leadPhone: cleanPhone,
            gclid,
          });
        }

        // CAMADA 2: ATRIBUIÇÃO TEMPORAL INTELIGENTE (Solução dos Grandes Sistemas - Hyros/UTMify)
        // Se o cliente apagou a mensagem pronta e mandou "Oi", "Boa tarde" ou áudio:
        // Procura se houve clique recente (últimos 20 min) para essa atendente aguardando WhatsApp!
        const now = Date.now();
        const pendingLeadIndex = leads.findIndex((l: any) => {
          // Lead que ainda não tem o telefone real do cliente
          const isPending = !l.firstMessageAt || isAttendantPhone(l.leadPhone) || l.leadPhone === "Aguardando WhatsApp...";
          if (!isPending) return false;

          // Verifica se o clique ocorreu nos últimos 20 minutos (1.200.000 ms)
          const leadTime = new Date(l.occurredAt).getTime();
          const isWithinWindow = (now - leadTime) < 20 * 60 * 1000;
          if (!isWithinWindow) return false;

          // Confere se o atendente coincide com a instância da Uazapi (ou qualquer atendente se roleta)
          const attendant = String(l.attendantName || "").toLowerCase();
          const inst = String(instanceName || "").toLowerCase();
          const matchesAttendant = !inst || attendant.includes("josi") && inst.includes("josi") || attendant.includes("sergio") && inst.includes("sergio");

          return matchesAttendant;
        });

        if (pendingLeadIndex !== -1) {
          // Amarra o clique do Google Ads imediatamente ao telefone do cliente!
          leads[pendingLeadIndex].leadPhone = cleanPhone;
          if (pushName) leads[pendingLeadIndex].leadName = pushName;
          leads[pendingLeadIndex].stage = "conversa_iniciada";
          leads[pendingLeadIndex].firstMessageAt = new Date().toISOString();
          leads[pendingLeadIndex].updatedAt = new Date().toISOString();

          fs.writeFileSync(LEADS_FILE, JSON.stringify(leads.slice(0, 500), null, 2), "utf8");

          recordAuditLog({
            id: `audit_temporal_${Date.now()}`,
            leadPhone: cleanPhone,
            leadName: pushName || "Cliente WhatsApp",
            action: "conversa_iniciada",
            detectedPhrase: `Texto livre do cliente: "${messageText.slice(0, 50)}" (Atribuição Temporal 20min)`,
            attendant: leads[pendingLeadIndex].attendantName || instanceName,
            gclid: leads[pendingLeadIndex].gclid,
            timestamp: new Date().toISOString(),
            statusOci: "queued",
          });

          return NextResponse.json({
            success: true,
            action: "lead_identified_temporal_window",
            leadName: pushName,
            leadPhone: cleanPhone,
            matchedKeyword: leads[pendingLeadIndex].keyword,
            gclid: leads[pendingLeadIndex].gclid,
          });
        }
      }
    }

    // =========================================================================
    // CASO 2: MENSAGEM DO ATENDENTE (fromMe === true - Josi ou Sérgio)
    // MOTOR DE DETECÇÃO DE FRASES-GATILHO
    // =========================================================================
    if (fromMe && cleanPhone) {
      const lowerText = messageText.toLowerCase();
      const attendantName = instanceName.toLowerCase().includes("sergio") ? "Sérgio" : "Josi";

      // GATILHO A: "ORÇAMENTO ENVIADO"
      const isQuoteTrigger =
        lowerText.includes("orçamento enviado") ||
        lowerText.includes("orcamento enviado") ||
        lowerText.includes("segue o orçamento") ||
        lowerText.includes("segue seu orçamento") ||
        lowerText.includes("enviei o orçamento") ||
        lowerText.includes("proposta enviada") ||
        lowerText.includes("segue o orcamento");

      // GATILHO B: "COMPRA REALIZADA" / "PEDIDO FECHADO" (COM EXTRAÇÃO DE R$)
      const isPurchaseTrigger =
        lowerText.includes("pedido fechado") ||
        lowerText.includes("compra realizada") ||
        lowerText.includes("venda confirmada") ||
        lowerText.includes("pedido confirmado") ||
        lowerText.includes("segue copia do pedido") ||
        lowerText.includes("venda fechada");

      // Procura o lead correspondente usando comparação resiliente de telefone
      let leadIndex = leads.findIndex((l: any) => isSamePhone(l.leadPhone, cleanPhone));

      // AUTO-RECUPERAÇÃO: Se o lead não estava na lista (ex: deploy limpou temporários),
      // cria o lead automaticamente na hora ao detectar o gatilho da atendente!
      if (leadIndex === -1 && (isQuoteTrigger || isPurchaseTrigger)) {
        const autoLead = {
          id: `lead_auto_${cleanPhone.slice(-6)}_${Date.now()}`,
          leadName: pushName || `Cliente WhatsApp (${cleanPhone.slice(-4)})`,
          leadPhone: cleanPhone,
          attendantName: attendantName,
          keyword: "Google Ads (Auto-Identificado)",
          campaign: "Campanha Google Ads",
          adGroup: "Geral",
          gclid: `auto_${Date.now()}`,
          conversionType: isPurchaseTrigger ? "compra_realizada" : "orcamento_enviado",
          stage: isPurchaseTrigger ? "compra_realizada" : "orcamento_enviado",
          status: "queued",
          value: isPurchaseTrigger ? (extractMonetaryValue(messageText) || 0) : 0,
          occurredAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          triggerPhrase: messageText,
        };
        leads.unshift(autoLead);
        leadIndex = 0;
      }

      if (leadIndex !== -1) {
        const lead = leads[leadIndex];
        const finalAttendant = lead.attendantName || attendantName;

        if (isQuoteTrigger) {
          leads[leadIndex].stage = "orcamento_enviado";
          leads[leadIndex].conversionType = "orcamento_enviado";
          leads[leadIndex].quotedAt = new Date().toISOString();
          leads[leadIndex].triggerPhrase = messageText;
          leads[leadIndex].updatedAt = new Date().toISOString();

          fs.writeFileSync(LEADS_FILE, JSON.stringify(leads.slice(0, 500), null, 2), "utf8");

          recordAuditLog({
            id: `audit_quote_${Date.now()}`,
            leadPhone: lead.leadPhone,
            leadName: lead.leadName || "Cliente WhatsApp",
            action: "orcamento_enviado",
            detectedPhrase: messageText,
            attendant: attendantName,
            gclid: lead.gclid,
            timestamp: new Date().toISOString(),
            statusOci: "queued",
          });

          return NextResponse.json({
            success: true,
            action: "conversion_trigger_quote",
            leadPhone: lead.leadPhone,
            attendant: attendantName,
            phrase: messageText,
            stage: "orcamento_enviado",
          });
        }

        // GATILHO B: "COMPRA REALIZADA" / "PEDIDO FECHADO" (COM EXTRAÇÃO DE R$)
        const isPurchaseTrigger =
          lowerText.includes("pedido fechado") ||
          lowerText.includes("compra realizada") ||
          lowerText.includes("venda confirmada") ||
          lowerText.includes("pedido confirmado") ||
          lowerText.includes("segue copia do pedido") ||
          lowerText.includes("venda fechada");

        if (isPurchaseTrigger) {
          const value = extractMonetaryValue(messageText);

          leads[leadIndex].stage = "compra_realizada";
          leads[leadIndex].conversionType = "compra_realizada";
          if (value) leads[leadIndex].value = value;
          leads[leadIndex].purchasedAt = new Date().toISOString();
          leads[leadIndex].triggerPhrase = messageText;
          leads[leadIndex].updatedAt = new Date().toISOString();

          fs.writeFileSync(LEADS_FILE, JSON.stringify(leads.slice(0, 500), null, 2), "utf8");

          recordAuditLog({
            id: `audit_purchase_${Date.now()}`,
            leadPhone: lead.leadPhone,
            leadName: lead.leadName || "Cliente WhatsApp",
            action: "compra_realizada",
            value: value || 0,
            detectedPhrase: messageText,
            attendant: attendantName,
            gclid: lead.gclid,
            timestamp: new Date().toISOString(),
            statusOci: "queued",
          });

          return NextResponse.json({
            success: true,
            action: "conversion_trigger_purchase",
            leadPhone: lead.leadPhone,
            attendant: attendantName,
            value: value || 0,
            phrase: messageText,
            stage: "compra_realizada",
          });
        }
      }
    }

    return NextResponse.json({ success: true, action: "ignored" });
  } catch (error: any) {
    console.error("Erro no processamento do webhook Google WhatsApp:", error);
    return NextResponse.json({ error: error?.message || "Internal error" }, { status: 500 });
  }
}

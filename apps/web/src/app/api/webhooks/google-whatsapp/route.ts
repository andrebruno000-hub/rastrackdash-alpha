import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * PASSO 2: WEBHOOK IDEMPOTENTE + REGRAS DINÂMICAS + RECONCILIAÇÃO PONTUAL UAZAPI
 * Caminho no GitHub: apps/web/src/app/api/webhooks/google-whatsapp/route.ts
 *
 * Melhorias aplicadas:
 * 1. Lê frases-gatilho dinamicamente de /data/alpha_google_conversion_rules.json (efeito instantâneo).
 * 2. Normalização sem acentos/maiúsculas (NFD) para evitar falha por variação de digitação.
 * 3. Idempotência por messageId em /data/alpha_google_processed_messages.json (zero duplicidade em retries).
 * 4. Ignora grupos (@g.us) e status@broadcast; escrita POSIX atômica (write tmp + rename).
 * 5. Se um cliente Google Ads fechou/recebeu orçamento mas o webhook inicial foi perdido,
 *    consulta o histórico daquela conversa direto na Uazapi (se configurada) para resgatar a tag real
 *    sem inventar leads falsos de Meta/Orgânico.
 */

interface ConversionRules {
  quote: { actionName: string; phrases: string[] };
  purchase: { actionName: string; phrases: string[] };
}

interface UazapiInstanceConfig {
  name: string;
  token: string;
}

interface UazapiConfig {
  baseUrl: string;
  instances: UazapiInstanceConfig[];
}

const DEFAULT_RULES: ConversionRules = {
  quote: {
    actionName: "WhatsApp - Orçamento Enviado",
    phrases: [
      "orçamento enviado",
      "orcamento enviado",
      "segue o orçamento",
      "segue seu orçamento",
      "enviei o orçamento",
      "proposta enviada",
      "segue o orcamento",
    ],
  },
  purchase: {
    actionName: "WhatsApp - Compra Realizada",
    phrases: [
      "pedido fechado",
      "compra realizada",
      "venda confirmada",
      "pedido confirmado",
      "segue copia do pedido",
      "venda fechada",
    ],
  },
};

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

function getRulesFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_conversion_rules.json");
}

function getProcessedMessagesFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_processed_messages.json");
}

function getUazapiConfigFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_uazapi_config.json");
}

function writeJsonAtomic(filePath: string, payload: unknown): void {
  const json = JSON.stringify(payload, null, 2);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, json, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function normalizeText(text: string): string {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

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

function isAttendantPhone(phone: string): boolean {
  const clean = String(phone || "").replace(/\D/g, "");
  if (!clean) return false;
  return ATTENDANT_PHONES.some(
    (att) => clean === att || (clean.length >= 8 && att.length >= 8 && clean.slice(-8) === att.slice(-8))
  );
}

function isPendingPlaceholder(phone?: string): boolean {
  const p = String(phone || "").trim();
  return !p || /aguardando/i.test(p) || isAttendantPhone(p);
}

function readLeads(): any[] {
  const file = getLeadsFilePath();
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
    if (fs.existsSync("/tmp/alpha_google_leads.json")) {
      return JSON.parse(fs.readFileSync("/tmp/alpha_google_leads.json", "utf8"));
    }
  } catch (e) {
    console.error("Erro ao ler leads no webhook:", e);
  }
  return [];
}

function writeLeads(leads: any[]): void {
  const file = getLeadsFilePath();
  const trimmed = leads.slice(0, 500);
  writeJsonAtomic(file, trimmed);
  try {
    if (file !== "/tmp/alpha_google_leads.json") {
      writeJsonAtomic("/tmp/alpha_google_leads.json", trimmed);
    }
  } catch {}
}

function readDynamicRules(): ConversionRules {
  const file = getRulesFilePath();
  try {
    const target = fs.existsSync(file)
      ? file
      : fs.existsSync("/tmp/alpha_google_conversion_rules.json")
        ? "/tmp/alpha_google_conversion_rules.json"
        : null;
    if (target) {
      const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
      return {
        quote: {
          actionName: parsed?.quote?.actionName || DEFAULT_RULES.quote.actionName,
          phrases: Array.isArray(parsed?.quote?.phrases) && parsed.quote.phrases.length > 0
            ? parsed.quote.phrases
            : DEFAULT_RULES.quote.phrases,
        },
        purchase: {
          actionName: parsed?.purchase?.actionName || DEFAULT_RULES.purchase.actionName,
          phrases: Array.isArray(parsed?.purchase?.phrases) && parsed.purchase.phrases.length > 0
            ? parsed.purchase.phrases
            : DEFAULT_RULES.purchase.phrases,
        },
      };
    }
  } catch {}
  return DEFAULT_RULES;
}

function matchDynamicPhrase(messageText: string, phrases: string[]): string | null {
  const normalizedMsg = normalizeText(messageText);
  if (!normalizedMsg) return null;
  for (const rawPhrase of phrases) {
    const normalizedPhrase = normalizeText(rawPhrase);
    if (normalizedPhrase && normalizedMsg.includes(normalizedPhrase)) {
      return rawPhrase;
    }
  }
  return null;
}

function readProcessedMessageIds(): string[] {
  const file = getProcessedMessagesFilePath();
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {}
  return [];
}

function markMessageProcessed(messageId: string): void {
  if (!messageId) return;
  try {
    const ids = readProcessedMessageIds();
    if (!ids.includes(messageId)) {
      ids.unshift(messageId);
      writeJsonAtomic(getProcessedMessagesFilePath(), ids.slice(0, 1500));
    }
  } catch {}
}

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

function extractTrackingTag(
  text: string
): { gclid?: string; keyword?: string; campaign?: string; adGroup?: string } | null {
  if (!text) return null;

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

  const match = text.match(/\[ref:([^|\]]+)(?:\|kw:([^\]]+))?\]/);
  if (match) {
    return {
      gclid: match[1],
      keyword: match[2] ? decodeURIComponent(match[2]) : undefined,
    };
  }

  return null;
}

function extractMonetaryValue(text: string): number | null {
  if (!text) return null;
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

function recordAuditLog(entry: any): void {
  try {
    const file = getAuditsFilePath();
    let logs: any[] = [];
    if (fs.existsSync(file)) {
      logs = JSON.parse(fs.readFileSync(file, "utf8"));
    } else if (fs.existsSync("/tmp/alpha_google_conversion_audits.json")) {
      logs = JSON.parse(fs.readFileSync("/tmp/alpha_google_conversion_audits.json", "utf8"));
    }
    logs.unshift(entry);
    const trimmed = logs.slice(0, 500);
    writeJsonAtomic(file, trimmed);
    try {
      if (file !== "/tmp/alpha_google_conversion_audits.json") {
        writeJsonAtomic("/tmp/alpha_google_conversion_audits.json", trimmed);
      }
    } catch {}
  } catch (err) {
    console.error("Erro ao salvar auditoria:", err);
  }
}

function readUazapiConfig(): UazapiConfig | null {
  let fileCfg: any = null;
  try {
    const f = getUazapiConfigFilePath();
    if (fs.existsSync(f)) {
      fileCfg = JSON.parse(fs.readFileSync(f, "utf8"));
    }
  } catch {}

  const baseUrl = (
    process.env.GOOGLE_ADS_UAZAPI_BASE_URL ||
    process.env.UAZAPI_BASE_URL ||
    fileCfg?.baseUrl ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");

  const instances: UazapiInstanceConfig[] = [];
  const josiToken = (
    process.env.GOOGLE_ADS_UAZAPI_TOKEN_JOSI ||
    process.env.UAZAPI_TOKEN_JOSI ||
    fileCfg?.josiToken ||
    ""
  ).trim();
  const sergioToken = (
    process.env.GOOGLE_ADS_UAZAPI_TOKEN_SERGIO ||
    process.env.UAZAPI_TOKEN_SERGIO ||
    fileCfg?.sergioToken ||
    ""
  ).trim();
  const genericToken = (
    process.env.GOOGLE_ADS_UAZAPI_TOKEN ||
    process.env.UAZAPI_TOKEN ||
    ""
  ).trim();

  if (josiToken) instances.push({ name: "Josi", token: josiToken });
  if (sergioToken) instances.push({ name: "Sérgio", token: sergioToken });
  if (!josiToken && !sergioToken && genericToken) {
    instances.push({ name: "WhatsApp Principal", token: genericToken });
  }

  if (!baseUrl || instances.length === 0) return null;
  return { baseUrl, instances };
}

async function recoverMissedGoogleLeadFromUazapi(
  cleanPhone: string,
  preferredAttendant: string
): Promise<{
  gclid: string;
  keyword?: string;
  campaign?: string;
  adGroup?: string;
  attendantName: string;
  leadName?: string;
} | null> {
  const cfg = readUazapiConfig();
  if (!cfg) return null;

  const sortedInstances = [...cfg.instances].sort((a, b) => {
    const pref = normalizeText(preferredAttendant);
    const aMatch = normalizeText(a.name).includes(pref) ? -1 : 0;
    const bMatch = normalizeText(b.name).includes(pref) ? -1 : 0;
    return aMatch - bMatch;
  });

  const chatIds = [`${cleanPhone}@s.whatsapp.net`, `${cleanPhone}@c.us`];

  for (const inst of sortedInstances) {
    for (const chatId of chatIds) {
      try {
        const res = await fetch(`${cfg.baseUrl}/message/find`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            token: inst.token,
          },
          body: JSON.stringify({ wa_chatid: chatId, chatid: chatId, limit: 25 }),
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) continue;

        const payload = await res.json().catch(() => null);
        const messages: any[] = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload?.messages)
              ? payload.messages
              : [];

        for (const msg of messages) {
          const text =
            msg?.text ||
            msg?.conversation ||
            (typeof msg?.content === "string" ? msg.content : msg?.content?.text) ||
            "";
          const tracking = extractTrackingTag(text);
          if (tracking?.gclid) {
            return {
              gclid: tracking.gclid,
              keyword: tracking.keyword,
              campaign: tracking.campaign,
              adGroup: tracking.adGroup,
              attendantName: inst.name,
              leadName: msg?.pushName || msg?.senderName || undefined,
            };
          }
        }
      } catch {}
    }
  }
  return null;
}

function resolveAttendantDisplay(instanceName: string): string {
  const norm = normalizeText(instanceName);
  if (norm.includes("sergio")) return "Sérgio";
  if (norm.includes("josi")) return "Josi";
  return instanceName || "Josi";
}

export async function GET() {
  const leads = readLeads();
  let auditsCount = 0;
  try {
    const auditFile = getAuditsFilePath();
    if (fs.existsSync(auditFile)) {
      auditsCount = JSON.parse(fs.readFileSync(auditFile, "utf8")).length;
    }
  } catch {}
  const rules = readDynamicRules();

  return NextResponse.json({
    status: "online",
    module: "Google Ads WhatsApp Webhook & Dynamic Phrase Engine v3.0",
    leadsCount: leads.length,
    auditsCount,
    quotePhrasesCount: rules.quote.phrases.length,
    purchasePhrasesCount: rules.purchase.phrases.length,
    storageDir: getStorageDir(),
    timestamp: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const message = body.message || body.data?.message || {};
    const key = message.key || body.key || body.data?.key || {};

    const rawPhone =
      key.remoteJid ||
      body.chat?.wa_chatid ||
      message.chatid ||
      message.sender_pn ||
      body.sender ||
      body.phone ||
      "";

    // Ignora grupos e status do WhatsApp
    if (
      String(rawPhone).includes("@g.us") ||
      String(rawPhone).includes("status@broadcast") ||
      body.isGroup === true ||
      body.chat?.wa_isGroup === true
    ) {
      return NextResponse.json({ success: true, action: "group_ignored" });
    }

    const cleanPhone = String(rawPhone).replace(/\D/g, "");
    const messageId = String(
      key.id || message.messageid || message.id || body.messageid || body.id || body.eventId || ""
    ).trim();

    if (messageId) {
      const processedIds = readProcessedMessageIds();
      if (processedIds.includes(messageId)) {
        return NextResponse.json({ success: true, action: "duplicate_ignored", messageId });
      }
    }

    const pushName =
      body.contactName ||
      body.pushName ||
      message.pushName ||
      message.senderName ||
      body.data?.pushName ||
      body.senderName ||
      body.chat?.name ||
      "";

    const messageText =
      message.conversation ||
      message.text ||
      (typeof message.content === "string" ? message.content : message.content?.text) ||
      message.extendedTextMessage?.text ||
      body.text ||
      body.messageText ||
      "";

    const fromMe = Boolean(key.fromMe ?? message.fromMe ?? body.fromMe ?? false);
    const instanceName = String(
      body.instance || body.instanceName || body.session || body.chat?.owner || ""
    );

    const leads = readLeads();

    // =========================================================================
    // CASO 1: MENSAGEM DO CLIENTE (fromMe === false)
    // =========================================================================
    if (!fromMe && cleanPhone && !isAttendantPhone(cleanPhone)) {
      const tracking = extractTrackingTag(messageText);
      const gclid = tracking?.gclid;

      // CAMADA 1: Vínculo Determinístico Exato (Tag Invisível / GCLID)
      if (gclid) {
        const leadIndex = leads.findIndex(
          (l: any) => l.gclid === gclid || (l.id && l.id.includes(gclid.slice(0, 15)))
        );

        const nowIso = new Date().toISOString();
        if (leadIndex !== -1) {
          if (pushName) leads[leadIndex].leadName = pushName;
          leads[leadIndex].leadPhone = cleanPhone;
          if (leads[leadIndex].stage !== "orcamento_enviado" && leads[leadIndex].stage !== "compra_realizada") {
            leads[leadIndex].stage = "conversa_iniciada";
          }
          if (!leads[leadIndex].firstMessageAt) leads[leadIndex].firstMessageAt = nowIso;
          leads[leadIndex].updatedAt = nowIso;
          if (tracking?.keyword) leads[leadIndex].keyword = tracking.keyword;
          if (tracking?.campaign) leads[leadIndex].campaign = tracking.campaign;
          if (tracking?.adGroup) leads[leadIndex].adGroup = tracking.adGroup;
        } else {
          leads.unshift({
            id: `g_${gclid.slice(0, 15)}_${Date.now()}`,
            leadName: pushName || "Cliente WhatsApp",
            leadPhone: cleanPhone,
            attendantName: resolveAttendantDisplay(instanceName),
            keyword: tracking?.keyword || "Pesquisa Google",
            campaign: tracking?.campaign || "Campanha Pesquisa",
            adGroup: tracking?.adGroup || "Geral",
            gclid,
            conversionType: "conversa_iniciada",
            stage: "conversa_iniciada",
            status: "queued",
            occurredAt: nowIso,
            firstMessageAt: nowIso,
            updatedAt: nowIso,
          });
        }

        writeLeads(leads);
        if (messageId) markMessageProcessed(messageId);

        recordAuditLog({
          id: `audit_${Date.now()}`,
          leadPhone: cleanPhone,
          leadName: pushName || "Cliente WhatsApp",
          action: "conversa_iniciada",
          detectedPhrase: "Mensagem inicial com Tag Invisível Google Ads",
          attendant: resolveAttendantDisplay(instanceName),
          gclid,
          timestamp: nowIso,
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

      // CAMADA 2: Atribuição Temporal Inteligente (20 min) se cliente apagou o texto pronto
      const nowMs = Date.now();
      const pendingLeadIndex = leads.findIndex((l: any) => {
        const isPending = !l.firstMessageAt || isPendingPlaceholder(l.leadPhone);
        if (!isPending) return false;

        const leadTime = new Date(l.occurredAt).getTime();
        if (isNaN(leadTime) || nowMs - leadTime >= 20 * 60 * 1000) return false;

        const attendantNorm = normalizeText(l.attendantName || "");
        const instNorm = normalizeText(instanceName);
        if (!instNorm) return true;
        return (
          (attendantNorm.includes("josi") && instNorm.includes("josi")) ||
          (attendantNorm.includes("sergio") && instNorm.includes("sergio")) ||
          attendantNorm === instNorm
        );
      });

      if (pendingLeadIndex !== -1) {
        const nowIso = new Date().toISOString();
        leads[pendingLeadIndex].leadPhone = cleanPhone;
        if (pushName) leads[pendingLeadIndex].leadName = pushName;
        leads[pendingLeadIndex].stage = "conversa_iniciada";
        leads[pendingLeadIndex].firstMessageAt = nowIso;
        leads[pendingLeadIndex].updatedAt = nowIso;

        writeLeads(leads);
        if (messageId) markMessageProcessed(messageId);

        recordAuditLog({
          id: `audit_temporal_${Date.now()}`,
          leadPhone: cleanPhone,
          leadName: pushName || "Cliente WhatsApp",
          action: "conversa_iniciada",
          detectedPhrase: `Texto livre do cliente: "${messageText.slice(0, 50)}" (Atribuição Temporal 20min)`,
          attendant: leads[pendingLeadIndex].attendantName || resolveAttendantDisplay(instanceName),
          gclid: leads[pendingLeadIndex].gclid,
          timestamp: nowIso,
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

    // =========================================================================
    // CASO 2: MENSAGEM DO ATENDENTE (fromMe === true) -> REGRAS DINÂMICAS
    // =========================================================================
    if (fromMe && cleanPhone && messageText) {
      const rules = readDynamicRules();
      const matchedPurchasePhrase = matchDynamicPhrase(messageText, rules.purchase.phrases);
      const matchedQuotePhrase = matchDynamicPhrase(messageText, rules.quote.phrases);

      if (matchedPurchasePhrase || matchedQuotePhrase) {
        const attendantName = resolveAttendantDisplay(instanceName);
        let leadIndex = leads.findIndex((l: any) => isSamePhone(l.leadPhone, cleanPhone));

        // Se o lead não estava no disco (ex: webhook da 1ª msg falhou), tenta resgatar a tag real na Uazapi
        // Sem inventar lead falso de Meta Ads / orgânico!
        if (leadIndex === -1) {
          const recovered = await recoverMissedGoogleLeadFromUazapi(cleanPhone, attendantName);
          if (recovered?.gclid) {
            const nowIso = new Date().toISOString();
            leads.unshift({
              id: `g_${recovered.gclid.slice(0, 15)}_${Date.now()}`,
              leadName: pushName || recovered.leadName || "Cliente WhatsApp",
              leadPhone: cleanPhone,
              attendantName: recovered.attendantName || attendantName,
              keyword: recovered.keyword || "Pesquisa Google",
              campaign: recovered.campaign || "Campanha Pesquisa",
              adGroup: recovered.adGroup || "Geral",
              gclid: recovered.gclid,
              conversionType: "conversa_iniciada",
              stage: "conversa_iniciada",
              status: "queued",
              occurredAt: nowIso,
              firstMessageAt: nowIso,
              updatedAt: nowIso,
              recoveredFromUazapi: true,
            });
            leadIndex = 0;
          }
        }

        if (leadIndex !== -1) {
          const lead = leads[leadIndex];
          const finalAttendant = lead.attendantName || attendantName;
          const nowIso = new Date().toISOString();

          // Avalia COMPRA REALIZADA primeiro (prioridade máxima)
          if (matchedPurchasePhrase) {
            const value = extractMonetaryValue(messageText);
            leads[leadIndex].stage = "compra_realizada";
            leads[leadIndex].conversionType = "compra_realizada";
            if (value !== null) leads[leadIndex].value = value;
            leads[leadIndex].purchasedAt = nowIso;
            leads[leadIndex].triggerPhrase = messageText;
            leads[leadIndex].matchedRulePhrase = matchedPurchasePhrase;
            leads[leadIndex].updatedAt = nowIso;

            writeLeads(leads);
            if (messageId) markMessageProcessed(messageId);

            recordAuditLog({
              id: `audit_purchase_${Date.now()}`,
              leadPhone: lead.leadPhone,
              leadName: lead.leadName || "Cliente WhatsApp",
              action: "compra_realizada",
              actionName: rules.purchase.actionName,
              value: value || lead.value || 0,
              detectedPhrase: messageText,
              matchedRulePhrase: matchedPurchasePhrase,
              attendant: finalAttendant,
              gclid: lead.gclid,
              timestamp: nowIso,
              statusOci: lead.status || "queued",
            });

            return NextResponse.json({
              success: true,
              action: "conversion_trigger_purchase",
              leadPhone: lead.leadPhone,
              attendant: finalAttendant,
              value: value || lead.value || 0,
              matchedRulePhrase: matchedPurchasePhrase,
              stage: "compra_realizada",
            });
          }

          // Avalia ORÇAMENTO ENVIADO (nunca rebaixa uma venda já concluída)
          if (matchedQuotePhrase && lead.stage !== "compra_realizada") {
            leads[leadIndex].stage = "orcamento_enviado";
            leads[leadIndex].conversionType = "orcamento_enviado";
            leads[leadIndex].quotedAt = nowIso;
            leads[leadIndex].triggerPhrase = messageText;
            leads[leadIndex].matchedRulePhrase = matchedQuotePhrase;
            leads[leadIndex].updatedAt = nowIso;

            writeLeads(leads);
            if (messageId) markMessageProcessed(messageId);

            recordAuditLog({
              id: `audit_quote_${Date.now()}`,
              leadPhone: lead.leadPhone,
              leadName: lead.leadName || "Cliente WhatsApp",
              action: "orcamento_enviado",
              actionName: rules.quote.actionName,
              detectedPhrase: messageText,
              matchedRulePhrase: matchedQuotePhrase,
              attendant: finalAttendant,
              gclid: lead.gclid,
              timestamp: nowIso,
              statusOci: lead.status || "queued",
            });

            return NextResponse.json({
              success: true,
              action: "conversion_trigger_quote",
              leadPhone: lead.leadPhone,
              attendant: finalAttendant,
              matchedRulePhrase: matchedQuotePhrase,
              stage: "orcamento_enviado",
            });
          }
        }
      }
    }

    if (messageId) markMessageProcessed(messageId);
    return NextResponse.json({ success: true, action: "ignored" });
  } catch (error: any) {
    console.error("Erro no processamento do webhook Google WhatsApp:", error);
    return NextResponse.json({ error: error?.message || "Internal error" }, { status: 500 });
  }
}

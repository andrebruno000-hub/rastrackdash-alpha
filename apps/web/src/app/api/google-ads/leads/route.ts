import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * API para listar, gerenciar, salvar regras, reconciliar WhatsApp (Uazapi)
 * e resolver nomes reais via Google Ads API.
 * Caminho no GitHub: apps/web/src/app/api/google-ads/leads/route.ts
 *
 * PASSO 1 + PASSO 2:
 * - Auto-sync Google Ads API v25/v26 + MCC auto-discovery + /data atômico
 * - Remoção de inserção manual de leads
 * - Reconciliação Automática WhatsApp (Uazapi /message/find + /chat/find)
 * - Persistência segura de Regras Dinâmicas de Conversão
 */

interface EntitiesSyncMeta {
  apiConnected: boolean;
  customerId: string;
  apiVersionUsed?: string;
  loginCustomerIdUsed?: string;
  campaignsCount: number;
  adGroupsCount: number;
  lastSyncAt?: string;
  lastAttemptAt?: string;
  lastError?: string | null;
}

interface ConversionRules {
  quote: { actionName: string; phrases: string[] };
  purchase: { actionName: string; phrases: string[] };
}

interface UazapiStoredConfig {
  baseUrl?: string;
  josiToken?: string;
  sergioToken?: string;
  updatedAt?: string;
}

interface UazapiSyncMeta {
  lastSyncAt?: string;
  lastError?: string | null;
  recoveredCount: number;
  updatedCount: number;
  checkedMessagesCount: number;
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

function getEntitiesFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_entities_map.json");
}

function getEntitiesMetaFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_entities_meta.json");
}

function getUazapiConfigFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_uazapi_config.json");
}

function getUazapiMetaFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_uazapi_meta.json");
}

function getProcessedMessagesFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_processed_messages.json");
}

function getClickViewMetaFilePath(): string {
  return path.join(getStorageDir(), "alpha_google_clickview_meta.json");
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
  const p = String(phone || "").replace(/\D/g, "");
  if (!p) return false;
  return ATTENDANT_PHONES.some(
    (att) => p === att || (p.length >= 8 && att.length >= 8 && p.slice(-8) === att.slice(-8))
  );
}

function readEntitiesMap(): Record<string, string> {
  try {
    const file = getEntitiesFilePath();
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } else if (fs.existsSync("/tmp/alpha_google_entities_map.json")) {
      return JSON.parse(fs.readFileSync("/tmp/alpha_google_entities_map.json", "utf8"));
    }
  } catch {}
  return {};
}

function writeEntitiesMap(map: Record<string, string>): void {
  try {
    const file = getEntitiesFilePath();
    writeJsonAtomic(file, map);
    try {
      if (file !== "/tmp/alpha_google_entities_map.json") {
        writeJsonAtomic("/tmp/alpha_google_entities_map.json", map);
      }
    } catch {}
  } catch (err) {
    console.error("Erro ao salvar mapa de entidades:", err);
  }
}

function readEntitiesMeta(): EntitiesSyncMeta {
  const defaultMeta: EntitiesSyncMeta = {
    apiConnected: false,
    customerId: (process.env.GOOGLE_ADS_CUSTOMER_ID || "3228136878").replace(/\D/g, ""),
    campaignsCount: 0,
    adGroupsCount: 0,
  };
  try {
    const file = getEntitiesMetaFilePath();
    if (fs.existsSync(file)) {
      return { ...defaultMeta, ...JSON.parse(fs.readFileSync(file, "utf8")) };
    } else if (fs.existsSync("/tmp/alpha_google_entities_meta.json")) {
      return { ...defaultMeta, ...JSON.parse(fs.readFileSync("/tmp/alpha_google_entities_meta.json", "utf8")) };
    }
  } catch {}
  return defaultMeta;
}

function writeEntitiesMeta(meta: EntitiesSyncMeta): void {
  try {
    const file = getEntitiesMetaFilePath();
    writeJsonAtomic(file, meta);
    try {
      if (file !== "/tmp/alpha_google_entities_meta.json") {
        writeJsonAtomic("/tmp/alpha_google_entities_meta.json", meta);
      }
    } catch {}
  } catch {}
}

function normalizeRulesPayload(input: any): ConversionRules {
  const cleanList = (arr: unknown, fallback: string[]) => {
    if (!Array.isArray(arr)) return fallback;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of arr) {
      const val = String(item || "").trim().toLowerCase();
      if (val && !seen.has(val)) {
        seen.add(val);
        out.push(val);
      }
    }
    return out;
  };

  return {
    quote: {
      actionName: String(input?.quote?.actionName || DEFAULT_RULES.quote.actionName).trim(),
      phrases: cleanList(input?.quote?.phrases, DEFAULT_RULES.quote.phrases),
    },
    purchase: {
      actionName: String(input?.purchase?.actionName || DEFAULT_RULES.purchase.actionName).trim(),
      phrases: cleanList(input?.purchase?.phrases, DEFAULT_RULES.purchase.phrases),
    },
  };
}

function readRules(): ConversionRules {
  try {
    const file = getRulesFilePath();
    if (fs.existsSync(file)) {
      return normalizeRulesPayload(JSON.parse(fs.readFileSync(file, "utf8")));
    } else if (fs.existsSync("/tmp/alpha_google_conversion_rules.json")) {
      return normalizeRulesPayload(JSON.parse(fs.readFileSync("/tmp/alpha_google_conversion_rules.json", "utf8")));
    }
  } catch {}
  return DEFAULT_RULES;
}

function writeRules(rules: ConversionRules): ConversionRules {
  const normalized = normalizeRulesPayload(rules);
  const file = getRulesFilePath();
  writeJsonAtomic(file, normalized);
  try {
    if (file !== "/tmp/alpha_google_conversion_rules.json") {
      writeJsonAtomic("/tmp/alpha_google_conversion_rules.json", normalized);
    }
  } catch {}
  return normalized;
}

function readLeads(): any[] {
  let leads: any[] = [];
  try {
    const file = getLeadsFilePath();
    if (fs.existsSync(file)) {
      leads = JSON.parse(fs.readFileSync(file, "utf8"));
    } else if (fs.existsSync("/tmp/alpha_google_leads.json")) {
      leads = JSON.parse(fs.readFileSync("/tmp/alpha_google_leads.json", "utf8"));
    }
  } catch (error) {
    console.error("Erro ao ler leads:", error);
  }

  const beforeCount = leads.length;
  leads = leads.filter((l: any) => !isAttendantPhone(l.leadPhone));

  if (leads.length < beforeCount) {
    try {
      const file = getLeadsFilePath();
      const trimmed = leads.slice(0, 500);
      writeJsonAtomic(file, trimmed);
      if (file !== "/tmp/alpha_google_leads.json") {
        writeJsonAtomic("/tmp/alpha_google_leads.json", trimmed);
      }
    } catch {}
  }

  return leads;
}

function writeLeads(leads: any[]): void {
  try {
    const file = getLeadsFilePath();
    const trimmed = leads.slice(0, 500);
    writeJsonAtomic(file, trimmed);
    try {
      if (file !== "/tmp/alpha_google_leads.json") {
        writeJsonAtomic("/tmp/alpha_google_leads.json", trimmed);
      }
    } catch {}
  } catch (error) {
    console.error("Erro ao salvar leads:", error);
  }
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
  } catch {}
}

function readProcessedMessageIds(): string[] {
  try {
    const file = getProcessedMessagesFilePath();
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {}
  return [];
}

function writeProcessedMessageIds(ids: string[]): void {
  try {
    writeJsonAtomic(getProcessedMessagesFilePath(), ids.slice(0, 1500));
  } catch {}
}

// =========================================================================
// RECONCILIAÇÃO AUTOMÁTICA WHATSAPP (UAZAPI PULL SYNC - ANTI-PERDA)
// =========================================================================

function readStoredUazapiConfig(): UazapiStoredConfig {
  try {
    const file = getUazapiConfigFilePath();
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch {}
  return {};
}

function readResolvedUazapiConfig(): {
  baseUrl: string;
  source: "env" | "panel" | "none";
  instances: { name: string; token: string }[];
  josiToken: string;
  sergioToken: string;
} {
  const stored = readStoredUazapiConfig();
  const envBase = (process.env.GOOGLE_ADS_UAZAPI_BASE_URL || process.env.UAZAPI_BASE_URL || "").trim();
  const baseUrl = (envBase || stored.baseUrl || "").trim().replace(/\/+$/, "");

  const envJosi = (process.env.GOOGLE_ADS_UAZAPI_TOKEN_JOSI || process.env.UAZAPI_TOKEN_JOSI || "").trim();
  const envSergio = (process.env.GOOGLE_ADS_UAZAPI_TOKEN_SERGIO || process.env.UAZAPI_TOKEN_SERGIO || "").trim();
  const envGeneric = (process.env.GOOGLE_ADS_UAZAPI_TOKEN || process.env.UAZAPI_TOKEN || "").trim();

  const josiToken = envJosi || (stored.josiToken || "").trim();
  const sergioToken = envSergio || (stored.sergioToken || "").trim();

  const instances: { name: string; token: string }[] = [];
  if (josiToken) instances.push({ name: "Josi", token: josiToken });
  if (sergioToken) instances.push({ name: "Sérgio", token: sergioToken });
  if (instances.length === 0 && envGeneric) {
    instances.push({ name: "WhatsApp Principal", token: envGeneric });
  }

  const hasEnv = Boolean(envBase && (envJosi || envSergio || envGeneric));
  const source: "env" | "panel" | "none" = !baseUrl || instances.length === 0 ? "none" : hasEnv ? "env" : "panel";

  return { baseUrl, source, instances, josiToken, sergioToken };
}

function readUazapiSyncMeta(): UazapiSyncMeta {
  try {
    const file = getUazapiMetaFilePath();
    if (fs.existsSync(file)) {
      return {
        recoveredCount: 0,
        updatedCount: 0,
        checkedMessagesCount: 0,
        ...JSON.parse(fs.readFileSync(file, "utf8")),
      };
    }
  } catch {}
  return { recoveredCount: 0, updatedCount: 0, checkedMessagesCount: 0 };
}

function writeUazapiSyncMeta(meta: UazapiSyncMeta): void {
  try {
    writeJsonAtomic(getUazapiMetaFilePath(), meta);
  } catch {}
}

function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

function getUazapiPublicStatus() {
  const cfg = readResolvedUazapiConfig();
  const meta = readUazapiSyncMeta();
  return {
    configured: cfg.source !== "none",
    source: cfg.source,
    baseUrl: cfg.baseUrl,
    instancesCount: cfg.instances.length,
    hasJosiToken: Boolean(cfg.josiToken),
    hasSergioToken: Boolean(cfg.sergioToken),
    josiTokenMasked: maskToken(cfg.josiToken),
    sergioTokenMasked: maskToken(cfg.sergioToken),
    lastSyncAt: meta.lastSyncAt || null,
    lastError: meta.lastError || null,
    recoveredCount: meta.recoveredCount || 0,
    updatedCount: meta.updatedCount || 0,
  };
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
    return { gclid: match[1], keyword: match[2] ? decodeURIComponent(match[2]) : undefined };
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

function matchDynamicPhrase(messageText: string, phrases: string[]): string | null {
  const normMsg = normalizeText(messageText);
  if (!normMsg) return null;
  for (const phrase of phrases) {
    const normPhrase = normalizeText(phrase);
    if (normPhrase && normMsg.includes(normPhrase)) return phrase;
  }
  return null;
}

async function fetchUazapiRecentMessages(baseUrl: string, token: string): Promise<{
  ok: boolean;
  messages: any[];
  error?: string;
}> {
  const parseList = (payload: any): any[] => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.messages)) return payload.messages;
    if (Array.isArray(payload?.chats)) return payload.chats;
    return [];
  };

  try {
    // 1) Tenta buscar mensagens recentes globais via POST /message/find
    const msgRes = await fetch(`${baseUrl}/message/find`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ limit: 60 }),
      signal: AbortSignal.timeout(5000),
    });

    if (msgRes.ok) {
      const msgPayload = await msgRes.json().catch(() => null);
      const list = parseList(msgPayload);
      if (list.length > 0) {
        return { ok: true, messages: list };
      }
    }

    // 2) Fallback: lista chats recentes (/chat/find) e busca histórico dos últimos 15 chats
    const chatRes = await fetch(`${baseUrl}/chat/find`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ limit: 20 }),
      signal: AbortSignal.timeout(5000),
    });

    if (!chatRes.ok) {
      return { ok: false, messages: [], error: `Uazapi HTTP ${chatRes.status}` };
    }

    const chatPayload = await chatRes.json().catch(() => null);
    const chats = parseList(chatPayload).slice(0, 15);
    const aggregated: any[] = [];

    for (const chat of chats) {
      const chatId = chat?.wa_chatid || chat?.chatid || chat?.id;
      if (!chatId || String(chatId).includes("@g.us") || String(chatId).includes("status@broadcast")) continue;

      try {
        const perChatRes = await fetch(`${baseUrl}/message/find`, {
          method: "POST",
          headers: { "Content-Type": "application/json", token },
          body: JSON.stringify({ wa_chatid: chatId, chatid: chatId, limit: 15 }),
          signal: AbortSignal.timeout(3500),
        });
        if (perChatRes.ok) {
          const perChatPayload = await perChatRes.json().catch(() => null);
          const msgs = parseList(perChatPayload).map((m) => ({
            ...m,
            _chatName: chat?.name || chat?.wa_name || m?.pushName || m?.senderName,
            _chatId: chatId,
          }));
          aggregated.push(...msgs);
        }
      } catch {}
    }

    return { ok: true, messages: aggregated };
  } catch (err: any) {
    return { ok: false, messages: [], error: err?.message || "Falha de conexão com Uazapi" };
  }
}

async function autoReconcileUazapiIfConfigured(force = false): Promise<UazapiSyncMeta & { configured: boolean }> {
  const cfg = readResolvedUazapiConfig();
  const prevMeta = readUazapiSyncMeta();

  if (cfg.source === "none") {
    return { ...prevMeta, configured: false };
  }

  // Cooldown automático de 3 minutos para evitar carga no polling de 4s
  if (!force && prevMeta.lastSyncAt) {
    const elapsed = Date.now() - new Date(prevMeta.lastSyncAt).getTime();
    if (elapsed < 3 * 60 * 1000) {
      return { ...prevMeta, configured: true };
    }
  }

  const leads = readLeads();
  const rules = readRules();
  const processedIds = readProcessedMessageIds();
  let leadsChanged = false;
  let processedChanged = false;
  let recoveredCount = 0;
  let updatedCount = 0;
  let checkedMessagesCount = 0;
  let lastError: string | null = null;

  for (const inst of cfg.instances) {
    const res = await fetchUazapiRecentMessages(cfg.baseUrl, inst.token);
    if (!res.ok) {
      lastError = `${inst.name}: ${res.error}`;
      continue;
    }

    // Ordena do mais antigo para o mais recente para preservar a ordem cronológica do funil
    const ordered = [...res.messages].sort((a, b) => {
      const ta = Number(a?.messageTimestamp || 0);
      const tb = Number(b?.messageTimestamp || 0);
      return ta - tb;
    });

    for (const msg of ordered) {
      checkedMessagesCount++;
      const rawChat = String(msg?.chatid || msg?.wa_chatid || msg?._chatId || msg?.sender || msg?.sender_pn || "");
      if (!rawChat || rawChat.includes("@g.us") || rawChat.includes("status@broadcast")) continue;

      const cleanPhone = rawChat.replace(/\D/g, "");
      if (!cleanPhone || isAttendantPhone(cleanPhone)) continue;

      const messageId = String(msg?.messageid || msg?.id || "").trim();
      if (messageId && processedIds.includes(messageId)) continue;

      const text =
        msg?.text ||
        msg?.conversation ||
        (typeof msg?.content === "string" ? msg.content : msg?.content?.text) ||
        "";
      if (!text) continue;

      const fromMe = Boolean(msg?.fromMe);
      const tsNum = Number(msg?.messageTimestamp || 0);
      const msgIso = tsNum
        ? new Date(tsNum > 1e12 ? tsNum : tsNum * 1000).toISOString()
        : new Date().toISOString();

      if (!fromMe) {
        const tracking = extractTrackingTag(text);
        if (tracking?.gclid) {
          const gclid = tracking.gclid;
          const idx = leads.findIndex(
            (l: any) => l.gclid === gclid || (l.id && l.id.includes(gclid.slice(0, 15)))
          );
          const pushName = msg?._chatName || msg?.pushName || msg?.senderName || "";

          if (idx !== -1) {
            if (!leads[idx].firstMessageAt || /aguardando/i.test(String(leads[idx].leadPhone || ""))) {
              leads[idx].leadPhone = cleanPhone;
              if (pushName) leads[idx].leadName = pushName;
              leads[idx].firstMessageAt = msgIso;
              leads[idx].updatedAt = new Date().toISOString();
              if (tracking.keyword) leads[idx].keyword = tracking.keyword;
              if (tracking.campaign) leads[idx].campaign = tracking.campaign;
              if (tracking.adGroup) leads[idx].adGroup = tracking.adGroup;
              leadsChanged = true;
              updatedCount++;
            }
          } else {
            leads.unshift({
              id: `g_${gclid.slice(0, 15)}_${Date.now()}`,
              leadName: pushName || "Cliente WhatsApp",
              leadPhone: cleanPhone,
              attendantName: inst.name,
              keyword: tracking.keyword || "Pesquisa Google",
              campaign: tracking.campaign || "Campanha Pesquisa",
              adGroup: tracking.adGroup || "Geral",
              gclid,
              conversionType: "conversa_iniciada",
              stage: "conversa_iniciada",
              status: "queued",
              occurredAt: msgIso,
              firstMessageAt: msgIso,
              updatedAt: new Date().toISOString(),
              recoveredFromUazapi: true,
            });
            leadsChanged = true;
            recoveredCount++;

            recordAuditLog({
              id: `audit_uazapi_rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              leadPhone: cleanPhone,
              leadName: pushName || "Cliente WhatsApp",
              action: "conversa_iniciada",
              detectedPhrase: "Lead recuperado automaticamente via Reconciliação Uazapi",
              attendant: inst.name,
              gclid,
              timestamp: msgIso,
              statusOci: "queued",
            });
          }

          if (messageId && !processedIds.includes(messageId)) {
            processedIds.unshift(messageId);
            processedChanged = true;
          }
        }
      } else {
        // Mensagem do atendente para lead já pertencente ao funil Google Ads
        const leadIdx = leads.findIndex((l: any) => isSamePhone(l.leadPhone, cleanPhone));
        if (leadIdx !== -1) {
          const matchedPurchase = matchDynamicPhrase(text, rules.purchase.phrases);
          const matchedQuote = matchDynamicPhrase(text, rules.quote.phrases);

          if (matchedPurchase && leads[leadIdx].stage !== "compra_realizada") {
            const val = extractMonetaryValue(text);
            leads[leadIdx].stage = "compra_realizada";
            leads[leadIdx].conversionType = "compra_realizada";
            if (val !== null) leads[leadIdx].value = val;
            leads[leadIdx].purchasedAt = msgIso;
            leads[leadIdx].triggerPhrase = text;
            leads[leadIdx].matchedRulePhrase = matchedPurchase;
            leads[leadIdx].updatedAt = new Date().toISOString();
            leadsChanged = true;
            updatedCount++;

            recordAuditLog({
              id: `audit_uazapi_buy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              leadPhone: leads[leadIdx].leadPhone,
              leadName: leads[leadIdx].leadName || "Cliente WhatsApp",
              action: "compra_realizada",
              value: val || leads[leadIdx].value || 0,
              detectedPhrase: text,
              attendant: inst.name,
              gclid: leads[leadIdx].gclid,
              timestamp: msgIso,
              statusOci: leads[leadIdx].status || "queued",
            });
          } else if (
            matchedQuote &&
            leads[leadIdx].stage !== "orcamento_enviado" &&
            leads[leadIdx].stage !== "compra_realizada"
          ) {
            leads[leadIdx].stage = "orcamento_enviado";
            leads[leadIdx].conversionType = "orcamento_enviado";
            leads[leadIdx].quotedAt = msgIso;
            leads[leadIdx].triggerPhrase = text;
            leads[leadIdx].matchedRulePhrase = matchedQuote;
            leads[leadIdx].updatedAt = new Date().toISOString();
            leadsChanged = true;
            updatedCount++;

            recordAuditLog({
              id: `audit_uazapi_quote_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              leadPhone: leads[leadIdx].leadPhone,
              leadName: leads[leadIdx].leadName || "Cliente WhatsApp",
              action: "orcamento_enviado",
              detectedPhrase: text,
              attendant: inst.name,
              gclid: leads[leadIdx].gclid,
              timestamp: msgIso,
              statusOci: leads[leadIdx].status || "queued",
            });
          }

          if (messageId && !processedIds.includes(messageId)) {
            processedIds.unshift(messageId);
            processedChanged = true;
          }
        }
      }
    }
  }

  if (leadsChanged) writeLeads(leads);
  if (processedChanged) writeProcessedMessageIds(processedIds);

  const meta: UazapiSyncMeta = {
    lastSyncAt: new Date().toISOString(),
    lastError,
    recoveredCount: (prevMeta.recoveredCount || 0) + recoveredCount,
    updatedCount: (prevMeta.updatedCount || 0) + updatedCount,
    checkedMessagesCount,
  };
  writeUazapiSyncMeta(meta);
  return { ...meta, configured: true };
}

// =========================================================================
// GOOGLE ADS API v25/v26 AUTO-DISCOVERY (PASSO 1)
// =========================================================================

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
    return {
      token: null,
      error: "Variáveis OAuth ausentes (GOOGLE_ADS_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN).",
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
      error: `OAuth2 erro ${res.status}${data.error ? ` (${data.error})` : ""}: ${data.error_description || data.error || res.statusText || "Falha ao gerar access_token"}`,
    };
  } catch (err: any) {
    return { token: null, error: `Falha de rede OAuth2: ${err?.message || "desconhecida"}` };
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
        if (Array.isArray(batch?.results)) {
          rows.push(...batch.results);
        }
      }
    } else if (Array.isArray(parsed?.results)) {
      rows.push(...parsed.results);
    }
    return { ok: true, status: res.status, rows };
  } catch {
    return { ok: false, status: res.status, rows: [], errorText: "Resposta JSON inválida da Google Ads API." };
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

function getMissingGoogleAdsEnvVars(): string[] {
  const required = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
  ];
  return required.filter((k) => !process.env[k]?.trim());
}

async function autoSyncEntitiesFromGoogleAds(forceRefresh = false): Promise<{
  map: Record<string, string>;
  meta: EntitiesSyncMeta;
}> {
  const map = readEntitiesMap();
  const prevMeta = readEntitiesMeta();
  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID || "3228136878").replace(/\D/g, "");
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  const missingEnv = getMissingGoogleAdsEnvVars();
  const nowMs = Date.now();

  if (!devToken || missingEnv.length > 0) {
    const missingList = missingEnv.length > 0 ? missingEnv : ["GOOGLE_ADS_DEVELOPER_TOKEN"];
    const meta: EntitiesSyncMeta = {
      ...prevMeta,
      apiConnected: false,
      customerId,
      lastAttemptAt: new Date().toISOString(),
      lastError: `Variáveis ausentes no runtime do container web (Dokploy): ${missingList.join(", ")}.`,
    };
    writeEntitiesMeta(meta);
    return { map, meta };
  }

  const wasMissingEnvError = Boolean(
    prevMeta.lastError && /não configurado|ausentes/i.test(prevMeta.lastError)
  );

  if (!forceRefresh && prevMeta.lastAttemptAt && !wasMissingEnvError) {
    const elapsedMs = nowMs - new Date(prevMeta.lastAttemptAt).getTime();
    if (!prevMeta.apiConnected && elapsedMs < 60 * 1000) {
      return { map, meta: prevMeta };
    }
    if (prevMeta.apiConnected && prevMeta.lastSyncAt) {
      const syncAgeMs = nowMs - new Date(prevMeta.lastSyncAt).getTime();
      if (syncAgeMs < 15 * 60 * 1000 && Object.keys(map).length > 0) {
        return { map, meta: prevMeta };
      }
    }
  }

  const oauth = await getGoogleAdsAccessToken();
  if (!oauth.token) {
    const meta: EntitiesSyncMeta = {
      ...prevMeta,
      apiConnected: false,
      customerId,
      lastAttemptAt: new Date().toISOString(),
      lastError: oauth.error || "Token OAuth inválido.",
    };
    writeEntitiesMeta(meta);
    return { map, meta };
  }

  const accessToken = oauth.token;
  const versions = getActiveApiVersions();
  const explicitLoginId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/\D/g, "") || undefined;
  let loginCustomerId = explicitLoginId || prevMeta.loginCustomerIdUsed;

  const campaignQuery = `SELECT campaign.id, campaign.name, campaign.status FROM campaign`;
  const adGroupQuery = `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group.status FROM ad_group`;
  const assetGroupQuery = `SELECT campaign.id, campaign.name, asset_group.id, asset_group.name FROM asset_group`;

  let workingVersion: string | undefined;
  let campaignRows: any[] = [];
  let lastError: string | null = null;

  for (const version of versions) {
    let res = await executeGaqlStream({
      version,
      customerId,
      accessToken,
      devToken,
      query: campaignQuery,
      loginCustomerId,
    });

    if (!res.ok && (res.status === 404 || (res.errorText && /UNSUPPORTED_VERSION|deprecated|sunset/i.test(res.errorText)))) {
      lastError = `Versão ${version} indisponível (${res.status})`;
      continue;
    }

    if (!res.ok && !explicitLoginId && (res.status === 403 || (res.errorText && /USER_PERMISSION_DENIED|PERMISSION_DENIED/i.test(res.errorText)))) {
      if (loginCustomerId) {
        const directRes = await executeGaqlStream({
          version,
          customerId,
          accessToken,
          devToken,
          query: campaignQuery,
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
            query: campaignQuery,
            loginCustomerId,
          });
        }
      }
    }

    if (res.ok) {
      workingVersion = version;
      campaignRows = res.rows;
      lastError = null;
      break;
    } else {
      lastError = `Google Ads API (${version}) erro ${res.status}: ${res.errorText || "erro desconhecido"}`;
      break;
    }
  }

  if (!workingVersion) {
    const meta: EntitiesSyncMeta = {
      ...prevMeta,
      apiConnected: false,
      customerId,
      lastAttemptAt: new Date().toISOString(),
      lastError: lastError || "Não foi possível conectar na Google Ads API.",
    };
    writeEntitiesMeta(meta);
    return { map, meta };
  }

  let campaignsCount = 0;
  let adGroupsCount = 0;

  for (const row of campaignRows) {
    const cId = String(row.campaign?.id || "");
    const cName = row.campaign?.name;
    if (cId && cName) {
      map[cId] = cName;
      campaignsCount++;
    }
  }

  const adGroupRes = await executeGaqlStream({
    version: workingVersion,
    customerId,
    accessToken,
    devToken,
    query: adGroupQuery,
    loginCustomerId,
  });

  if (adGroupRes.ok) {
    for (const row of adGroupRes.rows) {
      const cId = String(row.campaign?.id || "");
      const cName = row.campaign?.name;
      const aId = String(row.adGroup?.id || "");
      const aName = row.adGroup?.name;
      if (cId && cName) map[cId] = cName;
      if (aId && aName) {
        map[aId] = aName;
        adGroupsCount++;
      }
    }
  }

  const assetGroupRes = await executeGaqlStream({
    version: workingVersion,
    customerId,
    accessToken,
    devToken,
    query: assetGroupQuery,
    loginCustomerId,
  });

  if (assetGroupRes.ok) {
    for (const row of assetGroupRes.rows) {
      const agId = String(row.assetGroup?.id || "");
      const agName = row.assetGroup?.name;
      if (agId && agName && !map[agId]) {
        map[agId] = agName;
        adGroupsCount++;
      }
    }
  }

  writeEntitiesMap(map);
  const meta: EntitiesSyncMeta = {
    apiConnected: true,
    customerId,
    apiVersionUsed: workingVersion,
    loginCustomerIdUsed: loginCustomerId,
    campaignsCount,
    adGroupsCount,
    lastSyncAt: new Date().toISOString(),
    lastAttemptAt: new Date().toISOString(),
    lastError: null,
  };
  writeEntitiesMeta(meta);

  return { map, meta };
}

async function autoEnrichLeadsViaClickView(
  leads: any[],
  meta: EntitiesSyncMeta,
  entities: Record<string, string>
): Promise<{ leads: any[]; enrichedCount: number }> {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  const missingEnv = getMissingGoogleAdsEnvVars();
  if (!devToken || missingEnv.length > 0 || !meta.apiConnected) {
    return { leads, enrichedCount: 0 };
  }

  // Throttle de 5 minutos entre lotes de enriquecimento para proteger a cota Exploração
  let lastClickViewRunMs = 0;
  try {
    const cvMetaPath = getClickViewMetaFilePath();
    if (fs.existsSync(cvMetaPath)) {
      const parsed = JSON.parse(fs.readFileSync(cvMetaPath, "utf8"));
      lastClickViewRunMs = Number(parsed?.lastRunMs || 0);
    }
  } catch {}
  if (Date.now() - lastClickViewRunMs < 5 * 60 * 1000) {
    return { leads, enrichedCount: 0 };
  }

  const nowMs = Date.now();
  const candidates = leads.filter((l: any) => {
    if (!l?.gclid || l.gclid === "sem_gclid") return false;
    if (l.clickViewEnriched) return false;
    if (l.clickViewAttempts >= 2) return false;
    if (l.clickViewCheckedAt && nowMs - new Date(l.clickViewCheckedAt).getTime() < 4 * 60 * 60 * 1000) {
      return false;
    }
    const occurredMs = new Date(l.occurredAt || l.firstMessageAt || 0).getTime();
    if (!occurredMs || isNaN(occurredMs)) return false;
    const ageDays = (nowMs - occurredMs) / (1000 * 60 * 60 * 24);
    // click_view mantém até 90 dias de histórico e exige ao menos ~1h pós-clique
    return ageDays >= 0.04 && ageDays <= 89;
  });

  if (candidates.length === 0) return { leads, enrichedCount: 0 };

  const oauth = await getGoogleAdsAccessToken();
  if (!oauth.token) return { leads, enrichedCount: 0 };

  try {
    writeJsonAtomic(getClickViewMetaFilePath(), { lastRunMs: nowMs, lastRunAt: new Date().toISOString() });
  } catch {}

  const version = meta.apiVersionUsed || getActiveApiVersions()[0];
  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID || "3228136878").replace(/\D/g, "");
  const loginCustomerId =
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/\D/g, "") || meta.loginCustomerIdUsed;

  // Agrupa por data (no máximo 2 datas distintas por ciclo)
  const dateMap = new Map<string, any[]>();
  for (const c of candidates) {
    const d = String(c.occurredAt || c.firstMessageAt || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!dateMap.has(d)) {
      if (dateMap.size >= 2) continue;
      dateMap.set(d, []);
    }
    dateMap.get(d)!.push(c);
  }

  let enrichedCount = 0;
  let leadsChanged = false;
  let entitiesChanged = false;

  for (const [dateStr, dayLeads] of dateMap.entries()) {
    const query = `
      SELECT
        click_view.gclid,
        segments.date,
        click_view.keyword_info.text,
        click_view.keyword_info.match_type,
        click_view.ad_group_ad,
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group.name
      FROM click_view
      WHERE segments.date = '${dateStr}'
    `;

    const res = await executeGaqlStream({
      version,
      customerId,
      accessToken: oauth.token,
      devToken,
      loginCustomerId,
      query,
    });

    if (!res.ok) continue;

    const byGclid = new Map<string, any>();
    for (const row of res.rows) {
      const g = String(row.clickView?.gclid || "").trim();
      if (g) byGclid.set(g, row);
    }

    for (const target of dayLeads) {
      const idx = leads.findIndex((x: any) => x.id === target.id);
      if (idx === -1) continue;

      leads[idx].clickViewCheckedAt = new Date().toISOString();
      leads[idx].clickViewAttempts = Number(leads[idx].clickViewAttempts || 0) + 1;
      leadsChanged = true;

      const match = byGclid.get(String(target.gclid).trim());
      if (match) {
        const cId = String(match.campaign?.id || "");
        const cName = match.campaign?.name;
        const aId = String(match.adGroup?.id || "");
        const aName = match.adGroup?.name;
        const kwText = match.clickView?.keywordInfo?.text;
        const kwMatch = match.clickView?.keywordInfo?.matchType;
        const adGroupAdRn = String(match.clickView?.adGroupAd || "");
        const adId = adGroupAdRn ? adGroupAdRn.split("~").pop() || adGroupAdRn.split("/").pop() : undefined;

        if (cId && cName) {
          leads[idx].campaign = cId;
          leads[idx].campaignName = cName;
          entities[cId] = cName;
          entitiesChanged = true;
        }
        if (aId && aName) {
          leads[idx].adGroup = aId;
          leads[idx].adGroupName = aName;
          entities[aId] = aName;
          entitiesChanged = true;
        }
        if (kwText) leads[idx].keyword = kwText;
        if (kwMatch) leads[idx].matchType = kwMatch;
        if (adGroupAdRn) {
          leads[idx].adGroupAdResourceName = adGroupAdRn;
          if (adId) leads[idx].adId = adId;
        }
        leads[idx].clickViewEnriched = true;
        enrichedCount += 1;
      }
    }
  }

  if (entitiesChanged) writeEntitiesMap(entities);
  if (leadsChanged) writeLeads(leads);
  return { leads, enrichedCount };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");

  if (type === "audits") {
    let audits: any[] = [];
    try {
      const file = getAuditsFilePath();
      if (fs.existsSync(file)) {
        audits = JSON.parse(fs.readFileSync(file, "utf8"));
      } else if (fs.existsSync("/tmp/alpha_google_conversion_audits.json")) {
        audits = JSON.parse(fs.readFileSync("/tmp/alpha_google_conversion_audits.json", "utf8"));
      }
    } catch (e) {
      console.error("Erro ao ler auditoria:", e);
    }
    return NextResponse.json(audits, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  }

  if (type === "rules") {
    return NextResponse.json(readRules(), {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  }

  if (type === "entities") {
    return NextResponse.json(readEntitiesMap(), {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  }

  if (type === "entities_status") {
    const entities = readEntitiesMap();
    const meta = readEntitiesMeta();
    const leads = readLeads();
    const storageDir = getStorageDir();
    const missingEnvVars = getMissingGoogleAdsEnvVars();
    const ociStats = {
      queued: leads.filter((l: any) => !l.status || l.status === "queued").length,
      sent: leads.filter((l: any) => l.status === "sent").length,
      failed: leads.filter((l: any) => l.status === "failed").length,
    };

    return NextResponse.json(
      {
        ...meta,
        apiConnected: missingEnvVars.length === 0 ? meta.apiConnected : false,
        lastError:
          missingEnvVars.length > 0
            ? `Variáveis ausentes no runtime do container web (Dokploy): ${missingEnvVars.join(", ")}.`
            : meta.lastError,
        missingEnvVars,
        storageDir,
        isPersistentStorage: storageDir !== "/tmp",
        leadsCount: leads.length,
        lastLeadAt: leads[0]?.occurredAt || leads[0]?.firstMessageAt || leads[0]?.updatedAt || null,
        ociStats,
        mappedKeysCount: Object.keys(entities).length,
        uazapiStatus: getUazapiPublicStatus(),
        entities,
      },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  }

  // Dispara reconciliação automática da Uazapi em modo throttled (a cada 3 min se configurada)
  try {
    await autoReconcileUazapiIfConfigured(false);
  } catch {}

  let leads = readLeads();
  let entities = readEntitiesMap();

  const hasUnmappedNumeric = leads.some(
    (l: any) =>
      (l.campaign && /^\d+$/.test(String(l.campaign).trim()) && !entities[String(l.campaign).trim()]) ||
      (l.adGroup && /^\d+$/.test(String(l.adGroup).trim()) && !entities[String(l.adGroup).trim()])
  );

  let meta = readEntitiesMeta();
  const isCacheExpired =
    !meta.lastSyncAt || Date.now() - new Date(meta.lastSyncAt).getTime() > 15 * 60 * 1000;

  if (hasUnmappedNumeric || isCacheExpired) {
    try {
      const synced = await autoSyncEntitiesFromGoogleAds(false);
      entities = synced.map;
      meta = synced.meta;
    } catch {}
  }

  try {
    const cvResult = await autoEnrichLeadsViaClickView(leads, meta, entities);
    leads = cvResult.leads;
  } catch {}

  const enriched = leads.map((l: any) => {
    const rawCamp = String(l.campaign || "").trim();
    const rawAdGrp = String(l.adGroup || "").trim();
    return {
      ...l,
      campaignName: entities[rawCamp] || rawCamp,
      adGroupName: entities[rawAdGrp] || rawAdGrp,
    };
  });

  return NextResponse.json(enriched, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.action === "sync_catalog" || body.action === "sync_entities_api") {
      const { map, meta } = await autoSyncEntitiesFromGoogleAds(true);
      return NextResponse.json({
        success: meta.apiConnected,
        apiConnected: meta.apiConnected,
        apiVersionUsed: meta.apiVersionUsed,
        loginCustomerIdUsed: meta.loginCustomerIdUsed,
        campaignsCount: meta.campaignsCount,
        adGroupsCount: meta.adGroupsCount,
        lastError: meta.lastError,
        entities: map,
        count: Object.keys(map).length,
      });
    }

    if (body.action === "reconcile_uazapi") {
      const syncResult = await autoReconcileUazapiIfConfigured(true);
      return NextResponse.json({
        success: !syncResult.lastError,
        ...syncResult,
        uazapiStatus: getUazapiPublicStatus(),
      });
    }

    if (body.type === "save_uazapi_config") {
      const prev = readStoredUazapiConfig();
      const baseUrl = String(body.baseUrl || prev.baseUrl || "")
        .trim()
        .replace(/\/+$/, "");

      const nextJosi =
        body.clearJosiToken === true
          ? ""
          : String(body.josiToken || "").trim() && !String(body.josiToken).includes("••••")
            ? String(body.josiToken).trim()
            : prev.josiToken || "";

      const nextSergio =
        body.clearSergioToken === true
          ? ""
          : String(body.sergioToken || "").trim() && !String(body.sergioToken).includes("••••")
            ? String(body.sergioToken).trim()
            : prev.sergioToken || "";

      const payload: UazapiStoredConfig = {
        baseUrl,
        josiToken: nextJosi,
        sergioToken: nextSergio,
        updatedAt: new Date().toISOString(),
      };
      writeJsonAtomic(getUazapiConfigFilePath(), payload);

      const syncResult = await autoReconcileUazapiIfConfigured(true);
      return NextResponse.json({
        success: true,
        uazapiStatus: getUazapiPublicStatus(),
        syncResult,
      });
    }

    if (body.action === "save_entities" || body.type === "save_entities") {
      const current = readEntitiesMap();
      const updated = { ...current, ...(body.entities || {}) };
      writeEntitiesMap(updated);
      return NextResponse.json({ success: true, entities: updated, message: "Nomes reais vinculados com sucesso!" });
    }

    if (body.type === "save_rules" && body.rules) {
      const saved = writeRules(body.rules);
      return NextResponse.json({ success: true, rules: saved, message: "Regras salvas com sucesso!" });
    }

    return NextResponse.json({ error: "Ação não reconhecida" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro ao processar POST" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, stage, value, attendantName } = body;

    if (!id) {
      return NextResponse.json({ error: "ID do lead é obrigatório" }, { status: 400 });
    }

    const leads = readLeads();
    const index = leads.findIndex((l: any) => l.id === id);

    if (index === -1) {
      return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
    }

    const prevStage = leads[index].stage;
    const prevValue = Number(leads[index].value || 0);
    const sentPurchase = leads[index].sentStages?.compra_realizada;

    if (stage) leads[index].stage = stage;
    if (value !== undefined) leads[index].value = Number(value);
    if (attendantName) leads[index].attendantName = attendantName;
    leads[index].updatedAt = new Date().toISOString();

    // PASSO 4: Se uma venda já foi enviada ao Google Ads e o valor ou etapa mudou,
    // sinaliza ajuste pendente (RESTATEMENT / RETRACTION) vinculado ao mesmo orderId
    if (sentPurchase?.orderId) {
      const nextStage = leads[index].stage;
      const nextVal = Number(leads[index].value || 0);
      if (nextStage !== "compra_realizada" && prevStage === "compra_realizada") {
        leads[index].pendingConversionAdjustment = {
          adjustmentType: "RETRACTION",
          orderId: sentPurchase.orderId,
          conversionAction: sentPurchase.conversionAction,
          previousValue: prevValue,
          newValue: 0,
          updatedAt: new Date().toISOString(),
        };
      } else if (nextStage === "compra_realizada" && value !== undefined && nextVal !== prevValue) {
        leads[index].pendingConversionAdjustment = {
          adjustmentType: "RESTATEMENT",
          orderId: sentPurchase.orderId,
          conversionAction: sentPurchase.conversionAction,
          previousValue: prevValue,
          newValue: nextVal,
          updatedAt: new Date().toISOString(),
        };
      }
    }

    writeLeads(leads);
    return NextResponse.json({ success: true, lead: leads[index] });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const action = searchParams.get("action");

    let leads = readLeads();

    if (action === "clean_attendants") {
      const originalCount = leads.length;
      leads = leads.filter((l: any) => !isAttendantPhone(l.leadPhone));
      writeLeads(leads);
      return NextResponse.json({
        success: true,
        removed: originalCount - leads.length,
        message: "Leads dos atendentes removidos com sucesso!",
      });
    }

    if (!id) {
      return NextResponse.json({ error: "ID é obrigatório" }, { status: 400 });
    }

    leads = leads.filter((l: any) => l.id !== id);
    writeLeads(leads);

    return NextResponse.json({ success: true, message: "Lead removido com sucesso!" });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro ao excluir lead" }, { status: 500 });
  }
}

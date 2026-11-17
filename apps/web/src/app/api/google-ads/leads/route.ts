import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import {
  type GoogleTenantConfig,
  type TenantConversionRules,
  appendTenantAudit,
  extractUazapiChatLabels,
  getStorageDir,
  getTenantFilePath,
  getTenantResolvedUazapi,
  isSamePhone,
  isTenantAttendantPhone,
  listTenants,
  matchRuleLabel,
  normalizeText,
  normalizeUazapiBaseUrl,
  readJsonSafe,
  readTenantAudits,
  readTenantLeads,
  readTenantRules,
  resolveRequestTenant,
  upsertTenant,
  writeJsonAtomic,
  writeTenantLeads,
  writeTenantRules,
} from "../../../../lib/google-tenants";

export const dynamic = "force-dynamic";

/**
 * PASSO M1 — API MULTI-CLIENTE DE LEADS, REGRAS (FRASES + ETIQUETAS), UAZAPI & CLICK_VIEW
 * Caminho no GitHub: apps/web/src/app/api/google-ads/leads/route.ts
 *
 * - 100% isolado por cliente em /data/tenants/<slug>/ (padrão "cnac" quando ?client= omitido)
 * - Usa 1 único Refresh Token da MCC, trocando dinamicamente tenant.googleCustomerId
 * - Suporta modo "single" (1 WhatsApp) e "roulette" (multi-atendentes)
 * - Reconciliação Uazapi suporta Frases-Gatilho + Etiquetas do WhatsApp Business (wa_label)
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

interface UazapiInstanceStatusMeta {
  name: string;
  connected: boolean | null;
  state: string;
  phone?: string;
  checkedMessages?: number;
  recovered?: number;
  updated?: number;
  error?: string | null;
}

interface UazapiSyncMeta {
  lastSyncAt?: string;
  lastError?: string | null;
  recoveredCount: number;
  updatedCount: number;
  checkedMessagesCount: number;
  instanceStatuses?: UazapiInstanceStatusMeta[];
}

function extractCleanPhoneFromCandidates(candidates: unknown[]): string {
  const strings = candidates.map((c) => String(c || "").trim()).filter(Boolean);

  for (const s of strings) {
    if (s.includes("@g.us") || s.includes("status@broadcast") || s.includes("@lid")) continue;
    const digits = s.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) return digits;
  }

  for (const s of strings) {
    if (s.includes("@g.us") || s.includes("status@broadcast") || s.includes("@lid")) continue;
    const digits = s.replace(/\D/g, "");
    if (digits.length >= 8) return digits;
  }

  return "";
}

function parseUazapiTimestampMs(msg: any): number {
  const raw =
    msg?.messageTimestamp ?? msg?.Timestamp ?? msg?.timestamp ?? msg?.t ?? msg?.createdAt ?? msg?.date ?? 0;
  if (typeof raw === "number" && !isNaN(raw) && raw > 0) {
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (typeof raw === "string" && raw.trim()) {
    const asNum = Number(raw.trim());
    if (!isNaN(asNum) && asNum > 0) {
      return asNum > 1e12 ? asNum : asNum * 1000;
    }
    const parsed = Date.parse(raw.trim());
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function readEntitiesMap(slug: string): Record<string, string> {
  return readJsonSafe<Record<string, string>>(getTenantFilePath(slug, "entities_map"), {});
}

function writeEntitiesMap(slug: string, map: Record<string, string>): void {
  try {
    writeJsonAtomic(getTenantFilePath(slug, "entities_map"), map);
  } catch (err) {
    console.error("Erro ao salvar mapa de entidades:", err);
  }
}

function readEntitiesMeta(tenant: GoogleTenantConfig): EntitiesSyncMeta {
  const defaultMeta: EntitiesSyncMeta = {
    apiConnected: false,
    customerId: String(tenant.googleCustomerId || "").replace(/\D/g, ""),
    campaignsCount: 0,
    adGroupsCount: 0,
  };
  const stored = readJsonSafe<Partial<EntitiesSyncMeta>>(
    getTenantFilePath(tenant.slug, "entities_meta"),
    {}
  );
  return {
    ...defaultMeta,
    ...stored,
    customerId: String(tenant.googleCustomerId || stored.customerId || "").replace(/\D/g, ""),
  };
}

function writeEntitiesMeta(slug: string, meta: EntitiesSyncMeta): void {
  try {
    writeJsonAtomic(getTenantFilePath(slug, "entities_meta"), meta);
  } catch {}
}

function readProcessedMessageIds(slug: string): string[] {
  const parsed = readJsonSafe<unknown>(getTenantFilePath(slug, "processed_messages"), []);
  return Array.isArray(parsed) ? (parsed as string[]) : [];
}

function writeProcessedMessageIds(slug: string, ids: string[]): void {
  try {
    writeJsonAtomic(getTenantFilePath(slug, "processed_messages"), ids.slice(0, 1500));
  } catch {}
}

function readUazapiSyncMeta(slug: string): UazapiSyncMeta {
  const stored = readJsonSafe<Partial<UazapiSyncMeta>>(getTenantFilePath(slug, "uazapi_meta"), {});
  return {
    recoveredCount: 0,
    updatedCount: 0,
    checkedMessagesCount: 0,
    ...stored,
  };
}

function writeUazapiSyncMeta(slug: string, meta: UazapiSyncMeta): void {
  try {
    writeJsonAtomic(getTenantFilePath(slug, "uazapi_meta"), meta);
  } catch {}
}

function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

function getUazapiPublicStatus(tenant: GoogleTenantConfig) {
  const cfg = getTenantResolvedUazapi(tenant);
  const meta = readUazapiSyncMeta(tenant.slug);
  return {
    configured: cfg.source !== "none",
    source: cfg.source,
    baseUrl: cfg.baseUrl,
    routingMode: tenant.routingMode,
    instancesCount: cfg.instances.length,
    hasSingleToken: Boolean(cfg.singleToken),
    singleTokenMasked: maskToken(cfg.singleToken),
    hasJosiToken: Boolean(cfg.josiToken),
    hasSergioToken: Boolean(cfg.sergioToken),
    josiTokenMasked: maskToken(cfg.josiToken),
    sergioTokenMasked: maskToken(cfg.sergioToken),
    lastSyncAt: meta.lastSyncAt || null,
    lastError: meta.lastError || null,
    recoveredCount: meta.recoveredCount || 0,
    updatedCount: meta.updatedCount || 0,
    checkedMessagesCount: meta.checkedMessagesCount || 0,
    instanceStatuses: Array.isArray(meta.instanceStatuses) ? meta.instanceStatuses : [],
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

async function checkUazapiInstanceStatus(
  baseUrl: string,
  name: string,
  token: string
): Promise<UazapiInstanceStatusMeta> {
  try {
    const res = await fetch(`${baseUrl}/instance/status`, {
      method: "GET",
      headers: { token },
      signal: AbortSignal.timeout(4000),
    });

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const rawStatus = String(
        data?.instance?.status || data?.status?.state || data?.status || data?.state || ""
      ).toLowerCase();
      const connectedFlag =
        data?.status?.connected ??
        data?.connected ??
        data?.status?.loggedIn ??
        data?.loggedIn ??
        (rawStatus === "open" || rawStatus === "connected"
          ? true
          : rawStatus === "close" || rawStatus === "disconnected"
            ? false
            : null);
      const phone = String(
        data?.instance?.owner || data?.instance?.phone || data?.owner || data?.status?.jid || ""
      ).replace(/\D/g, "");

      return {
        name,
        connected: connectedFlag === null ? null : Boolean(connectedFlag),
        state:
          connectedFlag === true
            ? "Conectada"
            : connectedFlag === false
              ? "Desconectada"
              : rawStatus || "Desconhecido",
        phone: phone || undefined,
        error: null,
      };
    }

    if (res.status === 401 || res.status === 403) {
      return { name, connected: false, state: "Token inválido", error: `HTTP ${res.status}` };
    }
  } catch (err: any) {
    return { name, connected: null, state: "Erro de rede", error: err?.message || "Falha de conexão" };
  }

  return { name, connected: null, state: "Sem status", error: null };
}

async function fetchUazapiRecentMessages(
  baseUrl: string,
  token: string,
  deep = false
): Promise<{
  ok: boolean;
  messages: any[];
  chats: any[];
  error?: string;
}> {
  const parseList = (payload: any): any[] => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.messages)) return payload.messages;
    if (Array.isArray(payload?.chats)) return payload.chats;
    return [];
  };

  const aggregated: any[] = [];
  const discoveredChats: any[] = [];
  const seenKeys = new Set<string>();
  const addMessages = (list: any[]) => {
    for (const m of list) {
      const mid = String(m?.messageid || m?.id || m?.key?.id || "");
      const dedupKey =
        mid ||
        `${m?.chatid || m?.wa_chatid || m?._chatId || ""}_${m?.messageTimestamp || ""}_${String(m?.text || m?.conversation || "").slice(0, 24)}`;
      if (seenKeys.has(dedupKey)) continue;
      seenKeys.add(dedupKey);
      aggregated.push(m);
    }
  };

  let anyEndpointSucceeded = false;
  let lastError: string | undefined;

  try {
    try {
      const msgRes = await fetch(`${baseUrl}/message/find`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token },
        body: JSON.stringify({ limit: deep ? 150 : 60 }),
        signal: AbortSignal.timeout(5000),
      });

      if (msgRes.ok) {
        anyEndpointSucceeded = true;
        const msgPayload = await msgRes.json().catch(() => null);
        addMessages(parseList(msgPayload));
      } else {
        lastError = `message/find HTTP ${msgRes.status}`;
      }
    } catch (err: any) {
      lastError = err?.message || "Falha em /message/find";
    }

    try {
      const chatRes = await fetch(`${baseUrl}/chat/find`, {
        method: "POST",
        headers: { "Content-Type": "application/json", token },
        body: JSON.stringify({ limit: deep ? 50 : 20 }),
        signal: AbortSignal.timeout(5000),
      });

      if (chatRes.ok) {
        anyEndpointSucceeded = true;
        const chatPayload = await chatRes.json().catch(() => null);
        const allChats = parseList(chatPayload).filter((chat: any) => {
          const cid = String(chat?.wa_chatid || chat?.chatid || chat?.id || "");
          return cid && !cid.includes("@g.us") && !cid.includes("status@broadcast") && chat?.wa_isGroup !== true;
        });

        discoveredChats.push(...allChats);
        const chatsToInspect = allChats.slice(0, deep ? 50 : 15);
        const batchSize = 5;

        for (let i = 0; i < chatsToInspect.length; i += batchSize) {
          const batch = chatsToInspect.slice(i, i + batchSize);
          await Promise.all(
            batch.map(async (chat: any) => {
              const chatId = chat?.wa_chatid || chat?.chatid || chat?.id;
              if (!chatId) return;
              const chatLabels = extractUazapiChatLabels(chat);
              try {
                const perChatRes = await fetch(`${baseUrl}/message/find`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", token },
                  body: JSON.stringify({ wa_chatid: chatId, chatid: chatId, limit: deep ? 80 : 25 }),
                  signal: AbortSignal.timeout(4000),
                });
                if (perChatRes.ok) {
                  const perChatPayload = await perChatRes.json().catch(() => null);
                  const msgs = parseList(perChatPayload).map((m) => ({
                    ...m,
                    _chatName: chat?.name || chat?.wa_name || m?.pushName || m?.senderName,
                    _chatId: chatId,
                    _chatWaChatId: chat?.wa_chatid || undefined,
                    _chatPhone: chat?.phone || chat?.wa_fastid || undefined,
                    _chatLabels: chatLabels,
                  }));
                  addMessages(msgs);
                }
              } catch {}
            })
          );
        }
      } else if (!anyEndpointSucceeded) {
        lastError = `Uazapi HTTP ${chatRes.status}`;
      }
    } catch (err: any) {
      if (!anyEndpointSucceeded) {
        lastError = err?.message || "Falha de conexão com Uazapi";
      }
    }

    if (!anyEndpointSucceeded) {
      return { ok: false, messages: [], chats: [], error: lastError || "Uazapi indisponível" };
    }

    return { ok: true, messages: aggregated, chats: discoveredChats };
  } catch (err: any) {
    return { ok: false, messages: [], chats: [], error: err?.message || "Falha de conexão com Uazapi" };
  }
}

async function autoReconcileUazapiIfConfigured(
  tenant: GoogleTenantConfig,
  force = false
): Promise<UazapiSyncMeta & { configured: boolean }> {
  const cfg = getTenantResolvedUazapi(tenant);
  const prevMeta = readUazapiSyncMeta(tenant.slug);

  if (cfg.source === "none") {
    return { ...prevMeta, configured: false };
  }

  if (!force && prevMeta.lastSyncAt) {
    const elapsed = Date.now() - new Date(prevMeta.lastSyncAt).getTime();
    if (elapsed < 3 * 60 * 1000) {
      return { ...prevMeta, configured: true };
    }
  }

  const leads = readTenantLeads(tenant.slug, tenant);
  const rules: TenantConversionRules = readTenantRules(tenant.slug);
  const processedIds = readProcessedMessageIds(tenant.slug);
  let leadsChanged = false;
  let processedChanged = false;
  let recoveredCount = 0;
  let updatedCount = 0;
  let checkedMessagesCount = 0;
  let lastError: string | null = null;
  const instanceStatuses: UazapiInstanceStatusMeta[] = [];

  for (const inst of cfg.instances) {
    const statusInfo = await checkUazapiInstanceStatus(cfg.baseUrl, inst.name, inst.token);
    const res = await fetchUazapiRecentMessages(cfg.baseUrl, inst.token, force);

    let instRecovered = 0;
    let instUpdated = 0;
    let instChecked = 0;

    if (!res.ok) {
      const errText = `${inst.name}: ${res.error}`;
      lastError = lastError ? `${lastError} | ${errText}` : errText;
      instanceStatuses.push({
        ...statusInfo,
        checkedMessages: 0,
        recovered: 0,
        updated: 0,
        error: res.error || statusInfo.error || null,
      });
      continue;
    }

    const ordered = [...res.messages].sort(
      (a, b) => parseUazapiTimestampMs(a) - parseUazapiTimestampMs(b)
    );

    for (const msg of ordered) {
      checkedMessagesCount++;
      instChecked++;

      const rawChatGroupCheck = String(
        msg?.chatid || msg?.wa_chatid || msg?._chatId || msg?.sender || msg?.sender_pn || ""
      );
      if (
        !rawChatGroupCheck ||
        rawChatGroupCheck.includes("@g.us") ||
        rawChatGroupCheck.includes("status@broadcast") ||
        msg?.isGroup === true
      ) {
        continue;
      }

      const cleanPhone = extractCleanPhoneFromCandidates([
        msg?.sender_pn,
        msg?.key?.senderPn,
        msg?._chatPhone,
        msg?.wa_chatid,
        msg?._chatWaChatId,
        msg?._chatId,
        msg?.key?.remoteJid,
        msg?.chatid,
        msg?.sender,
        msg?.phone,
      ]);
      if (!cleanPhone || isTenantAttendantPhone(tenant, cleanPhone)) continue;

      const messageId = String(msg?.messageid || msg?.id || msg?.key?.id || "").trim();
      if (messageId && processedIds.includes(messageId)) continue;

      const text = String(
        msg?.text ||
          msg?.conversation ||
          (typeof msg?.content === "string" ? msg.content : msg?.content?.text) ||
          msg?.extendedTextMessage?.text ||
          ""
      );

      const fromMe = Boolean(msg?.fromMe ?? msg?.key?.fromMe ?? false);
      const tsMs = parseUazapiTimestampMs(msg);
      const msgIso = tsMs > 0 ? new Date(tsMs).toISOString() : new Date().toISOString();

      if (!fromMe) {
        const tracking = text ? extractTrackingTag(text) : null;
        if (tracking?.gclid) {
          const gclid = tracking.gclid;
          const idx = leads.findIndex(
            (l: any) => l.gclid === gclid || (l.id && l.id.includes(gclid.slice(0, 15)))
          );
          const pushName = msg?._chatName || msg?.pushName || msg?.senderName || "";

          if (idx !== -1) {
            if (
              !leads[idx].firstMessageAt ||
              /aguardando/i.test(String(leads[idx].leadPhone || "")) ||
              leads[idx].stage === "clique_anuncio"
            ) {
              leads[idx].leadPhone = cleanPhone;
              if (pushName) leads[idx].leadName = pushName;
              if (leads[idx].stage !== "orcamento_enviado" && leads[idx].stage !== "compra_realizada") {
                leads[idx].stage = "conversa_iniciada";
                leads[idx].conversionType = "conversa_iniciada";
              }
              if (!leads[idx].firstMessageAt) leads[idx].firstMessageAt = msgIso;
              leads[idx].updatedAt = new Date().toISOString();
              if (tracking.keyword) leads[idx].keyword = tracking.keyword;
              if (tracking.campaign) leads[idx].campaign = tracking.campaign;
              if (tracking.adGroup) leads[idx].adGroup = tracking.adGroup;
              leads[idx].recoveredFromUazapi = true;
              leadsChanged = true;
              updatedCount++;
              instUpdated++;
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
            instRecovered++;

            appendTenantAudit(tenant.slug, {
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
        } else if (tsMs > 0) {
          const alreadyLinked = leads.some((existing: any) => isSamePhone(existing.leadPhone, cleanPhone));
          if (!alreadyLinked) {
            let bestPendingIdx = -1;
            let bestDelta = Infinity;

            for (let i = 0; i < leads.length; i++) {
              const l = leads[i];
              const isPending =
                !l.firstMessageAt ||
                /aguardando/i.test(String(l.leadPhone || "")) ||
                isTenantAttendantPhone(tenant, l.leadPhone);
              if (!isPending) continue;

              const attendantNorm = normalizeText(l.attendantName || "");
              const instNorm = normalizeText(inst.name);
              const sameAttendant =
                tenant.routingMode === "single" ||
                (attendantNorm.includes("josi") && instNorm.includes("josi")) ||
                (attendantNorm.includes("sergio") && instNorm.includes("sergio")) ||
                attendantNorm === instNorm;
              if (!sameAttendant) continue;

              const clickMs = new Date(l.occurredAt || 0).getTime();
              if (isNaN(clickMs) || clickMs <= 0) continue;

              const delta = tsMs - clickMs;
              if (delta >= -60 * 1000 && delta <= 30 * 60 * 1000 && Math.abs(delta) < bestDelta) {
                bestDelta = Math.abs(delta);
                bestPendingIdx = i;
              }
            }

            if (bestPendingIdx !== -1) {
              const pushName = msg?._chatName || msg?.pushName || msg?.senderName || "";
              leads[bestPendingIdx].leadPhone = cleanPhone;
              if (pushName) leads[bestPendingIdx].leadName = pushName;
              if (
                leads[bestPendingIdx].stage !== "orcamento_enviado" &&
                leads[bestPendingIdx].stage !== "compra_realizada"
              ) {
                leads[bestPendingIdx].stage = "conversa_iniciada";
                leads[bestPendingIdx].conversionType = "conversa_iniciada";
              }
              leads[bestPendingIdx].firstMessageAt = msgIso;
              leads[bestPendingIdx].updatedAt = new Date().toISOString();
              leads[bestPendingIdx].recoveredFromUazapi = true;
              leadsChanged = true;
              updatedCount++;
              instUpdated++;

              appendTenantAudit(tenant.slug, {
                id: `audit_uazapi_temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                leadPhone: cleanPhone,
                leadName: pushName || "Cliente WhatsApp",
                action: "conversa_iniciada",
                detectedPhrase: `Recuperação Uazapi (Janela 30min): "${(text || "Mídia/Áudio").slice(0, 45)}"`,
                attendant: inst.name,
                gclid: leads[bestPendingIdx].gclid,
                timestamp: msgIso,
                statusOci: leads[bestPendingIdx].status || "queued",
              });

              if (messageId && !processedIds.includes(messageId)) {
                processedIds.unshift(messageId);
                processedChanged = true;
              }
            }
          }
        }
      } else if (text) {
        const leadIdx = leads.findIndex((l: any) => isSamePhone(l.leadPhone, cleanPhone));
        if (leadIdx !== -1) {
          const matchedPurchase = matchDynamicPhrase(text, rules.purchase.phrases);
          const matchedQuote = matchDynamicPhrase(text, rules.quote.phrases);

          if (matchedPurchase && leads[leadIdx].stage !== "compra_realizada") {
            const val = extractMonetaryValue(text);
            if (!leads[leadIdx].firstMessageAt) leads[leadIdx].firstMessageAt = msgIso;
            leads[leadIdx].stage = "compra_realizada";
            leads[leadIdx].conversionType = "compra_realizada";
            if (val !== null) leads[leadIdx].value = val;
            leads[leadIdx].purchasedAt = msgIso;
            leads[leadIdx].triggerPhrase = text;
            leads[leadIdx].matchedRulePhrase = matchedPurchase;
            leads[leadIdx].updatedAt = new Date().toISOString();
            leadsChanged = true;
            updatedCount++;
            instUpdated++;

            appendTenantAudit(tenant.slug, {
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
            if (!leads[leadIdx].firstMessageAt) leads[leadIdx].firstMessageAt = msgIso;
            leads[leadIdx].stage = "orcamento_enviado";
            leads[leadIdx].conversionType = "orcamento_enviado";
            leads[leadIdx].quotedAt = msgIso;
            leads[leadIdx].triggerPhrase = text;
            leads[leadIdx].matchedRulePhrase = matchedQuote;
            leads[leadIdx].updatedAt = new Date().toISOString();
            leadsChanged = true;
            updatedCount++;
            instUpdated++;

            appendTenantAudit(tenant.slug, {
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

    // PASSO M1: Reconciliação também por Etiquetas do WhatsApp Business (wa_label) nos chats encontrados
    if ((rules.purchase.labels.length > 0 || rules.quote.labels.length > 0) && res.chats.length > 0) {
      for (const chat of res.chats) {
        const chatLabels = extractUazapiChatLabels(chat);
        if (chatLabels.length === 0) continue;

        const cleanPhone = extractCleanPhoneFromCandidates([
          chat?.phone,
          chat?.wa_fastid,
          chat?.wa_chatid,
          chat?.chatid,
          chat?.id,
        ]);
        if (!cleanPhone || isTenantAttendantPhone(tenant, cleanPhone)) continue;

        const leadIdx = leads.findIndex((l: any) => isSamePhone(l.leadPhone, cleanPhone));
        if (leadIdx === -1) continue;

        const matchedPurchaseLabel = matchRuleLabel(chatLabels, rules.purchase.labels);
        const matchedQuoteLabel = matchRuleLabel(chatLabels, rules.quote.labels);
        const nowIso = new Date().toISOString();

        if (matchedPurchaseLabel && leads[leadIdx].stage !== "compra_realizada") {
          if (!leads[leadIdx].firstMessageAt) leads[leadIdx].firstMessageAt = nowIso;
          leads[leadIdx].stage = "compra_realizada";
          leads[leadIdx].conversionType = "compra_realizada";
          leads[leadIdx].purchasedAt = leads[leadIdx].purchasedAt || nowIso;
          leads[leadIdx].matchedRuleLabel = matchedPurchaseLabel;
          leads[leadIdx].updatedAt = nowIso;
          leadsChanged = true;
          updatedCount++;
          instUpdated++;

          appendTenantAudit(tenant.slug, {
            id: `audit_label_buy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            leadPhone: leads[leadIdx].leadPhone,
            leadName: leads[leadIdx].leadName || "Cliente WhatsApp",
            action: "compra_realizada",
            value: leads[leadIdx].value || 0,
            detectedPhrase: `Etiqueta WhatsApp Business: "${matchedPurchaseLabel}"`,
            attendant: inst.name,
            gclid: leads[leadIdx].gclid,
            timestamp: nowIso,
            statusOci: leads[leadIdx].status || "queued",
          });
        } else if (
          matchedQuoteLabel &&
          leads[leadIdx].stage !== "orcamento_enviado" &&
          leads[leadIdx].stage !== "compra_realizada"
        ) {
          if (!leads[leadIdx].firstMessageAt) leads[leadIdx].firstMessageAt = nowIso;
          leads[leadIdx].stage = "orcamento_enviado";
          leads[leadIdx].conversionType = "orcamento_enviado";
          leads[leadIdx].quotedAt = leads[leadIdx].quotedAt || nowIso;
          leads[leadIdx].matchedRuleLabel = matchedQuoteLabel;
          leads[leadIdx].updatedAt = nowIso;
          leadsChanged = true;
          updatedCount++;
          instUpdated++;

          appendTenantAudit(tenant.slug, {
            id: `audit_label_quote_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            leadPhone: leads[leadIdx].leadPhone,
            leadName: leads[leadIdx].leadName || "Cliente WhatsApp",
            action: "orcamento_enviado",
            detectedPhrase: `Etiqueta WhatsApp Business: "${matchedQuoteLabel}"`,
            attendant: inst.name,
            gclid: leads[leadIdx].gclid,
            timestamp: nowIso,
            statusOci: leads[leadIdx].status || "queued",
          });
        }
      }
    }

    instanceStatuses.push({
      ...statusInfo,
      checkedMessages: instChecked,
      recovered: instRecovered,
      updated: instUpdated,
      error: statusInfo.error || null,
    });
  }

  if (leadsChanged) writeTenantLeads(tenant.slug, leads);
  if (processedChanged) writeProcessedMessageIds(tenant.slug, processedIds);

  const meta: UazapiSyncMeta = {
    lastSyncAt: new Date().toISOString(),
    lastError,
    recoveredCount: (prevMeta.recoveredCount || 0) + recoveredCount,
    updatedCount: (prevMeta.updatedCount || 0) + updatedCount,
    checkedMessagesCount,
    instanceStatuses,
  };
  writeUazapiSyncMeta(tenant.slug, meta);
  return { ...meta, configured: true };
}

// =========================================================================
// GOOGLE ADS API v25/v26 AUTO-DISCOVERY (MULTI-CONTA POR MCC)
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

async function autoSyncEntitiesFromGoogleAds(
  tenant: GoogleTenantConfig,
  forceRefresh = false
): Promise<{
  map: Record<string, string>;
  meta: EntitiesSyncMeta;
}> {
  const map = readEntitiesMap(tenant.slug);
  const prevMeta = readEntitiesMeta(tenant);
  const customerId = String(tenant.googleCustomerId || "").replace(/\D/g, "");
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  const missingEnv = getMissingGoogleAdsEnvVars();
  const nowMs = Date.now();

  if (!customerId) {
    const meta: EntitiesSyncMeta = {
      ...prevMeta,
      apiConnected: false,
      customerId: "",
      lastAttemptAt: new Date().toISOString(),
      lastError: `Customer ID do Google Ads não configurado para o cliente "${tenant.name}".`,
    };
    writeEntitiesMeta(tenant.slug, meta);
    return { map, meta };
  }

  if (!devToken || missingEnv.length > 0) {
    const missingList = missingEnv.length > 0 ? missingEnv : ["GOOGLE_ADS_DEVELOPER_TOKEN"];
    const meta: EntitiesSyncMeta = {
      ...prevMeta,
      apiConnected: false,
      customerId,
      lastAttemptAt: new Date().toISOString(),
      lastError: `Variáveis ausentes no runtime do container web (Dokploy): ${missingList.join(", ")}.`,
    };
    writeEntitiesMeta(tenant.slug, meta);
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
    writeEntitiesMeta(tenant.slug, meta);
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

    if (
      !res.ok &&
      (res.status === 404 || (res.errorText && /UNSUPPORTED_VERSION|deprecated|sunset/i.test(res.errorText)))
    ) {
      lastError = `Versão ${version} indisponível (${res.status})`;
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
    writeEntitiesMeta(tenant.slug, meta);
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

  writeEntitiesMap(tenant.slug, map);
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
  writeEntitiesMeta(tenant.slug, meta);

  return { map, meta };
}

async function autoEnrichLeadsViaClickView(
  tenant: GoogleTenantConfig,
  leads: any[],
  meta: EntitiesSyncMeta,
  entities: Record<string, string>
): Promise<{ leads: any[]; enrichedCount: number }> {
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  const missingEnv = getMissingGoogleAdsEnvVars();
  const customerId = String(tenant.googleCustomerId || "").replace(/\D/g, "");
  if (!devToken || missingEnv.length > 0 || !meta.apiConnected || !customerId) {
    return { leads, enrichedCount: 0 };
  }

  let lastClickViewRunMs = 0;
  try {
    const cvMetaPath = getTenantFilePath(tenant.slug, "clickview_meta");
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
    return ageDays >= 0.04 && ageDays <= 89;
  });

  if (candidates.length === 0) return { leads, enrichedCount: 0 };

  const oauth = await getGoogleAdsAccessToken();
  if (!oauth.token) return { leads, enrichedCount: 0 };

  try {
    writeJsonAtomic(getTenantFilePath(tenant.slug, "clickview_meta"), {
      lastRunMs: nowMs,
      lastRunAt: new Date().toISOString(),
    });
  } catch {}

  const version = meta.apiVersionUsed || getActiveApiVersions()[0];
  const loginCustomerId =
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/\D/g, "") || meta.loginCustomerIdUsed;

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

  if (entitiesChanged) writeEntitiesMap(tenant.slug, entities);
  if (leadsChanged) writeTenantLeads(tenant.slug, leads);
  return { leads, enrichedCount };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const clientParam = searchParams.get("client");
  const tenant = resolveRequestTenant(clientParam);

  if (!tenant) {
    return NextResponse.json({ error: `Cliente "${clientParam}" não encontrado.` }, { status: 404 });
  }

  if (type === "audits") {
    return NextResponse.json(readTenantAudits(tenant.slug), {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  }

  if (type === "rules") {
    return NextResponse.json(readTenantRules(tenant.slug), {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  }

  if (type === "entities") {
    return NextResponse.json(readEntitiesMap(tenant.slug), {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  }

  if (type === "entities_status") {
    const entities = readEntitiesMap(tenant.slug);
    const meta = readEntitiesMeta(tenant);
    const leads = readTenantLeads(tenant.slug, tenant);
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
        uazapiStatus: getUazapiPublicStatus(tenant),
        entities,
        tenant: {
          slug: tenant.slug,
          name: tenant.name,
          routingMode: tenant.routingMode,
          googleCustomerId: tenant.googleCustomerId,
          attendantsCount: tenant.attendants.length,
        },
        tenantsCount: listTenants().length,
      },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  }

  try {
    await autoReconcileUazapiIfConfigured(tenant, false);
  } catch {}

  let leads = readTenantLeads(tenant.slug, tenant);
  let entities = readEntitiesMap(tenant.slug);

  const hasUnmappedNumeric = leads.some(
    (l: any) =>
      (l.campaign && /^\d+$/.test(String(l.campaign).trim()) && !entities[String(l.campaign).trim()]) ||
      (l.adGroup && /^\d+$/.test(String(l.adGroup).trim()) && !entities[String(l.adGroup).trim()])
  );

  let meta = readEntitiesMeta(tenant);
  const isCacheExpired =
    !meta.lastSyncAt || Date.now() - new Date(meta.lastSyncAt).getTime() > 15 * 60 * 1000;

  if (hasUnmappedNumeric || isCacheExpired) {
    try {
      const synced = await autoSyncEntitiesFromGoogleAds(tenant, false);
      entities = synced.map;
      meta = synced.meta;
    } catch {}
  }

  try {
    const cvResult = await autoEnrichLeadsViaClickView(tenant, leads, meta, entities);
    leads = cvResult.leads;
  } catch {}

  const enriched = leads.map((l: any) => {
    const rawCamp = String(l.campaign || "").trim();
    const rawAdGrp = String(l.adGroup || "").trim();
    const rawPhone = String(l.leadPhone || "").trim();
    const waitingWpp =
      !l.firstMessageAt && (!rawPhone || /aguardando/i.test(rawPhone) || isTenantAttendantPhone(tenant, rawPhone));
    const normalizedStage =
      l.stage === "orcamento_enviado" || l.stage === "compra_realizada"
        ? l.stage
        : waitingWpp || l.stage === "clique_anuncio"
          ? "clique_anuncio"
          : "conversa_iniciada";

    return {
      ...l,
      stage: normalizedStage,
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
    const { searchParams } = new URL(request.url);
    const body = await request.json();
    const clientParam = searchParams.get("client") || body.clientSlug || body.client || null;
    const tenant = resolveRequestTenant(clientParam);

    if (!tenant) {
      return NextResponse.json({ error: `Cliente "${clientParam}" não encontrado.` }, { status: 404 });
    }

    if (body.action === "sync_catalog" || body.action === "sync_entities_api") {
      const { map, meta } = await autoSyncEntitiesFromGoogleAds(tenant, true);
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
      const syncResult = await autoReconcileUazapiIfConfigured(tenant, true);
      return NextResponse.json({
        success: !syncResult.lastError,
        ...syncResult,
        uazapiStatus: getUazapiPublicStatus(tenant),
      });
    }

    if (body.type === "save_uazapi_config") {
      const prevCfg = readJsonSafe<any>(getTenantFilePath(tenant.slug, "uazapi_config"), {});
      const baseUrl = normalizeUazapiBaseUrl(String(body.baseUrl || tenant.uazapi?.baseUrl || prevCfg.baseUrl || ""));

      const nextSingle =
        body.clearSingleToken === true
          ? ""
          : String(body.singleToken || "").trim() && !String(body.singleToken).includes("••••")
            ? String(body.singleToken).trim()
            : tenant.uazapi?.singleToken || prevCfg.singleToken || "";

      const nextJosi =
        body.clearJosiToken === true
          ? ""
          : String(body.josiToken || "").trim() && !String(body.josiToken).includes("••••")
            ? String(body.josiToken).trim()
            : tenant.uazapi?.josiToken || prevCfg.josiToken || "";

      const nextSergio =
        body.clearSergioToken === true
          ? ""
          : String(body.sergioToken || "").trim() && !String(body.sergioToken).includes("••••")
            ? String(body.sergioToken).trim()
            : tenant.uazapi?.sergioToken || prevCfg.sergioToken || "";

      const payload = {
        baseUrl,
        singleToken: nextSingle || undefined,
        josiToken: nextJosi || undefined,
        sergioToken: nextSergio || undefined,
        updatedAt: new Date().toISOString(),
      };
      writeJsonAtomic(getTenantFilePath(tenant.slug, "uazapi_config"), payload);

      const updatedAttendants = tenant.attendants.map((att, idx) => {
        if (tenant.routingMode === "single" && idx === 0) {
          return { ...att, uazapiToken: nextSingle || undefined };
        }
        if (tenant.routingMode === "roulette" && idx === 0) {
          return { ...att, uazapiToken: nextJosi || undefined };
        }
        if (tenant.routingMode === "roulette" && idx === 1) {
          return { ...att, uazapiToken: nextSergio || undefined };
        }
        return att;
      });

      const updatedTenant = upsertTenant({
        ...tenant,
        attendants: updatedAttendants,
        uazapi: payload,
      });

      const syncResult = await autoReconcileUazapiIfConfigured(updatedTenant, true);
      return NextResponse.json({
        success: true,
        uazapiStatus: getUazapiPublicStatus(updatedTenant),
        syncResult,
      });
    }

    if (body.action === "save_entities" || body.type === "save_entities") {
      const current = readEntitiesMap(tenant.slug);
      const updated = { ...current, ...(body.entities || {}) };
      writeEntitiesMap(tenant.slug, updated);
      return NextResponse.json({ success: true, entities: updated, message: "Nomes reais vinculados com sucesso!" });
    }

    if (body.type === "save_rules" && body.rules) {
      const saved = writeTenantRules(tenant.slug, body.rules);
      return NextResponse.json({ success: true, rules: saved, message: "Regras salvas com sucesso!" });
    }

    return NextResponse.json({ error: "Ação não reconhecida" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro ao processar POST" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const body = await request.json();
    const clientParam = searchParams.get("client") || body.clientSlug || body.client || null;
    const tenant = resolveRequestTenant(clientParam);

    if (!tenant) {
      return NextResponse.json({ error: `Cliente "${clientParam}" não encontrado.` }, { status: 404 });
    }

    const { id, stage, value, attendantName } = body;
    if (!id) {
      return NextResponse.json({ error: "ID do lead é obrigatório" }, { status: 400 });
    }

    const leads = readTenantLeads(tenant.slug, tenant);
    const index = leads.findIndex((l: any) => l.id === id);

    if (index === -1) {
      return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });
    }

    const prevStage = leads[index].stage;
    const prevValue = Number(leads[index].value || 0);
    const sentPurchase = leads[index].sentStages?.compra_realizada;

    if (stage) {
      leads[index].stage = stage;
      leads[index].conversionType = stage;
      if (stage !== "clique_anuncio" && !leads[index].firstMessageAt) {
        leads[index].firstMessageAt = new Date().toISOString();
      }
    }
    if (value !== undefined) leads[index].value = Number(value);
    if (attendantName) leads[index].attendantName = attendantName;
    leads[index].updatedAt = new Date().toISOString();

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

    writeTenantLeads(tenant.slug, leads);
    return NextResponse.json({ success: true, lead: leads[index] });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clientParam = searchParams.get("client");
    const tenant = resolveRequestTenant(clientParam);

    if (!tenant) {
      return NextResponse.json({ error: `Cliente "${clientParam}" não encontrado.` }, { status: 404 });
    }

    const id = searchParams.get("id");
    const action = searchParams.get("action");

    let leads = readTenantLeads(tenant.slug, tenant);

    if (action === "clean_attendants") {
      const originalCount = leads.length;
      leads = leads.filter((l: any) => !isTenantAttendantPhone(tenant, l.leadPhone));
      writeTenantLeads(tenant.slug, leads);
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
    writeTenantLeads(tenant.slug, leads);

    return NextResponse.json({ success: true, message: "Lead removido com sucesso!" });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro ao excluir lead" }, { status: 500 });
  }
}

import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * PASSO M1 — MOTOR CENTRAL MULTI-CLIENTE GOOGLE ADS (100% ISOLADO DA META ADS)
 * Caminho no GitHub: apps/web/src/lib/google-tenants.ts
 *
 * Responsabilidades:
 * - Gerenciar clientes (tenants) em /data/alpha_google_tenants.json
 * - Isolar dados de cada cliente em /data/tenants/<slug>/ (sem "cnac" no caminho mestre)
 * - Migrar automaticamente os dados existentes da CNAC para /data/tenants/cnac/ na primeira execução
 * - Manter ponte segura de leitura/escrita com /data/alpha_google_*.json para CNAC durante transição M1 -> M2
 * - Suportar regras próprias por cliente com Palavras-Chave/Frases + Etiquetas do WhatsApp Business (Uazapi)
 * - Prover utilitários de autenticação isolada (scrypt + HMAC) e sanitização para o Portal do Cliente (Passo M4)
 */

export type RoutingMode = "single" | "roulette";

export interface TenantAttendant {
  id: string;
  name: string;
  phone: string;
  uazapiToken?: string;
  active: boolean;
}

export interface TenantUazapiConfig {
  baseUrl: string;
  singleToken?: string;
  josiToken?: string;
  sergioToken?: string;
  updatedAt?: string;
}

export interface TenantConversionRules {
  quote: {
    actionName: string;
    phrases: string[];
    labels: string[];
  };
  purchase: {
    actionName: string;
    phrases: string[];
    labels: string[];
  };
}

export interface TenantClientUser {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  active: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface GoogleTenantConfig {
  slug: string;
  name: string;
  active: boolean;
  googleCustomerId: string;
  routingMode: RoutingMode;
  initialMessage: string;
  attendants: TenantAttendant[];
  uazapi: TenantUazapiConfig;
  clientAccess?: {
    enabled: boolean;
    users: TenantClientUser[];
  };
  createdAt: string;
  updatedAt: string;
}

export type TenantFileKey =
  | "leads"
  | "audits"
  | "rules"
  | "entities_map"
  | "entities_meta"
  | "uazapi_config"
  | "uazapi_meta"
  | "processed_messages"
  | "clickview_meta"
  | "oci_sent_index"
  | "oci_actions_map"
  | "oci_diagnostics"
  | "reports_bi_cache"
  | "roulette_state";

const TENANT_FILENAMES: Record<TenantFileKey, string> = {
  leads: "leads.json",
  audits: "audits.json",
  rules: "rules.json",
  entities_map: "entities_map.json",
  entities_meta: "entities_meta.json",
  uazapi_config: "uazapi_config.json",
  uazapi_meta: "uazapi_meta.json",
  processed_messages: "processed_messages.json",
  clickview_meta: "clickview_meta.json",
  oci_sent_index: "oci_sent_index.json",
  oci_actions_map: "oci_actions_map.json",
  oci_diagnostics: "oci_diagnostics.json",
  reports_bi_cache: "reports_bi_cache.json",
  roulette_state: "roulette_state.json",
};

const LEGACY_ROOT_FILENAMES: Partial<Record<TenantFileKey, string>> = {
  leads: "alpha_google_leads.json",
  audits: "alpha_google_conversion_audits.json",
  rules: "alpha_google_conversion_rules.json",
  entities_map: "alpha_google_entities_map.json",
  entities_meta: "alpha_google_entities_meta.json",
  uazapi_config: "alpha_google_uazapi_config.json",
  uazapi_meta: "alpha_google_uazapi_meta.json",
  processed_messages: "alpha_google_processed_messages.json",
  clickview_meta: "alpha_google_clickview_meta.json",
  oci_sent_index: "alpha_google_oci_sent_index.json",
  oci_actions_map: "alpha_google_oci_actions_map.json",
  oci_diagnostics: "alpha_google_oci_diagnostics.json",
  reports_bi_cache: "alpha_google_reports_bi_cache.json",
};

export const DEFAULT_TENANT_RULES: TenantConversionRules = {
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
    labels: [],
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
    labels: [],
  },
};

export function getStorageDir(): string {
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

export function ensureDirExists(dirPath: string): void {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  } catch {}
}

export function writeJsonAtomic(filePath: string, payload: unknown): void {
  ensureDirExists(path.dirname(filePath));
  const json = JSON.stringify(payload, null, 2);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
  fs.writeFileSync(tmpPath, json, "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function readJsonSafe<T>(primaryPath: string, defaultValue: T, fallbackPath?: string | null): T {
  try {
    if (fs.existsSync(primaryPath)) {
      return JSON.parse(fs.readFileSync(primaryPath, "utf8")) as T;
    }
    if (fallbackPath && fs.existsSync(fallbackPath)) {
      return JSON.parse(fs.readFileSync(fallbackPath, "utf8")) as T;
    }
  } catch {}
  return defaultValue;
}

export function sanitizeTenantSlug(raw: string): string {
  return String(raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function normalizeText(text: string): string {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeUazapiBaseUrl(rawUrl: string): string {
  let clean = String(rawUrl || "").trim().replace(/\/+$/, "");
  if (!clean) return "";
  if (!/^https?:\/\//i.test(clean)) {
    clean = `https://${clean}`;
  }
  return clean.replace(/\/+$/, "");
}

export function normalizeBrazilianPhone(rawPhone: string): string {
  let digits = String(rawPhone || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return "";
  if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`;
  }
  return digits;
}

export function hasValidBrazilianDdi(rawPhone: string): boolean {
  const digits = String(rawPhone || "").replace(/\D/g, "");
  return digits.startsWith("55") && (digits.length === 12 || digits.length === 13);
}

export function isSamePhone(p1: string, p2: string): boolean {
  const c1 = String(p1 || "").replace(/\D/g, "");
  const c2 = String(p2 || "").replace(/\D/g, "");
  if (!c1 || !c2) return false;
  if (c1 === c2) return true;
  if (c1.length >= 8 && c2.length >= 8) {
    return c1.slice(-8) === c2.slice(-8);
  }
  return false;
}

export function getTenantsRegistryPath(): string {
  return path.join(getStorageDir(), "alpha_google_tenants.json");
}

export function getTenantDir(slug: string): string {
  const safe = sanitizeTenantSlug(slug) || "cnac";
  const dir = path.join(getStorageDir(), "tenants", safe);
  ensureDirExists(dir);
  return dir;
}

export function getTenantFilePath(slug: string, key: TenantFileKey): string {
  return path.join(getTenantDir(slug), TENANT_FILENAMES[key]);
}

function getLegacyRootFilePath(key: TenantFileKey): string | null {
  const name = LEGACY_ROOT_FILENAMES[key];
  if (!name) return null;
  return path.join(getStorageDir(), name);
}

function getLegacyTmpFilePath(key: TenantFileKey): string | null {
  const name = LEGACY_ROOT_FILENAMES[key];
  if (!name) return null;
  return path.join("/tmp", name);
}

function buildDefaultCnacTenant(): GoogleTenantConfig {
  const storageDir = getStorageDir();
  const legacyUazapiPath = path.join(storageDir, "alpha_google_uazapi_config.json");
  const legacyUazapi = readJsonSafe<any>(legacyUazapiPath, {});

  const josiPhone = normalizeBrazilianPhone(process.env.CNAC_ATTENDANT_1_PHONE || "5521980659269");
  const sergioPhone = normalizeBrazilianPhone(process.env.CNAC_ATTENDANT_2_PHONE || "5521994060206");

  const josiToken = String(
    process.env.GOOGLE_ADS_UAZAPI_TOKEN_JOSI || process.env.UAZAPI_TOKEN_JOSI || legacyUazapi?.josiToken || ""
  ).trim();
  const sergioToken = String(
    process.env.GOOGLE_ADS_UAZAPI_TOKEN_SERGIO || process.env.UAZAPI_TOKEN_SERGIO || legacyUazapi?.sergioToken || ""
  ).trim();

  const baseUrl = normalizeUazapiBaseUrl(
    process.env.GOOGLE_ADS_UAZAPI_BASE_URL || process.env.UAZAPI_BASE_URL || legacyUazapi?.baseUrl || ""
  );

  const now = new Date().toISOString();
  return {
    slug: "cnac",
    name: "CNAC Tapetes",
    active: true,
    googleCustomerId: (process.env.GOOGLE_ADS_CUSTOMER_ID || "3228136878").replace(/\D/g, ""),
    routingMode: "roulette",
    initialMessage: "Olá! Vim pelo site da CNAC Tapetes e gostaria de um orçamento.",
    attendants: [
      {
        id: "att_josi",
        name: process.env.CNAC_ATTENDANT_1_NAME || "Josi",
        phone: josiPhone || "5521980659269",
        uazapiToken: josiToken || undefined,
        active: true,
      },
      {
        id: "att_sergio",
        name: process.env.CNAC_ATTENDANT_2_NAME || "Sérgio",
        phone: sergioPhone || "5521994060206",
        uazapiToken: sergioToken || undefined,
        active: true,
      },
    ],
    uazapi: {
      baseUrl,
      josiToken,
      sergioToken,
      updatedAt: legacyUazapi?.updatedAt || now,
    },
    clientAccess: {
      enabled: false,
      users: [],
    },
    createdAt: now,
    updatedAt: now,
  };
}

let migrationCheckedInProcess = false;

export function ensureTenantsInitialized(): GoogleTenantConfig[] {
  const registryPath = getTenantsRegistryPath();
  let tenants: GoogleTenantConfig[] = [];

  if (fs.existsSync(registryPath)) {
    const parsed = readJsonSafe<GoogleTenantConfig[]>(registryPath, []);
    if (Array.isArray(parsed) && parsed.length > 0) {
      tenants = parsed;
    }
  }

  if (tenants.length === 0) {
    const cnac = buildDefaultCnacTenant();
    tenants = [cnac];
    writeJsonAtomic(registryPath, tenants);
  }

  if (!migrationCheckedInProcess) {
    migrationCheckedInProcess = true;
    const cnacExists = tenants.some((t) => t.slug === "cnac");
    if (cnacExists) {
      const storageDir = getStorageDir();
      const cnacDir = getTenantDir("cnac");
      (Object.keys(LEGACY_ROOT_FILENAMES) as TenantFileKey[]).forEach((key) => {
        const legacyName = LEGACY_ROOT_FILENAMES[key];
        if (!legacyName) return;
        const targetPath = path.join(cnacDir, TENANT_FILENAMES[key]);
        if (fs.existsSync(targetPath)) return;

        const rootSource = path.join(storageDir, legacyName);
        const tmpSource = path.join("/tmp", legacyName);
        const src = fs.existsSync(rootSource) ? rootSource : fs.existsSync(tmpSource) ? tmpSource : null;
        if (src) {
          try {
            const raw = fs.readFileSync(src, "utf8");
            const parsed = JSON.parse(raw);
            writeJsonAtomic(targetPath, parsed);
          } catch {}
        }
      });
    }
  }

  return tenants;
}

export function listTenants(): GoogleTenantConfig[] {
  return ensureTenantsInitialized();
}

export function getTenant(slug: string): GoogleTenantConfig | null {
  const safe = sanitizeTenantSlug(slug);
  if (!safe) return null;
  const tenants = ensureTenantsInitialized();
  return tenants.find((t) => t.slug === safe) || null;
}

/**
 * Resolve o cliente da requisição:
 * - Se não vier ?client= (legado da tela atual antes do Passo M3), usa "cnac"
 * - Se vier ?client=<slug> explícito, exige que exista no registro (nunca vaza dados de outro cliente)
 */
export function resolveRequestTenant(rawSlug?: string | null): GoogleTenantConfig | null {
  const tenants = ensureTenantsInitialized();
  const trimmed = String(rawSlug || "").trim();
  if (!trimmed) {
    return tenants.find((t) => t.slug === "cnac") || tenants[0] || null;
  }
  const safe = sanitizeTenantSlug(trimmed);
  return tenants.find((t) => t.slug === safe) || null;
}

export function saveTenantsRegistry(tenants: GoogleTenantConfig[]): void {
  writeJsonAtomic(getTenantsRegistryPath(), tenants);
}

export function upsertTenant(tenant: GoogleTenantConfig): GoogleTenantConfig {
  const tenants = ensureTenantsInitialized();
  const safeSlug = sanitizeTenantSlug(tenant.slug);
  if (!safeSlug) {
    throw new Error("Slug do cliente inválido.");
  }

  const normalized: GoogleTenantConfig = {
    ...tenant,
    slug: safeSlug,
    name: String(tenant.name || safeSlug).trim(),
    googleCustomerId: String(tenant.googleCustomerId || "").replace(/\D/g, ""),
    routingMode: tenant.routingMode === "roulette" ? "roulette" : "single",
    initialMessage: String(tenant.initialMessage || "Olá! Gostaria de mais informações.").trim(),
    attendants: Array.isArray(tenant.attendants)
      ? tenant.attendants.map((a, idx) => ({
          id: String(a.id || `att_${idx + 1}`),
          name: String(a.name || `Atendente ${idx + 1}`).trim(),
          phone: normalizeBrazilianPhone(a.phone),
          uazapiToken: a.uazapiToken ? String(a.uazapiToken).trim() : undefined,
          active: a.active !== false,
        }))
      : [],
    uazapi: {
      baseUrl: normalizeUazapiBaseUrl(tenant.uazapi?.baseUrl || ""),
      singleToken: tenant.uazapi?.singleToken ? String(tenant.uazapi.singleToken).trim() : undefined,
      josiToken: tenant.uazapi?.josiToken ? String(tenant.uazapi.josiToken).trim() : undefined,
      sergioToken: tenant.uazapi?.sergioToken ? String(tenant.uazapi.sergioToken).trim() : undefined,
      updatedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };

  getTenantDir(safeSlug);
  const idx = tenants.findIndex((t) => t.slug === safeSlug);
  if (idx >= 0) {
    tenants[idx] = normalized;
  } else {
    tenants.push(normalized);
  }
  saveTenantsRegistry(tenants);
  return normalized;
}

export function findTenantByUazapiToken(token: string): GoogleTenantConfig | null {
  const clean = String(token || "").trim();
  if (!clean) return null;
  const tenants = ensureTenantsInitialized();
  for (const t of tenants) {
    if (t.uazapi?.singleToken === clean) return t;
    if (t.uazapi?.josiToken === clean) return t;
    if (t.uazapi?.sergioToken === clean) return t;
    if (t.attendants?.some((a) => a.uazapiToken === clean)) return t;
  }
  return null;
}

export function getTenantAttendantPhones(tenant: GoogleTenantConfig): string[] {
  const set = new Set<string>();
  for (const a of tenant.attendants || []) {
    const clean = String(a.phone || "").replace(/\D/g, "");
    if (!clean) continue;
    set.add(clean);
    if (clean.startsWith("55") && clean.length >= 12) {
      set.add(clean.slice(2));
    }
  }
  return Array.from(set);
}

export function isTenantAttendantPhone(tenant: GoogleTenantConfig, phone?: string): boolean {
  const p = String(phone || "").replace(/\D/g, "");
  if (!p) return false;
  const attPhones = getTenantAttendantPhones(tenant);
  return attPhones.some(
    (att) => p === att || (p.length >= 8 && att.length >= 8 && p.slice(-8) === att.slice(-8))
  );
}

export function getTenantResolvedUazapi(tenant: GoogleTenantConfig): {
  baseUrl: string;
  source: "env" | "panel" | "none";
  instances: { name: string; token: string; phone?: string }[];
  singleToken: string;
  josiToken: string;
  sergioToken: string;
} {
  const storedCfg = readJsonSafe<any>(getTenantFilePath(tenant.slug, "uazapi_config"), {});
  const legacyCfg =
    tenant.slug === "cnac"
      ? readJsonSafe<any>(path.join(getStorageDir(), "alpha_google_uazapi_config.json"), {})
      : {};

  const isCnac = tenant.slug === "cnac";
  const envBase = isCnac
    ? (process.env.GOOGLE_ADS_UAZAPI_BASE_URL || process.env.UAZAPI_BASE_URL || "").trim()
    : "";

  const baseUrl = normalizeUazapiBaseUrl(
    envBase || tenant.uazapi?.baseUrl || storedCfg?.baseUrl || legacyCfg?.baseUrl || ""
  );

  if (tenant.routingMode === "single") {
    const primaryAtt = tenant.attendants.find((a) => a.active !== false) || tenant.attendants[0];
    const singleToken = String(
      tenant.uazapi?.singleToken ||
        storedCfg?.singleToken ||
        primaryAtt?.uazapiToken ||
        ""
    ).trim();

    const instances: { name: string; token: string; phone?: string }[] = [];
    if (singleToken) {
      instances.push({
        name: primaryAtt?.name || tenant.name || "WhatsApp Principal",
        token: singleToken,
        phone: primaryAtt?.phone,
      });
    }

    return {
      baseUrl,
      source: !baseUrl || instances.length === 0 ? "none" : "panel",
      instances,
      singleToken,
      josiToken: "",
      sergioToken: "",
    };
  }

  // Modo Roleta (compatível com CNAC e futuras equipes multi-atendentes)
  const envJosi = isCnac
    ? (process.env.GOOGLE_ADS_UAZAPI_TOKEN_JOSI || process.env.UAZAPI_TOKEN_JOSI || "").trim()
    : "";
  const envSergio = isCnac
    ? (process.env.GOOGLE_ADS_UAZAPI_TOKEN_SERGIO || process.env.UAZAPI_TOKEN_SERGIO || "").trim()
    : "";
  const envGeneric = isCnac
    ? (process.env.GOOGLE_ADS_UAZAPI_TOKEN || process.env.UAZAPI_TOKEN || "").trim()
    : "";

  const josiToken = String(
    envJosi ||
      tenant.uazapi?.josiToken ||
      storedCfg?.josiToken ||
      legacyCfg?.josiToken ||
      tenant.attendants?.[0]?.uazapiToken ||
      ""
  ).trim();

  const sergioToken = String(
    envSergio ||
      tenant.uazapi?.sergioToken ||
      storedCfg?.sergioToken ||
      legacyCfg?.sergioToken ||
      tenant.attendants?.[1]?.uazapiToken ||
      ""
  ).trim();

  const instances: { name: string; token: string; phone?: string }[] = [];
  if (josiToken) {
    instances.push({
      name: tenant.attendants?.[0]?.name || "Josi",
      token: josiToken,
      phone: tenant.attendants?.[0]?.phone,
    });
  }
  if (sergioToken) {
    instances.push({
      name: tenant.attendants?.[1]?.name || "Sérgio",
      token: sergioToken,
      phone: tenant.attendants?.[1]?.phone,
    });
  }

  // Atendentes adicionais dinâmicos (3º atendente em diante)
  for (let i = 2; i < (tenant.attendants?.length || 0); i++) {
    const att = tenant.attendants[i];
    if (att?.active !== false && att?.uazapiToken) {
      instances.push({ name: att.name, token: att.uazapiToken.trim(), phone: att.phone });
    }
  }

  if (instances.length === 0 && envGeneric) {
    instances.push({ name: "WhatsApp Principal", token: envGeneric });
  }

  const hasEnv = Boolean(envBase && (envJosi || envSergio || envGeneric));
  const source: "env" | "panel" | "none" = !baseUrl || instances.length === 0 ? "none" : hasEnv ? "env" : "panel";

  return {
    baseUrl,
    source,
    instances,
    singleToken: josiToken || envGeneric || "",
    josiToken,
    sergioToken,
  };
}

// =========================================================================
// REGRAS DINÂMICAS POR CLIENTE (FRASES + ETIQUETAS WHATSAPP BUSINESS)
// =========================================================================

export function normalizeTenantRules(input: any): TenantConversionRules {
  const cleanPhraseList = (arr: unknown, fallback: string[]) => {
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

  const cleanLabelList = (arr: unknown, fallback: string[]) => {
    if (!Array.isArray(arr)) return fallback;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of arr) {
      const raw = String(item || "").trim();
      const norm = normalizeText(raw);
      if (raw && norm && !seen.has(norm)) {
        seen.add(norm);
        out.push(raw);
      }
    }
    return out;
  };

  return {
    quote: {
      actionName: String(input?.quote?.actionName || DEFAULT_TENANT_RULES.quote.actionName).trim(),
      phrases: cleanPhraseList(input?.quote?.phrases, DEFAULT_TENANT_RULES.quote.phrases),
      labels: cleanLabelList(input?.quote?.labels, DEFAULT_TENANT_RULES.quote.labels),
    },
    purchase: {
      actionName: String(input?.purchase?.actionName || DEFAULT_TENANT_RULES.purchase.actionName).trim(),
      phrases: cleanPhraseList(input?.purchase?.phrases, DEFAULT_TENANT_RULES.purchase.phrases),
      labels: cleanLabelList(input?.purchase?.labels, DEFAULT_TENANT_RULES.purchase.labels),
    },
  };
}

export function readTenantRules(slug: string): TenantConversionRules {
  const file = getTenantFilePath(slug, "rules");
  const legacyRoot = slug === "cnac" ? getLegacyRootFilePath("rules") : null;
  const legacyTmp = slug === "cnac" ? getLegacyTmpFilePath("rules") : null;

  if (fs.existsSync(file)) {
    return normalizeTenantRules(readJsonSafe<any>(file, DEFAULT_TENANT_RULES));
  }
  if (legacyRoot && fs.existsSync(legacyRoot)) {
    return normalizeTenantRules(readJsonSafe<any>(legacyRoot, DEFAULT_TENANT_RULES));
  }
  if (legacyTmp && fs.existsSync(legacyTmp)) {
    return normalizeTenantRules(readJsonSafe<any>(legacyTmp, DEFAULT_TENANT_RULES));
  }
  return DEFAULT_TENANT_RULES;
}

export function writeTenantRules(slug: string, rules: any): TenantConversionRules {
  const normalized = normalizeTenantRules(rules);
  writeJsonAtomic(getTenantFilePath(slug, "rules"), normalized);

  if (slug === "cnac") {
    const legacyRoot = getLegacyRootFilePath("rules");
    if (legacyRoot) {
      try {
        writeJsonAtomic(legacyRoot, normalized);
      } catch {}
    }
    const legacyTmp = getLegacyTmpFilePath("rules");
    if (legacyTmp && legacyTmp !== legacyRoot) {
      try {
        writeJsonAtomic(legacyTmp, normalized);
      } catch {}
    }
  }
  return normalized;
}

export function extractUazapiChatLabels(rawChatOrMsg: any): string[] {
  const found: string[] = [];
  const collect = (val: unknown) => {
    if (!val) return;
    if (typeof val === "string") {
      val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => found.push(s));
      return;
    }
    if (Array.isArray(val)) {
      val.forEach(collect);
      return;
    }
    if (typeof val === "object") {
      const obj = val as Record<string, any>;
      const candidate = obj.name || obj.label || obj.title || obj.id;
      if (candidate) found.push(String(candidate).trim());
    }
  };

  collect(rawChatOrMsg?.wa_label);
  collect(rawChatOrMsg?.labels);
  collect(rawChatOrMsg?.chat?.wa_label);
  collect(rawChatOrMsg?.chat?.labels);
  collect(rawChatOrMsg?._chatLabels);
  collect(rawChatOrMsg?.label);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of found) {
    const norm = normalizeText(item);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      unique.push(item);
    }
  }
  return unique;
}

export function matchRuleLabel(chatLabels: string[], ruleLabels: string[]): string | null {
  if (!Array.isArray(chatLabels) || !Array.isArray(ruleLabels)) return null;
  if (chatLabels.length === 0 || ruleLabels.length === 0) return null;
  const normalizedChat = chatLabels.map((l) => normalizeText(l)).filter(Boolean);
  for (const ruleLabel of ruleLabels) {
    const normRule = normalizeText(ruleLabel);
    if (!normRule) continue;
    if (normalizedChat.some((c) => c === normRule || c.includes(normRule) || normRule.includes(c))) {
      return ruleLabel;
    }
  }
  return null;
}

// =========================================================================
// LEADS & AUDITORIAS COM PONTE SEGURA PARA TRANSIÇÃO DA CNAC (M1 -> M2)
// =========================================================================

const STAGE_RANK: Record<string, number> = {
  clique_anuncio: 1,
  conversa_iniciada: 2,
  orcamento_enviado: 3,
  compra_realizada: 4,
};

function mergeLeadRecords(a: any, b: any): any {
  const rankA = STAGE_RANK[a?.stage || "clique_anuncio"] || 1;
  const rankB = STAGE_RANK[b?.stage || "clique_anuncio"] || 1;
  const newerUpdate =
    new Date(b?.updatedAt || b?.occurredAt || 0).getTime() >
    new Date(a?.updatedAt || a?.occurredAt || 0).getTime();

  const primary = rankB > rankA || (rankB === rankA && newerUpdate) ? b : a;
  const secondary = primary === b ? a : b;

  return {
    ...secondary,
    ...primary,
    leadPhone:
      primary?.leadPhone && !/aguardando/i.test(String(primary.leadPhone))
        ? primary.leadPhone
        : secondary?.leadPhone || primary?.leadPhone,
    firstMessageAt: primary?.firstMessageAt || secondary?.firstMessageAt,
    sentStages: { ...(secondary?.sentStages || {}), ...(primary?.sentStages || {}) },
  };
}

export function readTenantLeads(slug: string, tenantForPhoneFilter?: GoogleTenantConfig | null): any[] {
  ensureTenantsInitialized();
  const tenantFile = getTenantFilePath(slug, "leads");
  let leads = readJsonSafe<any[]>(tenantFile, []);

  // Ponte M1->M2: para CNAC, sincroniza qualquer lead recém-chegado no arquivo legado de raiz
  if (slug === "cnac") {
    const legacyRoot = getLegacyRootFilePath("leads");
    const legacyTmp = getLegacyTmpFilePath("leads");
    const legacyLeads = legacyRoot && fs.existsSync(legacyRoot)
      ? readJsonSafe<any[]>(legacyRoot, [])
      : legacyTmp && fs.existsSync(legacyTmp)
        ? readJsonSafe<any[]>(legacyTmp, [])
        : [];

    if (legacyLeads.length > 0) {
      let tenantMtime = 0;
      let legacyMtime = 0;
      try {
        if (fs.existsSync(tenantFile)) tenantMtime = fs.statSync(tenantFile).mtimeMs;
        if (legacyRoot && fs.existsSync(legacyRoot)) legacyMtime = fs.statSync(legacyRoot).mtimeMs;
      } catch {}

      if (legacyMtime > tenantMtime || leads.length === 0) {
        const byId = new Map<string, any>();
        for (const item of leads) {
          if (item?.id) byId.set(item.id, item);
        }
        for (const item of legacyLeads) {
          if (!item?.id) continue;
          const prev = byId.get(item.id);
          byId.set(item.id, prev ? mergeLeadRecords(prev, item) : item);
        }
        leads = Array.from(byId.values()).sort(
          (x, y) =>
            new Date(y?.occurredAt || y?.firstMessageAt || 0).getTime() -
            new Date(x?.occurredAt || x?.firstMessageAt || 0).getTime()
        );
        try {
          writeJsonAtomic(tenantFile, leads.slice(0, 500));
        } catch {}
      }
    }
  }

  if (tenantForPhoneFilter) {
    const beforeCount = leads.length;
    leads = leads.filter((l: any) => !isTenantAttendantPhone(tenantForPhoneFilter, l?.leadPhone));
    if (leads.length < beforeCount) {
      writeTenantLeads(slug, leads);
    }
  }

  return Array.isArray(leads) ? leads : [];
}

export function writeTenantLeads(slug: string, leads: any[]): void {
  const trimmed = (Array.isArray(leads) ? leads : []).slice(0, 500);
  const tenantFile = getTenantFilePath(slug, "leads");
  writeJsonAtomic(tenantFile, trimmed);

  if (slug === "cnac") {
    const legacyRoot = getLegacyRootFilePath("leads");
    if (legacyRoot) {
      try {
        writeJsonAtomic(legacyRoot, trimmed);
      } catch {}
    }
    const legacyTmp = getLegacyTmpFilePath("leads");
    if (legacyTmp && legacyTmp !== legacyRoot) {
      try {
        writeJsonAtomic(legacyTmp, trimmed);
      } catch {}
    }
  }
}

export function readTenantAudits(slug: string): any[] {
  ensureTenantsInitialized();
  const file = getTenantFilePath(slug, "audits");
  if (fs.existsSync(file)) {
    return readJsonSafe<any[]>(file, []);
  }
  if (slug === "cnac") {
    const legacyRoot = getLegacyRootFilePath("audits");
    const legacyTmp = getLegacyTmpFilePath("audits");
    return readJsonSafe<any[]>(legacyRoot || file, [], legacyTmp);
  }
  return [];
}

export function appendTenantAudit(slug: string, entry: any): void {
  try {
    const logs = readTenantAudits(slug);
    logs.unshift(entry);
    const trimmed = logs.slice(0, 500);
    writeJsonAtomic(getTenantFilePath(slug, "audits"), trimmed);
    if (slug === "cnac") {
      const legacyRoot = getLegacyRootFilePath("audits");
      if (legacyRoot) {
        try {
          writeJsonAtomic(legacyRoot, trimmed);
        } catch {}
      }
    }
  } catch {}
}

// =========================================================================
// SEGURANÇA DO PORTAL DO CLIENTE (PASSO M4): SCRYPT + HMAC + SANITIZAÇÃO
// =========================================================================

function getClientSessionSecret(): string {
  return (
    process.env.GOOGLE_CLIENT_SESSION_SECRET?.trim() ||
    process.env.GOOGLE_ADS_CLIENT_SECRET?.trim() ||
    "alpha-google-client-portal-secret-v1"
  );
}

export function hashClientPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyClientPassword(password: string, storedHash: string): boolean {
  try {
    const [salt, keyHex] = String(storedHash || "").split(":");
    if (!salt || !keyHex) return false;
    const derived = crypto.scryptSync(String(password), salt, 64);
    const storedBuf = Buffer.from(keyHex, "hex");
    if (derived.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(derived, storedBuf);
  } catch {
    return false;
  }
}

export interface ClientPortalSessionPayload {
  tenantSlug: string;
  userId: string;
  username: string;
  displayName: string;
  exp: number;
}

export function signClientSessionToken(payload: ClientPortalSessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", getClientSessionSecret()).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyClientSessionToken(token: string): ClientPortalSessionPayload | null {
  try {
    const [encoded, sig] = String(token || "").split(".");
    if (!encoded || !sig) return null;
    const expected = crypto.createHmac("sha256", getClientSessionSecret()).update(encoded).digest("base64url");
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ClientPortalSessionPayload;
    if (!payload?.tenantSlug || !payload?.userId || !payload?.exp || Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Remove qualquer campo de tráfego pago, palavra-chave, campanha, custo ou OCI
 * antes de retornar um lead para o Portal do Cliente (garante sigilo técnico e painel motivador).
 */
export function sanitizeLeadForClient(lead: any) {
  return {
    id: lead.id,
    leadName: lead.leadName || "Cliente WhatsApp",
    leadPhone: lead.leadPhone,
    attendantName: lead.attendantName || "Atendimento",
    stage: lead.stage,
    value: Number(lead.value || 0),
    occurredAt: lead.occurredAt,
    firstMessageAt: lead.firstMessageAt || null,
    quotedAt: lead.quotedAt || null,
    purchasedAt: lead.purchasedAt || null,
    updatedAt: lead.updatedAt || null,
  };
}

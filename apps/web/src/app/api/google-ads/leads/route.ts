import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * API para listar, gerenciar, salvar regras e resolver nomes reais via Google Ads API
 * apps/web/src/app/api/google-ads/leads/route.ts
 *
 * PASSO 1: ConversÃ£o automÃ¡tica de IDs de Campanha e Conjunto para Nomes Reais
 * via Google Ads API (v25/v26 com fallback automÃ¡tico e descoberta de MCC).
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
    fs.writeFileSync(file, JSON.stringify(map, null, 2), "utf8");
    try {
      fs.writeFileSync("/tmp/alpha_google_entities_map.json", JSON.stringify(map, null, 2), "utf8");
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
    fs.writeFileSync(file, JSON.stringify(meta, null, 2), "utf8");
    try {
      fs.writeFileSync("/tmp/alpha_google_entities_meta.json", JSON.stringify(meta, null, 2), "utf8");
    } catch {}
  } catch {}
}

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
      error: "VariÃ¡veis OAuth ausentes (GOOGLE_ADS_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN).",
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
      error: `OAuth2 erro ${res.status}: ${data.error_description || data.error || "Falha ao gerar access_token"}`,
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

  const rawText = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, rows: [], errorText: rawText.slice(0, 500) };
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
    return { ok: false, status: res.status, rows: [], errorText: "Resposta JSON invÃ¡lida da Google Ads API." };
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

// AUTO-DISCOVERY PROFISSIONAL (PadrÃ£o Hyros/AnyTrack/RedTrack):
// Busca Campanhas, Conjuntos e Asset Groups (PMax) via Google Ads API ativa (v25/v26)
async function autoSyncEntitiesFromGoogleAds(forceRefresh = false): Promise<{
  map: Record<string, string>;
  meta: EntitiesSyncMeta;
}> {
  const map = readEntitiesMap();
  const prevMeta = readEntitiesMeta();
  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID || "3228136878").replace(/\D/g, "");
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  const nowMs = Date.now();

  // Evita spam na API em polling de 4s: respeita cooldown de 60s apÃ³s erro e TTL de 15min apÃ³s sucesso
  if (!forceRefresh && prevMeta.lastAttemptAt) {
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

  if (!devToken) {
    const meta: EntitiesSyncMeta = {
      ...prevMeta,
      apiConnected: false,
      customerId,
      lastAttemptAt: new Date().toISOString(),
      lastError: "GOOGLE_ADS_DEVELOPER_TOKEN nÃ£o configurado.",
    };
    writeEntitiesMeta(meta);
    return { map, meta };
  }

  const oauth = await getGoogleAdsAccessToken();
  if (!oauth.token) {
    const meta: EntitiesSyncMeta = {
      ...prevMeta,
      apiConnected: false,
      customerId,
      lastAttemptAt: new Date().toISOString(),
      lastError: oauth.error || "Token OAuth invÃ¡lido.",
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

    // Se falhou por versÃ£o descontinuada (404 / UNSUPPORTED_VERSION), tenta a prÃ³xima versÃ£o ativa
    if (!res.ok && (res.status === 404 || (res.errorText && /UNSUPPORTED_VERSION|deprecated|sunset/i.test(res.errorText)))) {
      lastError = `VersÃ£o ${version} indisponÃ­vel (${res.status})`;
      continue;
    }

    // Se falhou com 403 / USER_PERMISSION_DENIED e nÃ£o havia login-customer-id explÃ­cito, descobre a MCC automaticamente
    if (!res.ok && !explicitLoginId && (res.status === 403 || (res.errorText && /USER_PERMISSION_DENIED|PERMISSION_DENIED/i.test(res.errorText)))) {
      // 1) Tenta primeiro SEM login-customer-id se estava usando um em cache
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

      // 2) Se ainda falhar, consulta listAccessibleCustomers para encontrar a MCC mÃ£e
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
      lastError: lastError || "NÃ£o foi possÃ­vel conectar na Google Ads API.",
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

  // Busca todos os Conjuntos de AnÃºncios (Ad Groups)
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

  // Busca Asset Groups (Performance Max) em modo best-effort
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

const ATTENDANT_PHONES = ["5521980659269", "5521994060206", "21980659269", "21994060206"];

function isAttendantPhone(phone: string): boolean {
  const p = String(phone || "").replace(/\D/g, "");
  if (!p) return false;
  return ATTENDANT_PHONES.some(
    (att) => p === att || (p.length >= 8 && att.length >= 8 && p.slice(-8) === att.slice(-8))
  );
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
      fs.writeFileSync(file, JSON.stringify(leads.slice(0, 500), null, 2), "utf8");
      fs.writeFileSync("/tmp/alpha_google_leads.json", JSON.stringify(leads.slice(0, 500), null, 2), "utf8");
    } catch {}
  }

  return leads;
}

function writeLeads(leads: any[]): void {
  try {
    const file = getLeadsFilePath();
    fs.writeFileSync(file, JSON.stringify(leads.slice(0, 500), null, 2), "utf8");
    try {
      fs.writeFileSync("/tmp/alpha_google_leads.json", JSON.stringify(leads.slice(0, 500), null, 2), "utf8");
    } catch {}
  } catch (error) {
    console.error("Erro ao salvar leads:", error);
  }
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
    try {
      const file = getRulesFilePath();
      if (fs.existsSync(file)) {
        const rules = JSON.parse(fs.readFileSync(file, "utf8"));
        return NextResponse.json(rules, {
          headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
        });
      }
    } catch {}
    return NextResponse.json(
      {
        quote: {
          actionName: "orcamento_enviado",
          phrases: [
            "orÃ§amento enviado",
            "orcamento enviado",
            "segue o orÃ§amento",
            "segue seu orÃ§amento",
            "enviei o orÃ§amento",
            "proposta enviada",
          ],
        },
        purchase: {
          actionName: "compra_realizada",
          phrases: [
            "pedido fechado",
            "compra realizada",
            "venda confirmada",
            "pedido confirmado",
            "segue copia do pedido",
            "venda fechada",
          ],
        },
      },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  }

  if (type === "entities") {
    return NextResponse.json(readEntitiesMap(), {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  }

  if (type === "entities_status") {
    const entities = readEntitiesMap();
    const meta = readEntitiesMeta();
    return NextResponse.json(
      {
        ...meta,
        mappedKeysCount: Object.keys(entities).length,
        entities,
      },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  }

  const leads = readLeads();
  let entities = readEntitiesMap();

  const hasUnmappedNumeric = leads.some(
    (l: any) =>
      (l.campaign && /^\d+$/.test(String(l.campaign).trim()) && !entities[String(l.campaign).trim()]) ||
      (l.adGroup && /^\d+$/.test(String(l.adGroup).trim()) && !entities[String(l.adGroup).trim()])
  );

  const meta = readEntitiesMeta();
  const isCacheExpired =
    !meta.lastSyncAt || Date.now() - new Date(meta.lastSyncAt).getTime() > 15 * 60 * 1000;

  if (hasUnmappedNumeric || isCacheExpired) {
    try {
      const synced = await autoSyncEntitiesFromGoogleAds(false);
      entities = synced.map;
    } catch {}
  }

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

    // 0. Auto-SincronizaÃ§Ã£o ForÃ§ada do CatÃ¡logo Completo via Google Ads API
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
        message: meta.apiConnected
          ? `CatÃ¡logo sincronizado com sucesso via Google Ads API (${meta.apiVersionUsed}): ${meta.campaignsCount} campanhas e ${meta.adGroupsCount} conjuntos.`
          : `Falha ao conectar Google Ads API: ${meta.lastError}`,
      });
    }

    // 1. Salvar ou Atualizar Mapeamento Manual (Fallback se necessÃ¡rio)
    if (body.action === "save_entities" || body.type === "save_entities") {
      const current = readEntitiesMap();
      const updated = { ...current, ...(body.entities || {}) };
      writeEntitiesMap(updated);
      return NextResponse.json({ success: true, entities: updated, message: "Nomes reais vinculados com sucesso!" });
    }

    // 2. Salvar Regras DinÃ¢micas de ConversÃ£o
    if (body.type === "save_rules" && body.rules) {
      const file = getRulesFilePath();
      fs.writeFileSync(file, JSON.stringify(body.rules, null, 2), "utf8");
      try {
        fs.writeFileSync("/tmp/alpha_google_conversion_rules.json", JSON.stringify(body.rules, null, 2), "utf8");
      } catch {}
      return NextResponse.json({ success: true, message: "Regras salvas com sucesso!" });
    }

    // 3. Inserir/Recuperar Lead (mantido atÃ© o Passo 2)
    if (body.action === "add_lead" || body.action === "recover_lead" || body.leadPhone) {
      const cleanPhone = String(body.leadPhone || "").replace(/\D/g, "");
      if (!cleanPhone) {
        return NextResponse.json({ error: "Telefone do lead Ã© obrigatÃ³rio" }, { status: 400 });
      }

      const leads = readLeads();
      const newLead = {
        id: body.id || `lead_recov_${Date.now()}`,
        leadName: body.leadName || "Cliente WhatsApp",
        leadPhone: cleanPhone,
        attendantName: body.attendantName || "Josi",
        keyword: body.keyword || "Pesquisa Google Ads",
        campaign: body.campaign || "Campanha Google Ads",
        adGroup: body.adGroup || "Geral",
        gclid: body.gclid || `manual_${Date.now()}`,
        conversionType: body.conversionType || body.stage || "conversa_iniciada",
        stage: body.stage || "conversa_iniciada",
        status: "queued",
        value: Number(body.value || 0),
        notes: body.notes || "Lead recuperado/inserido manualmente",
        occurredAt: body.occurredAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const existingIdx = leads.findIndex((l: any) => {
        const p = String(l.leadPhone || "").replace(/\D/g, "");
        return p === cleanPhone || (p.length >= 8 && cleanPhone.length >= 8 && p.slice(-8) === cleanPhone.slice(-8));
      });

      if (existingIdx !== -1) {
        leads[existingIdx] = { ...leads[existingIdx], ...newLead };
      } else {
        leads.unshift(newLead);
      }

      writeLeads(leads);
      return NextResponse.json({ success: true, lead: newLead, message: "Lead salvo com sucesso!" });
    }

    return NextResponse.json({ error: "AÃ§Ã£o nÃ£o reconhecida" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro ao processar POST" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, stage, value, attendantName } = body;

    if (!id) {
      return NextResponse.json({ error: "ID do lead Ã© obrigatÃ³rio" }, { status: 400 });
    }

    const leads = readLeads();
    const index = leads.findIndex((l: any) => l.id === id);

    if (index === -1) {
      return NextResponse.json({ error: "Lead nÃ£o encontrado" }, { status: 404 });
    }

    if (stage) leads[index].stage = stage;
    if (value !== undefined) leads[index].value = Number(value);
    if (attendantName) leads[index].attendantName = attendantName;
    leads[index].updatedAt = new Date().toISOString();

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
      const attendantPhones = ["5521980659269", "5521994060206", "21980659269", "21994060206"];
      const originalCount = leads.length;
      leads = leads.filter((l: any) => {
        const p = String(l.leadPhone || "").replace(/\D/g, "");
        return !attendantPhones.some((att) => p === att || p.slice(-8) === att.slice(-8));
      });
      writeLeads(leads);
      return NextResponse.json({
        success: true,
        removed: originalCount - leads.length,
        message: "Leads dos atendentes removidos com sucesso!",
      });
    }

    if (!id) {
      return NextResponse.json({ error: "ID Ã© obrigatÃ³rio" }, { status: 400 });
    }

    leads = leads.filter((l: any) => l.id !== id);
    writeLeads(leads);

    return NextResponse.json({ success: true, message: "Lead removido com sucesso!" });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro ao excluir lead" }, { status: 500 });
  }
}

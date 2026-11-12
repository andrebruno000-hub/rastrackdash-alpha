import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * API para listar, gerenciar, salvar regras e RECUPERAR LEADS do Google Ads
 * apps/web/src/app/api/google-ads/leads/route.ts
 *
 * Suporta armazenamento persistente (/data montado no Dokploy ou /tmp com fallback).
 */

function getStorageDir(): string {
  if (process.env.GOOGLE_ADS_DATA_DIR) {
    try {
      if (!fs.existsSync(process.env.GOOGLE_ADS_DATA_DIR)) {
        fs.mkdirSync(process.env.GOOGLE_ADS_DATA_DIR, { recursive: true });
      }
      return process.env.GOOGLE_ADS_DATA_DIR;
    } catch {}
  }

  // Tenta pasta persistente montada no Dokploy
  try {
    if (fs.existsSync("/data")) {
      return "/data";
    }
  } catch {}

  // Fallback padrÃ£o
  return "/tmp";
}

function getLeadsFilePath(): string {
  const dir = getStorageDir();
  return path.join(dir, "alpha_google_leads.json");
}

function getAuditsFilePath(): string {
  const dir = getStorageDir();
  return path.join(dir, "alpha_google_conversion_audits.json");
}

function getRulesFilePath(): string {
  const dir = getStorageDir();
  return path.join(dir, "alpha_google_conversion_rules.json");
}

function getEntitiesFilePath(): string {
  const dir = getStorageDir();
  return path.join(dir, "alpha_google_entities_map.json");
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
  } catch (err) {
    console.error("Erro ao renovar token Google Ads:", err);
  }
  return null;
}

// AUTO-DISCOVERY: Busca todas as Campanhas e Conjuntos na conta Google Ads sem intervenÃ§Ã£o humana
async function autoSyncEntitiesFromGoogleAds(): Promise<Record<string, string>> {
  const map = readEntitiesMap();
  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID || "3228136878").replace(/\D/g, "");
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const accessToken = await getGoogleAdsAccessToken();

  if (!devToken || !accessToken) {
    return map;
  }

  try {
    const gaqlQuery = `
      SELECT
        campaign.id,
        campaign.name,
        ad_group.id,
        ad_group.name,
        campaign.status,
        ad_group.status
      FROM ad_group
      WHERE campaign.status != 'REMOVED'
    `;

    const res = await fetch(
      `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": devToken,
          "login-customer-id": customerId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: gaqlQuery }),
      }
    );

    if (res.ok) {
      const gadsData = await res.json();
      if (Array.isArray(gadsData)) {
        gadsData.forEach((batch: any) => {
          if (Array.isArray(batch.results)) {
            batch.results.forEach((row: any) => {
              const cId = String(row.campaign?.id || "");
              const cName = row.campaign?.name;
              const aId = String(row.adGroup?.id || "");
              const aName = row.adGroup?.name;
              if (cId && cName) map[cId] = cName;
              if (aId && aName) map[aId] = aName;
            });
          }
        });
        writeEntitiesMap(map);
      }
    }
  } catch (err) {
    console.error("Erro na auto-sincronizaÃ§Ã£o do catÃ¡logo Google Ads:", err);
  }

  return map;
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

  // AUTO-HIGIENIZAÃ‡ÃƒO: Remove automaticamente qualquer lead antigo com telefone de atendente
  const beforeCount = leads.length;
  leads = leads.filter((l: any) => !isAttendantPhone(l.leadPhone));

  // Se filtrou algum lead fantasma de atendente, salva a lista limpa no disco
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
    // Espelha tambÃ©m em /tmp por redundÃ¢ncia
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
        return NextResponse.json(rules);
      }
    } catch {}
    return NextResponse.json({
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
    });
  }

  if (type === "entities") {
    return NextResponse.json(readEntitiesMap(), {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  }

  const leads = readLeads();
  let entities = readEntitiesMap();

  // AUTO-RESOLVIMENTO: Se houver IDs numÃ©ricos nÃ£o mapeados, busca automaticamente na API do Google Ads
  const hasUnmapped = leads.some((l: any) =>
    (l.campaign && /^\d+$/.test(l.campaign) && !entities[l.campaign]) ||
    (l.adGroup && /^\d+$/.test(l.adGroup) && !entities[l.adGroup])
  );

  if (hasUnmapped) {
    try {
      entities = await autoSyncEntitiesFromGoogleAds();
    } catch {}
  }

  const enriched = leads.map((l: any) => ({
    ...l,
    campaignName: entities[l.campaign] || l.campaign,
    adGroupName: entities[l.adGroup] || l.adGroup,
  }));

  return NextResponse.json(enriched, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}

// POST: Recuperar ou Inserir Lead Manualmente, Salvar Regras ou Sincronizar CatÃ¡logo
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // 0. Auto-SincronizaÃ§Ã£o do CatÃ¡logo Completo via Google Ads API
    if (body.action === "sync_catalog" || body.action === "sync_entities_api") {
      const updated = await autoSyncEntitiesFromGoogleAds();
      return NextResponse.json({
        success: true,
        entities: updated,
        count: Object.keys(updated).length,
        message: "CatÃ¡logo de Campanhas e Conjuntos sincronizado com sucesso via Google Ads API!",
      });
    }

    // 1. Salvar ou Atualizar Mapeamento de Nomes Reais (ID Google Ads -> Nome Real)
    if (body.action === "save_entities" || body.type === "save_entities") {
      const current = readEntitiesMap();
      const updated = { ...current, ...(body.entities || {}) };
      writeEntitiesMap(updated);
      return NextResponse.json({ success: true, entities: updated, message: "Nomes reais vinculados com sucesso!" });
    }

    // 1. Salvar Regras DinÃ¢micas de ConversÃ£o
    if (body.type === "save_rules" && body.rules) {
      const file = getRulesFilePath();
      fs.writeFileSync(file, JSON.stringify(body.rules, null, 2), "utf8");
      try {
        fs.writeFileSync("/tmp/alpha_google_conversion_rules.json", JSON.stringify(body.rules, null, 2), "utf8");
      } catch {}
      return NextResponse.json({ success: true, message: "Regras salvas com sucesso!" });
    }

    // 2. Recuperar ou Inserir Lead Manualmente
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

      // Se jÃ¡ existir pelo telefone, atualiza. SenÃ£o adiciona no topo.
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

    // Limpa automaticamente leads teste com nÃºmeros dos atendentes
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

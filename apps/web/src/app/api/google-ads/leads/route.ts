import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/**
 * API para listar, gerenciar, salvar regras e LIMPAR LEADS FANTASMAS
 * apps/web/src/app/api/google-ads/leads/route.ts
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

function readLeads(): any[] {
  try {
    const file = getLeadsFilePath();
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
    if (fs.existsSync("/tmp/alpha_google_leads.json")) {
      return JSON.parse(fs.readFileSync("/tmp/alpha_google_leads.json", "utf8"));
    }
  } catch (error) {
    console.error("Erro ao ler leads:", error);
  }
  return [];
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
        return NextResponse.json(JSON.parse(fs.readFileSync(file, "utf8")));
      }
    } catch {}
    return NextResponse.json({
      quote: {
        actionName: "orcamento_enviado",
        phrases: ["orçamento enviado", "orcamento enviado", "segue o orçamento", "segue seu orçamento", "enviei o orçamento", "proposta enviada"],
      },
      purchase: {
        actionName: "compra_realizada",
        phrases: ["pedido fechado", "compra realizada", "venda confirmada", "pedido confirmado", "segue copia do pedido", "venda fechada"],
      },
    });
  }

  const leads = readLeads();
  return NextResponse.json(leads, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.type === "save_rules" && body.rules) {
      const file = getRulesFilePath();
      fs.writeFileSync(file, JSON.stringify(body.rules, null, 2), "utf8");
      try {
        fs.writeFileSync("/tmp/alpha_google_conversion_rules.json", JSON.stringify(body.rules, null, 2), "utf8");
      } catch {}
      return NextResponse.json({ success: true, message: "Regras salvas com sucesso!" });
    }

    if (body.action === "add_lead" || body.action === "recover_lead" || body.leadPhone) {
      const cleanPhone = String(body.leadPhone || "").replace(/\D/g, "");
      if (!cleanPhone) {
        return NextResponse.json({ error: "Telefone do lead é obrigatório" }, { status: 400 });
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

    return NextResponse.json({ error: "Ação não reconhecida" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro no POST" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const action = searchParams.get("action");

    let leads = readLeads();

    // Remove automaticamente todos os leads que possuem os números dos próprios atendentes
    if (action === "clean_attendants") {
      const attendantPhones = ["5521980659269", "5521994060206", "21980659269", "21994060206"];
      const countBefore = leads.length;
      leads = leads.filter((l: any) => {
        const p = String(l.leadPhone || "").replace(/\D/g, "");
        return !attendantPhones.some((att) => p === att || p.slice(-8) === att.slice(-8));
      });
      writeLeads(leads);
      return NextResponse.json({
        success: true,
        removed: countBefore - leads.length,
        message: "Registros dos atendentes limpos com sucesso!",
      });
    }

    if (!id) {
      return NextResponse.json({ error: "ID é obrigatório" }, { status: 400 });
    }

    leads = leads.filter((l: any) => l.id !== id);
    writeLeads(leads);

    return NextResponse.json({ success: true, message: "Lead removido com sucesso!" });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro ao excluir" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";

export const dynamic = "force-dynamic";

/**
 * API para Leads, Auditoria e Regras Dinâmicas de Conversão Google Ads
 * apps/web/src/app/api/google-ads/leads/route.ts
 */

const LEADS_FILE = "/tmp/alpha_google_leads.json";
const AUDIT_FILE = "/tmp/alpha_google_conversion_audits.json";
const RULES_FILE = "/tmp/alpha_google_conversion_rules.json";

const DEFAULT_RULES = {
  quote: {
    actionName: "WhatsApp - Orçamento Enviado",
    phrases: ["orçamento enviado", "orcamento enviado", "segue o orçamento", "proposta enviada", "segue seu orçamento"],
  },
  purchase: {
    actionName: "WhatsApp - Compra Realizada",
    phrases: ["pedido fechado", "compra realizada", "venda confirmada", "pedido confirmado", "segue copia do pedido"],
  },
};

function readRules() {
  try {
    if (fs.existsSync(RULES_FILE)) {
      return JSON.parse(fs.readFileSync(RULES_FILE, "utf8"));
    }
  } catch {}
  return DEFAULT_RULES;
}

function readLeads(): any[] {
  try {
    if (fs.existsSync(LEADS_FILE)) {
      return JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
    }
  } catch {}
  return [];
}

function writeLeads(leads: any[]): void {
  try {
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads.slice(0, 500), null, 2), "utf8");
  } catch {}
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");

  if (type === "rules") {
    return NextResponse.json(readRules(), {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  }

  if (type === "audits") {
    let audits: any[] = [];
    try {
      if (fs.existsSync(AUDIT_FILE)) {
        audits = JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8"));
      }
    } catch {}
    return NextResponse.json(audits, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  }

  return NextResponse.json(readLeads(), {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.type === "save_rules") {
      fs.writeFileSync(RULES_FILE, JSON.stringify(body.rules, null, 2), "utf8");
      return NextResponse.json({ success: true, rules: body.rules });
    }
    return NextResponse.json({ error: "Ação não suportada" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Erro interno" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, stage, value, attendantName } = body;

    if (!id) return NextResponse.json({ error: "ID obrigatório" }, { status: 400 });

    const leads = readLeads();
    const index = leads.findIndex((l: any) => l.id === id);
    if (index === -1) return NextResponse.json({ error: "Lead não encontrado" }, { status: 404 });

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

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";

export const dynamic = "force-dynamic";

/**
 * API para listar e gerenciar leads do Google Ads em tempo real
 * Caminho: apps/web/src/app/api/google-ads/leads/route.ts
 */

const LEADS_FILE = "/tmp/alpha_google_leads.json";

function readLeads(): any[] {
  try {
    if (fs.existsSync(LEADS_FILE)) {
      return JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
    }
  } catch (error) {
    console.error("Erro ao ler leads:", error);
  }
  return [];
}

function writeLeads(leads: any[]): void {
  try {
    fs.writeFileSync(LEADS_FILE, JSON.stringify(leads.slice(0, 500), null, 2), "utf8");
  } catch (error) {
    console.error("Erro ao salvar leads:", error);
  }
}

export async function GET() {
  const leads = readLeads();
  return NextResponse.json(leads, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
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

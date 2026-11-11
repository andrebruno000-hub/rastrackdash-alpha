import { NextResponse } from "next/server";
import fs from "fs";

const LEADS_FILE = "/tmp/alpha_google_leads.json";

export async function GET() {
  let leads = [];
  try {
    if (fs.existsSync(LEADS_FILE)) {
      leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
    }
  } catch (error) {
    console.error("Erro ao ler leads:", error);
  }

  return NextResponse.json(leads, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";

export const dynamic = "force-dynamic";

/**
 * FILA DE MATURAÇÃO E UPLOAD DE CONVERSÕES OFFLINE (OCI v17)
 * apps/web/src/app/api/google-ads/oci/route.ts
 */

const LEADS_FILE = "/tmp/alpha_google_leads.json";
const CUSTOMER_ID = (process.env.GOOGLE_ADS_CUSTOMER_ID || "3228136878").replace(/\D/g, "");
const MATURATION_TIME_MS = 4 * 60 * 60 * 1000;

export async function GET() {
  let leads: any[] = [];
  if (fs.existsSync(LEADS_FILE)) {
    try {
      leads = JSON.parse(fs.readFileSync(LEADS_FILE, "utf8"));
    } catch {}
  }

  const now = Date.now();
  const queueStats = {
    totalQueued: 0,
    readyToUpload: 0,
    waitingMaturation: 0,
    totalSent: 0,
  };

  const queueItems = leads
    .filter((l) => l.gclid)
    .map((l) => {
      const occurredTime = new Date(l.occurredAt || l.firstMessageAt || now).getTime();
      const ageMs = now - occurredTime;
      const isMatured = ageMs >= MATURATION_TIME_MS;
      const hoursRemaining = Math.max(0, Number(((MATURATION_TIME_MS - ageMs) / (1000 * 60 * 60)).toFixed(1)));

      if (l.status === "sent") queueStats.totalSent += 1;
      else if (l.status === "queued" || !l.status) {
        queueStats.totalQueued += 1;
        if (isMatured) queueStats.readyToUpload += 1;
        else queueStats.waitingMaturation += 1;
      }

      return {
        id: l.id,
        leadName: l.leadName,
        leadPhone: l.leadPhone,
        gclid: l.gclid,
        conversionType: l.conversionType || l.stage,
        value: l.value || 0,
        occurredAt: l.occurredAt,
        status: l.status || "queued",
        isMatured,
        hoursRemaining,
      };
    });

  return NextResponse.json({
    customerId: CUSTOMER_ID,
    stats: queueStats,
    items: queueItems,
  });
}

import { NextRequest, NextResponse } from "next/server";

// Contador em memória para alternância 50/50 justa
let requestCounter = 0;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  // 1. Definição dos Atendentes (Altere aqui os números do Sérgio e do José com DDD)
  const attendants = [
    {
      name: process.env.CNAC_ATTENDANT_1_NAME || "Sergio",
      phone: (process.env.CNAC_ATTENDANT_1_PHONE || "5521994060206").replace(/\D/g, "")
    },
    {
      name: process.env.CNAC_ATTENDANT_2_NAME || "Josi",
      phone: (process.env.CNAC_ATTENDANT_2_PHONE || "552121980659269").replace(/\D/g, "")
    }
  ];

  // 2. Roleta 50% / 50%
  requestCounter = (requestCounter + 1) % attendants.length;
  const chosen = attendants[requestCounter];

  // 3. Captura parâmetros do Google Ads
  const gclid = searchParams.get("gclid") || searchParams.get("wbraid") || searchParams.get("gbraid") || "";
  const keyword = searchParams.get("utm_term") || "";

  // 4. Monta a mensagem personalizada para o WhatsApp
  let text = "Olá! Vim pelo site da CNAC Tapetes e gostaria de um orçamento.";
  if (gclid) {
    let tag = ` [ref:${gclid}`;
    if (keyword) tag += `|kw:${encodeURIComponent(keyword.trim())}`;
    tag += `]`;
    text += tag;
  }

  // 5. Redirecionamento instantâneo (< 10ms)
  const whatsappUrl = `https://api.whatsapp.com/send?phone=${chosen.phone}&text=${encodeURIComponent(text)}`;
  return NextResponse.redirect(whatsappUrl, {
    status: 307,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Alpha-Attendant": chosen.name
    }
  });
}

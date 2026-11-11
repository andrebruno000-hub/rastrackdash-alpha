import { NextRequest, NextResponse } from "next/server";

// Contador em memória para alternância 50/50 justa
let requestCounter = 0;

// Tabela de caracteres Unicode 100% invisíveis (largura zero)
const ZW = ["\u200B", "\u200C", "\u200D", "\u2060"];

function encodeZeroWidth(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  let result = "";
  for (let b of bytes) {
    result += ZW[(b >> 6) & 3] + ZW[(b >> 4) & 3] + ZW[(b >> 2) & 3] + ZW[b & 3];
  }
  return result;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  // 1. Atendentes com números reais (Josi e Sérgio)
  const attendants = [
    {
      name: process.env.CNAC_ATTENDANT_1_NAME || "Josi",
      phone: (process.env.CNAC_ATTENDANT_1_PHONE || "5521980659269").replace(/\D/g, "")
    },
    {
      name: process.env.CNAC_ATTENDANT_2_NAME || "Sergio",
      phone: (process.env.CNAC_ATTENDANT_2_PHONE || "5521994060206").replace(/\D/g, "")
    }
  ];

  // 2. Roleta 50% / 50%
  requestCounter = (requestCounter + 1) % attendants.length;
  const chosen = attendants[requestCounter];

  // 3. Captura parâmetros do Google Ads
  const gclid = searchParams.get("gclid") || searchParams.get("wbraid") || searchParams.get("gbraid") || "";
  const keyword = searchParams.get("utm_term") || "";

  // 4. Mensagem 100% limpa visível para o cliente
  let text = "Olá! Vim pelo site da CNAC Tapetes e gostaria de um orçamento.";

  // 5. Injeta a tag invisível (o cliente não vê nada, mas os dados viajam na mensagem)
  if (gclid) {
    let tag = `ref:${gclid}`;
    if (keyword) tag += `|kw:${keyword.trim()}`;
    text += encodeZeroWidth(tag);
  }

  // 6. Redirecionamento instantâneo (< 10ms)
  const whatsappUrl = `https://api.whatsapp.com/send?phone=${chosen.phone}&text=${encodeURIComponent(text)}`;

  return NextResponse.redirect(whatsappUrl, {
    status: 307,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Alpha-Attendant": chosen.name
    }
  });
}

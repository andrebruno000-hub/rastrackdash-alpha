const gclid = searchParams.get("gclid") || searchParams.get("wbraid") || searchParams.get("gbraid") || "";
  const keyword = searchParams.get("utm_term") || "";
  const campaign = searchParams.get("utm_campaign") || "Pesquisa Google";
  const adGroup = searchParams.get("utm_content") || searchParams.get("utm_adgroup") || "Conjunto Geral";

  // Grava o lead completo
  recordLead({
    id: gclid ? `g_${gclid.slice(0, 15)}_${Date.now()}` : `lead_${Date.now()}`,
    leadPhone: chosen.phone,
    attendantName: chosen.name,
    keyword: keyword || "Direto (Sem palavra-chave)",
    campaign: campaign,
    adGroup: adGroup,
    gclid: gclid || "sem_gclid",
    conversionType: "conversa_iniciada",
    status: "queued",
    occurredAt: new Date().toISOString(),
  });

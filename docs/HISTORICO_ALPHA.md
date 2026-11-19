# Histórico Oficial de Evolução & Correções — RastrackDash Alpha

> Registro cronológico das entregas, correções em produção e lições aprendidas no fork `andrebruno000-hub/rastrackdash-alpha`.
> Arquivo mantido em `docs/HISTORICO_ALPHA.md` (fora do upstream `samoskito/nod-rastrackdash-wpp` — 100% preservado em atualizações futuras).

---

## [2026-11-19] — Correção "Rota Meta indisponível" & Recuperação Automática de Conversões Bloqueadas (Meta CAPI)

### Incidente observado
- Conversões de **Compra realizada (`Purchase`)** e **Orçamento enviado** disparadas via WhatsApp (UAZAPI/Josi) nos dias 17/11 e 18/11 (ex.: Criss R$ 385,00, Luan Garcia R$ 481,00, Edson R$ 800,00) permaneceram travadas com status **`Bloqueada`** e motivo **`Rota Meta indisponível`** (`provider_conversion_route_*`), mesmo após as conversões de 19/11 passarem a registrar normalmente.

### Causa raiz confirmada no código
1. Em `apps/api/src/inbound-webhook-production/provider-conversion-production.service.ts`, conexões UAZAPI/WAHA dependiam exclusivamente de `previewRoute({ workspaceId, adId })` encontrar o `adId` já sincronizado na tabela `MetaAd` no instante do evento, sem fallback seguro para a rota Meta única do workspace.
2. O status `blocked` estava em `terminalStatuses` com `retryable: false`, e o botão nativo *"Reprocessar bloqueadas"* (`apps/api/src/conversion-rules/provider-rule-blocked-reprocess.ts`) só reprocessa `connection_not_production`, `channel_not_active` e `before_production_activation` — deixando `provider_conversion_route_*` preso permanentemente.

### Correção aplicada e validada em produção
- **Arquivo alterado:** `apps/api/src/inbound-webhook-production/provider-conversion-production.service.ts` (commit `74fa9a3`).
- **Melhorias:**
  - Adicionado `resolveUniqueWorkspaceMetaRoute()` como fallback *fail-closed* (somente para UAZAPI/WAHA quando `previewRoute` não resolve), usando `authorizedInboundMetaDestinationIds(account)` + validação de conta ativa, conexão Meta ativa, credencial ativa e destino `configured` único (ou match único por `campaignId`).
  - Adicionado `recoverRouteBlockedExecutions()` agendado 15s após o boot da API e a cada 60s junto ao `recoverPurchaseOutbox()`, recuperando automaticamente execuções `blocked` por `provider_conversion_route_*` dentro da janela de 7 dias da Meta (margem de 1h), em lotes de 25 e cooldown de 5 minutos, preservando integralmente deduplicação e locks transacionais.
- **Resultado validado:** Após o **Deploy do serviço API no Dokploy**, as conversões bloqueadas foram automaticamente desbloqueadas, materializadas e enviadas à Meta CAPI.

### Lição operacional registrada
- O projeto possui serviços separados (**API** e **Web**) no Dokploy. Alterações em `apps/api/**` **só entram em vigor após o Deploy do serviço API**.

### Documentação criada/atualizada
- `docs/PADRAO_FIX_ROTA_META.md` (commit `f70aa21` + atualização com detalhes finais)
- `docs/DOCUMENTO_MESTRE_ALPHA.md` (mapa completo de arquivos protegidos e checklist pós-upstream)
- `docs/HISTORICO_ALPHA.md` (este histórico)

---

## [2026-11-18] — Extração de Legendas em PDF, Imagens e Vídeos (Meta Ads + Google Ads)

### Incidente observado
- Atendentes enviando PDFs (orçamentos/cópias de pedido), imagens ou vídeos com legenda contendo palavras-chave gatilho não disparavam conversões porque os parsers liam apenas texto simples de primeiro nível.

### Correção aplicada e validada em produção
- **Meta Ads (API):**
  - `apps/api/src/webhooks/uazapi-webhook-parser.ts` (commit `211cefd`): extração recursiva de legendas (`content.caption`, `documentWithCaptionMessage`, `documentMessage.caption`, `imageMessage.caption`, `videoMessage.caption`, wrappers efêmeros/viewOnce) preservando prioridade #1 para texto simples e bloqueando leitura de `quotedMessage`.
  - `apps/api/src/webhooks/webhooks.controller.ts` (commit `4584ab1`): suporte a `body.data.message` e `parsed.fromMe` em `recordUazapiWebhook`.
- **Google Ads (Web — módulo exclusivo Alpha):**
  - `apps/web/src/app/api/webhooks/google-whatsapp/route.ts` e `apps/web/src/app/api/google-ads/leads/route.ts`: extrator unificado `extractWhatsAppMessageText` no webhook ao vivo e na reconciliação retroativa.
- **Documentação permanente:** `docs/PADRAO_MESTRE_LEGENDAS_MIDIA.md` (commit `06f6e2b`).

---

## [2026-11-11 a 2026-11-17] — Módulo Multi-Cliente Google Ads OCI + Roleta Server-Side (`/r/[slug]`) + Portal do Cliente

### Entregas consolidadas (100% fora do upstream — risco zero em merges)
- Redirecionador server-side `< 10ms` (`/r/[slug]` e `/r/cnac`) com roleta Round-Robin no servidor e codificação invisível Zero-Width Unicode (`alpha-track.js`).
- Motor multi-cliente Google Ads (`google-tenants.ts`), painel `/google-ads` responsivo mobile, portal dedicado do cliente (`/google-ads/acesso`), monitor/teste Uazapi, regras por frase e etiquetas WhatsApp, relatórios com filtro e envio OCI (Conversa Iniciada, Orçamento Enviado, Compra Realizada) com janela anti-`CLICK_NOT_FOUND`.
- Correção de miniaturas de criativos Uazapi com fallback via tabela `MetaAd` (`thumbnailUrl` / `previewUrl`).

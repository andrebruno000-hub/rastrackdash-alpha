# Padrão Mestre — Recuperação de Conversões Bloqueadas por "Rota Meta indisponível"

> **Status:** Validado em produção em **19/11/2026** (commit `74fa9a3` + Deploy do serviço **API** no Dokploy).
> **Arquivo protegido:** `docs/PADRAO_FIX_ROTA_META.md` (fora do upstream `samoskito/nod-rastrackdash-wpp`).

## 1. Diagnóstico do Problema
No serviço `apps/api/src/inbound-webhook-production/provider-conversion-production.service.ts`, eventos de **Compra (`Purchase`)** e **Orçamento Enviado (`InitiateCheckout` / `QualifiedLead` / `AddToCart`)** disparados via WhatsApp (UAZAPI/NOD ou WAHA) ficavam presos com status **`Bloqueada`** e motivo **`Rota Meta indisponível`** (`provider_conversion_route_*`) por dois motivos combinados:

1. **Dependência rígida do `adId` sincronizado na tabela `MetaAd`:**
   Ao processar a conversão de um lead da Meta (`lead.adId` + `lead.ctwaClid`), o serviço chama `this.routes.previewRoute({ workspaceId, adId })`. Se o anúncio ainda não tivesse sido sincronizado na `MetaAd` no momento exato da venda/orçamento (anúncio novo, pausado ou fora da última sincronização), não havia fallback para a rota Meta única ativa do workspace em conexões UAZAPI/WAHA — gerando `provider_conversion_route_*`.
2. **Status `blocked` tratado como terminal sem reprocessamento automático:**
   Como `terminalStatuses` contém `"blocked"`, `failureDisposition()` marca `provider_conversion_route_*` como `retryable: false`, e o botão nativo *"Reprocessar bloqueadas"* (`apps/api/src/conversion-rules/provider-rule-blocked-reprocess.ts`) só cobre `connection_not_production`, `channel_not_active` e `before_production_activation`, as conversões antigas bloqueadas nunca eram reprocessadas mesmo após a sincronização/rota Meta normalizar.

## 2. Solução Aplicada (`apps/api/src/inbound-webhook-production/provider-conversion-production.service.ts`)
1. **Fallback fail-closed alinhado ao roteador oficial (`resolveUniqueWorkspaceMetaRoute`):**
   - Mantém `this.routes.previewRoute({ workspaceId, adId })` sempre como prioridade #1.
   - Somente quando `previewRoute` não resolve para conexões WhatsApp bridged (`uazapi`/`waha`) e não há `purchaseKey`, usa `authorizedInboundMetaDestinationIds(account)` (importado de `../inbound-webhooks/inbound-webhook-meta-route-eligibility`), validando `MetaReportingAccount.active === true`, `MetaBusinessConnection.status === "active"`, `MetaCredential.status === "active"` e `MetaConversionDestination.status === "configured"`.
   - Resolve apenas quando existe **exatamente uma** rota Meta inequívoca no workspace (ou quando `lead.campaignId` identifica exatamente uma conta ativa em `MetaAd`). Se houver múltiplos destinos autorizados na conta ou múltiplas contas ativas sem correspondência, permanece **fail-closed**.
2. **Recuperação automática de execuções bloqueadas por rota (`recoverRouteBlockedExecutions`):**
   - Executa 15s após o boot da API (`routeRecoveryBootTimer`) e a cada 60s junto ao `recoverPurchaseOutbox()`.
   - Busca apenas execuções com:
     - `status = "blocked"`
     - `conversionEventLogId = null`
     - `reasonCode LIKE 'provider_conversion_route_%'`
     - `occurredAt >= now() - 7 dias + 1h` (janela oficial Meta CAPI com margem de segurança)
     - `lastAttemptedAt IS NULL OR lastAttemptedAt <= now() - 5 min` (cooldown anti-loop)
   - Desbloqueia atomicamente para `eligible` (lote de até 25) e chama `processExecution()`, preservando integralmente todos os locks (`pg_advisory_xact_lock`), deduplicação, valor original, data original do evento e envio à fila Meta CAPI.

## 3. Regra de Deploy e Proteção Pós-Atualização (`samoskito/nod-rastrackdash-wpp`)
- **Deploy obrigatório na API:** por ser uma alteração em `apps/api/**`, sempre execute o **Deploy no serviço API** no Dokploy.
- **Checklist pós-merge com o upstream:** ao atualizar com nova versão do autor, verifique se `apps/api/src/inbound-webhook-production/provider-conversion-production.service.ts` mantém:
  - `import { authorizedInboundMetaDestinationIds } from "../inbound-webhooks/inbound-webhook-meta-route-eligibility";`
  - `recoverRouteBlockedExecutions()` agendado no `onApplicationBootstrap()` e limpo no `onModuleDestroy()`;
  - `resolveUniqueWorkspaceMetaRoute()` acionado em `materializeFrozenDecision()` apenas quando `!adRouteResolved && !purchaseKey && isBridgedWhatsappProvider(occurrence.provider)`.
- Referência consolidada do projeto inteiro: `docs/DOCUMENTO_MESTRE_ALPHA.md` e `docs/HISTORICO_ALPHA.md`.

# Padrão Mestre — Recuperação de Conversões Bloqueadas por "Rota Meta indisponível"

## 1. Diagnóstico do Problema
No módulo de conversões do RastrackDash (`apps/api/src/inbound-webhook-production/provider-conversion-production.service.ts`), eventos de **Compra (`Purchase`)** e **Orçamento Enviado (`InitiateCheckout` / `QualifiedLead` / `AddToCart`)** disparados via WhatsApp (UAZAPI/NOD ou WAHA) ficavam presos com status **`Bloqueada`** e motivo **`Rota Meta indisponível`** (`provider_conversion_route_*`) por dois motivos combinados:

1. **Dependência rígida do `adId` sincronizado na tabela `MetaAd`:**
   Ao processar a conversão de um lead da Meta (`lead.adId` + `lead.ctwaClid`), o serviço chama `this.routes.previewRoute({ workspaceId, adId })`. Se o anúncio ainda não tivesse sido sincronizado na `MetaAd` no momento exato da venda/orçamento (anúncio novo, pausado ou fora da última sincronização), não havia fallback para a rota Meta única ativa do workspace em conexões UAZAPI/WAHA — gerando `provider_conversion_route_*`.
2. **Status `blocked` tratado como terminal sem reprocessamento automático:**
   Como `terminalStatuses` contém `"blocked"` e `failureDisposition()` marca `provider_conversion_route_*` como `retryable: false`, mesmo após a Meta sincronizar ou a rota ser corrigida em **Integrações → Meta** (e as novas conversões do dia passarem a registrar normalmente), as conversões antigas bloqueadas nunca eram reprocessadas nem criavam `ConversionEventLog` para reenvio em Diagnóstico.

## 2. Solução Aplicada (`apps/api/src/inbound-webhook-production/provider-conversion-production.service.ts`)
1. **Fallback fail-closed para rota Meta única do workspace (`resolveUniqueWorkspaceMetaRoute`):**
   - Mantém `this.routes.previewRoute({ workspaceId, adId })` sempre como prioridade #1.
   - Somente quando `previewRoute` não resolve para conexões WhatsApp bridged (`uazapi`/`waha`) e não há `purchaseKey`, verifica se existe **exatamente uma** conta `MetaReportingAccount` ativa com `MetaBusinessConnection` e `MetaConversionDestination` (`status = "configured"`) no workspace (ou se `lead.campaignId` identifica exatamente uma conta ativa em `MetaAd`).
   - Se houver múltiplas contas ativas sem correspondência ou nenhum destino configurado, permanece **fail-closed** (não arrisca enviar para pixel errado).
2. **Recuperação automática de execuções bloqueadas por rota (`recoverRouteBlockedExecutions`):**
   - Executa 15s após o boot da API e a cada 60s junto ao `recoverPurchaseOutbox()`.
   - Busca apenas execuções com:
     - `status = "blocked"`
     - `conversionEventLogId = null`
     - `reasonCode LIKE 'provider_conversion_route_%'`
     - `occurredAt >= now() - 7 dias` (dentro da janela oficial da Meta CAPI)
     - `lastAttemptedAt IS NULL OR lastAttemptedAt <= now() - 5 min` (cooldown anti-loop)
   - Desbloqueia atomicamente para `eligible` e chama `processExecution()`, preservando integralmente todos os locks de deduplicação, valor original, data original do evento e envio à fila Meta CAPI.

## 3. Proteção pós-atualização (`samoskito/nod-rastrackdash-wpp`)
Ao atualizar o repositório com versões futuras do upstream, verifique se `apps/api/src/inbound-webhook-production/provider-conversion-production.service.ts` mantém:
- `recoverRouteBlockedExecutions()` agendado no `onApplicationBootstrap()` e limpo no `onModuleDestroy()`;
- `resolveUniqueWorkspaceMetaRoute()` acionado em `materializeFrozenDecision()` apenas quando `!adRouteResolved && !purchaseKey && isBridgedWhatsappProvider(occurrence.provider)`.

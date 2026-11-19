# Documento Mestre de Arquitetura, Customizações & Blindagem Pós-Atualização — RastrackDash Alpha

> **Repositório oficial da agência:** `andrebruno000-hub/rastrackdash-alpha`
> **Repositório upstream do autor:** `samoskito/nod-rastrackdash-wpp`
> **Proteção:** Este arquivo vive em `docs/DOCUMENTO_MESTRE_ALPHA.md` (fora do upstream) — **nunca é sobrescrito** em atualizações do autor e serve como guia oficial e checklist obrigatório pós-merge.

---

## 1. Regra de Ouro de Infraestrutura (Dokploy)

O RastrackDash Alpha roda em **2 serviços separados no Dokploy**:
- **Serviço API (`apps/api`)** — usa o `Dockerfile` da raiz (`pnpm --filter @wpptrack/api start`). Controla webhooks Meta/Uazapi/WAHA, regras de conversão Meta, fila BullMQ, CAPI e recuperação de conversões bloqueadas.
- **Serviço Web (`apps/web`)** — painel Next.js, rotas `/google-ads/*`, portal do cliente (`/google-ads/acesso`), redirecionador `/r/[slug]` e webhook Google Ads (`/api/webhooks/google-whatsapp`).

**Regra obrigatória de Deploy:**
- Alterou qualquer arquivo em `apps/api/**` → **OBRIGATÓRIO fazer Deploy no serviço API** no Dokploy (dar deploy apenas no Web não aplica mudanças na API).
- Alterou qualquer arquivo em `apps/web/**` → **Deploy no serviço Web** no Dokploy.
- Alterou `packages/shared/**` ou puxou atualização do upstream → **Deploy em AMBOS (API primeiro, depois Web)**.

---

## 2. Mapa Completo de Customizações vs. Risco em Atualizações do Autor

### A. Zona 100% Protegida (Risco ZERO em atualizações do upstream)
Arquivos exclusivos da **Anúncios Alpha** que **não existem** no repositório `samoskito/nod-rastrackdash-wpp`:
- **Módulo Google Ads completo:** `apps/web/src/app/(app)/google-ads/**`, `apps/web/src/app/r/**`, `apps/web/src/app/api/google-ads/**`, `apps/web/src/app/api/webhooks/google-whatsapp/**`, `apps/web/public/alpha-track.js`, utilitários multi-tenant (`google-tenants.ts`).
- **Documentação permanente da agência:**
  - `docs/DOCUMENTO_MESTRE_ALPHA.md` (este documento)
  - `docs/HISTORICO_ALPHA.md` (histórico cronológico de entregas e incidentes)
  - `docs/PADRAO_MESTRE_LEGENDAS_MIDIA.md` (padrão obrigatório de extração de legendas de mídia)
  - `docs/PADRAO_FIX_ROTA_META.md` (detalhamento técnico da correção de Rota Meta indisponível)

### B. Zona de Atenção (Arquivos originais do upstream com melhorias cirúrgicas)
Apenas estes **5 arquivos** do upstream possuem customizações nossas e **DEVEM** ser conferidos após qualquer `Sync fork` / `git merge` de uma nova versão do autor:

| # | Arquivo exato no GitHub | Melhoria aplicada | Símbolos / trechos que precisam continuar presentes | Serviço Dokploy |
| :-: | :--- | :--- | :--- | :---: |
| 1 | `apps/api/src/inbound-webhook-production/provider-conversion-production.service.ts` | **Recuperação automática de conversões bloqueadas por Rota Meta + Fallback fail-closed UAZAPI/WAHA** | `recoverRouteBlockedExecutions()`, `resolveUniqueWorkspaceMetaRoute()`, `authorizedInboundMetaDestinationIds`, `routeRecoveryBootTimer` | **API** |
| 2 | `apps/api/src/webhooks/uazapi-webhook-parser.ts` | **Extração de legendas em PDF/imagem/vídeo + `fromMe` + `ctwaThumbnailUrl` (sem ler `quotedMessage`)** | `extractMediaCaptionOrNestedText`, `contentObj?.caption`, `documentWithCaptionMessage`, `ctwaThumbnailUrl` | **API** |
| 3 | `apps/api/src/webhooks/webhooks.controller.ts` | **Suporte a `body.data.message`, `parsed.fromMe` e repasse de `ctwaThumbnailUrl` no `recordUazapiWebhook`** | `this.recordValue(data?.message)`, `parsed.fromMe === false`, `parsed.fromMe === true` | **API** |
| 4 | `apps/api/src/leads/leads.service.ts` *(se aplicado)* | **Fallback de miniatura de criativo via `MetaAd.thumbnailUrl` / `previewUrl`** | `thumbnailUrl: true`, `previewUrl: true` na query de `metaAd` em `findOne` | **API** |
| 5 | `apps/web/src/components/app-shell.tsx` | **Item de navegação do módulo Google Ads no menu lateral** | Link para `/google-ads` | **Web** |

> **Regras intocáveis do upstream (`docs/CUSTOMIZATION.md` — PALMUP-CORE):**
> Nunca alterar cliente de licença, guards de soft-lock, núcleo de auth multi-tenant, migrations core do upstream nem o rodapé obrigatório `RastrackDash · powered by PalmUP`.

---

## 3. Detalhamento das Melhorias Críticas de Conversões Meta

### 3.1. Correção "Rota Meta indisponível" e Auto-Recuperação 7 dias (`provider-conversion-production.service.ts`)
- **Problema resolvido:** Conversões de **Compra (`Purchase`)** e **Orçamento Enviado** via UAZAPI/WAHA ficavam travadas em `status = "blocked"` com `reasonCode = "provider_conversion_route_*"` quando o anúncio (`lead.adId`) ainda não havia sido sincronizado em `MetaAd` no momento do evento. Como `blocked` era tratado como terminal e o botão nativo *"Reprocessar bloqueadas"* (`provider-rule-blocked-reprocess.ts`) só reprocessa `connection_not_production` / `channel_not_active` / `before_production_activation`, essas vendas nunca voltavam para a fila mesmo após o sync da Meta.
- **Solução aplicada (fail-closed e zero duplicação):**
  1. **Prioridade #1 preservada:** `this.routes.previewRoute({ workspaceId, adId })` continua rodando primeiro exatamente como no upstream.
  2. **Fallback seguro para UAZAPI/WAHA (`resolveUniqueWorkspaceMetaRoute`):** somente quando `previewRoute` não resolve e `!purchaseKey && isBridgedWhatsappProvider(occurrence.provider)`, utiliza a própria função oficial `authorizedInboundMetaDestinationIds(account)` verificando `MetaReportingAccount.active === true`, `MetaBusinessConnection.status === "active"`, `MetaCredential.status === "active"` e `MetaConversionDestination.status === "configured"`. Resolve apenas quando existe **1 única rota inequívoca** no workspace (ou 1 conta identificada pelo `campaignId` do lead em `MetaAd`). Em caso de ambiguidade (2+ pixels ou 2+ contas distintas), permanece *fail-closed*.
  3. **Auto-recuperação controlada (`recoverRouteBlockedExecutions`):** roda 15s após o boot da API e a cada 60s (junto ao `recoverPurchaseOutbox()`), desbloqueando em lotes de até 25 execuções (`status = "blocked"`, `conversionEventLogId = null`, `reasonCode LIKE 'provider_conversion_route_%'`, dentro da janela de 7 dias da Meta com margem de 1h, cooldown de 5 min por item). Passa pelo `processExecution()` oficial com `pg_advisory_xact_lock` e todas as travas de deduplicação (inclusive contra conversões manuais).

### 3.2. Extração de Legendas de Mídia (`uazapi-webhook-parser.ts` + `webhooks.controller.ts`)
- Mantém prioridade #1 para texto simples; usa fallback recursivo para legendas de PDF, imagem e vídeo; **nunca** lê `quotedMessage` / `contextInfo` como texto de regra (evita conversões falsas em respostas). Detalhes completos em `docs/PADRAO_MESTRE_LEGENDAS_MIDIA.md`.

---

## 4. Playbook Obrigatório ao Atualizar com Nova Versão do Autor (`v1.6.0+`)

Siga exatamente esta ordem para **nunca quebrar o projeto** ao atualizar o fork:

1. **NUNCA sobrescreva o repositório inteiro por cima.** Use sempre **Sync fork / Pull Request / `git merge`** no GitHub para enxergar exatamente o diff antes de confirmar.
2. **Antes do Deploy, audite os 5 arquivos da Seção 2.B:**
   - Verifique se o autor já incorporou nativamente alguma das melhorias (ex.: reprocessamento de `provider_conversion_route_*` em `provider-rule-blocked-reprocess.ts` ou suporte a legendas no `uazapi-webhook-parser.ts`).
   - Se o autor **ainda não** resolveu nativamente e o merge sobrescreveu algum trecho nosso, reaplique o trecho cirúrgico sobre a versão nova do arquivo do autor (usando este documento + `docs/PADRAO_FIX_ROTA_META.md` + `docs/PADRAO_MESTRE_LEGENDAS_MIDIA.md`).
3. **Confirme que `apps/web/src/components/app-shell.tsx`** manteve o link do menu para `/google-ads`.
4. **Faça Deploy no Dokploy na ordem correta:**
   - 1º **Serviço API** → aguarde status saudável (as migrations do Prisma sobem automaticamente no start da API).
   - 2º **Serviço Web** → aguarde concluir.
5. **Validação rápida pós-deploy (3 minutos):**
   - Abrir `/google-ads` e confirmar carregamento do painel e `/r/[slug]`.
   - Abrir **Integrações → Meta** e verificar conta ativa + destino configurado.
   - Abrir **Conversões → Últimas execuções** e confirmar que novas conversões (inclusive legenda de PDF) entram como **Enviadas** e nenhuma fica presa indefinidamente em **Rota Meta indisponível**.

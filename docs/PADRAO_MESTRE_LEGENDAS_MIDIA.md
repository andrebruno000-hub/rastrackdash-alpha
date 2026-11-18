# PADRÃO MESTRE DE EXTRAÇÃO DE LEGENDAS DE MÍDIA & PROTEÇÃO CONTRA ATUALIZAÇÕES (META ADS + GOOGLE ADS)

> **IMPORTÂNCIA CRÍTICA:** Documento técnico oficial do repositório `andrebruno000-hub/rastrackdash-alpha`.
> Deve ser mantido em `docs/PADRAO_MESTRE_LEGENDAS_MIDIA.md` (fora dos arquivos do upstream) para **nunca ser sobrescrito** em merges futuros e servir como checklist obrigatório após qualquer atualização do fork `samoskito/nod-rastrackdash-wpp` ou na criação de novos projetos.

---

## 1. Incidente Raiz Documentado (Por que este bug era crítico)

- Em mensagens reais no WhatsApp, atendentes frequentemente enviam **arquivos PDF (orçamentos/pedidos), imagens ou vídeos com legenda** contendo a palavra-chave configurada na regra de conversão (ex.: `"Segue cópia do pedido"`).
- Diferente de mensagens de texto simples (`conversation` / `text` / `body`), provedores WhatsApp (Baileys, GoWS, Uazapi / NOD API, Evolution API, WAHA, WhatsApp Web) encapsulam a legenda em estruturas aninhadas como:
  - `message.content.caption` (padrão Uazapi / NOD API para mídia)
  - `message.documentWithCaptionMessage.message.documentMessage.caption`
  - `message.documentMessage.caption`
  - `message.imageMessage.caption`
  - `message.videoMessage.caption`
  - `message.caption` / `message.media.caption`
  - Wrappers efêmeros/viewOnce: `ephemeralMessage.message.*`, `viewOnceMessage.message.*`, `viewOnceMessageV2.message.*`, `viewOnceMessageV2Extension.message.*`
  - `body.data.message.*`
- Quando o parser lê apenas `text` / `body` / `conversation` no primeiro nível, **toda conversão enviada junto com PDF, foto ou vídeo é silenciosamente ignorada** (não conta no painel e não dispara Meta CAPI / Google OCI), mesmo aparecendo como entregue no WhatsApp.

---

## 2. Regra Arquitetural Obrigatória (Para ESTE e TODOS os Projetos Futuros)

Todo receptor de webhook WhatsApp (`fromMe=false` ou `fromMe=true`) e todo motor de sincronização/reconciliação retroativa DEVE implementar as **4 regras inegociáveis** abaixo:

1. **Prioridade Aditiva (Zero Regressão):**
   - Ler primeiro os campos de texto simples existentes (`text`, `body`, `message` string, `conversation`) na ordem original.
   - Somente quando vazios, executar a função recursiva de fallback de legendas (`extractMediaCaptionOrNestedText` / `extractWhatsAppMessageText`).
2. **Cobertura Completa de Legendas de Mídia:**
   - Suportar obrigatoriamente:
     - `content.caption` / `content.text` / `content.description` (Uazapi/NOD media object)
     - `caption` e `media.caption`
     - `documentWithCaptionMessage.message.documentMessage.caption`
     - `documentMessage.caption`
     - `imageMessage.caption`
     - `videoMessage.caption`
     - `extendedTextMessage.text`
     - Desembrulhamento recursivo (profundidade máxima `4`) de `ephemeralMessage`, `viewOnceMessage`, `viewOnceMessageV2`, `viewOnceMessageV2Extension` e `.message` aninhado + `body.data`.
3. **Proibição Absoluta de Leitura de `quotedMessage` / `contextInfo` como Texto da Mensagem:**
   - **NUNCA** ler `contextInfo.quotedMessage` como texto para avaliação de palavras-chave!
   - Motivo: se um cliente ou atendente responder (*swipe/reply*) a uma mensagem antiga que continha uma palavra-chave de pedido/orçamento, isso geraria conversão falsa duplicada.
   - `contextInfo.externalAdReply` pode ser lido exclusivamente para atribuição de anúncio (`ctwaClid` / `sourceID`), nunca como frase da mensagem.
4. **Reconciliação Retroativa / Backup Idêntica ao Webhook:**
   - Qualquer job de backup ou reconciliação (`/chat/find`, `/message/find`, etc.) deve chamar **a mesma função extratora** usada pelo webhook ao vivo, com idempotência garantida por `messageId` / `occurrenceKey`.

---

## 3. Mapa de Arquivos Protegidos no Repositório Atual

| Sistema | Arquivo no GitHub | Status da Proteção | Risco em Atualizações do Autor (`samoskito`) |
| :--- | :--- | :--- | :--- |
| **Meta Ads (Uazapi / NOD API)** | `apps/api/src/webhooks/uazapi-webhook-parser.ts` | Corrigido (extração recursiva de legendas + `fromMe` + proteção anti-`quotedMessage`) | **ALTO — Existe no upstream.** Verificar/reaplicar se houver merge neste arquivo. |
| **Meta Ads (Webhook Controller)** | `apps/api/src/webhooks/webhooks.controller.ts` | Corrigido cirurgicamente (suporte a `body.data.message` e `parsed.fromMe`) | **ALTO — Existe no upstream.** Verificar/reaplicar se houver merge neste arquivo. |
| **Meta Ads (WAHA v2)** | `apps/api/src/inbound-webhooks/providers/waha/waha-v2.parser.ts` | **Já nativamente protegido** (`documentWithCaptionMessage`, `documentMessage.caption`, `imageMessage.caption`, `videoMessage.caption`). | Apenas monitorar se upstream alterar `extractText`. |
| **Google Ads (Webhook)** | `apps/web/src/app/api/webhooks/google-whatsapp/route.ts` | Corrigido (`extractWhatsAppMessageText`) | **ZERO — Módulo exclusivo Alpha** (não existe no upstream). |
| **Google Ads (Sync Retroativo)** | `apps/web/src/app/api/google-ads/leads/route.ts` | Corrigido (`extractWhatsAppMessageText` + reavaliação `force`) | **ZERO — Módulo exclusivo Alpha** (não existe no upstream). |
| **Documentação Permanente** | `docs/PADRAO_MESTRE_LEGENDAS_MIDIA.md` | Este arquivo | **ZERO — Arquivo exclusivo Alpha** (preservado entre atualizações). |

---

## 4. Checklist Obrigatório Pós-Atualização do Upstream (`Sync fork` / Merge)

Sempre que puxar commits novos de `samoskito/nod-rastrackdash-wpp`:

1. Abra `apps/api/src/webhooks/uazapi-webhook-parser.ts` e confirme que contém `extractMediaCaptionOrNestedText` (ou `documentWithCaptionMessage` e `contentObj?.caption`).
2. Abra `apps/api/src/webhooks/webhooks.controller.ts` na função `recordUazapiWebhook` e confirme que usa `parsed.fromMe === false` / `parsed.fromMe === true` e `this.recordValue(data?.message)`.
3. Caso o `Sync fork` tenha dado conflito ou sobrescrito um desses 2 arquivos com a versão do autor, reaplique exatamente os arquivos do backup UTF-8 ou peça ao assistente usando este documento como referência.
4. Após subir o container `api` em produção, execute o **Teste de Ouro**: enviar 1 PDF com legenda contendo uma palavra-chave configurada (`fromMe=true`) para um lead pago de teste ou real e validar:
   - Log do webhook recebido sem erro;
   - Contabilização no painel e envio do evento (Purchase/InitiateCheckout) para o Pixel/CAPI ou OCI.

# Webhook / n8n: conversão chamada pelo seu fluxo

Origem de conversão **Webhook / n8n** (Conversões > Nova regra). O n8n, o
painel de atendimento ou o robô SDR chama a URL de uma regra, e o RastrackDash
envia o evento à Meta para o lead que veio do anúncio.

Funciona com **qualquer conexão de WhatsApp desta instalação**: API Oficial
(WhatsApp Cloud API), a sua Uazapi e a sua WAHA (conectadas por URL + token),
Umbler Talk, Unnichat, ROI Chat, Data Crazy e Gupshup.

Nenhuma variável de ambiente nova. A regra já nasce valendo para **todos os
números** (esta edição não precisa de chave extra para isso).

## Por que existe

Na **API Oficial (Cloud API) sem coexistência**, a Meta **não entrega pelo
webhook as mensagens enviadas pelo atendente**. A conversão por frase ("Pedido
confirmado" digitado pelo atendente) não tem como ser lida.

O n8n também **não recebe essa mensagem pela Meta**. Quem pode avisar é:

- o **painel de atendimento**, se ele tiver webhook ou automação que dispare
  quando uma mensagem é enviada, uma etiqueta é aplicada ou uma etapa muda; ou
- o **próprio fluxo que envia** a mensagem (robô SDR montado no n8n): ele sabe
  o que acabou de mandar.

## Como funciona

1. Em Conversões, crie uma regra **Webhook / n8n** por evento (Lead
   qualificado, Compra...). A regra vale para todos os números e **começa em
   observação** (nada vai à Meta até você ativar o envio).
2. Copie a URL da regra. O segredo já está na URL; não precisa de cabeçalho.
   A URL só aparece inteira na criação e em "Gerar novo endereço".
3. Faça um `POST` com JSON para essa URL quando o evento acontecer.
4. Confira em "Eventos recebidos" e ative o envio.

A URL tem este formato (o endereço público da sua API e o segredo da regra):

```text
POST {API_PUBLIC_URL}/webhooks/inbound/conversions/{id}?token=...
```

### Contrato

```json
{
  "phone": "5511999999999",
  "value": 1500,
  "currency": "BRL",
  "phone_number_id": "100000000000001",
  "message_id": "id-da-mensagem"
}
```

| Campo | Quando | O que é |
| --- | --- | --- |
| `phone` | sempre | Telefone do lead com DDI e DDD. Pode vir com `+`, espaços e traços. |
| `value`, `currency` | só em evento com valor, quando a regra usa "valor recebido" | `value` em **reais** (1500 = R$ 1.500,00; "1500,90" também vale). Sem `value`, vale o valor fixo da regra, se houver. |
| `phone_number_id` | opcional | Número que atendeu: o `phone_number_id` da API Oficial ou o próprio número (Uazapi, WAHA e as demais conexões). Só desempata quem tem mais de um número. |
| `message_id` | opcional, recomendado em Compra | Id da mensagem ou do pedido. Reenvio com o mesmo id nunca conta de novo. |

Também são aceitos os embrulhos do n8n: `[{ headers, body }]`, `{ body }`,
`{ json }` e lista de um item. Uma expressão do n8n que não resolveu
(`undefined`, `{{ ... }}`) é tratada como ausente.

**Não** envie `ctwa_clid`, pixel nem token da Meta: o evento vem da regra e o
clique já está no lead.

### O que acontece com cada chamada

| Situação | Recebimento |
| --- | --- |
| Lead do anúncio, número encontrado | Em observação / Na fila de envio / Enviado |
| Contato sem anúncio (orgânico) | Não atribuído: "Contato não é lead de anúncio". Nada vai à Meta e a chamada não conta como envio nem como repetição: se o mesmo contato chamar de novo depois de clicar num anúncio, essa chamada é a primeira. |
| Dois leads com o mesmo telefone | Bloqueado: "Mais de um lead com este telefone" |
| Lead do anúncio sem entrada registrada em nenhum número, sem `phone_number_id` | Bloqueado: "Não deu para saber por qual número o lead chegou" |
| O mesmo clique registrado em dois números, sem `phone_number_id` | Bloqueado: "Lead com entrada em mais de um número: informe o phone_number_id" |
| Sem `phone` | Dados inválidos: "Chamada sem telefone do lead (phone)" |
| Compra sem `value` e sem valor fixo | Dados inválidos: "Evento sem valor (value) e sem valor fixo na regra" |
| Reenvio | Repetido ("Mesma chamada repetida") |

Os bloqueados podem ser tentados de novo em "Eventos recebidos".

### Lead que falou com dois números

O lead guarda o **último clique** em anúncio. Vale o número por onde esse clique
entrou, venha de qualquer conexão (API Oficial, Uazapi, WAHA, Umbler, Unnichat,
ROI Chat, Data Crazy, Gupshup).

- O `phone_number_id` informado tem a entrada do clique: vale ele.
- Só um número tem a entrada: vale esse, **mesmo que outro `phone_number_id`
  venha** (o lead que clicou no anúncio do número A e foi atendido pelo B
  continua sendo do A; o anúncio é do A).
- O mesmo clique em mais de um número (por exemplo, a sua Uazapi e a sua WAHA
  no mesmo segundo): sem `phone_number_id` (ou com um id que não é de nenhum
  deles) fica bloqueado; nunca é adivinhado.
- Nenhuma entrada registrada: vale o `phone_number_id` informado, se for um
  número da conta.

Dois números no mesmo app da Meta funcionam assim: cada número tem a sua
conexão e o seu `phone_number_id`.

### Duplicidade

- **Lead qualificado** (e outros eventos "uma vez por lead"): conta uma vez
  por lead. O `message_id` é ignorado. Também não repete se o lead já foi
  qualificado por outro número para o mesmo pixel.
- **Compra** e outros eventos com valor:
  - com `message_id`: cada id é uma ocorrência. Duas compras do mesmo lead no
    mesmo dia com ids diferentes vão as duas; o mesmo id nunca vai duas vezes
    (o `event_id` na Meta também é o mesmo).
  - sem `message_id`: a mesma chamada (mesmo lead, valor e moeda) em até
    **12 horas** é reenvio. Outro valor é outra compra. Limite: duas compras
    reais de mesmo valor em menos de 12 horas contam uma só; para elas, envie
    `message_id`.
- Use como `message_id` o id da **mensagem ou do pedido de origem**, nunca o id
  da execução do n8n (um "re-run" geraria um id novo e duplicaria).

## Caminhos

### 1. Painel com webhook ou automação

O painel chama o seu n8n (ou a URL da regra direto) quando a mensagem é
enviada, a etiqueta é aplicada ou a etapa muda. Se o painel só deixa montar o
JSON, aponte direto para a URL da regra. Se manda um formato próprio, use o
fluxo pronto no meio: ele lê a mensagem, confere a frase e chama a regra.

### 2. Robô SDR no próprio n8n

O fluxo que envia a mensagem ao lead chama a URL da regra logo depois do envio,
com o telefone do lead e o id da mensagem enviada.

### 3. Coexistência (app do WhatsApp Business + API)

Com coexistência pela **sua Uazapi** (ou pela **sua WAHA**), as mensagens
enviadas pelo atendente chegam pela própria conexão e a regra por frase
continua funcionando. Não precisa do webhook. Se usar os dois, o número do
clique continua valendo (veja "Lead que falou com dois números").

### 4. Painel sem webhook

Sem webhook nem automação no painel, **não há como saber** o que o atendente
enviou. A saída é um acionamento manual que o painel consiga transformar em
chamada: por exemplo, uma etiqueta que dispare uma automação com requisição
HTTP. Sem isso, use o registro manual de conversão no lead.

## Fluxo pronto do n8n

[`webhook-conversao.json`](webhook-conversao.json) (o mesmo arquivo do botão
"Baixar fluxo pronto do n8n" na aba "Endereço e configuração" da regra). Dados
fictícios, sem segredo.

- **Mensagem enviada** (Webhook, `POST /mensagem-enviada`): recebe do painel ou
  do robô `phone`, `message`, `message_id` e, se houver, `phone_number_id` e
  `value`.
- **Frase de lead qualificado?** / **Frase de compra?** (IF): conferem a frase
  na mensagem (contém, sem diferenciar maiúsculas).
- **Enviar lead qualificado** / **Enviar compra** (HTTP POST): chamam a URL de
  cada regra. Troque `COLE_AQUI_A_URL_DA_REGRA_...` pela URL copiada.

Importar: no n8n, "Import from File" (ou colar o JSON no editor). O fluxo vem
desativado.

## Conferir depois de atualizar

1. `prisma migrate deploy` aplicou `20261105120000_webhook_provider` e
   `20261105120100_webhook_parser_release` (só acrescentam; nada é apagado).
2. Em `/backoffice/inbound-webhooks/parsers`, o leitor **Webhook / n8n**
   `automation-v1` aparece como certificado (chega pela migration, sem passo
   de liberação).
3. Em Conversões > Nova regra, a origem **Webhook / n8n** aparece (precisa de
   pelo menos uma conexão de WhatsApp em observação ou produção).
4. Crie uma regra de Lead qualificado, chame a URL com o telefone de um lead de
   teste que veio do anúncio e confira em "Eventos recebidos" (fica em
   observação, nada vai à Meta).

Para voltar atrás: pause ou exclua as regras Webhook / n8n. As migrations são
só aditivas e podem ficar no banco; não há variável para desligar.

## Para a IA do repositório

- Parser: `apps/api/src/inbound-webhooks/providers/webhook/webhook-automation-v1.parser.ts`
  (provedor `webhook`, versão `automation-v1`, release
  `inbound_parser_webhook_automation_v1`, nasce certificada: o contrato é
  nosso). Porte do SaaS (commit `098d0950`); o contrato é o mesmo do SaaS.
- Roteamento do número: `apps/api/src/conversion-rules/webhook-lead-routing.ts`.
  Usa `resolvePurchaseChannels` (entradas `inbound_webhook:<provedor>`: API
  Oficial, Umbler, Unnichat, ROI Chat, Data Crazy, Gupshup) e
  `resolveBridgedLeadOrigin` em `provider-purchase-routing.ts` (Uazapi e WAHA
  do aluno: `LeadSubmitted` com `sourceTrigger` `auto_lead` mais o
  `WebhookLog` de `source` `uazapi`/`waha` da mesma entrada, com
  `whatsappInstanceId`, `phoneHash` e `adId`). Não filtre os números pelo
  provedor da âncora da regra: o lead pode vir de qualquer conexão.
- Âncora: a API escolhe uma conexão de WhatsApp viva (produção primeiro, depois
  a mais antiga) e troca a âncora quando ela é pausada ou removida
  (`provider-rule-reanchor.ts`, `reanchorWebhookRules`). A tela nunca manda
  `connectionId` para esta origem.
- Duplicidade: `apps/api/src/conversion-rules/webhook-purchase-dedupe.ts` e a
  trava de 12h em `inbound-conversion-automation-ingestion.service.ts`
  (`findWebhookRepeatedCall`, motivo `webhook_event_repeated`).
- Regras (todos os números, uma por evento, sem frases/etiquetas, URL própria
  sempre ligada): `apps/api/src/conversion-rules/webhook-rule-policy.ts` e
  `provider-conversion-rules.service.ts`.
- Tela: `apps/web/src/app/(app)/conversions/webhook-view.ts` e
  `value-source-fields.tsx` (valor recebido ou fixo). O fluxo baixável fica em
  `apps/web/public/integrations/n8n/webhook-conversao.json` e precisa ser
  idêntico a `docs/setup/n8n/webhook-conversao.json` (há teste).
- Nenhuma variável de ambiente nova. Depende das que já existem para as
  regras de conversão (`INBOUND_WEBHOOKS_ENABLED`,
  `INBOUND_CONVERSION_RULES_ENABLED`, `INBOUND_WEBHOOK_PRODUCTION_ENABLED`).
- Migrations: `20261105120000_webhook_provider` e
  `20261105120100_webhook_parser_release` (dois arquivos: um valor novo de enum
  não pode ser usado na mesma migration).
- Testes: `apps/api/test/fase6-webhook-n8n/`, `packages/shared/tests/webhook.test.ts`
  e `apps/web/tests/webhook-integration.test.ts`.
- Ao mexer nesta origem, preserve: regra nascendo em observação, licença,
  onboarding, App ID/App Secret por conexão, reenvio de evento recusado e o
  rodapé "RastrackDash · powered by PalmUP".

## PENDENTE

- PENDENTE: importar o fluxo numa instância real do n8n e chamar uma regra de
  teste de ponta a ponta (validado só pela estrutura do JSON e por testes
  automatizados com dados fictícios).
- PENDENTE: confirmar com um painel real o formato do webhook de "mensagem
  enviada" (o fluxo pronto espera `body.phone`, `body.message`,
  `body.message_id`).
- PENDENTE: em produção, um lead do anúncio cujo envio cai na prova pelo
  destino do clique (sem rota de anúncio resolvida) é recusado com
  `ctwa_click_mismatch`, porque a chamada do webhook não traz `ctwa_clid`.
  Mesmo comportamento do SaaS; falha fechada (nada errado vai à Meta).

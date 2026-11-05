-- Leitor do Webhook / n8n (webhook/automation-v1), CERTIFICADO.
--
-- Produção direta do leitor (regra fixa do nod): o contrato é nosso
-- (docs/setup/n8n/README.md), não é lido de um terceiro, e nasce certificado
-- também no SaaS (20261105120100, 098d0950). O aluno não certifica nem libera
-- nada.
--
-- Nada é ativado além da release: cada regra de Webhook / n8n nasce em
-- observação (mostra o que enviaria, sem enviar à Meta) e só envia depois que
-- o aluno ativar a produção da regra, sujeita às travas reais (licença
-- utilizável, rota Meta válida, destino com pixel e página).
-- Aditiva e idempotente: uma release já existente não é alterada.
INSERT INTO "InboundWebhookParserRelease" (
  "id",
  "provider",
  "version",
  "status",
  "certifiedAt",
  "createdAt",
  "updatedAt"
) VALUES (
  'inbound_parser_webhook_automation_v1',
  'webhook',
  'automation-v1',
  'certified',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("provider", "version") DO NOTHING;

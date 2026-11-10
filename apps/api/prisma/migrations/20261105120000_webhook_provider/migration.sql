-- Webhook / n8n (automação genérica -> conversão, URL por regra): só valores
-- de enum. Porte do SaaS 20261105120000_webhook_provider (098d0950, #235).
-- IMPORTANTE: nenhuma linha que use 'webhook' entra nesta mesma migration.
-- O PostgreSQL não deixa usar um valor de enum recém-criado antes do commit,
-- e o Prisma envolve cada migration numa transação (ADD VALUE + INSERT = P3009).
-- O release do leitor fica na migration seguinte (20261105120100).
-- Aditiva e idempotente (IF NOT EXISTS).
ALTER TYPE "InboundWebhookProvider" ADD VALUE IF NOT EXISTS 'webhook';
ALTER TYPE "DiagnosticSource" ADD VALUE IF NOT EXISTS 'webhook';

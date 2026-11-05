import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(
    resolve(__dirname, "../../prisma/migrations", name, "migration.sql"),
    "utf8",
  );

describe("Webhook / n8n provider migrations (text only)", () => {
  const providerMigration = read("20261105120000_webhook_provider");
  const releaseMigration = read("20261105120100_webhook_parser_release");

  it("adds the enum values without inserting webhook rows in the same file", () => {
    expect(providerMigration).toContain(
      `ALTER TYPE "InboundWebhookProvider" ADD VALUE IF NOT EXISTS 'webhook'`,
    );
    expect(providerMigration).toContain(
      `ALTER TYPE "DiagnosticSource" ADD VALUE IF NOT EXISTS 'webhook'`,
    );
    expect(providerMigration).not.toMatch(/INSERT INTO/iu);
    expect(providerMigration).not.toContain("WhatsappSeatProvider");
  });

  it("is additive only (no DROP/DELETE/UPDATE/ALTER COLUMN)", () => {
    for (const sql of [providerMigration, releaseMigration]) {
      expect(sql).not.toMatch(
        /\bDROP\b|\bDELETE\b|\bUPDATE\s+"|\bALTER\s+COLUMN\b|\bTRUNCATE\b/iu,
      );
    }
  });

  it("seeds the automation-v1 release certified, idempotent", () => {
    expect(releaseMigration).toContain("'inbound_parser_webhook_automation_v1'");
    expect(releaseMigration).toMatch(
      /'webhook',\s*'automation-v1',\s*'certified'/u,
    );
    // Production direct of the reader only: every rule still starts in
    // observation (provider-conversion-rules.service.ts).
    expect(releaseMigration).not.toContain("ProviderConversionRuleConfig");
    expect(releaseMigration).toContain(
      'ON CONFLICT ("provider", "version") DO NOTHING',
    );
  });
});

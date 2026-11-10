import { describe, expect, it } from "vitest";
import {
  inboundWebhookProviders,
  isWebhookProvider,
  providerConversionRuleCreateInputSchema,
  providerConversionRuleOrigins,
  providerConversionRuleSchema,
  providerConversionRuleUpdateInputSchema,
} from "../src";

const base = {
  name: "Webhook / n8n: Lead qualificado",
  scope: "all_numbers" as const,
  channelIds: [],
  mode: "observation" as const,
  triggerType: "provider_automation" as const,
  automationSource: "webhook" as const,
  eventName: "QualifiedLead" as const,
};

describe("Webhook / n8n rule contract", () => {
  it("is a public provider and origin; a rule for all numbers needs no value", () => {
    expect(providerConversionRuleCreateInputSchema.safeParse(base).success).toBe(true);
    expect(isWebhookProvider("webhook")).toBe(true);
    expect(providerConversionRuleOrigins).toContain("automation_webhook");
    expect(inboundWebhookProviders).toContain("webhook");
  });

  it("Purchase: 'valor recebido' needs no fixed value; 'valor fixo' does", () => {
    const purchase = { ...base, eventName: "Purchase" as const };
    const parse = (input: object) =>
      providerConversionRuleCreateInputSchema.safeParse(input).success;
    expect(parse({ ...purchase, webhookValueSource: "received" })).toBe(true);
    expect(parse(purchase)).toBe(true);
    expect(parse({ ...purchase, webhookValueSource: "fixed" })).toBe(false);
    expect(
      parse({ ...purchase, webhookValueSource: "fixed", defaultValueCents: 150000 }),
    ).toBe(true);
  });

  it("refuses specific numbers, phrases, a closed URL and the source elsewhere", () => {
    const refused = [
      { ...base, scope: "specific_numbers", channelIds: ["channel_1"] },
      { ...base, triggerPhrases: ["comprou"] },
      { ...base, perRuleUrl: false },
      { ...base, eventName: "LeadSubmitted" },
      {
        ...base,
        automationSource: "roichat",
        eventName: "Purchase",
        webhookValueSource: "received",
      },
    ];
    for (const input of refused) {
      expect(providerConversionRuleCreateInputSchema.safeParse(input).success).toBe(
        false,
      );
    }
  });

  it("updates the value source and exposes it on the rule", () => {
    expect(
      providerConversionRuleUpdateInputSchema.safeParse({ webhookValueSource: "fixed" })
        .success,
    ).toBe(true);
    expect(
      providerConversionRuleSchema.shape.webhookValueSource.safeParse("received").success,
    ).toBe(true);
  });
});

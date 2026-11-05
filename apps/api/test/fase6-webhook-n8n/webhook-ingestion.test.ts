import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createHarness, input } from "../fase4-payt/payt-ingestion-harness";

/**
 * Webhook / n8n on the rule's own URL (porte do SaaS 098d0950,
 * inbound-conversion-automation-ingestion.test.ts). The rule is anchored on a
 * WhatsApp connection of the student (Meta Cloud, Uazapi or WAHA by URL +
 * token...); its stored parser release is Webhook's. Fictitious data only.
 */

const webhookBody = () =>
  JSON.parse(
    readFileSync(
      resolve(__dirname, "../fixtures/webhook/purchase.synthetic.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;

function webhookHarness(
  eventName: "QualifiedLead" | "Purchase",
  rule: { source: "received" | "fixed"; cents: number | null } = {
    source: "received",
    cents: null,
  },
  anchor: "meta_cloud" | "uazapi" | "waha" = "meta_cloud",
) {
  const harness = createHarness({ eventName });
  const providerRule = harness.endpoint.providerRule as any;
  // Anchored on a WhatsApp connection of the student; the release names Webhook.
  providerRule.connection.provider = anchor;
  providerRule.connection.parserRelease.provider = anchor;
  providerRule.parserRelease.provider = "webhook";
  providerRule.parserRelease.id = "inbound_parser_webhook_automation_v1";
  providerRule.parserReleaseId = "inbound_parser_webhook_automation_v1";
  providerRule.conversionRule.name = "Webhook / n8n: Compra";
  providerRule.conversionRule.defaultValueCents = rule.cents;
  providerRule.conversionRule.defaultCurrency = null;
  providerRule.conversionRule.defaultItems = {
    webhookValueSource: rule.source,
  };
  // The fake storage does not read JSON paths: the 12h resend guard does.
  const original = harness.prisma.inboundWebhookDelivery.findFirst;
  const fallback = original.getMockImplementation()!;
  original.mockImplementation(async (args: any) => {
    const path = args?.where?.normalizedSummary?.path;
    if (!path) return fallback(args);
    const match = [...harness.deliveries.values()].find(
      (delivery: any) =>
        delivery.providerRuleEndpointId === args.where.providerRuleEndpointId &&
        delivery.normalizedSummary?.[path[0]] ===
          args.where.normalizedSummary.equals &&
        delivery.firstReceivedAt >= args.where.firstReceivedAt.gte,
    );
    return match
      ? { id: match.id, firstReceivedAt: match.firstReceivedAt }
      : null;
  });
  return harness;
}
const send = (harness: ReturnType<typeof webhookHarness>, body: unknown) =>
  harness.service.ingest(input(Buffer.from(JSON.stringify(body))));

describe("Webhook / n8n on the rule's own URL", () => {
  it("takes the event from the rule, reads the n8n item and dedupes the resend by message_id", async () => {
    const harness = webhookHarness("Purchase");
    const body = webhookBody();
    const first = await send(harness, body);
    expect(first).toMatchObject({ status: "accepted", duplicate: false });
    expect(
      harness.conversionObservation.observeAutomation,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        automation: expect.objectContaining({
          provider: "webhook",
          eventName: "Purchase",
          valueCents: 200000,
          currency: "BRL",
          phoneNumberId: "100000000000001",
          hasMessageId: true,
          externalExecutionKey: expect.stringMatching(
            /^webhook-message:[0-9a-f]{64}$/u,
          ),
        }),
      }),
    );
    // The same call (same message_id) wrapped like an n8n item: same delivery.
    const resend = await send(harness, [{ headers: {}, body }]);
    expect(resend).toMatchObject({
      deliveryId: first.deliveryId,
      duplicate: true,
    });
    expect(harness.deliveries.size).toBe(1);
    const stored = [...harness.deliveries.values()][0]!;
    expect(stored.normalizedSummary).toMatchObject({
      webhookValueStatus: "valid",
      webhookHasMessageId: true,
      webhookFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    // No contact data in the stored summary.
    expect(JSON.stringify(stored.normalizedSummary)).not.toContain(
      "5511900000002",
    );
  });

  it("two purchases of the same lead on the same day with different message_id are two deliveries", async () => {
    const harness = webhookHarness("Purchase");
    const first = await send(harness, { ...webhookBody(), message_id: "m-1" });
    const second = await send(harness, { ...webhookBody(), message_id: "m-2" });
    expect(second.deliveryId).not.toBe(first.deliveryId);
    expect(second.duplicate).toBe(false);
    expect(harness.deliveries.size).toBe(2);
    expect(
      harness.conversionObservation.observeAutomation,
    ).toHaveBeenCalledTimes(2);
  });

  it("without message_id: the same value again is a resend, another value is another purchase", async () => {
    const harness = webhookHarness("Purchase");
    const { message_id: _ignored, ...withoutId } = webhookBody();
    const first = await send(harness, withoutId);
    const resend = await send(harness, { body: withoutId });
    expect(resend).toMatchObject({
      deliveryId: first.deliveryId,
      duplicate: true,
      observationStatus: "duplicate",
    });
    const other = await send(harness, { ...withoutId, value: 3500 });
    expect(other.duplicate).toBe(false);
    expect(harness.deliveries.size).toBe(2);
  });

  it("QualifiedLead: the lead is the occurrence (message_id ignored)", async () => {
    const harness = webhookHarness("QualifiedLead");
    const first = await send(harness, { phone: "5511900000002", message_id: "a" });
    const again = await send(harness, { phone: "5511900000002", message_id: "b" });
    expect(again).toMatchObject({ deliveryId: first.deliveryId, duplicate: true });
  });

  it("a purchase without value and without a fixed value is recorded with a clear reason", async () => {
    const harness = webhookHarness("Purchase");
    const result = await send(harness, { phone: "5511900000002" });
    expect(result.observationStatus).toBe("invalid_payload");
    expect([...harness.deliveries.values()][0]).toMatchObject({
      parseErrorCode: "webhook_value_missing",
    });
    expect(
      harness.conversionObservation.observeAutomation,
    ).not.toHaveBeenCalled();
  });

  it("'valor fixo' uses the rule's value even when the call carries one", async () => {
    const harness = webhookHarness("Purchase", { source: "fixed", cents: 150000 });
    await send(harness, webhookBody());
    expect(
      harness.conversionObservation.observeAutomation,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        automation: expect.objectContaining({ valueCents: null }),
      }),
    );
  });

  it("a lead with an entry on two numbers is listed as blocked with its own reason", async () => {
    const harness = webhookHarness("QualifiedLead");
    harness.conversionObservation.observeAutomation.mockResolvedValueOnce({
      decisionId: null,
      decisionCode: null,
      reasonCode: "contact_multiple_numbers",
      disposition: "blocked",
      executionId: null,
      eligibleExecutionId: null,
      reviewId: null,
      channelId: null,
      leadResolved: true,
      webhookNumberMatch: "not_informed",
    });
    const result = await send(harness, { phone: "5511900000002" });
    expect(result.observationStatus).toBe("blocked");
    const stored = [...harness.deliveries.values()][0]!;
    expect(stored.normalizedSummary).toMatchObject({
      reasonCode: "contact_multiple_numbers",
      webhookNumberMatch: "not_informed",
    });
  });

  it.each(["uazapi", "waha"] as const)(
    "the URL also works when the anchor is the student's %s connection (URL + token)",
    async (anchor) => {
      const harness = webhookHarness("QualifiedLead", undefined, anchor);
      const result = await send(harness, { phone: "5511900000002" });
      expect(result).toMatchObject({ status: "accepted", duplicate: false });
      expect(
        harness.conversionObservation.observeAutomation,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          automation: expect.objectContaining({
            provider: "webhook",
            eventName: "QualifiedLead",
          }),
        }),
      );
    },
  );
});

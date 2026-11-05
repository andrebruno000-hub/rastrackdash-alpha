import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  WEBHOOK_MESSAGE_KEY_PREFIX,
  parseWebhookForRule,
  readWebhookValueSource,
  unwrapWebhookBody,
  webhookReceivedValue,
  webhookRuleConfig,
} from "../../src/inbound-webhooks/providers/webhook/webhook-automation-v1.parser";

/** Webhook / n8n automation-v1: contract of docs/setup/n8n/README.md. Fictitious data. */

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(resolve(__dirname, "../fixtures/webhook", name), "utf8"),
  ) as unknown;
const receivedAt = new Date("2026-11-05T15:00:00.000Z");
const purchaseRule = (
  source: "received" | "fixed" = "received",
  cents: number | null = null,
) => ({
  eventName: "Purchase",
  defaultValueCents: cents,
  defaultItems: webhookRuleConfig(source),
});
const qualifiedRule = {
  eventName: "QualifiedLead",
  defaultValueCents: null,
  defaultItems: webhookRuleConfig("received"),
};
const ok = (result: ReturnType<typeof parseWebhookForRule>) => {
  if (!result.ok) throw new Error(result.errorCode);
  return result.value;
};

describe("Webhook / n8n parser: every n8n wrapper", () => {
  const body = fixture("purchase.synthetic.json") as Record<string, unknown>;
  it.each([
    ["corpo puro", body],
    ["item do n8n [{ headers, body }]", [{ headers: { a: "b" }, body }]],
    ["{ body }", { body }],
    ["{ json }", { json: body }],
    ["[{ json }]", [{ json: body }]],
    ["{ json: { body } }", { json: { headers: {}, body } }],
    ["lista de um item", [body]],
  ])("%s", (_label, payload) => {
    expect(unwrapWebhookBody(payload)).toEqual(body);
    const parsed = ok(parseWebhookForRule(payload, receivedAt, purchaseRule()));
    expect(parsed).toMatchObject({
      provider: "webhook",
      eventName: "Purchase",
      phone: "5511900000002",
      phoneNumberId: "100000000000001",
      hasMessageId: true,
      valueCents: 200000,
      currency: "BRL",
    });
    expect(parsed.externalExecutionKey.startsWith(WEBHOOK_MESSAGE_KEY_PREFIX)).toBe(true);
  });

  it("the real n8n Webhook item (headers, params, query, body) reads the body only", () => {
    const parsed = ok(
      parseWebhookForRule(
        fixture("n8n-item.synthetic.json"),
        receivedAt,
        qualifiedRule,
      ),
    );
    expect(parsed).toMatchObject({
      eventName: "QualifiedLead",
      phone: "5511900000002",
      phoneNumberId: "100000000000001",
      valueCents: null,
      fingerprint: null,
    });
  });

  it("{ json } with value in text (comma) and lower-case currency", () => {
    const parsed = ok(
      parseWebhookForRule(fixture("json-item.synthetic.json"), receivedAt, purchaseRule()),
    );
    expect(parsed).toMatchObject({ valueCents: 199790, currency: "BRL", hasMessageId: false });
  });

  it("a list of two items or an unknown shape is refused, never guessed", () => {
    expect(unwrapWebhookBody([body, body])).toBeNull();
    expect(
      parseWebhookForRule({ foo: "bar" }, receivedAt, purchaseRule()),
    ).toEqual({ ok: false, errorCode: "webhook_automation_v1_invalid_payload" });
    expect(parseWebhookForRule("texto", receivedAt, purchaseRule())).toEqual({
      ok: false,
      errorCode: "webhook_automation_v1_invalid_payload",
    });
  });
});

describe("Webhook / n8n parser: phone, value and keys", () => {
  it("requires the phone", () => {
    expect(
      parseWebhookForRule({ value: 10, phone: "" }, receivedAt, purchaseRule()),
    ).toEqual({ ok: false, errorCode: "webhook_phone_missing" });
  });

  it("value in reais; invalid or missing value without a fixed value has a clear reason", () => {
    expect(webhookReceivedValue("2.000,00", "BRL").status).toBe("invalid");
    expect(webhookReceivedValue(-5, "BRL").status).toBe("invalid");
    expect(webhookReceivedValue(10, "XYZ").status).toBe("invalid");
    expect(webhookReceivedValue(undefined, undefined).status).toBe("missing");
    expect(
      parseWebhookForRule({ phone: "5511900000002", value: "abc" }, receivedAt, purchaseRule()),
    ).toEqual({ ok: false, errorCode: "webhook_value_invalid" });
    expect(
      parseWebhookForRule({ phone: "5511900000002" }, receivedAt, purchaseRule()),
    ).toEqual({ ok: false, errorCode: "webhook_value_missing" });
  });

  it("a missing value falls back to the rule's fixed value; 'valor fixo' ignores the received one", () => {
    const fallback = ok(
      parseWebhookForRule({ phone: "5511900000002" }, receivedAt, purchaseRule("received", 15000)),
    );
    expect(fallback.valueCents).toBeNull();
    const fixed = ok(
      parseWebhookForRule(
        { phone: "5511900000002", value: 99, currency: "BRL" },
        receivedAt,
        purchaseRule("fixed", 15000),
      ),
    );
    expect(fixed.valueCents).toBeNull();
    expect(readWebhookValueSource({ webhookValueSource: "fixed" })).toBe("fixed");
    expect(readWebhookValueSource(null)).toBe("received");
  });

  it("an unresolved n8n expression is not a message_id nor a phone_number_id", () => {
    const parsed = ok(
      parseWebhookForRule(
        {
          phone: "5511900000002",
          value: 10,
          message_id: "{{ $json.body.message_id }}",
          phone_number_id: "undefined",
        },
        receivedAt,
        purchaseRule(),
      ),
    );
    expect(parsed).toMatchObject({ hasMessageId: false, phoneNumberId: null });
  });

  it("QualifiedLead: one key per lead, the same for 55/9th digit forms and any message_id", () => {
    const a = ok(parseWebhookForRule({ phone: "5511900000002", message_id: "x" }, receivedAt, qualifiedRule));
    const b = ok(
      parseWebhookForRule(
        { phone: "+55 11 90000-0002", message_id: "y" },
        new Date("2026-11-20T10:00:00.000Z"),
        qualifiedRule,
      ),
    );
    expect(a.externalExecutionKey).toBe(b.externalExecutionKey);
  });

  it("Purchase: same message_id = same key at any time; without it the arrival is in the key and the fingerprint is the value", () => {
    const later = new Date("2026-11-05T18:00:00.000Z");
    const withId = (at: Date, id: string) =>
      ok(parseWebhookForRule({ phone: "5511900000002", value: 20, message_id: id }, at, purchaseRule()));
    expect(withId(receivedAt, "m1").externalExecutionKey).toBe(
      withId(later, "m1").externalExecutionKey,
    );
    expect(withId(receivedAt, "m1").externalExecutionKey).not.toBe(
      withId(receivedAt, "m2").externalExecutionKey,
    );
    const noId = (at: Date, value: number) =>
      ok(parseWebhookForRule({ phone: "5511900000002", value }, at, purchaseRule()));
    expect(noId(receivedAt, 20).externalExecutionKey).not.toBe(
      noId(later, 20).externalExecutionKey,
    );
    expect(noId(receivedAt, 20).fingerprint).toBe(noId(later, 20).fingerprint);
    expect(noId(receivedAt, 20).fingerprint).not.toBe(noId(later, 35).fingerprint);
  });
});

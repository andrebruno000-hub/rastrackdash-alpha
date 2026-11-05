import { describe, expect, it } from "vitest";
import {
  webhookAutomationConversionIdentity,
  webhookDedupePolicy,
} from "../../src/conversion-rules/webhook-purchase-dedupe";

/** Webhook / n8n business dedupe (the production applies it under its lock). */

const input = (over: {
  eventName?: string;
  occurrenceKey?: string;
  provider?: string;
  value?: number | null;
  channelId?: string;
}) =>
  ({
    rule: { eventName: over.eventName ?? "Purchase" },
    occurrence: {
      source: "automation",
      provider: over.provider ?? "webhook",
      workspaceId: "workspace_1",
      connectionId: "connection_anchor",
      channelId: over.channelId ?? "channel_a",
      occurrenceKey: over.occurrenceKey ?? "webhook-automation:abc",
      observedValueCents: over.value === undefined ? 200000 : over.value,
      observedCurrency: "BRL",
    },
    leadResolution: { status: "resolved", lead: { id: "lead_1" } },
  }) as never;

describe("webhookDedupePolicy", () => {
  it("only for Webhook window events (QualifiedLead keeps the lifetime lock)", () => {
    expect(webhookDedupePolicy(input({ eventName: "QualifiedLead" }))).toBeNull();
    expect(webhookDedupePolicy(input({ provider: "roichat" }))).toBeNull();
  });

  it("with message_id: the id is in the scope (two ids = two purchases), 30 days", () => {
    const a = webhookDedupePolicy(input({ occurrenceKey: "webhook-message:1" }))!;
    const b = webhookDedupePolicy(input({ occurrenceKey: "webhook-message:2" }))!;
    expect(a).toMatchObject({ mode: "rolling_window", windowSeconds: 2_592_000 });
    expect(a.scopeKey).not.toBe(b.scopeKey);
  });

  it("without message_id: lead + number + value + currency within 12h", () => {
    const first = webhookDedupePolicy(input({ occurrenceKey: "webhook-automation:t1" }))!;
    const resend = webhookDedupePolicy(input({ occurrenceKey: "webhook-automation:t2" }))!;
    const other = webhookDedupePolicy(input({ value: 350000 }))!;
    expect(first).toMatchObject({ mode: "rolling_window", windowSeconds: 43_200 });
    // Arrival is not in the scope: the same call later is the same purchase.
    expect(first.scopeKey).toBe(resend.scopeKey);
    expect(other.scopeKey).not.toBe(first.scopeKey);
  });

  it("the Meta identity comes from the occurrence, not from the execution", () => {
    const id = (key: string) =>
      webhookAutomationConversionIdentity({
        workspaceId: "workspace_1",
        eventName: "Purchase",
        occurrenceKey: key,
      });
    expect(id("webhook-message:1")).toBe(id("webhook-message:1"));
    expect(id("webhook-message:1")).not.toBe(id("webhook-message:2"));
  });
});

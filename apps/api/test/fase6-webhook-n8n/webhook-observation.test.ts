import { describe, expect, it, vi } from "vitest";
import { hashPhoneIdentity } from "../../src/common/phone/phone-identity";
import { ProviderConversionDecisionEngine } from "../../src/conversion-rules/provider-conversion-decision.engine";
import { ProviderConversionObservationService } from "../../src/conversion-rules/provider-conversion-observation.service";
import { parseWebhookForRule } from "../../src/inbound-webhooks/providers/webhook/webhook-automation-v1.parser";

/**
 * Webhook / n8n (URL per rule) in the real observation service, routing and
 * decision engine (storage is a fake). Porte do SaaS 098d0950
 * (webhook-automation-observation.test.ts) with the student connections: the
 * rule is anchored on one WhatsApp connection; the conversion lands on the
 * number the PAID lead's current click came through, whatever the connection
 * (Meta Cloud, the student's own Uazapi and WAHA connected by URL + token,
 * Umbler, Unnichat, ROI Chat, DataCrazy, Gupshup). `phone_number_id` only
 * breaks a tie. Fictitious data only.
 */

const workspaceId = "workspace_webhook";
const activatedAt = new Date("2026-10-01T00:00:00.000Z");
const receivedAt = new Date("2026-11-05T15:00:00.000Z");
const entryAt = new Date("2026-11-04T12:00:00.000Z");
const env = {
  NODE_ENV: "test",
  API_PUBLIC_URL: "http://localhost:3333",
  INBOUND_WEBHOOKS_ENABLED: "true",
  INBOUND_WEBHOOK_PRODUCTION_ENABLED: "true",
  INBOUND_CONVERSION_RULES_ENABLED: "true",
  INBOUND_CONVERSION_PRODUCTION_ENABLED: "true",
  INBOUND_WEBHOOK_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
};
const phone = "5511900000001";
const phoneHash = hashPhoneIdentity(phone)!;

type Number = {
  channelId: string;
  connectionId: string;
  provider: string;
  /** Meta Cloud: phone_number_id; others: their own channel id. */
  providerChannelId: string;
  connectedPhone: string;
  /** Uazapi/WAHA of the student (bridged WhatsappInstance) only. */
  instanceId?: string;
};
const number = (
  provider: string,
  suffix: string,
  extra: Partial<Number> = {},
): Number => ({
  channelId: `ch_${provider}_${suffix}`,
  connectionId: `conn_${provider}_${suffix}`,
  provider,
  providerChannelId: `pcid_${provider}_${suffix}`,
  connectedPhone: `55119888800${suffix}`,
  ...extra,
});
// Two numbers of the SAME Meta app (each its own Meta Cloud connection).
const cloudA = number("meta_cloud", "01", { providerChannelId: "100000000000001" });
const cloudB = number("meta_cloud", "02", { providerChannelId: "100000000000002" });
// The student's own Uazapi and WAHA (URL + token): bridged instances.
const uazapi = number("uazapi", "03", { instanceId: "instance_uazapi_03" });
const uazapi2 = number("uazapi", "04", { instanceId: "instance_uazapi_04" });
const waha = number("waha", "08", { instanceId: "instance_waha_08" });
const umbler = number("umbler", "05");
const unnichat = number("unnichat", "06");
const roichat = number("roichat", "07");
const datacrazy = number("data_crazy", "09");
const gupshup = number("gupshup", "10");
const numbers = [
  cloudA,
  cloudB,
  uazapi,
  uazapi2,
  waha,
  umbler,
  unnichat,
  roichat,
  datacrazy,
  gupshup,
];

const connection = (n: Number) => ({
  id: n.connectionId,
  provider: n.provider,
  status: "production",
  removedAt: null,
  parserReleaseId: `release_${n.provider}_v1`,
  parserRelease: {
    id: `release_${n.provider}_v1`,
    provider: n.provider,
    version: "v1",
    status: "certified",
  },
  productionActivatedAt: activatedAt,
});

type EventName = "QualifiedLead" | "Purchase";
function ruleFor(
  eventName: EventName,
  mode = "production",
  value: { source: "received" | "fixed"; cents: number | null } = {
    source: "received",
    cents: null,
  },
) {
  return {
    id: `webhook_${eventName}`,
    workspaceId,
    // Anchor: the first Meta Cloud connection (it only stores the deliveries).
    connectionId: cloudA.connectionId,
    parserReleaseId: "inbound_parser_webhook_automation_v1",
    scope: "all_numbers",
    crossConnectionScope: null,
    mode,
    productionActivatedAt: mode === "production" ? activatedAt : null,
    removedAt: null,
    unifiedIntoProviderRuleId: null,
    createdAt: activatedAt,
    updatedAt: activatedAt,
    conversionRuleId: `conversion_${eventName}`,
    messageTriggerPhrases: [],
    messageAuthorScope: null,
    productFilterCodes: [],
    conversionRule: {
      id: `conversion_${eventName}`,
      active: true,
      triggerType: "provider_automation",
      eventName,
      defaultValueCents: eventName === "Purchase" ? value.cents : null,
      defaultCurrency: null,
      defaultContentName: null,
      defaultItems: { webhookValueSource: value.source },
      updatedAt: activatedAt,
    },
    connection: connection(cloudA),
    parserRelease: {
      id: "inbound_parser_webhook_automation_v1",
      provider: "webhook",
      version: "automation-v1",
      status: "certified",
    },
    channels: [],
    catalog: null,
  };
}

const channelRow = (n: Number) => ({
  id: n.channelId,
  connectionId: n.connectionId,
  organizationId: workspaceId,
  providerChannelId: n.providerChannelId,
  status: "active",
  productionActivatedAt: activatedAt,
  conversionEngineMode: "canonical",
});

function idsOf(where: any): string[] | null {
  if (!where?.id) return null;
  if (typeof where.id === "string") return [where.id];
  return where.id.in ?? null;
}

function harness(input: {
  rule: ReturnType<typeof ruleFor>;
  /** Numbers with an entry receipt of the lead's CURRENT click. */
  entries: Number[];
  /** Lead with its own ad attribution (lead pago). */
  lead?: "paid" | "organic" | "ambiguous";
  body?: Record<string, unknown>;
}) {
  const lead = input.lead ?? "paid";
  const inboundEntries = input.entries.filter((n) => !n.instanceId);
  const bridgedEntries = input.entries.filter((n) => n.instanceId);
  const prisma = {
    providerConversionRuleConfig: {
      findFirst: vi.fn(async () => input.rule),
      findMany: vi.fn(async () => []),
    },
    inboundWebhookChannel: {
      findMany: vi.fn(async ({ where }: any) => {
        const scoped = (list: Number[]) => {
          const ids = idsOf(where);
          return ids ? list.filter((n) => ids.includes(n.channelId)) : list;
        };
        // nod: the workspace scope scan also has an OR (suspended
        // instances); only the phone_number_id lookup names a number.
        if (
          where?.OR?.some(
            (clause: any) => "providerChannelId" in clause || "connectedPhone" in clause,
          )
        ) {
          // Number named by phone_number_id (or by the number itself).
          const named = where.OR.map(
            (clause: any) => clause.providerChannelId ?? clause.connectedPhone,
          );
          return scoped(
            numbers.filter(
              (n) =>
                named.includes(n.providerChannelId) ||
                named.includes(n.connectedPhone),
            ),
          ).map(channelRow);
        }
        if (where?.whatsappInstanceId) {
          const wanted =
            typeof where.whatsappInstanceId === "string"
              ? [where.whatsappInstanceId]
              : where.whatsappInstanceId.in;
          return scoped(
            numbers.filter((n) => n.instanceId && wanted.includes(n.instanceId)),
          ).map(channelRow);
        }
        if (idsOf(where)) return scoped(numbers).map(channelRow);
        // Workspace scope listing (every live number).
        return numbers.map((n, index) => ({
          id: n.channelId,
          connectionId: n.connectionId,
          status: "active",
          createdAt: new Date(activatedAt.getTime() + index * 1000),
          connectedPhone: n.connectedPhone,
          connection: { provider: n.provider },
          whatsappSeats: [],
          whatsappInstance: null,
        }));
      }),
      findFirst: vi.fn(async () => null),
    },
    inboundWebhookConnection: {
      findFirst: vi.fn(async ({ where }: any) => {
        const n = numbers.find((c) => c.connectionId === where.id);
        return n ? connection(n) : null;
      }),
    },
    conversionEventLog: {
      findMany: vi.fn(async ({ where }: any) => {
        // Uazapi/WAHA entry (auto_lead): one per lead + ad.
        if (where.sourceTrigger === "auto_lead") {
          return bridgedEntries.length > 0 ? [{ createdAt: entryAt }] : [];
        }
        // CTWA entry of every other connection (inbound_webhook:<provider>).
        return inboundEntries.map((n, index) => ({
          id: `entry_log_${index}`,
          sourcePayload: {
            inboundEventId: `entry_event_${index}`,
            channelId: n.channelId,
            connectionId: n.connectionId,
          },
        }));
      }),
    },
    inboundWebhookEvent: {
      findMany: vi.fn(async ({ where }: any) => {
        const proven = (where.OR ?? []).map((proof: any) => proof.channelId);
        return inboundEntries
          .filter(
            (n) =>
              where.channelId.in.includes(n.channelId) &&
              proven.includes(n.channelId),
          )
          .slice(0, 2)
          .map((n) => ({ channel: channelRow(n) }));
      }),
      findFirst: vi.fn(async () => null),
    },
    webhookLog: {
      findMany: vi.fn(async ({ where }: any) =>
        bridgedEntries
          // WebhookLog.source of the bridged numbers ("uazapi" | "waha").
          .filter((n) => where.source.in.includes(n.provider))
          .map((n) => ({ whatsappInstanceId: n.instanceId })),
      ),
    },
  };
  const decisions = {
    findLatestByOccurrence: vi.fn(async () => null),
    recordInitial: vi.fn(async ({ decision }: any) => ({
      id: "decision_1",
      workspaceId,
      providerRuleId: decision.rule.providerRuleId,
      decision,
      decisionCode: decision.decisionCode,
      reasonCode: decision.reasonCode,
      occurrenceKey: decision.occurrence.occurrenceKey,
      created: true,
    })),
  };
  const engine = new ProviderConversionDecisionEngine();
  const orchestrator = {
    orchestrate: vi.fn(async ({ disposition }: any) => ({
      executionId: "execution_1",
      eligibleExecutionId:
        disposition.state === "eligible" ? "execution_1" : null,
      reviewId: null,
    })),
  };
  const paidLeads = {
    resolve: vi.fn(async () =>
      lead === "paid"
        ? {
            status: "resolved",
            reasonCode: "paid_lead_resolved",
            lead: {
              id: "lead_1",
              phoneHash,
              campaignId: "campaign_1",
              adSetId: "adset_1",
              adId: "ad_1",
              ctwaClid: "click_current",
            },
          }
        : lead === "ambiguous"
          ? { status: "ambiguous", reasonCode: "buyer_ambiguous" }
          : {
              status: "not_found",
              reasonCode: "paid_attribution_missing",
              candidateLeadId: "lead_1",
            },
    ),
  };
  const service = new ProviderConversionObservationService(
    prisma as never,
    {
      evaluate: vi.fn(async ({ decisionInput }: any) =>
        engine.evaluate(decisionInput),
      ),
    } as never,
    decisions as never,
    paidLeads as never,
    orchestrator as never,
    env,
  );
  const parsed = parseWebhookForRule(
    input.body ?? { phone },
    receivedAt,
    input.rule.conversionRule,
  );
  if (!parsed.ok) throw new Error(`fixture: ${parsed.errorCode}`);
  const observe = () =>
    service.observeAutomation({
      workspaceId,
      connectionId: cloudA.connectionId,
      origin: null,
      deliveryId: "delivery_1",
      externalDeliveryId: null,
      deliveryReceivedAt: receivedAt,
      providerRuleId: input.rule.id,
      automation: parsed.value,
    } as never);
  const decision = () =>
    (decisions.recordInitial.mock.calls[0] as any)?.[0].decision;
  return { observe, paidLeads, decisions, decision, parsed: parsed.value };
}

describe("Webhook / n8n: the paid lead converts on its own number, from ANY connection", () => {
  it.each([
    ["Meta Cloud (API Oficial)", cloudA],
    ["Uazapi do aluno (URL + token, entrada auto_lead)", uazapi],
    ["WAHA do aluno (URL + token, entrada auto_lead)", waha],
    ["Umbler", umbler],
    ["Unnichat", unnichat],
    ["ROI Chat", roichat],
    ["DataCrazy", datacrazy],
    ["Gupshup", gupshup],
  ])("lead que entrou por %s", async (_label, origin) => {
    const h = harness({ rule: ruleFor("QualifiedLead"), entries: [origin] });
    const result = await h.observe();
    expect(result).toMatchObject({
      disposition: "eligible",
      channelId: origin.channelId,
      leadResolved: true,
      webhookNumberMatch: "not_informed",
    });
    // Any paid lead of the phone: also the page/pixel CTWA proof.
    expect((h.paidLeads.resolve.mock.calls[0] as unknown[])[0]).toMatchObject({
      ctwaProofAnyChannel: true,
    });
    expect(h.decision().occurrence).toMatchObject({
      provider: "webhook",
      source: "automation",
      eventName: "QualifiedLead",
      channelId: origin.channelId,
      occurrenceKey: h.parsed.externalExecutionKey,
    });
    expect(h.decision().occurrence.businessDedupePolicy.mode).toBe("lifetime");
  });

  it("an organic contact is not attributable (ignored, never a decision)", async () => {
    const h = harness({
      rule: ruleFor("QualifiedLead"),
      entries: [],
      lead: "organic",
    });
    const result = await h.observe();
    expect(result).toMatchObject({
      disposition: "ignored",
      reasonCode: "contact_not_paid_lead",
      decisionId: null,
    });
    expect(h.decisions.recordInitial).not.toHaveBeenCalled();
  });

  it("two leads with the phone stay blocked as ambiguous", async () => {
    const h = harness({
      rule: ruleFor("QualifiedLead"),
      entries: [cloudA],
      lead: "ambiguous",
    });
    expect(await h.observe()).toMatchObject({
      disposition: "blocked",
      reasonCode: "buyer_ambiguous",
    });
  });

  it("a paid lead without any entry and no number informed stays blocked", async () => {
    const h = harness({ rule: ruleFor("QualifiedLead"), entries: [] });
    expect(await h.observe()).toMatchObject({
      disposition: "blocked",
      reasonCode: "origin_channel_unresolved",
    });
  });

  it("a rule still in observation records the decision without sending", async () => {
    const h = harness({
      rule: ruleFor("QualifiedLead", "observation"),
      entries: [cloudA],
    });
    const result = await h.observe();
    expect(result.disposition).toBe("observed");
    expect(result.eligibleExecutionId).toBeNull();
  });
});

describe("Webhook / n8n: two numbers and phone_number_id", () => {
  it("the current click's number wins even when another number is informed", async () => {
    // Clicked the ad of A; the attendant answered from B (same Meta app).
    const h = harness({
      rule: ruleFor("QualifiedLead"),
      entries: [cloudA],
      body: { phone, phone_number_id: cloudB.providerChannelId },
    });
    expect(await h.observe()).toMatchObject({
      disposition: "eligible",
      channelId: cloudA.channelId,
      webhookNumberMatch: "other_number",
    });
  });

  it("the informed number is confirmed when it has the entry", async () => {
    const h = harness({
      rule: ruleFor("QualifiedLead"),
      entries: [cloudB],
      body: { phone, phone_number_id: cloudB.providerChannelId },
    });
    expect(await h.observe()).toMatchObject({
      channelId: cloudB.channelId,
      webhookNumberMatch: "entry_number",
    });
  });

  it("the same click on two numbers: blocked without phone_number_id, never guessed", async () => {
    const h = harness({
      rule: ruleFor("QualifiedLead"),
      entries: [cloudA, cloudB],
    });
    expect(await h.observe()).toMatchObject({
      disposition: "blocked",
      reasonCode: "contact_multiple_numbers",
      webhookNumberMatch: "not_informed",
    });
    expect(h.decisions.recordInitial).not.toHaveBeenCalled();
  });

  it("the same click on two numbers: phone_number_id breaks the tie", async () => {
    const h = harness({
      rule: ruleFor("QualifiedLead"),
      entries: [cloudA, cloudB],
      body: { phone, phone_number_id: cloudB.providerChannelId },
    });
    expect(await h.observe()).toMatchObject({
      disposition: "eligible",
      channelId: cloudB.channelId,
      webhookNumberMatch: "entry_number",
    });
  });

  it("an unknown phone_number_id does not break a tie", async () => {
    const h = harness({
      rule: ruleFor("QualifiedLead"),
      entries: [cloudA, cloudB],
      body: { phone, phone_number_id: "999999999999999" },
    });
    expect(await h.observe()).toMatchObject({
      disposition: "blocked",
      reasonCode: "contact_multiple_numbers",
      webhookNumberMatch: "unknown_number",
    });
  });

  it("two Uazapi numbers of the student: the informed number (its own phone) breaks the tie", async () => {
    const tie = harness({
      rule: ruleFor("QualifiedLead"),
      entries: [uazapi, uazapi2],
    });
    expect(await tie.observe()).toMatchObject({
      disposition: "blocked",
      reasonCode: "contact_multiple_numbers",
    });
    const named = harness({
      rule: ruleFor("QualifiedLead"),
      entries: [uazapi, uazapi2],
      body: { phone, phone_number_id: uazapi2.connectedPhone },
    });
    expect(await named.observe()).toMatchObject({
      disposition: "eligible",
      channelId: uazapi2.channelId,
      webhookNumberMatch: "entry_number",
    });
  });

  it("the same click on a Uazapi and a WAHA number of the student: tie, broken by the named number", async () => {
    const tie = harness({
      rule: ruleFor("QualifiedLead"),
      entries: [uazapi, waha],
    });
    expect(await tie.observe()).toMatchObject({
      disposition: "blocked",
      reasonCode: "contact_multiple_numbers",
    });
    const named = harness({
      rule: ruleFor("QualifiedLead"),
      entries: [uazapi, waha],
      body: { phone, phone_number_id: waha.connectedPhone },
    });
    expect(await named.observe()).toMatchObject({
      disposition: "eligible",
      channelId: waha.channelId,
      webhookNumberMatch: "entry_number",
    });
  });

  it("coexistence: the click entered by the student's Uazapi, the attendant answered by Meta Cloud: the Uazapi number keeps it", async () => {
    const h = harness({
      rule: ruleFor("QualifiedLead"),
      entries: [uazapi],
      body: { phone, phone_number_id: cloudA.providerChannelId },
    });
    expect(await h.observe()).toMatchObject({
      disposition: "eligible",
      channelId: uazapi.channelId,
      webhookNumberMatch: "other_number",
    });
  });

  it("a paid lead without entry receipt goes to the informed number of the account", async () => {
    const h = harness({
      rule: ruleFor("QualifiedLead"),
      entries: [],
      body: { phone, phone_number_id: cloudB.providerChannelId },
    });
    expect(await h.observe()).toMatchObject({
      disposition: "eligible",
      channelId: cloudB.channelId,
      webhookNumberMatch: "named_without_entry",
    });
  });
});

describe("Webhook / n8n: value and duplicate policy of the decision", () => {
  it("Purchase with message_id: the id is the occurrence (rolling, id in the scope)", async () => {
    const first = harness({
      rule: ruleFor("Purchase"),
      entries: [cloudA],
      body: { phone, value: 2000, currency: "BRL", message_id: "wamid.FAKE1" },
    });
    expect((await first.observe()).disposition).toBe("eligible");
    const second = harness({
      rule: ruleFor("Purchase"),
      entries: [cloudA],
      body: { phone, value: 2000, currency: "BRL", message_id: "wamid.FAKE2" },
    });
    await second.observe();
    const a = first.decision().occurrence;
    const b = second.decision().occurrence;
    expect(first.decision().conversion).toMatchObject({
      valueCents: 200000,
      currency: "BRL",
    });
    expect(a.businessDedupePolicy).toMatchObject({
      mode: "rolling_window",
      windowSeconds: 30 * 24 * 60 * 60,
    });
    expect(a.businessDedupePolicy.scopeKey).toContain(a.occurrenceKey);
    // Two purchases the same day, different ids: two occurrences.
    expect(a.occurrenceKey).not.toBe(b.occurrenceKey);
    expect(a.businessDedupePolicy.scopeKey).not.toBe(
      b.businessDedupePolicy.scopeKey,
    );
  });

  it("Purchase without message_id: same value within 12h is one purchase, another value is another", async () => {
    const same1 = harness({
      rule: ruleFor("Purchase"),
      entries: [cloudA],
      body: { phone, value: 2000 },
    });
    await same1.observe();
    const other = harness({
      rule: ruleFor("Purchase"),
      entries: [cloudA],
      body: { phone, value: 3500 },
    });
    await other.observe();
    const policy = same1.decision().occurrence.businessDedupePolicy;
    expect(policy).toMatchObject({
      mode: "rolling_window",
      windowSeconds: 12 * 60 * 60,
    });
    expect(policy.scopeKey).toContain("value:200000");
    expect(other.decision().occurrence.businessDedupePolicy.scopeKey).toContain(
      "value:350000",
    );
  });

  it("'valor fixo' ignores the received value; without value it uses the rule's", async () => {
    const fixed = harness({
      rule: ruleFor("Purchase", "production", { source: "fixed", cents: 99000 }),
      entries: [cloudA],
      body: { phone, value: 2000, currency: "BRL" },
    });
    await fixed.observe();
    expect(fixed.decision().conversion.valueCents).toBe(99000);
    const fallback = harness({
      rule: ruleFor("Purchase", "production", {
        source: "received",
        cents: 150000,
      }),
      entries: [cloudA],
      body: { phone },
    });
    await fallback.observe();
    expect(fallback.decision().conversion.valueCents).toBe(150000);
  });
});

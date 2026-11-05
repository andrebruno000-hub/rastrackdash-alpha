import type { Prisma } from "@prisma/client";

/** The paid lead's verified origin is a WhatsApp number outside the Payt rule
 * scope: the rule of that other number owns the purchase. Not an error. */
export const PAYT_LEAD_OTHER_CHANNEL_REASON = "payt_lead_other_channel";

const channelSelect = {
  id: true,
  organizationId: true,
  providerChannelId: true,
  status: true,
  productionActivatedAt: true,
  conversionEngineMode: true,
} satisfies Prisma.InboundWebhookChannelSelect;

/** A phone match alone is insufficient: require the actual materialized lead's origin. */
export async function resolvePurchaseChannels(
  client: Pick<
    Prisma.TransactionClient,
    "inboundWebhookEvent" | "conversionEventLog"
  >,
  input: {
    workspaceId: string;
    channelIds: string[];
    phoneHashes: string[];
    leadId: string;
    adId: string | null;
    ctwaClid: string;
    receivedAt: Date;
  },
) {
  const logs = await client.conversionEventLog.findMany({
    where: {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      adId: input.adId,
      ctwaClid: input.ctwaClid,
      eventName: "LeadSubmitted",
      sourceTrigger: { startsWith: "inbound_webhook:" },
      phoneHash: { in: input.phoneHashes },
    },
    select: { id: true, sourcePayload: true },
    take: 501,
  });
  // Bound work without treating a truncated evidence set as unique.
  if (logs.length > 500) return [];
  const proofs = logs.flatMap((log) => {
    const payload = log.sourcePayload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      return [];
    const { inboundEventId, channelId, connectionId } = payload;
    return typeof inboundEventId === "string" &&
      typeof channelId === "string" &&
      typeof connectionId === "string" &&
      input.channelIds.includes(channelId)
      ? [
          {
            id: inboundEventId,
            channelId,
            connectionId,
            OR: [
              {
                productionItem: {
                  is: {
                    workspaceId: input.workspaceId,
                    leadId: input.leadId,
                    conversionEventLogId: log.id,
                    status: {
                      in: ["materialized" as const, "duplicate" as const],
                    },
                  },
                },
              },
              {
                replayItem: {
                  is: {
                    workspaceId: input.workspaceId,
                    leadId: input.leadId,
                    conversionEventLogId: log.id,
                    status: {
                      in: ["materialized" as const, "duplicate" as const],
                    },
                  },
                },
              },
            ],
          },
        ]
      : [];
  });
  const events =
    proofs.length === 0
      ? []
      : await client.inboundWebhookEvent.findMany({
          where: {
            workspaceId: input.workspaceId,
            hasCtwa: true,
            adId: input.adId,
            channelId: { in: input.channelIds },
            contactIdentityHash: { in: input.phoneHashes },
            occurredAt: {
              lte: new Date(input.receivedAt.getTime() + 5 * 60 * 1_000),
            },
            channel: {
              is: {
                workspaceId: input.workspaceId,
                connection: { is: { removedAt: null } },
              },
            },
            OR: proofs,
          },
          distinct: ["channelId"],
          take: 2,
          select: { channel: { select: channelSelect } },
        });
  // A mutable WhatsApp-instance link cannot prove which channel produced this click.
  // UAZAPI has no immutable instance+click receipt today; fail closed instead of using that link.
  return [
    ...new Map(
      events.map((event) => [event.channel.id, event.channel]),
    ).values(),
  ];
}

/** sourceTrigger of the bridged-number entry LeadSubmitted (webhooks controller). */
const BRIDGED_ENTRY_TRIGGER = "auto_lead";
/**
 * nod: the numbers the student connects by URL + token (Uazapi and WAHA) are
 * bridged WhatsappInstances. Their CTWA entry is the auto_lead LeadSubmitted,
 * written in the same request as the WebhookLog of the CTWA message (stamped
 * with the receiving WhatsappInstance), right after it. Only the WebhookLogs
 * of that moment bind the click to a number.
 */
const BRIDGED_ENTRY_WEBHOOK_BEFORE_MS = 5 * 60 * 1_000;
const BRIDGED_ENTRY_WEBHOOK_AFTER_MS = 60 * 1_000;
/** WebhookLog.source and connection provider of the bridged numbers. */
const BRIDGED_ENTRY_PROVIDERS = ["uazapi", "waha"] as const;

/**
 * Webhook / n8n only (the URL picks the rule; the number only fills channel,
 * connection and attribution): origin number of a PAID lead that arrived
 * through a bridged number (the student's own Uazapi or WAHA, connected by
 * URL + token), which has no inbound_webhook entry receipt. Port of the SaaS
 * resolveUazapiQrLeadChannels/Origin with WAHA added.
 *
 * Evidence, all append-only rows:
 * 1. the entry receipt (sourceTrigger "auto_lead", LeadSubmitted) of the same
 *    lead, ad and click (lead.ctwaClid): the lead's CURRENT click is an entry
 *    on a bridged number, not an older one;
 * 2. the Uazapi/WAHA WebhookLogs written with that receipt (same phone and
 *    ad, within minutes of it), each stamped with the receiving instance;
 * 3. exactly ONE instance among them, bridged to a live uazapi/waha channel
 *    of the scope. Two instances (the same contact and ad on two numbers at
 *    that moment) is a tie: the number named by the call (phone_number_id)
 *    breaks it, otherwise nothing is returned, never a guess.
 *
 * The mutable Lead.whatsappInstanceId is never read. Sales-platform purchases
 * (Payt, Braip, Yampi) do not use this: they keep the fail-closed
 * resolvePurchaseChannels above.
 */
export async function resolveBridgedLeadOrigin(
  client: Pick<
    Prisma.TransactionClient,
    "conversionEventLog" | "webhookLog" | "inboundWebhookChannel"
  >,
  input: {
    workspaceId: string;
    channelIds: string[];
    phoneHashes: string[];
    leadId: string;
    adId: string | null;
    ctwaClid: string;
    receivedAt: Date;
    namedChannelIds: string[];
  },
): Promise<{ channels: Array<{ id: string }>; tie: boolean }> {
  // Paid CTWA leads only: an ad and a click are required.
  if (
    !input.adId ||
    !input.ctwaClid ||
    input.channelIds.length === 0 ||
    input.phoneHashes.length === 0
  )
    return { channels: [], tie: false };
  const entries = await client.conversionEventLog.findMany({
    where: {
      workspaceId: input.workspaceId,
      leadId: input.leadId,
      adId: input.adId,
      ctwaClid: input.ctwaClid,
      eventName: "LeadSubmitted",
      sourceTrigger: BRIDGED_ENTRY_TRIGGER,
      phoneHash: { in: input.phoneHashes },
      createdAt: {
        lte: new Date(input.receivedAt.getTime() + 5 * 60 * 1_000),
      },
    },
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  // One entry per lead + ad (its dedupe key); anything else: fail closed.
  if (entries.length !== 1) return { channels: [], tie: false };
  const entryAt = entries[0]!.createdAt.getTime();
  const logs = await client.webhookLog.findMany({
    where: {
      workspaceId: input.workspaceId,
      source: { in: [...BRIDGED_ENTRY_PROVIDERS] },
      adId: input.adId,
      phoneHash: { in: input.phoneHashes },
      whatsappInstanceId: { not: null },
      receivedAt: {
        gte: new Date(entryAt - BRIDGED_ENTRY_WEBHOOK_BEFORE_MS),
        lte: new Date(entryAt + BRIDGED_ENTRY_WEBHOOK_AFTER_MS),
      },
    },
    distinct: ["whatsappInstanceId"],
    select: { whatsappInstanceId: true },
    take: 20,
  });
  const instanceIds = [
    ...new Set(
      logs
        .map((log) => log.whatsappInstanceId)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  if (instanceIds.length === 0) return { channels: [], tie: false };
  const liveBridged = {
    is: {
      workspaceId: input.workspaceId,
      provider: { in: [...BRIDGED_ENTRY_PROVIDERS] },
      removedAt: null,
    },
  };
  if (instanceIds.length === 1) {
    const channels = await client.inboundWebhookChannel.findMany({
      where: {
        workspaceId: input.workspaceId,
        id: { in: input.channelIds },
        whatsappInstanceId: instanceIds[0]!,
        connection: liveBridged,
      },
      select: { id: true },
      take: 2,
    });
    return channels.length === 1
      ? { channels, tie: false }
      : { channels: [], tie: false };
  }
  if (input.namedChannelIds.length === 0) return { channels: [], tie: true };
  const named = await client.inboundWebhookChannel.findMany({
    where: {
      workspaceId: input.workspaceId,
      id: {
        in: input.namedChannelIds.filter((id) =>
          input.channelIds.includes(id),
        ),
      },
      whatsappInstanceId: { in: instanceIds },
      connection: liveBridged,
    },
    select: { id: true },
    take: 2,
  });
  return named.length === 1
    ? { channels: named, tie: false }
    : { channels: [], tie: true };
}

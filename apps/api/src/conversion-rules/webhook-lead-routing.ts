import type { Prisma } from "@prisma/client";
import {
  resolveBridgedLeadOrigin,
  resolvePurchaseChannels,
} from "./provider-purchase-routing";

/**
 * Numero de um evento Webhook / n8n. O lead vem por telefone e o numero e o da
 * ENTRADA do clique atual do lead (Lead.ctwaClid, sempre o ultimo clique), de
 * qualquer conexao: Meta Cloud, Uazapi e WAHA do aluno (URL + token), Umbler,
 * Gupshup, Unnichat, DataCrazy, ROI Chat etc. O destino
 * Meta sai do anuncio do lead; o numero decide atribuicao e ativacao do envio.
 *
 * `phone_number_id` so desempata, nunca muda a origem provada:
 * 1. o numero informado tem a entrada do clique atual: ele;
 * 2. senao, exatamente um numero tem a entrada: esse, mesmo com outro id
 *    informado (lead de A atendido em B segue em A: o clique e de A);
 * 3. mais de um numero com a entrada: sem id ou com id desconhecido fica
 *    bloqueado, nunca adivinhado;
 * 4. nenhuma entrada registrada: o numero informado, se for da conta. Sem ele,
 *    bloqueado.
 *
 * Sem dependencia do provedor do numero. nod: a entrada dos numeros ligados
 * por URL + token (Uazapi e WAHA do aluno) vem de resolveBridgedLeadOrigin.
 */

/** Como o `phone_number_id` recebido se relaciona com a origem do lead. */
export type WebhookNumberMatch =
  | "not_informed"
  | "unknown_number"
  | "entry_number"
  | "other_number"
  | "named_without_entry";

export type WebhookLeadChannelSelect = {
  id: true;
  connectionId: true;
  organizationId: true;
  providerChannelId: true;
  status: true;
  productionActivatedAt: true;
  conversionEngineMode: true;
};

const channelSelect: WebhookLeadChannelSelect = {
  id: true,
  connectionId: true,
  organizationId: true,
  providerChannelId: true,
  status: true,
  productionActivatedAt: true,
  conversionEngineMode: true,
};

type RoutingClient = Pick<
  Prisma.TransactionClient,
  | "inboundWebhookChannel"
  | "inboundWebhookEvent"
  | "conversionEventLog"
  | "webhookLog"
>;

type WebhookLead = {
  id: string;
  adId: string | null;
  ctwaClid: string;
  ctwaDestination?: { channelId: string; connectionId: string };
};

export async function resolveWebhookLeadChannel(
  client: RoutingClient,
  input: {
    workspaceId: string;
    /** Numeros vivos da conta (escopo da regra). */
    channelIds: string[];
    phoneHashes: string[];
    lead: WebhookLead;
    receivedAt: Date;
    phoneNumberId: string | null;
  },
) {
  const named = input.phoneNumberId
    ? await client.inboundWebhookChannel.findMany({
        where: {
          workspaceId: input.workspaceId,
          id: { in: input.channelIds },
          OR: [
            { providerChannelId: input.phoneNumberId },
            // Sem API oficial nao ha id: o proprio numero tambem vale.
            { connectedPhone: input.phoneNumberId },
          ],
        },
        select: channelSelect,
        take: 5,
      })
    : [];
  const namedIds = named.map((channel) => channel.id);

  const entries = async (channelIds: string[]) => {
    // Lead sem anuncio (entrada so com pagina/pixel): a prova e o numero.
    if (!input.lead.adId) {
      const proof = input.lead.ctwaDestination;
      if (!proof || !channelIds.includes(proof.channelId))
        return { channels: [], tie: false };
      const channels = await client.inboundWebhookChannel.findMany({
        where: {
          id: proof.channelId,
          workspaceId: input.workspaceId,
          connectionId: proof.connectionId,
        },
        select: channelSelect,
        take: 1,
      });
      return { channels, tie: false };
    }
    const common = {
      workspaceId: input.workspaceId,
      channelIds,
      phoneHashes: input.phoneHashes,
      leadId: input.lead.id,
      adId: input.lead.adId,
      ctwaClid: input.lead.ctwaClid,
      receivedAt: input.receivedAt,
    };
    const inbound = await resolvePurchaseChannels(client, common);
    if (inbound.length > 0) {
      return {
        channels: await hydrate(
          client,
          input.workspaceId,
          inbound.map((channel) => channel.id),
        ),
        tie: inbound.length > 1,
      };
    }
    // Entrada so com a prova de pagina/pixel (rotas por anuncio removidas).
    const proof = input.lead.ctwaDestination;
    if (proof && channelIds.includes(proof.channelId)) {
      return {
        channels: await hydrate(client, input.workspaceId, [proof.channelId]),
        tie: false,
      };
    }
    // Uazapi/WAHA do aluno (URL + token): sem recibo inbound_webhook, vale a
    // entrada auto_lead do mesmo clique.
    const bridged = await resolveBridgedLeadOrigin(client, {
      ...common,
      namedChannelIds: namedIds,
    });
    return {
      channels: await hydrate(
        client,
        input.workspaceId,
        bridged.channels.map((channel) => channel.id),
      ),
      tie: bridged.tie,
    };
  };

  if (namedIds.length > 0) {
    const onNamed = await entries(namedIds);
    if (onNamed.channels.length === 1) {
      return {
        channel: onNamed.channels[0]!,
        tie: false,
        numberMatch: "entry_number" as WebhookNumberMatch,
      };
    }
  }
  const everywhere = await entries(input.channelIds);
  const fallbackMatch: WebhookNumberMatch = !input.phoneNumberId
    ? "not_informed"
    : namedIds.length > 0
      ? "other_number"
      : "unknown_number";
  if (everywhere.channels.length === 1 && !everywhere.tie) {
    return {
      channel: everywhere.channels[0]!,
      tie: false,
      numberMatch: fallbackMatch,
    };
  }
  if (everywhere.tie || everywhere.channels.length > 1) {
    return { channel: null, tie: true, numberMatch: fallbackMatch };
  }
  // Lead pago sem entrada registrada (ex.: conexao refeita depois do clique).
  if (input.lead.adId && named.length === 1) {
    return {
      channel: named[0]!,
      tie: false,
      numberMatch: "named_without_entry" as WebhookNumberMatch,
    };
  }
  return { channel: null, tie: false, numberMatch: fallbackMatch };
}

/** O roteamento compartilhado nao seleciona a conexao: busca o canal completo. */
function hydrate(
  client: Pick<RoutingClient, "inboundWebhookChannel">,
  workspaceId: string,
  ids: string[],
) {
  if (ids.length === 0) return Promise.resolve([]);
  return client.inboundWebhookChannel.findMany({
    where: { id: { in: ids }, workspaceId },
    select: channelSelect,
    take: ids.length,
  });
}

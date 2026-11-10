import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { RETRY_DESTINATION_PAYLOAD_KEY } from "../../src/conversion-events/conversion-event-retry";
import { ConversionEventsService } from "../../src/conversion-events/conversion-events.service";
import { DiagnosticsService } from "../../src/diagnostics/diagnostics.service";
import { MetaConnectionResolverService } from "../../src/integrations/meta/meta-connection-resolver.service";
import { MetaTokenEncryptionService } from "../../src/integrations/meta/meta-token-encryption.service";

/**
 * Porte do SaaS (#234 e #233):
 * - envio sem roteamento por BM usa o destino principal da conta;
 * - "Enviar para": o pixel escolhido no Reenviar recusado de um evento.
 * Dados fictícios.
 */

const DAY = 24 * 60 * 60_000;
const encryption = new MetaTokenEncryptionService({
  META_TOKEN_ENCRYPTION_KEY: "test-only-encryption-key",
});

const destinations: Record<string, { pixelId: string; pageId: string }> = {
  "destination-a": { pixelId: "pixel-antigo", pageId: "pagina-a" },
  "destination-b": { pixelId: "pixel-certo", pageId: "pagina-b" },
  "destination-primary": { pixelId: "pixel-principal", pageId: "pagina-p" },
};

function destinationFinder() {
  return vi.fn(async ({ where }: { where: { id?: string } }) => {
    // Sem id: o mais recente (primeiro da lista), como orderBy updatedAt desc.
    const id = where.id ?? Object.keys(destinations)[0]!;
    return destinations[id]
      ? {
          id,
          workspaceId: "workspace_1",
          status: "configured",
          ...destinations[id],
        }
      : null;
  });
}

function rejected(overrides: Record<string, unknown> = {}) {
  return {
    id: "rejected_1",
    workspaceId: "workspace_1",
    leadId: null,
    eventName: "LeadSubmitted",
    sourceTrigger: "manual_conversion",
    status: "error",
    errorCode: "MetaCapiRejected" as string | null,
    errorMessage: "Meta CAPI request failed",
    providerResponseSummary: {
      httpStatus: 400,
      error: { code: 100, error_subcode: 2804050 },
    } as unknown,
    eventOccurredAt: new Date(Date.now() - 2 * DAY),
    pixelId: "pixel-antigo" as string | null,
    pageId: "pagina-a" as string | null,
    metaAccountId: "act-a" as string | null,
    metaBusinessConnectionId: "connection-a" as string | null,
    metaConversionDestinationId: "destination-a" as string | null,
    adId: "ad-1" as string | null,
    campaignId: null,
    sourcePayload: { origin: "manual" } as unknown,
    sentAt: null,
    jobId: "job_original",
    dedupeKey: "dedupe_1",
    eventId: "evento_meta_1",
    ...overrides,
  };
}

const context = {
  workspaceId: "workspace_1",
  actorUserId: "admin_1",
  actorType: "workspace_admin",
};
const input = { reason: "Pixel errado no anúncio" };

function metaWorld(options: {
  adAssignmentDestinationId?: string | null;
  allowedDestinationIds?: string[];
  legacy?: Record<string, unknown> | null;
  accounts?: boolean;
}) {
  const credential = {
    id: "credential-a",
    workspaceId: "workspace_1",
    source: "manual",
    status: "active",
    ...encryption.encrypt("connection-token"),
  };
  const connection = {
    id: "connection-a",
    workspaceId: "workspace_1",
    status: "active",
    credentialId: credential.id,
    credential,
    defaultConversionDestinationId: "destination-a",
  };
  const allowed = (options.allowedDestinationIds ?? []).map((id) => ({
    workspaceId: "workspace_1",
    reportingAccountId: "account-a",
    conversionDestinationId: id,
    active: true,
  }));
  const account = {
    id: "account-a",
    workspaceId: "workspace_1",
    active: true,
    adAccountId: "act-a",
    businessConnectionId: connection.id,
    conversionDestinationId: null,
  };
  const withAccounts = options.accounts !== false;
  return {
    metaIntegration: {
      findUnique: vi.fn(async () => options.legacy ?? null),
    },
    metaReportingAccount: {
      findFirst: vi.fn(async () => (withAccounts ? account : null)),
      findMany: vi.fn(async () => (withAccounts ? [account] : [])),
    },
    metaBusinessConnection: { findFirst: vi.fn(async () => connection) },
    metaAd: {
      findFirst: vi.fn(async () =>
        options.adAssignmentDestinationId === undefined
          ? null
          : {
              adAccountId: "act-a",
              destinationAssignment: options.adAssignmentDestinationId
                ? {
                    reportingAccountId: "account-a",
                    conversionDestinationId: options.adAssignmentDestinationId,
                  }
                : null,
            },
      ),
    },
    metaCampaign: { findFirst: vi.fn(async () => null) },
    metaConversionDestination: { findFirst: destinationFinder() },
    metaReportingAccountDestination: { findMany: vi.fn(async () => allowed) },
  };
}

function harness(
  world: ReturnType<typeof metaWorld>,
  events: Array<ReturnType<typeof rejected>> = [rejected()],
) {
  const prisma = {
    ...world,
    conversionEventLog: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = events.find((item) => item.id === where.id);
        return row ? { ...row } : null;
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          const row = events.find((item) =>
            Object.entries(where).every(
              ([key, value]) => (item as Record<string, unknown>)[key] === value,
            ),
          );
          if (!row) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
      update: vi.fn(async () => ({})),
    },
    auditLog: { create: vi.fn(async () => ({ id: "audit" })) },
    jobAttempt: { create: vi.fn(async () => ({ id: "attempt" })) },
    diagnosticEvent: { create: vi.fn(async () => ({ id: "diagnostic" })) },
  };
  const queue = { retrySend: vi.fn(async () => ({ jobId: "retry_job" })) };
  const service = new DiagnosticsService(prisma as never, undefined, queue as never);
  const resolver = new MetaConnectionResolverService(prisma as never, encryption);
  const sender = new ConversionEventsService(
    prisma as never,
    {} as never,
    encryption,
    resolver,
    {} as never,
  );
  const routeOf = (event: Record<string, unknown>) =>
    (sender as any).resolveDeliveryRoute(event);
  return {
    prisma,
    queue,
    service,
    sender,
    routeOf,
    events: events as Array<Record<string, any>>,
  };
}

function legacyIntegration(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "workspace_1",
    status: "connected",
    advancedRoutingEnabled: false,
    ...encryption.encrypt("legacy-token"),
    capiAccessTokenEncrypted: null,
    capiTokenIv: null,
    capiTokenTag: null,
    selectedAdAccountId: "act_legacy",
    selectedBusinessId: null,
    selectedPixelId: "pixel-legado",
    primaryConversionDestinationId: "destination-primary",
    ...overrides,
  };
}

describe("envio sem roteamento por BM: destino principal (SaaS #234)", () => {
  function destinationLookup(primary: string | null) {
    const prisma = {
      metaIntegration: {
        findUnique: vi.fn(async () => ({
          primaryConversionDestinationId: primary,
        })),
      },
      metaConversionDestination: { findFirst: destinationFinder() },
    };
    const sender = new ConversionEventsService(
      prisma as never,
      {} as never,
      encryption,
      undefined as never,
      {} as never,
    );
    return {
      prisma,
      lookup: (chosen?: string) =>
        (sender as any).getWorkspaceConversionDestination("workspace_1", chosen),
    };
  }

  it("vai para o destino principal, não para o alterado mais recentemente", async () => {
    const { lookup } = destinationLookup("destination-primary");
    // destination-a é o primeiro da lista (o mais recente).
    await expect(lookup()).resolves.toMatchObject({
      pixelId: "pixel-principal",
      pageId: "pagina-p",
    });
  });

  it("sem principal válido, cai no destino mais recente", async () => {
    await expect(destinationLookup(null).lookup()).resolves.toMatchObject({
      pixelId: "pixel-antigo",
    });
    await expect(
      destinationLookup("destination-removido").lookup(),
    ).resolves.toMatchObject({ pixelId: "pixel-antigo" });
  });

  it("o pixel escolhido no reenvio vale acima do principal", async () => {
    const { lookup, prisma } = destinationLookup("destination-primary");
    await expect(lookup("destination-b")).resolves.toMatchObject({
      pixelId: "pixel-certo",
    });
    expect(prisma.metaIntegration.findUnique).not.toHaveBeenCalled();
  });
});

describe("Enviar para: pixel escolhido no Reenviar recusado (SaaS #233)", () => {
  it("grava o pixel escolhido como destino do evento, no sourcePayload, e audita", async () => {
    const h = harness(
      metaWorld({
        adAssignmentDestinationId: "destination-a",
        allowedDestinationIds: ["destination-a", "destination-b"],
      }),
    );

    await h.service.retryRejectedConversionEvent("rejected_1", input, context, {
      conversionDestinationId: "destination-b",
    });

    expect(h.events[0]).toMatchObject({
      status: "ready_to_send",
      eventId: "evento_meta_1",
      pixelId: null,
      pageId: null,
      metaAccountId: "act-a",
      metaBusinessConnectionId: null,
      metaConversionDestinationId: "destination-b",
      sourcePayload: {
        origin: "manual",
        [RETRY_DESTINATION_PAYLOAD_KEY]: "destination-b",
      },
    });
    expect(h.prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          afterSummary: {
            retryStatus: "queued",
            chosenConversionDestinationId: "destination-b",
          },
        }),
      }),
    );
  });

  it("o envio vai para o pixel escolhido, acima da rota do anúncio", async () => {
    const h = harness(
      metaWorld({
        adAssignmentDestinationId: "destination-a",
        allowedDestinationIds: ["destination-a", "destination-b"],
      }),
    );
    await h.service.retryRejectedConversionEvent("rejected_1", input, context, {
      conversionDestinationId: "destination-b",
    });

    await expect(h.routeOf(h.events[0]!)).resolves.toMatchObject({
      conversionDestinationId: "destination-b",
      pixelId: "pixel-certo",
      pageId: "pagina-b",
      businessConnectionId: "connection-a",
      routeError: null,
    });
  });

  it("pixel que nenhuma conta ativa pode usar: o envio não sai por outra rota", async () => {
    const h = harness(
      metaWorld({
        adAssignmentDestinationId: "destination-a",
        allowedDestinationIds: ["destination-a"],
      }),
    );
    await h.service.retryRejectedConversionEvent("rejected_1", input, context, {
      conversionDestinationId: "destination-b",
    });

    await expect(h.routeOf(h.events[0]!)).resolves.toMatchObject({
      routeError: "Destino não autorizado para esta conta Meta",
    });
  });

  it("sem roteamento por BM: o envio usa o pixel escolhido com o login da Meta", async () => {
    const h = harness(
      metaWorld({ legacy: legacyIntegration(), accounts: false }),
      [
        rejected({
          metaAccountId: null,
          metaBusinessConnectionId: null,
          metaConversionDestinationId: null,
          adId: null,
        }),
      ],
    );
    await expect(h.routeOf(h.events[0]!)).resolves.toMatchObject({
      source: "legacy_oauth",
      pixelId: "pixel-principal",
    });

    await h.service.retryRejectedConversionEvent("rejected_1", input, context, {
      conversionDestinationId: "destination-b",
    });

    await expect(h.routeOf(h.events[0]!)).resolves.toMatchObject({
      source: "legacy_oauth",
      pixelId: "pixel-certo",
      pageId: "pagina-b",
      routeError: null,
    });
  });

  it("recusa pixel desconhecido ou evento com destino do número (CTWA)", async () => {
    const h = harness(metaWorld({}));
    await expect(
      h.service.retryRejectedConversionEvent("rejected_1", input, context, {
        conversionDestinationId: "destination-de-outra-conta",
      }),
    ).rejects.toThrow("Este pixel não está disponível para o reenvio");
    expect(h.events[0]).toMatchObject({
      status: "error",
      metaConversionDestinationId: "destination-a",
    });

    const ctwa = harness(metaWorld({}), [
      rejected({ sourcePayload: { ctwaDestination: { pixelId: "pixel-antigo" } } }),
    ]);
    await expect(
      ctwa.service.retryRejectedConversionEvent("rejected_1", input, context, {
        conversionDestinationId: "destination-b",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctwa.queue.retrySend).not.toHaveBeenCalled();
  });

  it("continua só para recusas corrigíveis: código 368 fica de fora mesmo com pixel escolhido", async () => {
    const h = harness(metaWorld({}), [
      rejected({
        providerResponseSummary: { httpStatus: 400, error: { code: 368 } },
      }),
    ]);
    await expect(
      h.service.retryRejectedConversionEvent("rejected_1", input, context, {
        conversionDestinationId: "destination-b",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.queue.retrySend).not.toHaveBeenCalled();
  });

  it("reenvio em lote (sem escolha) apaga a escolha anterior", async () => {
    const h = harness(
      metaWorld({
        allowedDestinationIds: ["destination-a", "destination-b"],
      }),
      [
        rejected({
          adId: null,
          metaConversionDestinationId: "destination-b",
          sourcePayload: {
            origin: "manual",
            [RETRY_DESTINATION_PAYLOAD_KEY]: "destination-b",
          },
        }),
      ],
    );

    await h.service.retryRejectedConversionEvents(["rejected_1"], input, context);

    expect(h.events[0]!.sourcePayload).toEqual({ origin: "manual" });
    expect(h.events[0]).toMatchObject({
      status: "ready_to_send",
      metaConversionDestinationId: "destination-a",
    });
  });

  it("a fila falhou: devolve destino, conexão e sourcePayload", async () => {
    const h = harness(
      metaWorld({ allowedDestinationIds: ["destination-a", "destination-b"] }),
    );
    h.queue.retrySend.mockRejectedValueOnce(new Error("fila fora"));

    await expect(
      h.service.retryRejectedConversionEvent("rejected_1", input, context, {
        conversionDestinationId: "destination-b",
      }),
    ).rejects.toThrow("fila fora");

    expect(h.events[0]).toMatchObject({
      status: "error",
      metaBusinessConnectionId: "connection-a",
      metaConversionDestinationId: "destination-a",
      pixelId: "pixel-antigo",
      sourcePayload: { origin: "manual" },
    });
  });
});


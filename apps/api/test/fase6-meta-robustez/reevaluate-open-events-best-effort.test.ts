import "reflect-metadata";
import { NotFoundException } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { InboundWebhookChannelRoutesService } from "../../src/inbound-webhooks/inbound-webhook-channel-routes.service";
import { MetaManualConnectionsService } from "../../src/integrations/meta/meta-manual-connections.service";
import { MetaTokenEncryptionService } from "../../src/integrations/meta/meta-token-encryption.service";

/**
 * Porte das correções gerais do SaaS #201 (sem a parte de Formulários): a
 * reavaliação de eventos abertos ignora canais de conexões removidas e, ao
 * alterar o destino da conta ou do anúncio, uma falha dela vai para o log em
 * vez de derrubar a alteração já salva. Dados fictícios.
 */

const encryption = new MetaTokenEncryptionService({
  META_TOKEN_ENCRYPTION_KEY: "test-only-encryption-key",
});

describe("reavaliação de eventos abertos (correções gerais do SaaS #201)", () => {
  it("ignora canais de conexão removida", async () => {
    const findMany = vi.fn(async () => [{ id: "channel_live" }]);
    const service = new InboundWebhookChannelRoutesService(
      { inboundWebhookChannel: { findMany } } as never,
      {} as never,
    );
    const perChannel = vi
      .spyOn(service, "reevaluateOpenEvents")
      .mockResolvedValue({
        examinedCount: 1,
        updatedCount: 0,
        resolvedCount: 0,
        unresolvedCount: 1,
        conflictCount: 0,
      });

    await expect(
      service.reevaluateWorkspaceOpenEvents("workspace_1"),
    ).resolves.toMatchObject({ examinedCount: 1 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "workspace_1",
          connection: { is: { workspaceId: "workspace_1", removedAt: null } },
        }),
      }),
    );
    expect(perChannel).toHaveBeenCalledTimes(1);
    expect(perChannel).toHaveBeenCalledWith("workspace_1", "channel_live");
  });

  it("falha da reavaliação não derruba a alteração de destino: só registra no log", async () => {
    const inboundRoutes = {
      reevaluateWorkspaceOpenEvents: vi.fn(async () => {
        throw new NotFoundException("Recurso de webhook não encontrado");
      }),
    };
    const service = new MetaManualConnectionsService(
      {} as never,
      {} as never,
      {} as never,
      encryption,
      {},
      inboundRoutes as never,
    );
    const warn = vi
      .spyOn((service as any).logger, "warn")
      .mockImplementation(() => undefined);

    await expect(
      (service as any).reevaluateOpenInboundEvents(
        "workspace_1",
        "após alterar o destino do anúncio",
      ),
    ).resolves.toBeUndefined();
    expect(inboundRoutes.reevaluateWorkspaceOpenEvents).toHaveBeenCalledWith(
      "workspace_1",
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "Recurso de webhook não encontrado",
    );
  });

  it("as alterações de destino da conta e do anúncio usam a reavaliação protegida", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../../src/integrations/meta/meta-manual-connections.service.ts",
      ),
      "utf8",
    );
    expect(
      source.match(/await this\.inboundRoutes\?\.reevaluateWorkspaceOpenEvents/g),
    ).toHaveLength(1);
    expect(
      source.match(/await this\.reevaluateOpenInboundEvents\(/g),
    ).toHaveLength(2);
  });
});

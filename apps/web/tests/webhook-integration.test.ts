// @vitest-environment jsdom

import type {
  ProviderConversionRuleCapabilitiesDto,
  ProviderConversionRuleDto,
} from "@wpptrack/shared";
import { webhookEventNames } from "@wpptrack/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ineligibleNumbers,
  offeredRuleOrigins,
  providerRuleOrigin,
  type ConversionConnection,
  type ConversionNumber,
} from "../src/app/(app)/conversions/conversion-rules-view";
import {
  buildRulePayload,
  emptyRuleDraft,
} from "../src/app/(app)/conversions/rule-draft";
import {
  buildRuleUpdatePayload,
  ruleEditCapabilities,
  ruleEditDraft,
} from "../src/app/(app)/conversions/rule-edit";
import { ruleManageTabs } from "../src/app/(app)/conversions/rule-manage";
import { RuleEndpoint } from "../src/app/(app)/conversions/rule-endpoint";
import { NewRuleFlow } from "../src/app/(app)/conversions/new-rule-flow";
import { setupUser } from "./user-shim";
import {
  WEBHOOK_N8N_FLOW_PATH,
  firstFreeWebhookEvent,
  isWebhookApiMessage,
  webhookBodyExample,
  webhookRulesOf,
} from "../src/app/(app)/conversions/webhook-view";
import { executionReasonLabel } from "../src/app/(app)/settings/provider-conversion-labels";
import {
  capabilities,
  connections,
  numbers,
  providerRule,
} from "./conversions-fixtures";

/**
 * Webhook / n8n na tela Conversões (porte do SaaS 098d0950,
 * webhook-integration.test.ts) com as conexões do aluno: API Oficial (Meta
 * Cloud), Uazapi e WAHA por URL + token, Umbler, Gupshup... Dados fictícios.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

const whatsappProviders = [
  "umbler",
  "gupshup",
  "uazapi",
  "meta_cloud",
  "data_crazy",
  "unnichat",
  "waha",
  "roichat",
];

/** Mesma entrada que a API publica em GET providers/capabilities. */
const capabilitiesWithWebhook: ProviderConversionRuleCapabilitiesDto = {
  ...capabilities,
  origins: [
    ...capabilities.origins,
    {
      origin: "automation_webhook",
      scopes: ["all_numbers"],
      channelProviders: whatsappProviders,
      authorChannelProviders: null,
      connectionBound: false,
      labelMatch: null,
      unifiable: false,
      eventNames: [...webhookEventNames],
    },
  ],
};

function webhookRule(input: {
  id: string;
  eventName: ProviderConversionRuleDto["conversionRule"]["eventName"];
  valueCents?: number | null;
  valueSource?: "received" | "fixed";
}): ProviderConversionRuleDto {
  const rule = providerRule({
    id: input.id,
    triggerType: "provider_automation",
    origin: "automation_webhook",
    eventName: input.eventName,
    connectionId: "conn_qr_a",
    scope: "all_numbers",
    phrases: [],
  });
  return {
    ...rule,
    automationSource: "webhook",
    webhookValueSource: input.valueSource ?? "received",
    conversionRule: {
      ...rule.conversionRule,
      defaultValueCents: input.valueCents ?? null,
      defaultCurrency: null,
    },
  };
}

const qualified = webhookRule({ id: "wh_qualified", eventName: "QualifiedLead" });
const purchase = webhookRule({
  id: "wh_purchase",
  eventName: "Purchase",
  valueCents: 150000,
});
const context = {
  numbers,
  connections,
  capabilities: capabilitiesWithWebhook,
  webhookRules: [qualified],
};

/** One connection + one number of a provider (Meta Cloud, WAHA...). */
function only(provider: string): {
  numbers: ConversionNumber[];
  connections: ConversionConnection[];
} {
  return {
    connections: [
      {
        id: `conn_${provider}`,
        provider: provider as ConversionConnection["provider"],
        displayName: provider,
        status: "observation",
      },
    ],
    numbers: [
      {
        id: `ch_${provider}`,
        connectionId: `conn_${provider}`,
        provider: provider as ConversionConnection["provider"],
        connectionName: provider,
        label: provider,
        phone: "+5511900000000",
        whatsappInstanceId: null,
        routeIds: [],
        status: "active",
      },
    ],
  };
}

describe("Webhook / n8n in Conversões", () => {
  const crm = { kommo: false, pipedrive: false };

  it("is offered with any WhatsApp connection of the student (API says so)", () => {
    expect(
      offeredRuleOrigins({
        numbers,
        connections,
        capabilities: capabilitiesWithWebhook,
        crm,
      }),
    ).toContain("automation_webhook");
    // Each connection of the student alone is enough.
    for (const provider of ["meta_cloud", "uazapi", "waha", "gupshup", "umbler"]) {
      expect(
        offeredRuleOrigins({
          ...only(provider),
          capabilities: capabilitiesWithWebhook,
          crm,
        }),
      ).toContain("automation_webhook");
    }
    // Without the origin in the capabilities, or without any WhatsApp, no.
    expect(
      offeredRuleOrigins({ numbers, connections, capabilities, crm }),
    ).not.toContain("automation_webhook");
    expect(
      offeredRuleOrigins({
        numbers: [],
        connections: [],
        capabilities: capabilitiesWithWebhook,
        crm,
      }),
    ).not.toContain("automation_webhook");
  });

  it("a webhook rule never turns a number into 'not evaluated' (any WhatsApp)", () => {
    const metaCloud = only("meta_cloud").numbers;
    // The general note keeps Meta Cloud as not evaluated by the other origins.
    expect(ineligibleNumbers(metaCloud, capabilitiesWithWebhook)).toHaveLength(1);
    // On the webhook rule itself, every WhatsApp number is in.
    expect(
      ineligibleNumbers(metaCloud, capabilitiesWithWebhook, "automation_webhook"),
    ).toEqual([]);
  });

  it("reads the origin of a rule from automationSource", () => {
    const { origin: _origin, ...withoutOrigin } = purchase;
    expect(providerRuleOrigin(withoutOrigin, new Map())).toBe(
      "automation_webhook",
    );
  });

  it("Nova regra: one rule per event, every number, no connection sent, starts in observation", () => {
    const draft = {
      ...emptyRuleDraft("automation_webhook"),
      name: "Webhook / n8n: Compra",
      eventName: "Purchase" as const,
      scope: "all_numbers" as const,
    };
    expect(buildRulePayload(draft, context)).toEqual({
      ok: true,
      value: {
        name: "Webhook / n8n: Compra",
        scope: "all_numbers",
        channelIds: [],
        mode: "observation",
        triggerType: "provider_automation",
        automationSource: "webhook",
        eventName: "Purchase",
        webhookValueSource: "received",
      },
    });
    // Even with the single URL of the workspace on: its own URL, never off.
    const withSingleUrl = buildRulePayload(draft, { ...context, singleUrl: true });
    expect(withSingleUrl).toMatchObject({ ok: true });
    expect(withSingleUrl.ok && withSingleUrl.value).not.toHaveProperty(
      "perRuleUrl",
    );
    // The event already has its URL.
    expect(
      buildRulePayload({ ...draft, eventName: "QualifiedLead" }, context),
    ).toMatchObject({ ok: false });
    // "Valor fixo" needs the ticket.
    expect(
      buildRulePayload({ ...draft, webhookValueSource: "fixed" }, context),
    ).toMatchObject({ ok: false, message: "Informe o ticket médio." });
    expect(
      buildRulePayload(
        { ...draft, webhookValueSource: "fixed", averageValue: "1.500,00" },
        context,
      ),
    ).toMatchObject({
      ok: true,
      value: { webhookValueSource: "fixed", defaultValueCents: 150000 },
    });
    expect(firstFreeWebhookEvent([qualified])).toBe("Purchase");
    expect(webhookRulesOf([purchase, qualified]).map((rule) => rule.id)).toEqual(
      ["wh_qualified", "wh_purchase"],
    );
  });

  it("Gerenciar: URL tab, received events and the value source", () => {
    expect(
      ruleManageTabs("automation_webhook", purchase).map((tab) => tab.id),
    ).toEqual(["edit", "endpoint", "received"]);
    expect(ruleEditCapabilities(purchase, "automation_webhook")).toMatchObject({
      value: true,
      webhookValueSource: true,
    });
    const draft = ruleEditDraft(purchase, "automation_webhook");
    expect(
      buildRuleUpdatePayload(
        purchase,
        { ...draft, webhookValueSource: "fixed" },
        context,
      ),
    ).toEqual({ ok: true, value: { webhookValueSource: "fixed" } });
    // "Valor recebido": the fallback can be removed.
    expect(
      buildRuleUpdatePayload(purchase, { ...draft, averageValue: "" }, context),
    ).toEqual({ ok: true, value: { defaultValueCents: null } });
  });

  it("API refusals and receipt reasons are written for the screen", () => {
    expect(
      isWebhookApiMessage("Este evento já tem uma regra de webhook; use a URL dela"),
    ).toBe(true);
    expect(executionReasonLabel("contact_multiple_numbers")).toContain(
      "phone_number_id",
    );
    expect(executionReasonLabel("webhook_phone_missing")).toBe(
      "Chamada sem telefone do lead (phone)",
    );
    expect(executionReasonLabel("webhook_event_repeated")).toBe(
      "Mesma chamada repetida",
    );
  });

  it("body example: phone always, value only on valued events, no secret", () => {
    expect(JSON.parse(webhookBodyExample("QualifiedLead"))).toEqual({
      phone: "5511999999999",
      message_id: "id-da-mensagem",
    });
    expect(JSON.parse(webhookBodyExample("Purchase"))).toMatchObject({
      value: 1500,
      currency: "BRL",
    });
  });

  it("URL tab shows the steps, the body and the n8n flow download (no QR wording)", () => {
    const { container } = render(
      createElement(RuleEndpoint as never, {
        rule: {
          ...purchase,
          endpoint: {
            id: "endpoint_1",
            lastDeliveryAt: null,
            lastSuccessfulParseAt: null,
            rotatedAt: null,
            removedAt: null,
            publicUrlDisabledAt: null,
          },
        },
        origin: "automation_webhook",
        canManage: true,
        rotateAction: vi.fn(),
        onRotated: vi.fn(),
        onDismiss: vi.fn(),
      }),
    );
    expect(screen.getByText(/phone_number_id só se você tiver/u)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Baixar fluxo pronto do n8n" }),
    ).toHaveProperty("pathname", WEBHOOK_N8N_FLOW_PATH);
    expect(container.textContent).not.toMatch(/QR/u);
  });
});

describe("Webhook / n8n Nova regra flow", () => {
  it("skips Alcance, keeps one rule per event and shows the rule URL once", async () => {
    const user = setupUser();
    const createAction = vi.fn(async (_formData: FormData) => ({
      ok: true as const,
      ruleId: "rule_wh",
      ruleMode: "observation" as const,
      webhookUrl: "https://api.exemplo.test/webhooks/inbound/conversions/x?token=ficticio",
      message: "Regra criada em observação.",
    }));
    const { container } = render(
      createElement(NewRuleFlow, {
        offeredOrigins: ["automation_webhook"],
        initialOrigin: "automation_webhook",
        numbers,
        connections,
        capabilities: capabilitiesWithWebhook,
        createAction,
        confirmAction: vi.fn(),
        onFinished: () => undefined,
        webhookRules: [qualified],
      }),
    );
    expect(screen.queryByText("Alcance")).toBeNull();
    // Lead qualificado already has its rule: Compra is the first free event.
    const select = screen.getByLabelText("Evento") as HTMLSelectElement;
    expect(select.value).toBe("Purchase");
    expect(
      (select.querySelector("option[value=QualifiedLead]") as HTMLOptionElement)
        .disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: /Continuar/ }));
    // Straight to Detalhes, with the default name.
    expect(
      (screen.getByLabelText("Nome da regra") as HTMLInputElement).value,
    ).toBe("Webhook / n8n: Compra realizada");
    await user.click(screen.getByRole("button", { name: "Criar regra" }));
    await screen.findByText("Regra criada");
    const formData = createAction.mock.calls[0]![0];
    const payload = JSON.parse(String(formData.get("payload")));
    expect(payload).toMatchObject({
      automationSource: "webhook",
      eventName: "Purchase",
      scope: "all_numbers",
      mode: "observation",
    });
    expect(payload.connectionId).toBeUndefined();
    expect(screen.getByText("URL da regra (exibida uma única vez)")).toBeTruthy();
    expect(container.textContent).not.toMatch(/QR/u);
  });
});

describe("n8n flow (docs/setup/n8n/webhook-conversao.json)", () => {
  const docs = readFileSync(
    resolve(__dirname, "../../../docs/setup/n8n/webhook-conversao.json"),
    "utf8",
  );
  const guide = readFileSync(
    resolve(__dirname, "../../../docs/setup/n8n/README.md"),
    "utf8",
  );
  const published = readFileSync(
    resolve(__dirname, `../public${WEBHOOK_N8N_FLOW_PATH}`),
    "utf8",
  );
  const flow = JSON.parse(docs) as {
    name: string;
    nodes: Array<{
      id: string;
      name: string;
      type: string;
      typeVersion: number;
      position: [number, number];
      parameters: Record<string, any>;
    }>;
    connections: Record<
      string,
      { main: Array<Array<{ node: string; type: string; index: number }>> }
    >;
  };

  it("the download is the same file as the docs", () => {
    expect(published.replace(/\r\n/gu, "\n")).toBe(docs.replace(/\r\n/gu, "\n"));
  });

  it("has the shape n8n imports: unique names/ids, known node types, valid connections", () => {
    expect(typeof flow.name).toBe("string");
    const names = flow.nodes.map((node) => node.name);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(flow.nodes.map((node) => node.id)).size).toBe(names.length);
    for (const node of flow.nodes) {
      expect(node.type).toMatch(/^n8n-nodes-base\./u);
      expect(typeof node.typeVersion).toBe("number");
      expect(node.position).toHaveLength(2);
      expect(typeof node.parameters).toBe("object");
    }
    for (const [from, outputs] of Object.entries(flow.connections)) {
      expect(names).toContain(from);
      for (const output of outputs.main) {
        for (const link of output) {
          expect(names).toContain(link.node);
          expect(link.type).toBe("main");
        }
      }
    }
  });

  it("checks the phrase in IF nodes and posts the contract to the rule URLs", () => {
    const ifs = flow.nodes.filter((node) => node.type === "n8n-nodes-base.if");
    expect(ifs.length).toBeGreaterThan(0);
    for (const node of ifs) {
      const condition = node.parameters.conditions.conditions[0];
      expect(condition.leftValue).toBe("={{ $json.body.message }}");
      expect(condition.operator).toEqual({
        type: "string",
        operation: "contains",
      });
    }
    const posts = flow.nodes.filter(
      (node) => node.type === "n8n-nodes-base.httpRequest",
    );
    expect(posts).toHaveLength(2);
    for (const node of posts) {
      expect(node.parameters.method).toBe("POST");
      expect(node.parameters.url).toMatch(/^COLE_AQUI_A_URL_DA_REGRA_/u);
      expect(node.parameters.jsonBody).toContain("phone: $json.body.phone");
      // message_id from the source message: a re-run never makes a new one.
      expect(node.parameters.jsonBody).toContain("$json.body.message_id");
      expect(node.parameters.jsonBody).not.toContain("$execution");
    }
  });

  it("carries no secret nor real data", () => {
    for (const text of [docs, guide]) {
      expect(text).not.toMatch(/token=[A-Za-z0-9]|access_token|Bearer |EAA[A-Za-z0-9]/u);
    }
    expect(docs).not.toMatch(/\b55\d{10,11}\b/u);
    // The guide only uses the fictitious example number of the screen.
    for (const phone of guide.match(/\b55\d{10,11}\b/gu) ?? []) {
      expect(phone).toBe("5511999999999");
    }
    expect(docs).not.toContain("pinData\": {\"");
  });

  it("the student guide never says 'QR code' and has the section for the AI", () => {
    expect(guide).not.toMatch(/QR\s*code/iu);
    expect(docs).not.toMatch(/QR\s*code/iu);
    expect(guide).toContain("## Para a IA do repositório");
  });
});

import {
  conversionEventCarriesValue,
  webhookEventNames,
  type ConversionEventNameDto,
  type ProviderConversionRuleDto,
} from "@wpptrack/shared";
import { eventLabel } from "../integrations/single-url/single-url-copy";

/**
 * Decisões puras da origem "Webhook / n8n" (uma URL por regra, uma regra por
 * evento, sempre todos os números). Sem React: testadas direto. Sem
 * dependência do Kinbox, para o port ao repositório do aluno.
 */

export type WebhookEventName = (typeof webhookEventNames)[number];

/** Fluxo pronto para importar no n8n (cópia de docs/setup/n8n). */
export const WEBHOOK_N8N_FLOW_PATH =
  "/integrations/n8n/webhook-conversao.json";

export function webhookRulesOf(
  rules: readonly ProviderConversionRuleDto[],
): ProviderConversionRuleDto[] {
  return rules
    .filter((rule) => rule.automationSource === "webhook")
    .sort(
      (left, right) =>
        webhookEventNames.indexOf(
          left.conversionRule.eventName as WebhookEventName,
        ) -
        webhookEventNames.indexOf(
          right.conversionRule.eventName as WebhookEventName,
        ),
    );
}

export function webhookRuleForEvent(
  rules: readonly ProviderConversionRuleDto[],
  eventName: string,
): ProviderConversionRuleDto | null {
  return (
    rules.find((rule) => rule.conversionRule.eventName === eventName) ?? null
  );
}

/** Lead qualificado, depois Compra, depois o primeiro evento sem regra. */
export function firstFreeWebhookEvent(
  rules: readonly ProviderConversionRuleDto[],
): WebhookEventName | null {
  const used = new Set(rules.map((rule) => rule.conversionRule.eventName));
  return (
    (["QualifiedLead", "Purchase"] as const).find(
      (eventName) => !used.has(eventName),
    ) ??
    webhookEventNames.find((eventName) => !used.has(eventName)) ??
    null
  );
}

export function webhookEventCarriesValue(eventName: string): boolean {
  return conversionEventCarriesValue(eventName as ConversionEventNameDto);
}

export function webhookRuleName(eventName: string): string {
  return `Webhook / n8n: ${eventLabel(eventName)}`.slice(0, 120);
}

/** Recusas da API escritas para a tela (400/409). */
const webhookApiMessages: ReadonlySet<string> = new Set([
  "A regra de webhook vale para todos os números",
  "Conecte (ou retome) um número de WhatsApp antes de criar uma regra de webhook",
  "Este evento já tem uma regra de webhook; use a URL dela",
  "Informe o valor fixo (ticket médio) para usar valor fixo",
]);

export function isWebhookApiMessage(message: string): boolean {
  return webhookApiMessages.has(message);
}

/** Corpo de exemplo da chamada (dados fictícios). */
export function webhookBodyExample(eventName: string): string {
  const body: Record<string, string | number> = { phone: "5511999999999" };
  if (webhookEventCarriesValue(eventName)) {
    body.value = 1500;
    body.currency = "BRL";
  }
  body.message_id = "id-da-mensagem";
  return JSON.stringify(body, null, 2);
}

/** Passo a passo (curto: o resto está em docs/setup/n8n/README.md). */
export const webhookSetupSteps: readonly string[] = [
  "Copie a URL da regra.",
  "No n8n (ou no painel), faça um POST para essa URL com o JSON abaixo. phone_number_id só se você tiver mais de um número.",
  "Chame a URL com um lead de teste que veio do anúncio e confira o recebimento.",
  "Com o recebimento certo, ative o envio.",
];

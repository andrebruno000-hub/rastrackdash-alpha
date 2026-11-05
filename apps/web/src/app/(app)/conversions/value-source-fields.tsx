"use client";

import {
  conversionEventCarriesValue,
  conversionEventRequiresValue,
  type ConversionEventNameDto,
  type WebhookValueSourceDto,
} from "@wpptrack/shared";

/**
 * Valor de uma regra que recebe o valor na chamada (hoje: Webhook / n8n; na
 * Nova regra e em Gerenciar): o valor recebido (com reserva opcional) ou um
 * valor fixo (ticket médio). Nada aparece para eventos sem valor.
 *
 * Porte do `KinboxValueFields` do SaaS (098d0950) com nome genérico: esta
 * edição não tem Kinbox.
 */
export function ValueSourceFields({
  eventName,
  source,
  value,
  onSourceChange,
  onValueChange,
  disabled,
  name,
  showLegend = true,
}: {
  eventName: string;
  source: WebhookValueSourceDto;
  value: string;
  onSourceChange: (source: WebhookValueSourceDto) => void;
  onValueChange: (value: string) => void;
  disabled: boolean;
  /** Radio group name (unique per form). */
  name: string;
  /** False under a legend that already says "Valor enviado à Meta". */
  showLegend?: boolean;
}) {
  if (!conversionEventCarriesValue(eventName as ConversionEventNameDto)) {
    return null;
  }
  const fixed = source === "fixed";
  const required =
    fixed && conversionEventRequiresValue(eventName as ConversionEventNameDto);
  return (
    <div className="conversion-value-source">
      <fieldset
        className="provider-conversion-value-modes"
        aria-label={showLegend ? undefined : "Valor enviado à Meta"}
      >
        {showLegend ? (
          <legend className="field-label">Valor enviado à Meta</legend>
        ) : null}
        <div>
          <label>
            <input
              type="radio"
              name={name}
              checked={!fixed}
              disabled={disabled}
              onChange={() => onSourceChange("received")}
            />
            <span>Usar o valor recebido</span>
          </label>
          <label>
            <input
              type="radio"
              name={name}
              checked={fixed}
              disabled={disabled}
              onChange={() => onSourceChange("fixed")}
            />
            <span>Valor fixo (ticket médio)</span>
          </label>
        </div>
      </fieldset>
      <label className="conversion-field">
        <span className="field-label">
          {fixed ? "Ticket médio" : "Se o valor não vier (opcional)"}
        </span>
        <input
          inputMode="decimal"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder="Ex.: 1.500,00"
          required={required}
          disabled={disabled}
        />
      </label>
    </div>
  );
}

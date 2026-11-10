import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { finalize } from "rxjs/operators";

type HttpRequest = {
  method?: string;
  originalUrl?: string;
  url?: string;
};

export function sanitizeRequestPath(path: string): string {
  // The Pipedrive webhook URL carries its secret as ?token=; drop the query.
  const pathname = path.split(/[?#]/u, 1)[0] ?? path;
  if (/^\/webhooks\/pipedrive(?:\/|$)/i.test(pathname)) return pathname;
  const queryStart = path.indexOf("?");
  if (queryStart < 0) return pathname;
  // Webhook and OAuth URLs carry secrets in the query (Meta hub.verify_token,
  // Google code/state, inbound ?token=...). Keep the parameter names for
  // debugging but redact every value whose (decoded) name looks sensitive.
  const query = path.slice(queryStart + 1).split("#", 1)[0] ?? "";
  const params = query
    .split("&")
    .filter((part) => part.length > 0)
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator < 0) return part;
      const name = part.slice(0, separator);
      return isSensitiveQueryName(name) ? `${name}=[REDACTED]` : part;
    });
  return params.length > 0 ? `${pathname}?${params.join("&")}` : pathname;
}

const sensitiveQueryNames = new Set([
  "auth",
  "authorization",
  "challenge",
  "code",
  "hottok",
  "key",
  "licenseid",
  "pass",
  "sig",
  "state",
]);

const sensitiveQueryFragments = [
  "token",
  "secret",
  "signature",
  "password",
  "apikey",
  "api_key",
  "hmac",
];

function isSensitiveQueryName(rawName: string): boolean {
  let name = rawName;
  try {
    name = decodeURIComponent(rawName.replace(/\+/g, " "));
  } catch {
    // Malformed escape: judge the raw name.
  }
  const normalized = name.trim().toLowerCase().replace(/[-\s]/g, "_");
  return (
    sensitiveQueryNames.has(normalized) ||
    sensitiveQueryFragments.some((fragment) => normalized.includes(fragment))
  );
}

@Injectable()
export class RequestDurationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestDurationInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<HttpRequest>();
    const startedAt = Date.now();

    return next.handle().pipe(
      finalize(() => {
        const durationMs = Date.now() - startedAt;
        const thresholdMs = Number(
          process.env.WPPTRACK_API_SLOW_REQUEST_MS ?? 1500,
        );

        if (!Number.isFinite(thresholdMs) || durationMs < thresholdMs) {
          return;
        }

        this.logger.warn(
          JSON.stringify({
            event: "http.request.slow",
            method: request.method ?? "UNKNOWN",
            path: sanitizeRequestPath(
              request.originalUrl ?? request.url ?? "unknown",
            ),
            durationMs,
          }),
        );
      }),
    );
  }
}

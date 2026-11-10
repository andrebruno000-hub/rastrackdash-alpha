import { Logger } from "@nestjs/common";
import { lastValueFrom, of } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RequestDurationInterceptor,
  sanitizeRequestPath,
} from "../src/common/http/request-duration.interceptor";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.WPPTRACK_API_SLOW_REQUEST_MS;
});

describe("request duration interceptor", () => {
  it("redacts the Meta Cloud verify token from the slow request log", async () => {
    process.env.WPPTRACK_API_SLOW_REQUEST_MS = "0";
    const warn = vi
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    await lastValueFrom(
      new RequestDurationInterceptor().intercept(
        {
          getType: () => "http",
          switchToHttp: () => ({
            getRequest: () => ({
              method: "GET",
              originalUrl:
                "/webhooks/inbound/conn_1?hub.mode=subscribe&hub.verify_token=x&hub.challenge=y",
            }),
          }),
        } as never,
        { handle: () => of({ ok: true }) },
      ),
    );
    const logged = JSON.parse(warn.mock.calls[0]?.[0] as string);
    expect(logged.path).toBe(
      "/webhooks/inbound/conn_1?hub.mode=subscribe&hub.verify_token=[REDACTED]&hub.challenge=y",
    );
  });

  it.each([
    [
      "/webhooks/inbound/conn_1?token=x&mode=test",
      "/webhooks/inbound/conn_1?token=[REDACTED]&mode=test",
    ],
    [
      "/webhooks/meta?hub.verify_token=x",
      "/webhooks/meta?hub.verify_token=[REDACTED]",
    ],
    [
      "/auth/google/callback?code=x&state=y&scope=email",
      "/auth/google/callback?code=[REDACTED]&state=[REDACTED]&scope=email",
    ],
    ["/hooks?secret=x", "/hooks?secret=[REDACTED]"],
    ["/hooks?hottok=x", "/hooks?hottok=[REDACTED]"],
    ["/hooks?api_token=x&page=2", "/hooks?api_token=[REDACTED]&page=2"],
    ["/hooks?apiKey=x", "/hooks?apiKey=[REDACTED]"],
    ["/hooks?key=x", "/hooks?key=[REDACTED]"],
    ["/hooks?X-Hub-Signature=x", "/hooks?X-Hub-Signature=[REDACTED]"],
    ["/hooks?%73ecret=x", "/hooks?%73ecret=[REDACTED]"],
    ["/hooks?SECRET=x&secret=y", "/hooks?SECRET=[REDACTED]&secret=[REDACTED]"],
    ["/hooks?secret=x#frag", "/hooks?secret=[REDACTED]"],
    ["/reports/campaigns?page=1&q=abc", "/reports/campaigns?page=1&q=abc"],
    ["/reports/campaigns", "/reports/campaigns"],
  ])("redacts sensitive query values: %s", (url, expected) => {
    expect(sanitizeRequestPath(url)).toBe(expected);
  });
});

import { vi } from "vitest";

export interface RecordedRequest {
  url: URL;
  method: string;
  body?: string;
  headers: Headers;
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function textResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function serializeBody(body: BodyInit | null | undefined): string | undefined {
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  return undefined;
}

/**
 * Replaces global fetch and records every request. The handler returns the
 * response for a given call; unhandled requests should return a 404 response.
 */
export function mockGoogleFetch(
  handler: (request: RecordedRequest) => Response | Promise<Response>,
): { calls: RecordedRequest[]; fetchMock: ReturnType<typeof vi.fn> } {
  const calls: RecordedRequest[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const request: RecordedRequest = {
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      body: serializeBody(init?.body),
      headers: new Headers(init?.headers),
    };

    calls.push(request);
    return handler(request);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

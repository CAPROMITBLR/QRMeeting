const NO_STORE = { "cache-control": "no-store" } as const;

export function json(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: { ...NO_STORE, ...(init.headers as Record<string, string> | undefined) },
  });
}

export function apiError(status: number, error: string, message: string): Response {
  return json({ error, message }, { status });
}

/** <APP_BASE_URL> when configured, otherwise the origin this request arrived on. */
export function getBaseUrl(request: Request): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const headers = request.headers;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const proto = headers.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

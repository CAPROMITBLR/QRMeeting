import { apiError, getClientIp } from "@/lib/http";

export async function readJson(request: Request): Promise<unknown | Response> {
  try {
    return await request.json();
  } catch {
    return apiError(400, "invalid_body", "Expected a JSON body.");
  }
}

export async function checkRateLimit(
  request: Request,
  limiter: { check(key: string): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> },
  message: string,
): Promise<Response | null> {
  const limit = await limiter.check(`ip:${getClientIp(request)}`);
  if (limit.allowed) return null;
  const response = apiError(429, "rate_limited", message);
  response.headers.set("retry-after", String(limit.retryAfterSeconds));
  return response;
}

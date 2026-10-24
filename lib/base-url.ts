import "server-only";

import { headers } from "next/headers";

/** APP_BASE_URL when set, otherwise the origin of the current request. */
export async function requestOrigin(): Promise<string> {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) {
    if (process.env.NODE_ENV === "production" && !configured.startsWith("https://")) {
      console.warn("MeetingQR requires an HTTPS APP_BASE_URL in production; generated links may not support geolocation.");
    }
    return configured.replace(/\/+$/, "");
  }

  if (process.env.NODE_ENV === "production") {
    console.warn("MeetingQR APP_BASE_URL is missing in production; configure an HTTPS public origin for QR links and geolocation.");
  }

  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const proto = requestHeaders.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

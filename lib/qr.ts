import { createHmac, timingSafeEqual } from "node:crypto";

import QRCode from "qrcode";
import { QR_ROTATE_SECONDS } from "@/lib/config";
import { fileSlug } from "@/lib/csv";

export function currentQrSlot(now = Date.now()): number {
  return Math.floor(now / (QR_ROTATE_SECONDS * 1000));
}

function tokenForSlot(hostToken: string, meetingId: string, slot: number): string {
  return createHmac("sha256", hostToken).update(`${meetingId}:${slot}`, "utf8").digest().subarray(0, 16).toString("base64url");
}

export function qrToken(hostToken: string, meetingId: string, slot = currentQrSlot()): string {
  return tokenForSlot(hostToken, meetingId, slot);
}

export function verifyQrToken(
  hostToken: string,
  meetingId: string,
  token: string | null | undefined,
  slot: number | null | undefined,
  now = Date.now(),
): boolean {
  if (!token || typeof slot !== "number" || !Number.isInteger(slot)) return false;
  const currentSlot = currentQrSlot(now);
  if (slot > currentSlot || slot < currentSlot - 2) return false;
  const expected = Buffer.from(tokenForSlot(hostToken, meetingId, slot), "utf8");
  const provided = Buffer.from(token, "utf8");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function attendeeUrl(
  baseUrl: string,
  meetingId: string,
  token: string,
  slot: number,
): string {
  return `${baseUrl.replace(/\/+$/, "")}/attend/${meetingId}?t=${encodeURIComponent(token)}&s=${slot}`;
}

export async function qrPng(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, {
    type: "png",
    width: 1024,
    margin: 2,
    errorCorrectionLevel: "M",
  });
}

/** "Faculty Meeting 12/03" -> "Faculty-Meeting-1203-qr.png" */
export function qrFileName(title: string): string {
  return `${fileSlug(title) || "meeting"}-qr.png`;
}

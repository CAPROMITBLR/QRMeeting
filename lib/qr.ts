import "server-only";

import QRCode from "qrcode";
import { fileSlug } from "@/lib/csv";

export function attendeeUrl(baseUrl: string, meetingId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/attend/${meetingId}`;
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

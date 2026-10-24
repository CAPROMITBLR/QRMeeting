import QRCode from "qrcode";

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
export function qrFileName(_title: string, meetingId: string): string {
  return `meeting_${meetingId.slice(-8)}.png`;
}

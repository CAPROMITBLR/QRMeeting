import { MEETING_EVENT, meetingTopic, type MeetingChangeKind } from "@/lib/realtime-topic";

export type RealtimeConfig = { url: string; key: string };

/**
 * Realtime needs the project URL plus a publishable key. The key is public by
 * design, but it still comes from the environment so deployments can rotate it
 * without a code change. When either value is missing the app keeps working:
 * the host page falls back to polling.
 */
export function realtimeConfig(): RealtimeConfig | null {
  const url = process.env.PROJECT_URL?.trim().replace(/\/+$/, "");
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

/** One POST body for the batch broadcast endpoint. Contains no attendee data. */
export function meetingBroadcastBody(meetingId: string, kind: MeetingChangeKind) {
  return {
    messages: [{ topic: meetingTopic(meetingId), event: MEETING_EVENT, payload: { kind } }],
  };
}

/** Broadcast a "meeting changed" signal. Never throws; failures are logged. */
export async function notifyMeetingChanged(
  meetingId: string,
  kind: MeetingChangeKind,
): Promise<boolean> {
  const config = realtimeConfig();
  if (!config) return false;

  try {
    const response = await fetch(`${config.url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: config.key,
        authorization: `Bearer ${config.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(meetingBroadcastBody(meetingId, kind)),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      console.warn("realtime broadcast failed", response.status);
      return false;
    }
    return true;
  } catch (error) {
    console.warn("realtime broadcast failed", error);
    return false;
  }
}

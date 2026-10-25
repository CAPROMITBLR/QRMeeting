"use client";

import { createClient, type RealtimeChannel } from "@supabase/supabase-js";

import { MEETING_EVENT, meetingTopic } from "@/lib/realtime-topic";

export type HostConnectionState = "connecting" | "live" | "offline";

/**
 * Subscribes to the meeting's "something changed" channel. The callback only
 * signals that a refetch is worthwhile; callers keep the snapshot endpoint as
 * the single source of truth. Returns an unsubscribe function.
 */
export function subscribeToMeetingChange({
  url,
  key,
  meetingId,
  onChange,
  onState,
}: {
  url: string;
  key: string;
  meetingId: string;
  onChange: () => void;
  onState?: (state: HostConnectionState) => void;
}): () => void {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // Only invalidation hints travel over this socket.
    realtime: { params: { eventsPerSecond: 5 } },
  });

  onState?.("connecting");

  const channel: RealtimeChannel = client.channel(meetingTopic(meetingId));
  channel.on("broadcast", { event: MEETING_EVENT }, () => onChange());
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") onState?.("live");
    else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      onState?.("offline");
    }
  });

  return () => {
    void client.removeChannel(channel);
    void client.realtime.disconnect();
  };
}

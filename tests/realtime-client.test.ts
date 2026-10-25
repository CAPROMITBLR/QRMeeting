import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);
  const client = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => {}),
    realtime: { disconnect: vi.fn() },
  };
  return { channel, client };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => mocks.client) }));

import { subscribeToMeetingChange } from "../lib/realtime-client";
import { MEETING_EVENT, meetingTopic } from "../lib/realtime-topic";

const MEETING_ID = "11111111-1111-4111-8111-111111111111";
const CONFIG = { url: "https://example.supabase.co", key: "sb_publishable_test" };

describe("subscribeToMeetingChange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listens on the meeting topic and turns a broadcast into a refetch", () => {
    const onChange = vi.fn();
    const onState = vi.fn();

    subscribeToMeetingChange({ ...CONFIG, meetingId: MEETING_ID, onChange, onState });

    expect(mocks.client.channel).toHaveBeenCalledWith(meetingTopic(MEETING_ID));
    expect(mocks.channel.on).toHaveBeenCalledWith(
      "broadcast",
      { event: MEETING_EVENT },
      expect.any(Function),
    );

    const handleMessage = mocks.channel.on.mock.calls[0][2] as () => void;
    handleMessage();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("reports connection states so the page can fall back to polling", () => {
    const onState = vi.fn();
    subscribeToMeetingChange({ ...CONFIG, meetingId: MEETING_ID, onChange: vi.fn(), onState });

    const onStatus = mocks.channel.subscribe.mock.calls[0][0] as (status: string) => void;

    expect(onState).toHaveBeenCalledWith("connecting");
    onStatus("SUBSCRIBED");
    expect(onState).toHaveBeenLastCalledWith("live");
    onStatus("CHANNEL_ERROR");
    expect(onState).toHaveBeenLastCalledWith("offline");
    onStatus("TIMED_OUT");
    expect(onState).toHaveBeenLastCalledWith("offline");
    onStatus("CLOSED");
    expect(onState).toHaveBeenLastCalledWith("offline");
  });

  it("tears the channel and socket down on unmount", () => {
    const unsubscribe = subscribeToMeetingChange({
      ...CONFIG,
      meetingId: MEETING_ID,
      onChange: vi.fn(),
    });

    unsubscribe();

    expect(mocks.client.removeChannel).toHaveBeenCalledTimes(1);
    expect(mocks.client.realtime.disconnect).toHaveBeenCalledTimes(1);
  });
});

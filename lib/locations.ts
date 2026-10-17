export type MeetingLocation = {
  latitude: number;
  longitude: number;
  radius: number;
};

export const LOCATION_PRESETS: Record<string, MeetingLocation> = {
  AB5: { latitude: 13.125128055616079, longitude: 77.58987820483807, radius: 45 },
  AB4: { latitude: 13.12525, longitude: 77.5905833333, radius: 45 },
};

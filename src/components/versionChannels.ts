import { useSyncExternalStore } from "react";
import type { Channel } from "./packVersions";

/** Which versions a version list shows: every one, or only one channel. */
export type ChannelFilter = "all" | Channel;

const KEY = "unity.versionChannel";
const CHOICES: ChannelFilter[] = ["all", "release", "beta", "alpha"];
const listeners = new Set<() => void>();

function read(): ChannelFilter {
  try {
    const stored = localStorage.getItem(KEY) as ChannelFilter | null;
    return stored && CHOICES.includes(stored) ? stored : "all";
  } catch {
    return "all";
  }
}

function write(value: ChannelFilter) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Not remembered, but still applied until the list closes.
  }
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const countChannels = (channels: Channel[]) => {
  const counts: Record<Channel, number> = { release: 0, beta: 0, alpha: 0 };
  for (const channel of channels) counts[channel]++;
  return counts;
};

/*
 * The channel filter every version list shares, remembered between lists and launches:
 * someone who only wants full releases picks Release once. A list with nothing in the
 * remembered channel shows everything instead (`wanted` still says what was asked for).
 */
export function useChannelFilter(counts: Record<Channel, number>) {
  const wanted = useSyncExternalStore(subscribe, read);
  const filter: ChannelFilter = wanted !== "all" && !counts[wanted] ? "all" : wanted;
  return { filter, wanted, setFilter: write };
}

/** The version to start on under a filter: the newest in it, else the newest of all. */
export function newestIn<T>(versions: T[], channelOf: (version: T) => Channel, filter: ChannelFilter): T | null {
  return (filter === "all" ? versions[0] : versions.find((v) => channelOf(v) === filter)) ?? versions[0] ?? null;
}

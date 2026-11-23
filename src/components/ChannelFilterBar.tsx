import type { CSSProperties } from "react";
import { Segmented } from "./ui";
import { CHANNEL, type Channel } from "./packVersions";
import type { ChannelFilter } from "./versionChannels";
import "./channelFilter.css";

type Props = {
  counts: Record<Channel, number>;
  value: ChannelFilter;
  /** What was asked for, when this list has none of it and shows everything instead. */
  wanted: ChannelFilter;
  onChange: (value: ChannelFilter) => void;
  style?: CSSProperties;
};

const PLURAL: Record<Channel, string> = { release: "full releases", beta: "betas", alpha: "alphas" };

/* All, Release, Beta or Alpha, each with how many there are; only channels with any are offered. */
export default function ChannelFilterBar({ counts, value, wanted, onChange, style }: Props) {
  const total = counts.release + counts.beta + counts.alpha;
  const present = (["release", "beta", "alpha"] as Channel[]).filter((c) => counts[c]);
  if (present.length < 2 && wanted === value) return null;

  return (
    <div className="channel-filter" data-testid="channel-filter" style={style}>
      {present.length > 1 && (
        <Segmented
          label="Show versions"
          value={value}
          onChange={onChange}
          options={[
            { value: "all" as ChannelFilter, label: `All ${total}` },
            ...present.map((c) => ({ value: c as ChannelFilter, label: `${CHANNEL[c].label} ${counts[c]}` })),
          ]}
        />
      )}
      {wanted !== value && wanted !== "all" && (
        <span className="channel-filter__note">There are no {PLURAL[wanted]} of this, so every version is shown.</span>
      )}
    </div>
  );
}

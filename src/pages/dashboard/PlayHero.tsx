import { useState, type ReactNode } from "react";
import { FolderPlus, Play } from "lucide-react";
import { Badge, Button } from "../../components/ui";
import { AccountClashNotice, PlayAsMenu } from "../../components/PlayAs";
import { useAccountChoice } from "../../components/playAsChoice";
import { formatDuration, formatHours } from "../../components/charts";
import { timeAgo } from "../playedAgo";
import { loaderName } from "./useInstances";
import "./dashboard.css";

/* Minecraft art from the Minecraft Launcher's own release notes, behind the last-played card. */
export const MINECRAFT_ART = "https://launchercontent.mojang.com/v2/images/dappledcamp540x540.jpg";

type Props = {
  /** The instance to offer: the one played last (or the first, if none has been played). */
  instance?: Instance;
  /** Its dashboard numbers (mods, play time), when known. */
  stat?: DashboardInstanceStat;
  loaded: boolean;
  starting: string | null;
  /** accountId: who to play as, when chosen; otherwise the active account. */
  onPlay: (instance: Instance, accountId?: string) => void;
  /** With no instances yet: where "Create an instance" goes. */
  onCreate: () => void;
  /** More buttons beside Play. */
  actions?: ReactNode;
  /** One more fact after the version and loader (the last world, say). */
  extra?: ReactNode;
  /** A strip along the bottom (Home puts the overview numbers there). */
  footer?: ReactNode;
  headingLevel?: "h2" | "h3";
  /** A tall, full-bleed art banner with the words laid over it. */
  banner?: boolean;
};

/* The quick-launch card: what was played last and when, with the screen's one solid Play.
   Home and the Minecraft home both use it, so they look and launch the same. */
export default function PlayHero({ instance, stat, loaded, starting, onPlay, onCreate, actions, extra, footer, headingLevel: H = "h2", banner }: Props) {
  const [artFailed, setArtFailed] = useState(false);
  const choice = useAccountChoice();
  // An account already in another game is offered the free ones instead of failing.
  const play = (accountId?: string) => {
    if (instance && choice.check(instance.name, accountId)) onPlay(instance, accountId);
  };

  return (
    <section className={banner ? "db-hero db-hero--banner" : "db-hero"} aria-label={instance ? "Last played" : "Get started"}>
      <div className="db-hero__art" aria-hidden="true">
        {!artFailed && <img src={MINECRAFT_ART} alt="" referrerPolicy="no-referrer" draggable={false} onError={() => setArtFailed(true)} />}
      </div>

      <div className="db-hero__body">
        {instance ? (
          <>
            <p className="db-hero__when">
              {instance.running ? "Playing now" : instance.lastPlayed ? `Last played ${timeAgo(instance.lastPlayed)}` : "Not played yet"}
            </p>
            <H className="db-hero__name">{instance.name}</H>
            <p className="db-hero__facts">
              <Badge className="db-mono">{instance.version}</Badge>
              <Badge>
                {loaderName(instance.loader)}
                {instance.loaderVersion && instance.loader !== "vanilla" ? ` ${instance.loaderVersion}` : ""}
              </Badge>
              {stat && <Badge>{stat.modCount === 1 ? "1 mod" : `${stat.modCount} mods`}</Badge>}
              {stat && stat.playSeconds !== null && <Badge>{formatDuration(stat.playSeconds)} in this instance</Badge>}
              {stat && stat.worldPlaySeconds ? (
                <Badge data-tip="What this instance's worlds record themselves. It can include play from before the instance was added here, so it isn't counted in play time.">
                  {formatHours(stat.worldPlaySeconds)} recorded in its worlds
                </Badge>
              ) : null}
              {extra}
            </p>
            <div className="db-hero__actions">
              {instance.running ? (
                // One copy at a time: while it runs, say so instead of offering Play.
                <span className="db-running" role="status">
                  <span className="db-running__dot" aria-hidden="true" />
                  {instance.playingAs ? `Running as ${instance.playingAs.name}.` : "Running."} Close the game to play again.
                </span>
              ) : (
                <>
                  <Button
                    variant="primary"
                    size="lg"
                    className="db-play"
                    icon={<Play size={18} fill="currentColor" aria-hidden="true" />}
                    disabled={starting !== null}
                    onClick={() => play()}
                    aria-label={`Play ${instance.name}`}
                  >
                    {starting === instance.name ? "Starting..." : "Play"}
                  </Button>
                  {starting === null && <PlayAsMenu choice={choice} instance={instance.name} size="lg" onPlayAs={play} />}
                </>
              )}
              {actions}
            </div>
            {!instance.running && <AccountClashNotice choice={choice} instance={instance.name} onPlayAs={play} />}
          </>
        ) : (
          <>
            <p className="db-hero__when">{loaded ? "No instances yet" : "Loading your instances..."}</p>
            <H className="db-hero__name">{loaded ? "Make your first instance" : "Getting your library ready"}</H>
            <p className="db-hero__facts">An instance keeps its own mods, worlds and settings. Start with Vanilla for the original game, or choose a modpack.</p>
            <div className="db-hero__actions">
              <Button variant="primary" size="lg" disabled={!loaded} icon={<FolderPlus size={18} aria-hidden="true" />} onClick={onCreate}>
                Create an instance
              </Button>
              {actions}
            </div>
          </>
        )}
      </div>

      {footer && <div className="db-hero__footer">{footer}</div>}
    </section>
  );
}

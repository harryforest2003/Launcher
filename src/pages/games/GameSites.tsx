import { useState } from "react";
import { ExternalLink, Globe } from "lucide-react";
import DiscoverRow from "../DiscoverRow";
import { modSitesFor, errorText } from "./shared";
import { Badge, Button, EmptyState, Monogram, Notice } from "../../components/ui";

type Props = {
  detail: GameDetail;
  /* The sites Discover searches for this game, once its first search is in. */
  sources: NonNullable<GameSearchPage["sources"]>;
  checking: boolean;
  goMods: () => void;
};

/*
 * Every website with mods for the game, each a link that opens in the browser: the ones
 * Discover searches, and the ones it can't (no way for apps to list their mods), so those
 * are a click away too. What's downloaded from them goes in through Add from Downloads.
 */
export default function GameSites({ detail, sources, checking, goMods }: Props) {
  const [error, setError] = useState<string | null>(null);
  const sites = modSitesFor(detail.id, sources);
  const open = (url: string) => {
    setError(null);
    window.gamesAPI.openUrl(url).catch((err) => setError(errorText(err)));
  };

  if (!sites.length) {
    return checking ? (
      <p className="gd-sites-note" role="status">Finding sites with {detail.name} mods…</p>
    ) : (
      <EmptyState icon={<Globe size={22} aria-hidden="true" />} title="No mod sites yet" body={`None of the sites the launcher knows has ${detail.name} mods.`} />
    );
  }

  const websiteOnly = sites.some((site) => !site.searched);
  return (
    <>
      {websiteOnly && (
        <p className="gd-sites-note">
          {sites.length} {sites.length === 1 ? "site has" : "sites have"} {detail.name} mods. From a site marked Website only, download in your browser, then{" "}
          <button type="button" className="dc-link" onClick={goMods}>
            Add from Downloads
          </button>
          .
        </p>
      )}
      {error && (
        <div className="dc-notices">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}
      <div className="dc-list" data-testid="game-sites">
        {sites.map((site) => (
          <DiscoverRow
            key={site.url}
            testId="game-site"
            name={site.name}
            summary={site.about}
            onOpen={() => open(site.url)}
            art={<Monogram name={site.name} size={48} />}
            meta={
              <>
                <span className="dc-stat" title={site.url}>{site.host}</span>
                {site.searched ? (
                  <Badge className="dc-chip" tone="accent" title="Discover searches this site: its mods are on the Mods tab">In Discover</Badge>
                ) : (
                  <Badge className="dc-chip" title="Apps can't list this site's mods: browse it in your browser">Website only</Badge>
                )}
              </>
            }
            action={
              <Button size="sm" variant="secondary" icon={<ExternalLink size={14} aria-hidden="true" />} aria-label={`Open ${site.name} in your browser`} title={`Opens ${site.url} in your browser`} onClick={() => open(site.url)}>
                Open
              </Button>
            }
          />
        ))}
      </div>
    </>
  );
}

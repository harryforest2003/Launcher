import { useState } from "react";
import { ExternalLink } from "lucide-react";
import ApiKeyRow from "./ApiKeyRow";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import SearchField from "./ui/SearchField";
import { MOD_SITES, MOD_SITE_KEYS, gamesOf, matchSites, type ModSite } from "../utils/modSites";
import "../theme/appearance.css";

type Props = {
  apiKeys: ApiKeyStatuses | null;
  onChange: (statuses: ApiKeyStatuses) => void;
};

function Help({ site }: { site: ModSite }) {
  return (
    <>
      <span className="set-site-games">{gamesOf(site)}</span>
      {site.about}
    </>
  );
}

/* A site with nothing to add: how the launcher reaches it, and a way to its page. */
function SiteRow({ site, hostReady }: { site: ModSite; hostReady: boolean | undefined }) {
  const [error, setError] = useState<string | null>(null);
  const viaHost = site.connection === "host";

  return (
    <div className="set-row" data-testid={`mod-site-${site.id}`}>
      <div>
        <h3 className="set-row-name">
          {site.name}
          <Badge tone={viaHost && hostReady === false ? "warning" : "success"}>
            {!viaHost ? "No key needed" : hostReady === false ? "Host not set up" : "Through the launcher"}
          </Badge>
        </h3>
        <p className="set-help">
          <Help site={site} />
        </p>
      </div>

      <div className="set-row-controls set-row-controls--start">
        <Button
          size="sm"
          variant="ghost"
          icon={<ExternalLink size={14} aria-hidden="true" />}
          aria-label={`Open ${site.name} in your browser`}
          onClick={() => {
            setError(null);
            window.gamesAPI.openUrl(site.url).catch((err) => setError(err instanceof Error ? err.message : String(err)));
          }}
        >
          Open site
        </Button>
        {error && <p className="set-help" role="alert">{error}</p>}
      </div>
    </div>
  );
}

/*
 * Every mod site the launcher finds mods on, searchable by name or game. Sites that take a
 * key from the player's account show its field; the rest need nothing.
 */
export default function ModSiteList({ apiKeys, onChange }: Props) {
  const [query, setQuery] = useState("");
  const shown = matchSites(MOD_SITES, query);
  const added = apiKeys ? MOD_SITE_KEYS.filter((key) => apiKeys[key]?.set).length : 0;

  return (
    <section id="api-tokens" aria-label="Mod sites" className="page-section">
      <div className="set-pane-head set-pane-head--end">
        {apiKeys && (
          <span className="set-count" style={{ marginRight: 0 }}>
            {MOD_SITES.length} sites · <strong>{added}</strong> of {MOD_SITE_KEYS.length} keys added
          </span>
        )}
      </div>
      <div className="ui-panel set-panel" data-testid="personal-tokens">
        <div className="set-panel-head set-panel-head--stack">
          <p className="set-lead" style={{ marginTop: 0 }}>
            Where Discover finds mods. Most sites need nothing. A few take a key from your own
            account, which is locked with your computer's keychain and only ever sent to the site
            it belongs to.
          </p>
          <SearchField
            label="Search mod sites"
            placeholder="Search by site or game"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            wrapperClassName="set-site-search"
          />
        </div>

        {shown.length === 0 ? (
          <p className="set-message set-message--muted" data-testid="mod-sites-none">
            Nothing matches “{query.trim()}”. Try a site or a game, like Valheim or Doom.
          </p>
        ) : (
          <div className="set-rows">
            {shown.map((site) =>
              site.key ? (
                <div key={site.id} id={`token-${site.key}`} className="page-section-anchor">
                  <ApiKeyRow
                    name={site.key}
                    label={site.name}
                    environmentVariable={site.environmentVariable ?? ""}
                    status={apiKeys?.[site.key]}
                    onChange={onChange}
                    getKey={site.keyUrl ? { url: site.keyUrl, steps: site.keySteps } : undefined}
                  >
                    <Help site={site} />
                  </ApiKeyRow>
                </div>
              ) : (
                <div key={site.id} id={`site-${site.id}`} className="page-section-anchor">
                  <SiteRow site={site} hostReady={site.id === "curseforge" ? apiKeys?.curseforge?.set : undefined} />
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </section>
  );
}

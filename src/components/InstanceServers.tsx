import { useEffect, useState } from "react";
import { ExternalLink, Play, Plus, Server } from "lucide-react";
import { Badge, Button, EmptyState, Notice, SearchField, Select } from "./ui";
import { BinIcon } from "./Icons";
import Pagination from "./Pagination";

type ServerSort = "relevance" | "follows" | "newest" | "updated";

const SORTS: { value: ServerSort; label: string }[] = [
  { value: "relevance", label: "Best match" },
  { value: "follows", label: "Most followed" },
  { value: "updated", label: "Recently updated" },
  { value: "newest", label: "Newest" },
];

const message = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

const count = new Intl.NumberFormat();

/* The servers an instance's Multiplayer screen lists, each pinged, with Play and remove. */
export function YourServers({
  instanceName,
  servers,
  running,
  onChange,
  onPlay,
  onFind,
  onError,
}: {
  instanceName: string;
  servers: InstanceServer[] | null;
  running: boolean;
  onChange: (servers: InstanceServer[]) => void;
  onPlay: (address: string) => void;
  onFind: () => void;
  onError: (text: string) => void;
}) {
  // Answers belong to the list they were asked for, so a refreshed list starts checking again.
  const [pinged, setPinged] = useState<{ of: InstanceServer[] | null; status: Record<string, ServerStatus> }>({ of: null, status: {} });

  useEffect(() => {
    if (!servers) return;
    let live = true;
    for (const server of servers) {
      window.instanceAPI
        .pingServer(server.address)
        .catch((err) => ({ online: false as const, error: message(err) }))
        .then((status) => {
          if (!live) return;
          setPinged((now) => ({ of: servers, status: { ...(now.of === servers ? now.status : {}), [server.address]: status } }));
        });
    }
    return () => {
      live = false;
    };
  }, [servers]);

  if (!servers) return <p className="worlds__muted">Loading…</p>;

  if (!servers.length) {
    return (
      <EmptyState
        icon={<Server size={28} />}
        title="No servers yet"
        body="Servers you add in the game's Multiplayer screen appear here. Add one by its address, or find servers listed on Modrinth."
        actions={
          <Button variant="primary" icon={<Server size={16} />} onClick={onFind}>
            Find servers
          </Button>
        }
      />
    );
  }

  const statuses = pinged.of === servers ? pinged.status : {};

  const remove = async (server: InstanceServer) => {
    if (!window.confirm(`Remove "${server.name}" (${server.address}) from this instance's server list?`)) return;
    try {
      onChange(await window.instanceAPI.removeServer(instanceName, { index: server.index, address: server.address }));
    } catch (err) {
      onError(message(err));
    }
  };

  return (
    <ul className="worlds__list">
      {servers.map((server) => {
        const status = statuses[server.address];
        const icon = (status?.online && status.icon) || server.icon;
        return (
          <li key={`${server.index}:${server.address}`} data-testid="server" className="worlds__item">
            {icon ? <img src={icon} alt="" width={56} height={56} className="worlds__icon worlds__icon--pixel" /> : <div className="worlds__icon worlds__icon--empty" aria-hidden="true"><Server size={22} /></div>}

            <div className="worlds__body">
              <div className="worlds__name">{server.name}</div>
              <div className="worlds__meta worlds__meta--small">{server.address}</div>
              {status?.online && status.motd && <div className="worlds__motd">{status.motd}</div>}
              <div className="worlds__meta worlds__meta--small servers__status">
                {!status ? (
                  "Checking…"
                ) : status.online ? (
                  <>
                    <span className="servers__dot servers__dot--online" aria-hidden="true" />
                    {`Online · ${count.format(status.players)}/${count.format(status.maxPlayers)} players · ${status.latency} ms${status.version ? ` · ${status.version}` : ""}`}
                  </>
                ) : (
                  <>
                    <span className="servers__dot" aria-hidden="true" />
                    {`Not answering${status.error ? `: ${status.error}` : ""}`}
                  </>
                )}
              </div>
            </div>

            <div className="worlds__item-actions">
              <Button
                size="sm"
                variant="primary"
                icon={<Play size={15} />}
                disabled={running}
                title={running ? "The game is already running" : `Start the game and join ${server.name}`}
                onClick={() => onPlay(server.address)}
              >
                Play
              </Button>
              <button className="bin-button" title={`Remove ${server.name}`} aria-label={`Remove ${server.name}`} onClick={() => remove(server)}>
                <BinIcon />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* Adding a server by its address, the way the game's Add Server screen does. */
export function AddServerForm({
  instanceName,
  onAdded,
  onCancel,
}: {
  instanceName: string;
  onAdded: (servers: InstanceServer[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!address.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      onAdded(await window.instanceAPI.addServer(instanceName, { name: name.trim(), address: address.trim() }));
    } catch (err) {
      setError(message(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="worlds__link"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="servers__form-row">
        <label className="servers__field">
          <span className="worlds__link-label">Name</span>
          <input className="ui-input worlds__input" placeholder="Minecraft Server" value={name} maxLength={64} disabled={saving} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="servers__field servers__field--wide">
          <span className="worlds__link-label">Address</span>
          <input
            className="ui-input worlds__input"
            placeholder="play.example.com"
            value={address}
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            disabled={saving}
            onChange={(e) => setAddress(e.target.value)}
          />
        </label>
      </div>
      {error && <Notice tone="danger" className="worlds__notice">{error}</Notice>}
      <div className="worlds__link-row">
        <Button type="submit" variant="primary" size="sm" disabled={saving || !address.trim()}>
          {saving ? "Adding…" : "Add server"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* Servers listed on Modrinth: join one straight away, or add it to the instance's list. */
export function FindServers({
  instanceName,
  mcVersion,
  servers,
  running,
  onChange,
  onPlay,
}: {
  instanceName: string;
  mcVersion: string;
  servers: InstanceServer[] | null;
  running: boolean;
  onChange: (servers: InstanceServer[]) => void;
  onPlay: (address: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ServerSort>("relevance");
  const [page, setPage] = useState(1);
  const [found, setFound] = useState<ServerSearch | null>(null);
  const [settled, setSettled] = useState<{ key: string; error: string | null } | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const searchKey = JSON.stringify([query, sort, page]);
  const loading = settled?.key !== searchKey;
  const error = settled?.key === searchKey ? settled.error : null;
  const listed = new Set((servers ?? []).map((server) => server.address.toLowerCase()));

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(typed.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [typed]);

  useEffect(() => {
    let live = true;
    window.instanceAPI
      .searchServers({ query, sort, page: page - 1 })
      .then((result) => {
        if (!live) return;
        setFound(result);
        setSettled({ key: searchKey, error: null });
      })
      .catch((err) => {
        if (live) setSettled({ key: searchKey, error: message(err) });
      });
    return () => {
      live = false;
    };
  }, [query, sort, page, searchKey]);

  const add = async (server: FoundServer) => {
    setAddError(null);
    try {
      onChange(await window.instanceAPI.addServer(instanceName, { name: server.name, address: server.address }));
    } catch (err) {
      setAddError(message(err));
    }
  };

  return (
    <div className="worlds__find">
      <div className="worlds__filters">
        <SearchField label="Search servers" placeholder="Search Modrinth's servers" value={typed} onChange={(e) => setTyped(e.target.value)} wrapperClassName="worlds__search" />
        <Select
          size="sm"
          aria-label="Sort by"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as ServerSort);
            setPage(1);
          }}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>

      <p className="worlds__muted worlds__source">
        {found && !loading ? `${found.total.toLocaleString()} Java servers on Modrinth.` : "Java servers on Modrinth."} Modded ones say which modpack to join with.
      </p>

      {error && <Notice tone="danger" className="worlds__notice">{error}</Notice>}
      {addError && <Notice tone="danger" className="worlds__notice">{addError}</Notice>}

      {loading && !found ? (
        <p className="worlds__muted">Searching…</p>
      ) : found && found.servers.length === 0 && !loading ? (
        <EmptyState size="compact" title={query ? `No servers match "${query}"` : "No servers here"} body="Try other words." />
      ) : (
        <ul className="worlds__list" aria-busy={loading}>
          {found?.servers.map((server) => {
            const onList = listed.has(server.address.toLowerCase());
            const otherVersion = !server.modpack && server.versions.length > 0 && !server.versions.includes(mcVersion);
            return (
              <li key={server.id} data-testid="server-result" className="worlds__item">
                {server.icon ? <img src={server.icon} alt="" width={56} height={56} loading="lazy" className="worlds__icon" /> : <div className="worlds__icon worlds__icon--empty" aria-hidden="true"><Server size={22} /></div>}
                <div className="worlds__body">
                  <div className="worlds__name">{server.name}</div>
                  {server.summary && <div className="worlds__summary">{server.summary}</div>}
                  <div className="worlds__meta worlds__meta--small servers__status">
                    {server.online ? (
                      <>
                        <span className="servers__dot servers__dot--online" aria-hidden="true" />
                        {`${count.format(server.online.players)} playing`}
                      </>
                    ) : (
                      <>
                        <span className="servers__dot" aria-hidden="true" />
                        Offline when last checked
                      </>
                    )}
                    {` · ${server.address}`}
                    {server.versions.length ? ` · Minecraft ${versionRange(server.versions)}` : ""}
                    {server.region ? ` · ${server.region}` : ""}
                  </div>
                  {(server.modpack || otherVersion || server.tags.length > 0) && (
                    <div className="worlds__tags">
                      {server.modpack && <Badge tone="info">Join with the {server.modpack.name} modpack</Badge>}
                      {otherVersion && <Badge tone="warning">Not for Minecraft {mcVersion}</Badge>}
                      {server.tags.slice(0, 3).map((tag) => (
                        <Badge key={tag}>{tag}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="worlds__item-actions">
                  <a className="worlds__site" href={server.url} target="_blank" rel="noopener noreferrer" title="Its page on Modrinth" aria-label={`${server.name} on Modrinth`}>
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Plus size={15} />}
                    disabled={onList || !servers}
                    title={onList ? "It's on this instance's server list" : "Add it to this instance's server list"}
                    onClick={() => add(server)}
                  >
                    {onList ? "Added" : "Add"}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Play size={15} />}
                    disabled={running}
                    title={running ? "The game is already running" : `Start the game and join ${server.name}`}
                    onClick={() => onPlay(server.address)}
                  >
                    Play
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination page={page} pageCount={found?.pageCount ?? 1} disabled={loading} onChange={setPage} />
    </div>
  );
}

/* "1.8–1.21.4" for a long list, or the few versions there are. */
function versionRange(versions: string[]) {
  const parts = (v: string) => v.split(/[.-]/).map((n) => Number(n) || 0);
  const sorted = [...versions].sort((a, b) => {
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  });
  if (sorted.length <= 3) return sorted.join(", ");
  return `${sorted[0]}–${sorted[sorted.length - 1]}`;
}

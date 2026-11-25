import { useEffect, useState, type CSSProperties } from "react";
import { Copy } from "lucide-react";
import { Button, Notice } from "./ui";

/*
 * Shared instances, on an instance's page. The owner publishes the instance to a small file
 * (in a folder that syncs, or anywhere they can send a link to) and publishes again after
 * changing it; members joined it from Import and get an Update when it changes. No server:
 * the file is the whole link between them.
 */

type Run = (label: string, fn: () => Promise<unknown>) => Promise<void>;

const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

function CopyText({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="shared__where">
      <code className="shared__path" title={text}>
        {text}
      </code>
      <Button
        size="sm"
        variant="ghost"
        icon={<Copy size={14} aria-hidden="true" />}
        aria-label={label}
        onClick={() =>
          void navigator.clipboard.writeText(text).then(
            () => setCopied(true),
            () => setCopied(false)
          )
        }
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

type CardProps = {
  instance: Instance;
  style: CSSProperties;
  busy: string | null;
  run: Run;
  onNotice: (text: string) => void;
};

/* The "Share live" card on the instance's Settings tab. */
export function SharedInstanceCard({ instance, style, busy, run, onNotice }: CardProps) {
  const shared = instance.shared;
  const name = instance.name;

  const publish = (choose = false) =>
    run("shared", async () => {
      const done = await window.instanceAPI.sharedPublish(name, { choose });
      if (!done) return;
      onNotice(
        `Published version ${done.revision} of the shared instance.` +
          (done.missing.length ? ` Not on Modrinth or CurseForge, so friends need these from you: ${done.missing.join(", ")}.` : "")
      );
    });

  const title = <p style={{ color: "var(--color-accent-text)", marginBottom: 6 }}>Share live</p>;
  const muted: CSSProperties = { color: "var(--color-text-muted)", fontSize: 13, marginBottom: 10 };

  if (!shared) {
    return (
      <div style={style} data-testid="instance-shared">
        {title}
        <p style={muted}>
          Keeps friends' copies in step with yours. This saves a small file, best in a folder that syncs (Dropbox, iCloud Drive,
          OneDrive), and they join it under Import. Each time you publish changes, they get an Update button. Only mods, resource
          packs and shaders from Modrinth and CurseForge are shared, and nothing is uploaded anywhere else.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button data-testid="shared-publish" disabled={busy === "shared"} onClick={() => publish(true)}>
            {busy === "shared" ? "Publishing..." : "Share live..."}
          </Button>
        </div>
      </div>
    );
  }

  if (shared.role === "owner") {
    return (
      <div style={style} data-testid="instance-shared">
        {title}
        <p style={muted}>
          You share this instance: version {shared.revision}, published {when(shared.updated)}. Publish again after changing its
          mods so friends get them. Send them the file's path (if they share the synced folder) or a link to it.
        </p>
        <CopyText text={shared.path} label="Copy the shared file's path" />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
          <Button variant="ghost" disabled={busy === "shared"} onClick={() => run("shared", () => window.instanceAPI.sharedLeave(name))}>
            Stop sharing
          </Button>
          <Button disabled={busy === "shared"} onClick={() => publish(true)}>
            Move file...
          </Button>
          <Button variant="primary" data-testid="shared-publish" disabled={busy === "shared"} onClick={() => publish(false)}>
            {busy === "shared" ? "Publishing..." : "Publish changes"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={style} data-testid="instance-shared">
      {title}
      <p style={muted}>
        This instance follows a shared one (version {shared.revision}). Updates come in on the Content tab. Mods you add yourself
        stay when it updates; mods the owner removes are removed.
      </p>
      <CopyText text={shared.source} label="Copy where the shared file is" />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
        <Button
          variant="ghost"
          disabled={busy === "shared"}
          onClick={() =>
            run("shared", async () => {
              await window.instanceAPI.sharedLeave(name);
              onNotice("Stopped following. The instance stays as it is.");
            })
          }
        >
          Stop following
        </Button>
      </div>
    </div>
  );
}

type NoticeProps = {
  instance: Instance;
  busy: string | null;
  run: Run;
  onNotice: (text: string) => void;
};

/* On the Content tab of an instance that follows a shared one: the Update when there are changes. */
export function SharedUpdateNotice({ instance, busy, run, onNotice }: NoticeProps) {
  const shared = instance.shared?.role === "member" ? instance.shared : null;
  const name = instance.name;
  const revision = shared?.revision ?? 0;
  const [check, setCheck] = useState<{ for: string; result: SharedCheck | null; error: string | null } | null>(null);
  const key = `${name}#${revision}`;

  useEffect(() => {
    if (!revision) return;
    let live = true;
    window.instanceAPI.sharedCheck(name).then(
      (result) => live && setCheck({ for: `${name}#${revision}`, result, error: null }),
      (err: unknown) => live && setCheck({ for: `${name}#${revision}`, result: null, error: err instanceof Error ? err.message : String(err) })
    );
    return () => {
      live = false;
    };
  }, [name, revision]);

  if (!shared || check?.for !== key) return null;
  if (check.error) {
    return (
      <Notice tone="warning" style={{ marginBottom: 12 }} data-testid="shared-update">
        Couldn't check the shared instance for changes: {check.error}
      </Notice>
    );
  }
  const result = check.result;
  if (result?.role !== "member" || !result.available) return null;
  if (result.moved) {
    return (
      <Notice tone="warning" style={{ marginBottom: 12 }} data-testid="shared-update">
        The shared instance moved to {result.moved}. Join it again under Import to get it as a new instance.
      </Notice>
    );
  }
  return (
    <Notice
      tone="info"
      style={{ marginBottom: 12 }}
      data-testid="shared-update"
      actions={
        <Button
          size="sm"
          variant="primary"
          disabled={busy === "shared-update"}
          onClick={() =>
            run("shared-update", async () => {
              const done = await window.instanceAPI.sharedUpdate(name);
              const parts = [
                done.installed && `${done.installed} added`,
                done.removed && `${done.removed} removed`,
                done.failed.length && `${done.failed.length} couldn't be downloaded (${done.failed.map((f) => f.name).join(", ")})`,
                done.blocked.length && `${done.blocked.length} must be downloaded from CurseForge by hand (${done.blocked.map((f) => f.name).join(", ")})`,
              ].filter(Boolean);
              onNotice(`Updated to version ${done.revision}${parts.length ? `: ${parts.join(", ")}` : ""}.`);
            })
          }
        >
          {busy === "shared-update" ? "Updating..." : "Update"}
        </Button>
      }
    >
      The shared instance has changed: version {result.latest}, published {when(result.updated)}. You have version {result.revision}.
    </Notice>
  );
}

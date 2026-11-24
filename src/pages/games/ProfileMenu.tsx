import { ChevronDown, Copy, Layers, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { Button, Menu, type MenuItem } from "../../components/ui";
import type { GameProfilesApi, ProfileForm } from "./useGameProfiles";

type MenuProps = {
  api: GameProfilesApi;
  onForm: (form: ProfileForm) => void;
};

/*
 * The header's profile picker: each profile (picking one switches the game's mods over),
 * then making, copying, renaming and deleting them.
 */
export default function ProfileMenu({ api, onForm }: MenuProps) {
  const { profiles, active, busy } = api;
  const items: MenuItem[] = profiles.length
    ? [
        ...profiles.map((profile) => {
          const chosen = profile.id === active?.id;
          // A switch cut short: picking the chosen profile again puts its saves back.
          const unfinished = chosen && api.saves.on && api.saves.pending;
          return {
            label: `${chosen ? "✓ " : ""}${profile.name} (${profile.keys.length})${unfinished ? ": put its saves back" : ""}`,
            disabled: Boolean(busy),
            onSelect: () => {
              if (!chosen || unfinished) void api.switchTo(profile.id);
            },
          };
        }),
        "separator" as const,
        { label: "New empty profile...", icon: <Plus size={14} aria-hidden="true" />, onSelect: () => onForm({ kind: "new", name: "" }) },
        { label: `Copy ${active?.name ?? "this profile"}...`, icon: <Copy size={14} aria-hidden="true" />, onSelect: () => onForm({ kind: "copy", name: `${active?.name ?? "Profile"} copy` }) },
        { label: `Rename ${active?.name ?? "this profile"}...`, icon: <Pencil size={14} aria-hidden="true" />, onSelect: () => onForm({ kind: "rename", name: active?.name ?? "" }) },
        {
          label: `${api.saves.on ? "✓ " : ""}Separate saves for each profile`,
          icon: <Save size={14} aria-hidden="true" />,
          disabled: Boolean(busy),
          onSelect: () => void api.setSaves(!api.saves.on),
        },
        ...(profiles.length > 1
          ? profiles
              .filter((profile) => profile.id !== active?.id)
              .map((profile) => ({ label: `Delete ${profile.name}...`, icon: <Trash2 size={14} aria-hidden="true" />, danger: true, onSelect: () => onForm({ kind: "delete", id: profile.id }) }))
          : [{ label: "Stop using profiles...", icon: <Trash2 size={14} aria-hidden="true" />, danger: true, onSelect: () => onForm({ kind: "delete", id: profiles[0].id }) }]),
      ]
    : [
        { label: "New empty profile...", icon: <Plus size={14} aria-hidden="true" />, onSelect: () => onForm({ kind: "new", name: "" }) },
        { label: "Copy these mods to a profile...", icon: <Copy size={14} aria-hidden="true" />, onSelect: () => onForm({ kind: "copy", name: "" }) },
      ];

  return (
    <Menu
      align="start"
      label={active ? `Mod profile: ${active.name}. Switch or manage profiles` : "Mod profiles"}
      triggerClassName={`ui-button ui-button--secondary ui-button--sm gm-profile${active ? "" : " gm-profile--none"}`}
      trigger={
        <>
          <Layers size={14} aria-hidden="true" />
          <span className="gm-profile__name">{busy === "switch" ? "Switching..." : (active?.name ?? "Profiles")}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </>
      }
      items={items}
    />
  );
}

type BarProps = {
  api: GameProfilesApi;
  form: ProfileForm;
  setForm: (form: ProfileForm | null) => void;
};

/* Under the header while a profile is named, or its deletion confirmed. */
export function ProfileBar({ api, form, setForm }: BarProps) {
  const { profiles, active, busy } = api;
  const first = profiles.length === 0;

  if (form.kind === "delete") {
    const gone = profiles.find((profile) => profile.id === form.id);
    if (!gone) return null;
    const last = profiles.length === 1;
    return (
      <div className="gm-setbar" data-testid="profile-bar">
        <span className="gm-muted">
          {last
            ? "Stop using profiles? Your mods stay installed, on and off as they are now."
            : `Delete ${gone.name}? Mods only it has move to ${active?.name ?? "the chosen profile"}, turned off. Nothing is uninstalled.${api.saves.on ? " Its saves are kept as a save backup." : ""}`}
        </span>
        <Button
          size="sm"
          variant="danger"
          disabled={Boolean(busy)}
          onClick={async () => {
            if (await api.remove(gone.id)) setForm(null);
          }}
        >
          {last ? "Stop using profiles" : "Delete profile"}
        </Button>
        <Button size="sm" onClick={() => setForm(null)}>
          Cancel
        </Button>
      </div>
    );
  }

  // Each profile's saves are its own, so a save isn't loaded with mods it wasn't made with.
  const saves = !api.saves.on
    ? ""
    : form.kind === "new"
      ? ` Its saves start empty${first ? "; yours stay with Default" : ""}.`
      : ` It gets a copy of the saves too.`;
  const cloud = api.saves.on ? " If the game syncs saves with Steam Cloud, turn that off for it, or it can bring another profile's saves back." : "";
  const hint =
    form.kind === "rename"
      ? null
      : (form.kind === "new"
          ? first
            ? "Your mods now become the Default profile. The new one starts with none: the game gets no mods until you add some to it."
            : "Starts with no mods. Mods you add while it's chosen go in it."
          : first
            ? "Your mods now become the Default profile, and the new one starts as a copy you can change."
            : `Starts with ${active?.name ?? "this profile"}'s mods, on and off the same.`) +
        saves +
        (first ? cloud : "");

  return (
    <div className="gm-setbar" data-testid="profile-bar">
      <form
        className="gm-setbar__form"
        onSubmit={async (event) => {
          event.preventDefault();
          const name = form.name.trim();
          if (!name) return;
          const done = form.kind === "rename" ? active && (await api.rename(active.id, name)) : await api.create(name, form.kind === "copy");
          if (done) setForm(null);
        }}
      >
        <input
          autoFocus
          className="ui-input"
          data-testid="profile-name"
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder={form.kind === "rename" ? "New name..." : "Name the profile..."}
          aria-label={form.kind === "rename" ? "New name for the profile" : "Name for the new profile"}
          maxLength={40}
        />
        <Button type="submit" size="sm" variant="primary" disabled={Boolean(busy)} data-testid="profile-save">
          {form.kind === "rename" ? "Rename" : busy ? "Making..." : "Make and switch"}
        </Button>
        <Button size="sm" onClick={() => setForm(null)}>
          Cancel
        </Button>
      </form>
      {hint && <span className="gm-muted">{hint}</span>}
    </div>
  );
}

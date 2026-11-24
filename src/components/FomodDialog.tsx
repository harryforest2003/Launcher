import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Modal } from "./ui";
import "./fomodDialog.css";

/*
 * Which options of a mod's FOMOD installer to install, asked while a game mod installs:
 * a page per step, a group of choices on each, with the option's picture and description
 * beside them. Steps that only apply to other choices are skipped, as the installer does.
 */

type Picks = Record<string, string[]>;

const keyOf = (step: number, group: number) => `${step}:${group}`;

function test(cond: FomodCond | null, flags: Map<string, string>): boolean {
  if (!cond) return true;
  if ("bool" in cond) return cond.bool;
  if ("flag" in cond) return (flags.get(cond.flag) ?? "") === cond.value;
  if (!cond.items.length) return true;
  const results = cond.items.map((item) => test(item, flags));
  return cond.op === "Or" ? results.some(Boolean) : results.every(Boolean);
}

const typeNow = (option: FomodOption, flags: Map<string, string>) => option.typePatterns.find((pattern) => test(pattern.when, flags))?.type ?? option.type;

// What the installer picks with nothing chosen: its Required and Recommended options.
function recommended(type: string, usable: FomodOption[], types: Map<string, string>) {
  const marked = usable.filter((option) => /^(Required|Recommended)$/.test(types.get(option.name) ?? ""));
  if (type === "SelectAll") return usable;
  if (type === "SelectExactlyOne") return [marked[0] ?? usable[0]].filter(Boolean);
  if (type === "SelectAtLeastOne") return marked.length ? marked : usable.slice(0, 1);
  if (type === "SelectAtMostOne") return marked.slice(0, 1);
  return marked;
}

type Walked = { visible: boolean; groups: { types: Map<string, string>; chosen: string[] }[] }[];

/* Goes through the steps in order, as the installer will, so flags from earlier picks decide what shows. */
function walk(info: FomodInfo, picks: Picks, preset: FomodChoice[] | null): Walked {
  const flags = new Map<string, string>();
  return info.steps.map((step, si) => {
    const visible = test(step.visible, flags);
    const groups = step.groups.map((group, gi) => {
      const types = new Map(group.options.map((option) => [option.name, typeNow(option, flags)]));
      const usable = group.options.filter((option) => types.get(option.name) !== "NotUsable");
      const wanted = picks[keyOf(si, gi)] ?? preset?.find((c) => c.step === step.name && c.group === group.name)?.options;
      let chosen: FomodOption[];
      if (group.type === "SelectAll" || !wanted) chosen = recommended(group.type, usable, types);
      else {
        const names = new Set(wanted);
        chosen = usable.filter((option) => names.has(option.name) || types.get(option.name) === "Required");
        if (/^(SelectExactlyOne|SelectAtMostOne)$/.test(group.type)) chosen = chosen.slice(0, 1);
        if (!chosen.length && group.type === "SelectExactlyOne") chosen = recommended(group.type, usable, types);
      }
      if (visible) for (const option of chosen) for (const [flag, value] of Object.entries(option.flags)) flags.set(flag, value);
      return { types, chosen: chosen.map((option) => option.name) };
    });
    return { visible, groups };
  });
}

const RULES: Record<string, string> = {
  SelectExactlyOne: "Pick one",
  SelectAtMostOne: "Pick one or none",
  SelectAtLeastOne: "Pick at least one",
  SelectAny: "Pick any",
  SelectAll: "All are installed",
};

const TYPE_BADGES: Record<string, string> = { Required: "Required", Recommended: "Recommended", NotUsable: "Not usable", CouldBeUsable: "Might not work" };

function Chooser({ request, onAnswer }: { request: FomodRequest; onAnswer: (choices: FomodChoice[] | null) => void }) {
  const { info, preset } = request;
  const [picks, setPicks] = useState<Picks>({});
  const [at, setAt] = useState(() => Math.max(0, info.steps.findIndex((step) => step.groups.length)));
  const [focus, setFocus] = useState<{ group: number; option: number } | null>(null);
  const walked = useMemo(() => walk(info, picks, preset), [info, picks, preset]);

  // The steps to show: visible ones that ask something.
  const shown = info.steps.map((_, i) => i).filter((i) => walked[i].visible && info.steps[i].groups.length);
  const current = shown.includes(at) ? at : (shown.find((i) => i > at) ?? shown[shown.length - 1] ?? 0);
  const place = shown.indexOf(current);
  const step = info.steps[current];
  const stepState = walked[current];
  const last = place === shown.length - 1;

  const missing = step.groups.findIndex((group, gi) => {
    const count = stepState.groups[gi].chosen.length;
    const usable = group.options.some((option) => stepState.groups[gi].types.get(option.name) !== "NotUsable");
    return usable && count === 0 && /^(SelectExactlyOne|SelectAtLeastOne)$/.test(group.type);
  });

  const toggle = (gi: number, option: FomodOption, on: boolean) => {
    const group = step.groups[gi];
    const now = stepState.groups[gi].chosen;
    const single = /^(SelectExactlyOne|SelectAtMostOne)$/.test(group.type);
    const next = single ? (on ? [option.name] : []) : on ? [...now, option.name] : now.filter((name) => name !== option.name);
    setPicks((old) => ({ ...old, [keyOf(current, gi)]: next }));
  };

  const finish = () => {
    const choices: FomodChoice[] = [];
    info.steps.forEach((s, si) => {
      if (!walked[si].visible) return;
      s.groups.forEach((group, gi) => choices.push({ step: s.name, group: group.name, options: walked[si].groups[gi].chosen }));
    });
    onAnswer(choices);
  };

  const go = (to: number) => {
    setAt(to);
    setFocus(null);
  };

  // The option described on the right: the one pointed at, else the first picked here.
  const firstPicked = (() => {
    for (const [gi, group] of step.groups.entries()) {
      const oi = group.options.findIndex((option) => stepState.groups[gi].chosen.includes(option.name));
      if (oi >= 0) return { group: gi, option: oi };
    }
    return null;
  })();
  const described = focus ?? firstPicked;
  const about = described ? step.groups[described.group]?.options[described.option] : null;
  const picture = about?.image ?? info.image;

  return (
    <Modal
      open
      size="lg"
      onClose={() => onAnswer(null)}
      title={info.name || request.modName}
      lead={shown.length > 1 ? `${step.name} — step ${place + 1} of ${shown.length}` : step.name}
      footer={
        <>
          <Button variant="ghost" onClick={() => onAnswer(null)}>
            Cancel install
          </Button>
          <span className="fomod__spacer" />
          {place > 0 && <Button onClick={() => go(shown[place - 1])}>Back</Button>}
          {last ? (
            <Button variant="primary" disabled={missing >= 0} onClick={finish}>
              Install
            </Button>
          ) : (
            <Button variant="primary" disabled={missing >= 0} onClick={() => go(shown[place + 1])}>
              Next
            </Button>
          )}
        </>
      }
    >
      <div className="fomod" data-testid="fomod-dialog">
        <div className="fomod__groups">
          {step.groups.map((group, gi) => {
            const single = /^(SelectExactlyOne|SelectAtMostOne)$/.test(group.type);
            const chosen = stepState.groups[gi].chosen;
            return (
              <fieldset key={`${group.name}-${gi}`} className="fomod__group">
                <legend>
                  <span className="fomod__group-name">{group.name}</span>
                  <span className="fomod__rule">{RULES[group.type] ?? "Pick any"}</span>
                </legend>
                {group.options.map((option, oi) => {
                  const type = stepState.groups[gi].types.get(option.name) ?? "Optional";
                  const locked = type === "NotUsable" || type === "Required" || group.type === "SelectAll";
                  const checked = chosen.includes(option.name);
                  const badge = TYPE_BADGES[type];
                  return (
                    <label
                      key={`${option.name}-${oi}`}
                      className={`fomod__option${checked ? " is-on" : ""}${type === "NotUsable" ? " is-off" : ""}`}
                      onMouseEnter={() => setFocus({ group: gi, option: oi })}
                      onFocus={() => setFocus({ group: gi, option: oi })}
                    >
                      <input
                        type={single ? "radio" : "checkbox"}
                        name={`fomod-${current}-${gi}`}
                        checked={checked}
                        disabled={locked}
                        onChange={(event) => toggle(gi, option, event.target.checked)}
                        onClick={(event) => {
                          // A second click on the picked option clears a pick-one-or-none group.
                          if (group.type === "SelectAtMostOne" && checked) {
                            event.preventDefault();
                            toggle(gi, option, false);
                          }
                        }}
                      />
                      <span className="fomod__option-name">{option.name}</span>
                      {badge && <Badge className="fomod__badge">{badge}</Badge>}
                    </label>
                  );
                })}
              </fieldset>
            );
          })}
          {missing >= 0 && <p className="fomod__missing">Pick an option in {step.groups[missing].name}.</p>}
        </div>
        <aside className="fomod__about" aria-live="polite">
          {picture && <img className="fomod__image" src={picture} alt="" />}
          {about ? (
            <>
              <h3 className="fomod__about-name">{about.name}</h3>
              <p className="fomod__description">{about.description || "No description."}</p>
            </>
          ) : (
            <p className="fomod__description">Point at an option to see what it does.</p>
          )}
        </aside>
      </div>
    </Modal>
  );
}

/* Shows each FOMOD question the main process sends, one at a time. */
export default function FomodDialog() {
  const [queue, setQueue] = useState<FomodRequest[]>([]);

  useEffect(() => window.gamesAPI?.onFomod?.((request) => setQueue((old) => [...old, request])), []);

  const request = queue[0];
  if (!request) return null;
  return (
    <Chooser
      key={request.id}
      request={request}
      onAnswer={(choices) => {
        window.gamesAPI.answerFomod(request.id, choices).catch(() => {});
        setQueue((old) => old.filter((item) => item.id !== request.id));
      }}
    />
  );
}

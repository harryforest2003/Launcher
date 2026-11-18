import type { KeyboardEvent, ReactNode } from "react";
import "./discover.css";

type Props = {
  name: string;
  author?: string;
  summary: string;
  /** The picture, or a monogram when there is none. */
  art: ReactNode;
  /** The compact line under the description: downloads, updated, chips. */
  meta: ReactNode;
  /** The row's one primary action. */
  action: ReactNode;
  testId: string;
  onOpen: () => void;
};

/*
 * One result row, shared by Minecraft's Discover Content and a game's Discover Mods so both read as
 * one product. Clicking anywhere but the action opens the project's page.
 */
export default function DiscoverRow({ name, author, summary, art, meta, action, testId, onOpen }: Props) {
  const key = (event: KeyboardEvent) => {
    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onOpen();
    }
  };
  return (
    <div className="dc-row" data-testid={testId} role="button" tabIndex={0} aria-label={`Open ${name}`} onClick={onOpen} onKeyDown={key}>
      <div className="dc-art">{art}</div>
      <div className="dc-main">
        <div className="dc-title">
          <span className="dc-name">{name}</span>
          {author && <span className="dc-by">by {author}</span>}
        </div>
        <p className="dc-summary">{summary}</p>
        <div className="dc-meta">{meta}</div>
      </div>
      <div className="dc-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        {action}
      </div>
    </div>
  );
}

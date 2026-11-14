import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import "./ui.css";

type Props = {
  open: boolean;
  /** Escape, the × and a click outside all call this. */
  onClose: () => void;
  title: ReactNode;
  /** A sentence under the title. */
  lead?: ReactNode;
  /** The buttons along the bottom (main action last). */
  footer?: ReactNode;
  /** sm 420px, md 560px (default), lg 760px. */
  size?: "sm" | "md" | "lg";
  children?: ReactNode;
};

/*
 * A dialog over the app, on the browser's own <dialog>: focus moves in and stays in, Escape
 * closes it, and focus goes back where it was afterwards.
 */
export default function Modal({ open, onClose, title, lead, footer, size = "md", children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`ui-modal ui-modal--${size}`}
      aria-labelledby="ui-modal-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the <dialog> itself.
        if (event.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="ui-modal__box">
          <div className="ui-modal__head">
            <div>
              <h2 id="ui-modal-title" className="ui-modal__title">
                {title}
              </h2>
              {lead && <p className="ui-modal__lead">{lead}</p>}
            </div>
            <button type="button" className="ui-modal__close" aria-label="Close" onClick={onClose}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          {children && <div className="ui-modal__body">{children}</div>}
          {footer && <div className="ui-modal__foot">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

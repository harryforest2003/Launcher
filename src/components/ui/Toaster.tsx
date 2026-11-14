import { useEffect, useRef, useSyncExternalStore } from "react";
import { CircleCheck, CircleX, Info, TriangleAlert, X } from "lucide-react";
import { dismissToast, getToasts, subscribeToasts, type Toast } from "./toastStore";
import "./ui.css";

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleX };

/* The corner where toasts show. Mounted once, by App. */
export default function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts);
  return (
    <div className="ui-toaster" aria-live="polite">
      {toasts.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  );
}

function ToastCard({ item }: { item: Toast }) {
  const Icon = ICONS[item.tone];
  const left = useRef(item.duration ?? (item.tone === "danger" ? 8000 : 5000));
  const started = useRef(0);
  const timer = useRef(0);

  // Goes by itself after a while; the clock stops while the pointer is over it.
  const start = () => {
    if (!left.current) return;
    started.current = Date.now();
    timer.current = window.setTimeout(() => dismissToast(item.id), left.current);
  };
  const pause = () => {
    window.clearTimeout(timer.current);
    if (left.current) left.current = Math.max(800, left.current - (Date.now() - started.current));
  };
  useEffect(() => {
    start();
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when it appears
  }, []);

  return (
    <div
      className={`ui-toast ui-toast--${item.tone}`}
      role={item.tone === "danger" ? "alert" : "status"}
      onPointerEnter={pause}
      onPointerLeave={start}
    >
      <Icon className="ui-toast__icon" size={18} aria-hidden="true" />
      <div className="ui-toast__text">
        <div className="ui-toast__title">{item.title}</div>
        {item.body && <div className="ui-toast__body">{item.body}</div>}
      </div>
      {item.action && (
        <button
          type="button"
          className="ui-toast__action"
          onClick={() => {
            item.action?.run();
            dismissToast(item.id);
          }}
        >
          {item.action.label}
        </button>
      )}
      <button type="button" className="ui-toast__close" aria-label="Close" onClick={() => dismissToast(item.id)}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

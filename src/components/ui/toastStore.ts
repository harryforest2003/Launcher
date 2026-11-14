/*
 * Toasts: short notices that come and go in the corner ("Instance created", "Couldn't reach
 * Modrinth"). Call toast() from anywhere; <Toaster /> (mounted once by App) shows them.
 */
export type ToastTone = "info" | "success" | "warning" | "danger";

export type ToastInput = {
  tone?: ToastTone;
  title: string;
  body?: string;
  /** One button, e.g. Undo. Pressing it also closes the toast. */
  action?: { label: string; run: () => void };
  /** ms before it goes by itself (default 5000, problems 8000); 0 keeps it until closed. */
  duration?: number;
};

export type Toast = ToastInput & { id: number; tone: ToastTone };

let toasts: Toast[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function toast(input: ToastInput): number {
  const id = next++;
  toasts = [...toasts.slice(-3), { tone: "info", ...input, id }];
  emit();
  return id;
}

export function dismissToast(id: number) {
  toasts = toasts.filter((item) => item.id !== id);
  emit();
}

export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getToasts = () => toasts;

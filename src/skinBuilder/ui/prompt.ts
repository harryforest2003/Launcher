import { useCallback, useState } from "react";

export type PromptRequest = {
  title: string;
  initial: string;
  settle: (value: string | null) => void;
};

/**
 * Asks for a short piece of text through <PromptDialog>. window.prompt cannot be
 * used for this, because Electron does not implement it.
 */
export function usePrompt() {
  const [request, setRequest] = useState<PromptRequest | null>(null);

  const ask = useCallback(
    (title: string, initial = "") =>
      new Promise<string | null>((resolve) => {
        setRequest({
          title,
          initial,
          settle: (value) => {
            setRequest(null);
            resolve(value?.trim() || null);
          },
        });
      }),
    []
  );

  return { request, ask };
}

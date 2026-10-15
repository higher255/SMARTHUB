import { useEffect, useRef } from "react";

/**
 * Keeps a page in sync with the server: runs `load` on mount, whenever the tab regains focus,
 * and every `everyMs` while the tab is visible. Pages that use it never need a manual refresh.
 */
export function useLive(load: () => void | Promise<unknown>, everyMs = 20000) {
  const ref = useRef(load);
  ref.current = load;
  useEffect(() => {
    const run = () => {
      if (document.visibilityState === "visible") void ref.current();
    };
    void ref.current();
    const timer = window.setInterval(run, everyMs);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", run);
    };
  }, [everyMs]);
}

export function errorMessage(error: unknown, fallback = "Something went wrong"): string {
  const message = error instanceof Error && error.message ? error.message : typeof error === "string" && error ? error : fallback;
  if (message.includes("Check in from My work before starting work.") && typeof window !== "undefined") {
    window.alert(message);
  }
  return message;
}

// Live-preview bearer tokens are kept in sessionStorage because the embedded
// preview iframe cannot read the popup's partitioned session cookie.
const BEARER_KEY = "smarthub-auth.bearer-token";

/** The stored preview bearer token, or null. Safe to import on the server. */
export function getBearerToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(BEARER_KEY);
  } catch {
    return null;
  }
}

export function setBearerToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.sessionStorage.setItem(BEARER_KEY, token);
    else window.sessionStorage.removeItem(BEARER_KEY);
  } catch {
    // Storage may be unavailable in restricted browser contexts.
  }
}

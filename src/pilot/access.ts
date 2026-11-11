// Participant access key from the invitation link (`?key=...`). It is kept for this tab
// only and removed from the address bar so it is not shown during screen sharing.
export const ACCESS_HEADER = "X-Pilot-Access";
export const ACCESS_LINK_ERROR =
  "This access link is missing or invalid. Please open the link provided by the researcher.";
const STORAGE_KEY = "comparethink-access-key";
let current: string | undefined;

type AccessWindow = Pick<Window, "location" | "history" | "sessionStorage">;

export function captureAccessKey(win: AccessWindow = window) {
  const url = new URL(win.location.href);
  const fromLink = url.searchParams.get("key")?.trim();
  if (fromLink) {
    current = fromLink;
    try {
      win.sessionStorage.setItem(STORAGE_KEY, fromLink);
    } catch {
      // Without tab storage a reload would lose the key, so leave it in the URL.
      return current;
    }
    url.searchParams.delete("key");
    win.history.replaceState(win.history.state, "", url);
    return current;
  }
  try {
    current = win.sessionStorage.getItem(STORAGE_KEY) || undefined;
  } catch {
    current = undefined;
  }
  return current;
}

/** fetch for the app's own /api routes, adding the access key when one was provided. */
export function apiFetch(input: string, init: RequestInit = {}) {
  if (!current) return fetch(input, init);
  const headers = new Headers(init.headers);
  headers.set(ACCESS_HEADER, current);
  return fetch(input, { ...init, headers });
}

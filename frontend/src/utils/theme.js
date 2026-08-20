// Colour-scheme control.
//
// theme.css and tokens.css both define a complete dark palette under
// :root[data-theme="dark"], but nothing ever set that attribute — the dark
// tokens were unreachable. This owns the attribute and the preference.
//
// Two states the visitor can choose from, and one they never have to:
//   "light" / "dark" — an explicit, stored choice, honoured everywhere
//   null             — nothing chosen yet, so follow the OS and keep
//                      following it as it changes
//
// There is deliberately no "system" button. Following the OS is the default,
// not a third thing to pick: on a first visit the app already matches the
// platform, and the toggle simply shows which scheme is currently rendering.
// Clicking it pins that choice; from then on the platform no longer overrides
// it, because a visitor who asked for light at dusk meant it.

const KEY = "kla.theme";
export const THEMES = ["light", "dark"];

const media = () =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

// The stored choice, or null when the visitor has not pinned one — which is
// the signal to follow the OS.
export function readTheme() {
  try {
    const stored = window.localStorage.getItem(KEY);
    return THEMES.includes(stored) ? stored : null;
  } catch {
    // Private mode / storage disabled — fall back to following the OS.
    return null;
  }
}

// The scheme actually rendered for a given choice. A null (or stale "system")
// choice resolves against the platform.
export function resolveTheme(choice) {
  if (choice === "light" || choice === "dark") return choice;
  return media()?.matches ? "dark" : "light";
}

// Write the resolved scheme to <html>. Both stylesheets key off the attribute,
// and `color-scheme` tells the browser to render native widgets (scrollbars,
// form controls, the Leaflet attribution) to match.
export function applyTheme(choice) {
  const resolved = resolveTheme(choice);
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved;
  return resolved;
}

export function storeTheme(choice) {
  try {
    window.localStorage.setItem(KEY, choice);
  } catch {
    // Preference is best-effort; the session still renders correctly.
  }
}

// Re-apply when the OS flips. Only subscribed to while no explicit choice is
// stored — an explicit light/dark must not be overridden by the platform.
export function watchSystemTheme(onChange) {
  const mq = media();
  if (!mq) return () => {};
  const handler = () => onChange();
  // Safari < 14 only has the deprecated listener API.
  if (mq.addEventListener) mq.addEventListener("change", handler);
  else mq.addListener(handler);
  return () => {
    if (mq.removeEventListener) mq.removeEventListener("change", handler);
    else mq.removeListener(handler);
  };
}

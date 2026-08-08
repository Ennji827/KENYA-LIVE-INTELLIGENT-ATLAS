import React, { useEffect, useState } from "react";
import {
  applyTheme,
  readTheme,
  resolveTheme,
  storeTheme,
  watchSystemTheme,
} from "../utils/theme";

const SunIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

const MoonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
);

const OPTIONS = [
  { id: "light", label: "Light", Icon: SunIcon },
  { id: "dark", label: "Dark", Icon: MoonIcon },
];

// Light / dark control.
//
// Two buttons, no "system" option: following the platform is the default rather
// than a third thing to choose. Until the visitor picks a side, `choice` is null
// and the OS decides — including when it changes mid-session. What the rail
// highlights is therefore the scheme *currently rendering*, not the stored
// preference, so on a dark-mode machine the moon is lit on the first visit
// without anyone having touched it.
export default function ThemeToggle({ compact = false }) {
  const [choice, setChoice] = useState(readTheme); // "light" | "dark" | null
  const [resolved, setResolved] = useState(() => resolveTheme(readTheme()));

  useEffect(() => {
    setResolved(applyTheme(choice));
    // Once pinned, stop listening: the platform must not override an explicit
    // choice.
    if (choice) return undefined;
    return watchSystemTheme(() => setResolved(applyTheme(null)));
  }, [choice]);

  const pick = (id) => {
    storeTheme(id);
    setChoice(id);
  };

  return (
    <div
      className={`theme-toggle${compact ? " theme-toggle--compact" : ""}`}
      role="radiogroup"
      aria-label="Colour scheme"
    >
      {OPTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={resolved === id}
          className={`theme-toggle__btn${resolved === id ? " is-active" : ""}`}
          onClick={() => pick(id)}
          title={`${label} theme`}
        >
          <Icon />
          <span className="u-sr">{label} theme</span>
        </button>
      ))}
    </div>
  );
}

import React from "react";

// AEIS-K brand mark (matches the landing footer/logo).
const BrandLogo = (props) => (
  <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true" {...props}>
    <rect width="32" height="32" fill="#0f4c81" />
    <path d="M8 22 L16 10 L24 22" stroke="#4ade80" strokeWidth="2.5" strokeLinejoin="round" fill="none" />
    <circle cx="16" cy="10" r="2" fill="#4ade80" />
  </svg>
);

// Shared, branded top bar. Used on the landing "home" page and across the
// signed-in app (hub · area select · workspace) so every screen carries the
// same gradient-glass identity. Actions adapt to whether a user is signed in.
export default function SiteHeader({
  user,
  onHome,
  onEnterHub,
  onSignIn,
  onSignUp,
  onSignOut,
  active, // "home" | "hub" | undefined — marks / hides the current section
}) {
  const displayName =
    user && (user.first_name || user.full_name || user.name || user.email)
      ? user.first_name || user.full_name || user.name || user.email
      : null;

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <button
          type="button"
          className="site-header__brand"
          onClick={onHome}
          aria-label="AEIS-K home"
        >
          <BrandLogo />
          <span className="site-header__name">AEIS-K</span>
        </button>

        <div className="site-header__actions">
          {user ? (
            <>
              {onHome && active !== "home" && (
                <button type="button" className="site-header__link" onClick={onHome}>
                  Home
                </button>
              )}
              {onEnterHub && (
                <button
                  type="button"
                  className={`site-header__link${active === "hub" ? " is-active" : ""}`}
                  onClick={onEnterHub}
                >
                  Topics
                </button>
              )}
              {displayName && (
                <span className="site-header__user" title={displayName}>
                  {displayName}
                </span>
              )}
              {onSignOut && (
                <button type="button" className="site-header__btn ghost" onClick={onSignOut}>
                  Sign out
                </button>
              )}
            </>
          ) : (
            <>
              {onSignIn && (
                <button type="button" className="site-header__btn ghost" onClick={onSignIn}>
                  Sign In
                </button>
              )}
              {onSignUp && (
                <button type="button" className="site-header__btn solid" onClick={onSignUp}>
                  Sign Up
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}

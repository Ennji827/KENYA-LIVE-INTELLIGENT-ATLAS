import React, { useEffect, useRef, useState } from "react";
import ThemeToggle from "./ThemeToggle";

// Kenya Live Atlas mark. The abbreviation tile plus a two-line lockup: the
// full name reads as the product, the descriptor underneath says what it is.
// The descriptor is dropped on narrow screens where only the name fits.
const BrandLogo = () => (
  <>
    <span className="site-header__mark" aria-hidden="true">
      KLA
    </span>
    <span className="site-header__lockup">
      <span className="site-header__name">Kenya Live Atlas</span>
      <span className="site-header__tagline">Geospatial Intelligence</span>
    </span>
  </>
);

const MenuIcon = ({ open }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
    {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
  </svg>
);

// Shared, branded top bar. Used on the landing "home" page and across the
// signed-in app (workspace · insights · reports) so every screen carries the
// same identity. Actions adapt to whether a user is signed in. There is no
// separate topics link: home is the topic picker.
//
// Below the tablet breakpoint the actions collapse behind a menu button and
// open as a full-width sheet under the bar — the previous version wrapped them
// onto a second row, which pushed the map off the fold on a phone.
export default function SiteHeader({
  user,
  onHome,
  onReports,
  onSignIn,
  onSignUp,
  onSignOut,
  active, // "home" | "reports" | undefined — marks / hides the current section
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef(null);

  const displayName =
    user && (user.first_name || user.full_name || user.name || user.email)
      ? user.first_name || user.full_name || user.name || user.email
      : null;
  const role = user?.role;

  // Escape closes the sheet, and so does a click anywhere outside it — a menu
  // that can only be dismissed by its own button strands anyone who opens it
  // by accident.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => e.key === "Escape" && setMenuOpen(false);
    const onDown = (e) => {
      if (!headerRef.current?.contains(e.target)) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [menuOpen]);

  // Every action also navigates, so the sheet must close with it or it stays
  // open over the page it just moved to.
  const run = (fn) => () => {
    setMenuOpen(false);
    fn?.();
  };

  const navLinks = user ? (
    <>
      {onHome && (
        <button
          type="button"
          className={`site-header__link${active === "home" ? " is-active" : ""}`}
          onClick={run(onHome)}
        >
          Home
        </button>
      )}
      {onReports && (
        <button
          type="button"
          className={`site-header__link${active === "reports" ? " is-active" : ""}`}
          onClick={run(onReports)}
        >
          Reports
        </button>
      )}
    </>
  ) : null;

  return (
    <header className="site-header" ref={headerRef}>
      <div className="site-header__inner">
        <button
          type="button"
          className="site-header__brand"
          onClick={run(onHome)}
          aria-label="Kenya Live Atlas home"
        >
          <BrandLogo />
        </button>

        {/* Desktop / tablet: everything inline. */}
        <nav className="site-header__nav" aria-label="Main">
          {navLinks}
        </nav>

        <div className="site-header__actions">
          <ThemeToggle />
          {user ? (
            <>
              {displayName && (
                <span className="site-header__user" title={displayName}>
                  <span className="site-header__avatar" aria-hidden="true">
                    {String(displayName).trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="site-header__user-text">
                    <span className="site-header__user-name">{displayName}</span>
                    {role && <span className="site-header__user-role">{role}</span>}
                  </span>
                </span>
              )}
              {onSignOut && (
                <button type="button" className="site-header__btn ghost" onClick={run(onSignOut)}>
                  Sign out
                </button>
              )}
            </>
          ) : (
            <>
              {onSignIn && (
                <button type="button" className="site-header__btn ghost" onClick={run(onSignIn)}>
                  Sign in
                </button>
              )}
              {onSignUp && (
                <button type="button" className="site-header__btn solid" onClick={run(onSignUp)}>
                  Create account
                </button>
              )}
            </>
          )}
        </div>

        {/* Mobile: one button, one sheet. */}
        <button
          type="button"
          className="site-header__menu-btn"
          aria-expanded={menuOpen}
          aria-controls="site-menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <MenuIcon open={menuOpen} />
          <span className="u-sr">{menuOpen ? "Close menu" : "Open menu"}</span>
        </button>
      </div>

      <div
        id="site-menu"
        className={`site-header__sheet${menuOpen ? " is-open" : ""}`}
        hidden={!menuOpen}
      >
        {user && displayName && (
          <div className="site-header__sheet-user">
            <span className="site-header__avatar" aria-hidden="true">
              {String(displayName).trim().charAt(0).toUpperCase()}
            </span>
            <span className="site-header__user-text">
              <span className="site-header__user-name">{displayName}</span>
              {role && <span className="site-header__user-role">{role}</span>}
            </span>
          </div>
        )}

        <div className="site-header__sheet-nav">{navLinks}</div>

        <div className="site-header__sheet-foot">
          <ThemeToggle compact />
          {user
            ? onSignOut && (
                <button type="button" className="site-header__btn ghost" onClick={run(onSignOut)}>
                  Sign out
                </button>
              )
            : (
              <>
                {onSignIn && (
                  <button type="button" className="site-header__btn ghost" onClick={run(onSignIn)}>
                    Sign in
                  </button>
                )}
                {onSignUp && (
                  <button type="button" className="site-header__btn solid" onClick={run(onSignUp)}>
                    Create account
                  </button>
                )}
              </>
            )}
        </div>
      </div>
    </header>
  );
}

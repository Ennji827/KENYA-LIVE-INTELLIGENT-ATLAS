import React from "react";
import KsaPoweredBy from "../components/KsaPoweredBy";

const FEATURES = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    ),
    title: "47-County Coverage",
    desc: "Full GIS boundary data for every county, sub-county, and ward across Kenya.",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
      </svg>
    ),
    title: "Satellite Intelligence",
    desc: "Sentinel-2 and Landsat imagery with NDVI, NDWI, and land-cover analysis.",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/>
      </svg>
    ),
    title: "Live Climate Data",
    desc: "Real-time weather forecasts and historical NASA POWER climate records.",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
      </svg>
    ),
    title: "AI-Backed Insights",
    desc: "Evidence-grounded intelligence analysis and field report verification.",
  },
];

const STATS = [
  { value: "47", label: "Counties" },
  { value: "290+", label: "Sub-counties" },
  { value: "1,450+", label: "Wards" },
  { value: "Live", label: "Satellite feeds" },
];

export default function LandingPage({ onSignIn, onSignUp }) {
  return (
    <div className="lp-root">

      {/* ── Nav ── */}
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <div className="lp-logo">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="#0f4c81"/>
              <path d="M8 22 L16 10 L24 22" stroke="#4ade80" strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
              <circle cx="16" cy="10" r="2" fill="#4ade80"/>
            </svg>
            <span className="lp-logo-name">AEIS-K</span>
          </div>
          <div className="lp-nav-actions">
            <button type="button" className="lp-btn-ghost" onClick={onSignIn}>Sign In</button>
            <button type="button" className="lp-btn-primary" onClick={onSignUp}>Sign Up</button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-badge">Agro-Environmental Intelligence</div>
          <h1 className="lp-hero-title">
            Kenya's National<br />
            <span className="lp-hero-accent">Agricultural Intelligence</span><br />
            Platform
          </h1>
          <p className="lp-hero-sub">
            Satellite imagery, climate data, and AI-backed analysis for every county —
            built for researchers, decision makers, and industry professionals.
          </p>
          <div className="lp-hero-ctas">
            <button type="button" className="lp-cta-primary" onClick={onSignUp}>
              Get started free
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </button>
            <button type="button" className="lp-cta-ghost" onClick={onSignIn}>
              Sign in to your account
            </button>
          </div>

          {/* Stats strip */}
          <div className="lp-stats">
            {STATS.map((s) => (
              <div key={s.label} className="lp-stat">
                <strong>{s.value}</strong>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Map illustration */}
        <div className="lp-hero-map" aria-hidden="true">
          <div className="lp-map-glow" />
          <svg viewBox="0 0 400 320" fill="none" xmlns="http://www.w3.org/2000/svg" className="lp-map-svg">
            <rect width="400" height="320" rx="16" fill="rgba(15,76,129,0.12)"/>
            {/* Kenya silhouette approximation */}
            <path d="M180 40 L220 38 L255 55 L270 80 L265 115 L280 140 L275 170 L250 195 L235 230 L210 260 L190 265 L170 245 L155 210 L140 185 L135 155 L145 125 L135 100 L145 75 L160 55 Z" fill="rgba(74,222,128,0.18)" stroke="rgba(74,222,128,0.5)" strokeWidth="1.5"/>
            {/* County grid lines */}
            <line x1="170" y1="80" x2="255" y2="80" stroke="rgba(74,222,128,0.2)" strokeWidth="0.8"/>
            <line x1="160" y1="120" x2="275" y2="115" stroke="rgba(74,222,128,0.2)" strokeWidth="0.8"/>
            <line x1="148" y1="160" x2="275" y2="155" stroke="rgba(74,222,128,0.2)" strokeWidth="0.8"/>
            <line x1="148" y1="200" x2="255" y2="195" stroke="rgba(74,222,128,0.2)" strokeWidth="0.8"/>
            <line x1="200" y1="42" x2="200" y2="262" stroke="rgba(74,222,128,0.2)" strokeWidth="0.8"/>
            <line x1="228" y1="42" x2="238" y2="262" stroke="rgba(74,222,128,0.2)" strokeWidth="0.8"/>
            {/* Data points */}
            <circle cx="195" cy="100" r="4" fill="#4ade80" opacity="0.9"/>
            <circle cx="240" cy="130" r="3" fill="#4ade80" opacity="0.7"/>
            <circle cx="175" cy="160" r="5" fill="#60a5fa" opacity="0.8"/>
            <circle cx="220" cy="185" r="3" fill="#4ade80" opacity="0.6"/>
            <circle cx="190" cy="210" r="4" fill="#facc15" opacity="0.7"/>
            {/* Pulse rings */}
            <circle cx="175" cy="160" r="12" stroke="#60a5fa" strokeWidth="1" opacity="0.35"/>
            <circle cx="175" cy="160" r="20" stroke="#60a5fa" strokeWidth="0.6" opacity="0.18"/>
            {/* Legend */}
            <rect x="20" y="260" width="8" height="8" rx="2" fill="#4ade80"/>
            <text x="33" y="268" fill="rgba(255,255,255,0.6)" fontSize="10" fontFamily="system-ui">NDVI coverage</text>
            <rect x="20" y="276" width="8" height="8" rx="2" fill="#60a5fa"/>
            <text x="33" y="284" fill="rgba(255,255,255,0.6)" fontSize="10" fontFamily="system-ui">Live analysis</text>
          </svg>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="lp-features">
        <div className="lp-section-inner">
          <h2 className="lp-section-title">Everything you need for agro-environmental intelligence</h2>
          <p className="lp-section-sub">One platform connecting satellite, climate, and field data for evidence-backed decisions.</p>
          <div className="lp-features-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="lp-feature-card">
                <div className="lp-feature-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA banner ── */}
      <section className="lp-cta-band">
        <div className="lp-section-inner lp-cta-band-inner">
          <div>
            <h2 className="lp-cta-band-title">Ready to explore Kenya's agricultural data?</h2>
            <p className="lp-cta-band-sub">Join researchers, analysts, and decision makers using AEIS-K.</p>
          </div>
          <div className="lp-cta-band-actions">
            <button type="button" className="lp-cta-primary" onClick={onSignUp}>Create free account</button>
            <button type="button" className="lp-cta-ghost lp-cta-ghost-light" onClick={onSignIn}>Sign in</button>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-section-inner lp-footer-inner">
          <div className="lp-logo">
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="#0f4c81"/>
              <path d="M8 22 L16 10 L24 22" stroke="#4ade80" strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
              <circle cx="16" cy="10" r="2" fill="#4ade80"/>
            </svg>
            <span className="lp-logo-name" style={{ color: "#94a3b8" }}>AEIS-K</span>
          </div>
          <p className="lp-footer-copy">Agro-Environmental Intelligence System for Kenya</p>
          <KsaPoweredBy />
        </div>
      </footer>

    </div>
  );
}

import React, { useCallback, useEffect, useRef, useState } from "react";
import KsaPoweredBy from "../components/KsaPoweredBy";
import SiteHeader from "../components/SiteHeader";
import TopicCard from "../components/TopicCard";
import { GoogleIcon } from "../components/AuthGateway";
import { TOPICS } from "../data/topics";
import { TOPIC_IMAGE } from "../data/topicImages";
import "../styles/landing.css";

// One hero slide per topic that has a photo, in topic order. Each falls back to
// the topic's own colour gradient if the image is missing.
const SLIDES = TOPICS.filter((t) => TOPIC_IMAGE[t.id]).map((t) => ({
  key: t.id,
  eyebrow: t.category,
  title: t.label,
  desc: t.description,
  image: TOPIC_IMAGE[t.id],
  gradient: `linear-gradient(135deg, ${t.ramp[1]} 0%, #0f172a 100%)`,
  topics: [t.id],
}));

const AUTO_MS = 5000;
const topicById = TOPICS.reduce((m, t) => ((m[t.id] = t), m), {});

// Topics surfaced as quick links in the footer.
const FOOTER_TOPICS = ["weather", "landuse", "water_bodies", "roads", "households"];

const ArrowRight = (props) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

export default function LandingPage({
  onSignIn,
  onSignUp,
  onGoogle,
  onExploreTopic,
  authenticated = false,
  user = null,
  onEnterHub,
  onSignOut,
}) {
  const [active, setActive] = useState(0);
  const timer = useRef(null);

  const explore = onExploreTopic || onSignUp || (() => {});
  const scrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  const go = useCallback((next) => {
    setActive((prev) => (next + SLIDES.length) % SLIDES.length);
  }, []);

  // Auto-advance; restarts whenever the active slide changes (incl. manual nav).
  useEffect(() => {
    timer.current = setTimeout(() => go(active + 1), AUTO_MS);
    return () => clearTimeout(timer.current);
  }, [active, go]);

  const pause = () => clearTimeout(timer.current);
  const resume = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => go(active + 1), AUTO_MS);
  };

  return (
    <div className="lp-root">

      {/* ── Nav (shared branded header) ── */}
      <SiteHeader
        user={authenticated ? user : null}
        onHome={scrollTop}
        onEnterHub={authenticated ? onEnterHub : undefined}
        onSignIn={authenticated ? undefined : onSignIn}
        onSignUp={authenticated ? undefined : onSignUp}
        onSignOut={authenticated ? onSignOut : undefined}
        active="home"
      />

      {/* ── Hero copy ── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-badge">National Geospatial and Resource Intelligence</div>
          <h1 className="lp-hero-title">
            Kenya Live <span className="lp-hero-accent">Atlas</span>
          </h1>
        </div>
      </section>

      {/* ── Hero slideshow ── */}
      <section className="lp-slideshow" onMouseEnter={pause} onMouseLeave={resume}>
        <div className="lp-slides" aria-roledescription="carousel">
          {SLIDES.map((slide, i) => (
            <div
              key={slide.key}
              className={`lp-slide${i === active ? " is-active" : ""}`}
              aria-hidden={i !== active}
              style={{
                backgroundImage: `linear-gradient(180deg, rgba(2,6,23,0.30) 0%, rgba(2,6,23,0.78) 100%), url('${slide.image}'), ${slide.gradient}`,
              }}
            >
              <div className="lp-slide-content">
                <span className="lp-slide-eyebrow">{slide.eyebrow}</span>
                <h2 className="lp-slide-title">{slide.title}</h2>
                <p className="lp-slide-desc">{slide.desc}</p>
                <div className="lp-slide-actions">
                  <button
                    type="button"
                    className="lp-slide-explore"
                    onClick={() => explore(slide.topics[0])}
                  >
                    Explore {topicById[slide.topics[0]]?.label || slide.eyebrow}
                    <ArrowRight />
                  </button>
                  {slide.topics.length > 1 && (
                    <div className="lp-slide-pills">
                      {slide.topics.slice(1).map((id) => (
                        <button key={id} type="button" className="lp-slide-pill" onClick={() => explore(id)}>
                          <span aria-hidden="true">{topicById[id]?.icon}</span>
                          {topicById[id]?.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          <button type="button" className="lp-slide-arrow prev" aria-label="Previous slide" onClick={() => go(active - 1)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <button type="button" className="lp-slide-arrow next" aria-label="Next slide" onClick={() => go(active + 1)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>

          <div className="lp-slide-dots">
            {SLIDES.map((slide, i) => (
              <button
                key={slide.key}
                type="button"
                className={`lp-slide-dot${i === active ? " is-active" : ""}`}
                aria-label={`Go to ${slide.eyebrow} slide`}
                onClick={() => setActive(i)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── Explore topics ── */}
      <section className="lp-topics">
        <div className="lp-section-inner">
          <h2 className="lp-section-title">Explore Resource intelligence topics</h2>
          <p className="lp-section-sub">
            Critical topics, each mapped from national down to sub-county level.
            Select a topic and generate reports, and ask the model for insights.
          </p>
          <div className="lp-topics-grid">
            {TOPICS.map((topic) => (
              <TopicCard
                key={topic.id}
                topic={topic}
                onClick={() => explore(topic.id)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA banner ── */}
      <section className="lp-cta-band">
        <div className="lp-section-inner lp-cta-band-inner">
          <div>
            <h2 className="lp-cta-band-title">Ready to explore Kenya's national data?</h2>
            <p className="lp-cta-band-sub">
              {authenticated
                ? "Jump into the intelligence hub and drill down from national to sub-county level."
                : "Join researchers, analysts, and decision makers using Kenya Live Atlas."}
            </p>
          </div>
          <div className="lp-cta-band-actions">
            {authenticated ? (
              <button type="button" className="lp-cta-primary" onClick={onEnterHub}>Enter the hub</button>
            ) : (
              <>
                <button type="button" className="lp-cta-primary" onClick={onSignUp}>Create free account</button>
                <button type="button" className="lp-cta-ghost lp-cta-ghost-light" onClick={onSignIn}>Sign in</button>
                {onGoogle && (
                  <button type="button" className="lp-cta-google" onClick={onGoogle}>
                    <GoogleIcon />
                    <span>Continue with Google</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-section-inner lp-footer-grid">
          <div className="lp-footer-brand">
            <div className="lp-logo">
              <span className="brand-abbr" aria-hidden="true">KLA</span>
              <span className="lp-logo-name">KENYA LIVE ATLAS</span>
            </div>
            <p className="lp-footer-copy">
              National geospatial intelligence for Kenya — climate, environment,
              infrastructure, and population mapped to every county.
            </p>
          </div>

          <nav className="lp-footer-col" aria-label="Explore topics">
            <h4>Explore</h4>
            {FOOTER_TOPICS.map((id) => (
              <button key={id} type="button" className="lp-footer-link" onClick={() => explore(id)}>
                {topicById[id]?.label}
              </button>
            ))}
          </nav>

          <nav className="lp-footer-col" aria-label="Platform">
            <h4>Platform</h4>
            {authenticated ? (
              <>
                <button type="button" className="lp-footer-link" onClick={onEnterHub}>Open the hub</button>
                <button type="button" className="lp-footer-link" onClick={onSignOut}>Sign out</button>
              </>
            ) : (
              <>
                <button type="button" className="lp-footer-link" onClick={onSignIn}>Sign in</button>
                <button type="button" className="lp-footer-link" onClick={onSignUp}>Create account</button>
              </>
            )}
            <a className="lp-footer-link" href="mailto:info@ksa.go.ke">Contact</a>
          </nav>

          <div className="lp-footer-ksa">
            <KsaPoweredBy />
          </div>
        </div>

        <div className="lp-footer-bottom">
          <div className="lp-section-inner lp-footer-bottom-inner">
            <span>© {new Date().getFullYear()} Kenya Live Atlas · National Geospatial and Resource Intelligence for Kenya</span>
            <span>Kenya Space Agency</span>
          </div>
        </div>
      </footer>

    </div>
  );
}

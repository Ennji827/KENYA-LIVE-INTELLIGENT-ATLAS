import React, { useCallback, useEffect, useState } from "react";
import TopicWorkspace from "./pages/TopicWorkspace";
import InsightsPage from "./pages/InsightsPage";
import ReportsWorkspace from "./pages/ReportsWorkspace";
import LandingPage from "./pages/LandingPage";
import SiteHeader from "./components/SiteHeader";
import AuthGateway, { readAuthSession, clearAuthSession } from "./components/AuthGateway";
import {
  parseUrl,
  buildUrl,
  currentUrl,
  isProtected,
  NATIONAL_SCOPE,
} from "./utils/urlState";
// Self-hosted variable faces, then the design tokens that every other
// stylesheet consumes, then the shared chrome and the app UI. Order matters:
// tokens must be defined before anything reads them.
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/theme.css";
import "./styles/intel.css";
import "./styles/payments.css";

// Top-level shell for the critical intelligence system.
// Flow: Landing (home + topic picker) -> Auth -> Workspace (map) -> Insights.
// The landing page is the home for signed-out AND signed-in visitors, and is the
// only place topics are chosen, so both states share one identity and one entry.
//
// Every screen is addressable (see utils/urlState.js): the route — including the
// map's administrative scope — lives in the URL, so a county or ward view can be
// copied to a colleague, bookmarked, and walked with the browser Back button.
// Identifies the exact view a region set was computed for, so a handoff is
// never reused for a different topic or scope (e.g. after back/forward).
const askKeyFor = (topicId, scope) =>
  [topicId, scope?.level, scope?.county, scope?.subcounty, scope?.ward].join("|");

export default function AppIntel() {
  const [session, setSession] = useState(() => readAuthSession());
  const [route, setRoute] = useState(() => parseUrl());
  // Set when the visitor picks "Continue with Google" on the landing page, so
  // the auth screen opens the Google popup immediately on mount.
  const [autoGoogle, setAutoGoogle] = useState(false);
  // Route a signed-out visitor asked for before authenticating; replayed once
  // they sign in, so a shared deep link survives the sign-in detour.
  const [pendingRoute, setPendingRoute] = useState(null);
  // Regions handed from the workspace to the insights page when a question is
  // asked there — the exact values on screen, live feed included. Null on a
  // cold load; the insights page then resolves them itself.
  const [askedRegions, setAskedRegions] = useState(null);

  // Push a new route (Back returns to the previous one) or replace the current
  // entry for corrections that shouldn't add history. Re-navigating to the URL
  // already showing always replaces, so repeat clicks don't stack entries.
  const navigate = useCallback((next, { replace = false } = {}) => {
    const url = buildUrl(next);
    setRoute(next);
    if (replace || url === currentUrl()) {
      window.history.replaceState(null, "", url);
    } else {
      window.history.pushState(null, "", url);
    }
  }, []);

  // Back/forward buttons re-read the URL without writing to history.
  useEffect(() => {
    const onPop = () => setRoute(parseUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Canonicalise the entry URL once (e.g. /topic/bogus -> /, a truncated
  // scope -> its deepest valid level) so the address bar matches what renders.
  useEffect(() => {
    const url = buildUrl(parseUrl());
    if (url !== currentUrl()) window.history.replaceState(null, "", url);
  }, []);

  // A signed-out visitor on a protected route is sent to sign-in; the route
  // they wanted is held and replayed by handleAuthenticated.
  useEffect(() => {
    if (session || !isProtected(route)) return;
    setPendingRoute(route);
    navigate({ view: "signin", topicId: null, scope: null }, { replace: true });
  }, [session, route, navigate]);

  // Mirror image: an already-signed-in visitor has no business on the auth
  // screens, so /signin and /register resolve to home.
  useEffect(() => {
    if (!session) return;
    if (route.view !== "signin" && route.view !== "register") return;
    navigate({ view: "landing", topicId: null, scope: null }, { replace: true });
  }, [session, route, navigate]);

  // Exploring a topic drops straight onto the national map — no interstitial
  // area chooser. Narrowing to a county or ward is done on the map itself,
  // via the scope controls above it.
  const openTopic = (topicId) =>
    navigate({ view: "topic", topicId, scope: NATIONAL_SCOPE });

  // The landing page is the topic picker, so it is also where "all topics"
  // and the post-sign-in default land.
  const goHome = () => navigate({ view: "landing", topicId: null, scope: null });
  const goReports = () =>
    navigate({ view: "reports", topicId: null, scope: null });

  const handleSignOut = () => {
    clearAuthSession();
    setSession(null);
    setPendingRoute(null);
    navigate({ view: "landing", topicId: null, scope: null });
  };

  // Called after successful sign-in/register. Honour whatever route the visitor
  // was reaching for; otherwise drop them at home to pick a topic.
  const handleAuthenticated = (payload) => {
    setSession(payload);
    const next = pendingRoute || { view: "landing", topicId: null, scope: null };
    setPendingRoute(null);
    navigate(next, { replace: true });
  };

  const exploreTopic = (topicId) => {
    setPendingRoute({ view: "topic", topicId, scope: NATIONAL_SCOPE });
    setAutoGoogle(false);
    navigate({ view: "signin", topicId: null, scope: null });
  };

  // ── Signed out ───────────────────────────────────────────────
  if (!session) {
    if (route.view === "landing") {
      return (
        <div className="intel-app">
          <LandingPage
            onSignIn={() => { setAutoGoogle(false); navigate({ view: "signin", topicId: null, scope: null }); }}
            onSignUp={() => { setAutoGoogle(false); navigate({ view: "register", topicId: null, scope: null }); }}
            onGoogle={() => { setAutoGoogle(true); navigate({ view: "signin", topicId: null, scope: null }); }}
            onExploreTopic={exploreTopic}
          />
        </div>
      );
    }
    // Auth screens, and protected routes awaiting the redirect above.
    return (
      <div className="intel-app">
        <AuthGateway
          initialView={route.view === "register" ? "register" : "signin"}
          autoGoogle={autoGoogle}
          onAuthenticated={handleAuthenticated}
          onBack={() => {
            setPendingRoute(null);
            setAutoGoogle(false);
            navigate({ view: "landing", topicId: null, scope: null });
          }}
        />
      </div>
    );
  }

  // ── Signed in · home (landing) ───────────────────────────────
  if (route.view === "landing") {
    return (
      <div className="intel-app">
        <LandingPage
          authenticated
          user={session}
          onSignOut={handleSignOut}
          onExploreTopic={openTopic}
          onReports={goReports}
        />
      </div>
    );
  }

  // ── Signed in · Reports ──────────────────────────────────────
  if (route.view === "reports") {
    return (
      <div className="intel-app">
        <SiteHeader
          user={session}
          onHome={goHome}
          onReports={goReports}
          onSignOut={handleSignOut}
          active="reports"
        />
        <ReportsWorkspace user={session} />
      </div>
    );
  }

  // ── Signed in · app ──────────────────────────────────────────
  let screen;
  if (route.view === "topic") {
    screen = (
      <TopicWorkspace
        // Remount on topic change so per-topic state (regions, live feeds)
        // never leaks across topics.
        key={route.topicId}
        topicId={route.topicId}
        scope={route.scope}
        onScope={(scope) =>
          navigate({ view: "topic", topicId: route.topicId, scope })
        }
        onAsk={(question, regions, dataStatus) => {
          setAskedRegions({
            key: askKeyFor(route.topicId, route.scope),
            regions,
            dataStatus,
          });
          navigate({
            view: "insights",
            topicId: route.topicId,
            scope: route.scope,
            question,
          });
        }}
        onBackToTopics={goHome}
        user={session}
      />
    );
  } else if (route.view === "insights") {
    // Only reuse the handoff if it was computed for this exact view.
    const handoff =
      askedRegions?.key === askKeyFor(route.topicId, route.scope)
        ? askedRegions
        : null;
    screen = (
      <InsightsPage
        // A new question is a new answer, not an update to the old one.
        key={route.question}
        topicId={route.topicId}
        scope={route.scope}
        question={route.question}
        regions={handoff?.regions || null}
        dataStatus={handoff?.dataStatus}
        onBack={() =>
          navigate({
            view: "topic",
            topicId: route.topicId,
            scope: route.scope,
          })
        }
        onAsk={(question) =>
          navigate({
            view: "insights",
            topicId: route.topicId,
            scope: route.scope,
            question,
          })
        }
      />
    );
  }

  // The map workspace is laid out to the viewport rather than the document:
  // the map and chart flex to fill the height so the whole page fits without
  // scrolling. Every other screen reads as a document and scrolls normally.
  return (
    <div
      className={`intel-app${route.view === "topic" ? " intel-app--fixed" : ""}`}
    >
      <SiteHeader
        user={session}
        onHome={goHome}
        onReports={goReports}
        onSignOut={handleSignOut}
        active={route.view === "reports" ? "reports" : undefined}
      />
      {screen}
    </div>
  );
}

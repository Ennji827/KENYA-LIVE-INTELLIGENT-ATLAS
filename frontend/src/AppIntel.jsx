import React, { useState } from "react";
import IntelHub from "./pages/IntelHub";
import AreaSelect from "./components/AreaSelect";
import TopicWorkspace from "./pages/TopicWorkspace";
import ReportsWorkspace from "./pages/ReportsWorkspace";
import LandingPage from "./pages/LandingPage";
import SiteHeader from "./components/SiteHeader";
import AuthGateway, { readAuthSession, clearAuthSession } from "./components/AuthGateway";
// Shared tokens + glassmorphism + auth/KSA styles, then the app UI.
import "./styles/theme.css";
import "./styles/intel.css";
import "./styles/payments.css";

// Top-level shell for the critical intelligence system.
// Flow: Landing (home) -> Auth -> Hub (pick a topic) -> Area of interest -> Workspace.
// The landing page is the home for signed-out AND signed-in visitors: a signed-in
// user can always return "Home" and re-enter the hub, keeping one shared identity.
export default function AppIntel() {
  const [session, setSession] = useState(() => readAuthSession());
  // Which signed-out screen to show: "landing" | "signin" | "register".
  const [authScreen, setAuthScreen] = useState("landing");
  // Topic the visitor picked on the landing page before signing in; opened once
  // authenticated so an "Explore" click deep-links straight into that topic.
  const [pendingTopic, setPendingTopic] = useState(null);
  // Signed-in visitor viewing the landing/home page rather than the app.
  const [atHome, setAtHome] = useState(false);
  // Signed-in visitor viewing the Reports workspace (a top-level section).
  const [atReports, setAtReports] = useState(false);

  const [activeTopic, setActiveTopic] = useState(null);
  const [area, setArea] = useState(null); // chosen scope { level, county, subcounty }

  const openTopic = (topicId) => {
    setActiveTopic(topicId);
    setArea(null);
    setAtHome(false);
    setAtReports(false);
  };

  const backToHub = () => {
    setActiveTopic(null);
    setArea(null);
    setAtHome(false);
    setAtReports(false);
  };

  const goHome = () => {
    setAtHome(true);
    setAtReports(false);
  };

  const goReports = () => {
    setAtReports(true);
    setAtHome(false);
    setActiveTopic(null);
    setArea(null);
  };

  const handleSignOut = () => {
    clearAuthSession();
    setSession(null);
    setAuthScreen("landing");
    setPendingTopic(null);
    setAtHome(false);
    setAtReports(false);
    setActiveTopic(null);
    setArea(null);
  };

  // Called after successful sign-in/register. Honour any topic the visitor
  // asked to explore from the landing page.
  const handleAuthenticated = (payload) => {
    setSession(payload);
    setAtHome(false);
    if (pendingTopic) {
      openTopic(pendingTopic);
      setPendingTopic(null);
    }
  };

  const exploreTopic = (topicId) => {
    setPendingTopic(topicId);
    setAuthScreen("signin");
  };

  // ── Signed out ───────────────────────────────────────────────
  if (!session) {
    if (authScreen === "landing") {
      return (
        <div className="intel-app">
          <LandingPage
            onSignIn={() => setAuthScreen("signin")}
            onSignUp={() => setAuthScreen("register")}
            onExploreTopic={exploreTopic}
          />
        </div>
      );
    }
    return (
      <div className="intel-app">
        <AuthGateway
          initialView={authScreen}
          onAuthenticated={handleAuthenticated}
          onBack={() => { setAuthScreen("landing"); setPendingTopic(null); }}
        />
      </div>
    );
  }

  // ── Signed in · home (landing) ───────────────────────────────
  if (atHome) {
    return (
      <div className="intel-app">
        <LandingPage
          authenticated
          user={session}
          onEnterHub={backToHub}
          onSignOut={handleSignOut}
          onExploreTopic={openTopic}
        />
      </div>
    );
  }

  // ── Signed in · Reports ──────────────────────────────────────
  if (atReports) {
    return (
      <div className="intel-app">
        <SiteHeader
          user={session}
          onHome={goHome}
          onEnterHub={backToHub}
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
  if (!activeTopic) {
    screen = <IntelHub onOpenTopic={openTopic} />;
  } else if (!area) {
    screen = (
      <AreaSelect topicId={activeTopic} onConfirm={setArea} onCancel={backToHub} />
    );
  } else {
    screen = (
      <TopicWorkspace
        topicId={activeTopic}
        initialScope={area}
        onBackToHub={backToHub}
        onChangeArea={() => setArea(null)}
        user={session}
      />
    );
  }

  return (
    <div className="intel-app">
      <SiteHeader
        user={session}
        onHome={goHome}
        onEnterHub={backToHub}
        onReports={goReports}
        onSignOut={handleSignOut}
        active={activeTopic ? undefined : "hub"}
      />
      {screen}
    </div>
  );
}

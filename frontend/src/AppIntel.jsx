import React, { useState } from "react";
import IntelHub from "./pages/IntelHub";
import AreaSelect from "./components/AreaSelect";
import TopicWorkspace from "./pages/TopicWorkspace";
import LandingPage from "./pages/LandingPage";
import AuthGateway, { readAuthSession, clearAuthSession } from "./components/AuthGateway";
// Shared tokens + glassmorphism + auth/KSA styles, then the app UI.
import "./styles/theme.css";
import "./styles/intel.css";

// Top-level shell for the critical intelligence system.
// Flow: Landing -> Auth -> Hub (pick a topic) -> Area of interest -> Workspace.
export default function AppIntel() {
  const [session, setSession] = useState(() => readAuthSession());
  // Which unauthenticated screen to show: "landing" | "signin" | "register".
  const [authScreen, setAuthScreen] = useState("landing");
  // Topic the visitor picked on the landing page before signing in; opened once
  // authenticated so an "Explore" click deep-links straight into that topic.
  const [pendingTopic, setPendingTopic] = useState(null);

  const [activeTopic, setActiveTopic] = useState(null);
  const [area, setArea] = useState(null); // chosen scope { level, county, subcounty }

  const openTopic = (topicId) => {
    setActiveTopic(topicId);
    setArea(null);
  };

  const backToHub = () => {
    setActiveTopic(null);
    setArea(null);
  };

  const handleSignOut = () => {
    clearAuthSession();
    setSession(null);
    setAuthScreen("landing");
    setPendingTopic(null);
    backToHub();
  };

  // Called after successful sign-in/register. Honour any topic the visitor
  // asked to explore from the landing page.
  const handleAuthenticated = (payload) => {
    setSession(payload);
    if (pendingTopic) {
      openTopic(pendingTopic);
      setPendingTopic(null);
    }
  };

  const exploreTopic = (topicId) => {
    setPendingTopic(topicId);
    setAuthScreen("signin");
  };

  // ── Unauthenticated ──────────────────────────────────────────
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

  // ── Authenticated ────────────────────────────────────────────
  let screen;
  if (!activeTopic) {
    screen = (
      <IntelHub onOpenTopic={openTopic} user={session} onSignOut={handleSignOut} />
    );
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
      />
    );
  }

  return <div className="intel-app">{screen}</div>;
}

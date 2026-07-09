import React, { useState } from "react";
import IntelHub from "./pages/IntelHub";
import AreaSelect from "./components/AreaSelect";
import TopicWorkspace from "./pages/TopicWorkspace";
import "./styles/intel.css";

// Top-level shell for the critical intelligence system.
// Flow: Hub (pick a topic) -> Area of interest (pick scope) -> Workspace.
export default function AppIntel() {
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
      />
    );
  }

  return <div className="intel-app">{screen}</div>;
}

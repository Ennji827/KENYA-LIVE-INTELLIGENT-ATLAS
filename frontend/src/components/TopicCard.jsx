import React from "react";
import { TOPIC_IMAGE } from "../data/topicImages";

const ArrowRight = (props) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

// The photo-hero topic card: the topic's accent rail, category, title and an
// Explore call-to-action over its slide photo (falls back to the accent colour
// when no image exists). Shared by the landing page and the intelligence hub so
// both surfaces present topics identically.
export default function TopicCard({ topic, onClick, ctaLabel = "Explore" }) {
  const accent = topic.ramp?.[1] || "#0f766e";
  const image = TOPIC_IMAGE[topic.id];
  return (
    <button
      type="button"
      className="lp-topic-card"
      style={{
        "--topic-accent": accent,
        backgroundImage: image
          ? `linear-gradient(180deg, rgba(2,6,23,0.20) 0%, rgba(2,6,23,0.85) 100%), url('${image}')`
          : undefined,
      }}
      onClick={onClick}
    >
      <span className="lp-topic-card-cat">{topic.category}</span>
      <h3 className="lp-topic-card-title">{topic.label}</h3>
      <span className="lp-topic-card-cta">
        {ctaLabel} <ArrowRight />
      </span>
    </button>
  );
}

// Two-way mapping between the browser URL and the app's route state, so every
// screen — and every map scope — is shareable, bookmarkable and back-buttonable.
//
// Shape:
//   /                                          landing (home + topic picker)
//   /signin  ·  /register                      auth screens
//   /reports                                   reports workspace
//   /topic/<topicId>                           workspace, national view
//   /topic/<topicId>?level=county&county=…     workspace, drilled in
//   /topic/<topicId>/insights?q=…&level=…      answer page for one question
//
// The administrative area travels as query params rather than path segments
// because 290 sub-county and 1409 ward names contain "/" (Sigowet/Soin,
// Parklands/Highridge); URLSearchParams round-trips those exactly, while a
// path segment would need lossy slugging and an async name lookup to reverse.

import { topicById } from "../data/topics";

const LEVELS = ["national", "county", "subcounty", "ward"];

// Views that require a signed-in session.
const PROTECTED = new Set(["reports", "topic", "insights"]);

export function isProtected(route) {
  return PROTECTED.has(route?.view);
}

// Opening a topic lands on the whole country; the map's own scope controls
// take it from there.
export const NATIONAL_SCOPE = {
  level: "national",
  county: "",
  subcounty: "",
  ward: "",
};

// Resolve the area params to the deepest level that is both requested and
// fully backed by its ancestors, so a truncated or hand-edited URL still
// opens something coherent instead of an empty map.
function parseScope(params) {
  const level = params.get("level");
  // A bare /topic/<id>, or an unparseable level, opens at national.
  if (!LEVELS.includes(level)) return NATIONAL_SCOPE;

  const county = params.get("county") || "";
  const subcounty = params.get("subcounty") || "";
  const ward = params.get("ward") || "";

  let depth = 0;
  if (county) depth = 1;
  if (county && subcounty) depth = 2;
  if (county && subcounty && ward) depth = 3;
  depth = Math.min(depth, LEVELS.indexOf(level));

  return {
    level: LEVELS[depth],
    county: depth >= 1 ? county : "",
    subcounty: depth >= 2 ? subcounty : "",
    ward: depth >= 3 ? ward : "",
  };
}

export function parseUrl(loc = window.location) {
  const segments = loc.pathname.split("/").filter(Boolean);
  const head = segments[0] || "";
  const blank = { view: "landing", topicId: null, scope: null, question: "" };

  if (head === "signin" || head === "register") return { ...blank, view: head };
  if (head === "reports") return { ...blank, view: "reports" };
  // The old topic hub is gone; the landing page lists every topic. Existing
  // /hub links resolve there rather than 404-ing.
  if (head === "hub") return blank;

  if (head === "topic") {
    let topicId = "";
    try {
      topicId = decodeURIComponent(segments[1] || "");
    } catch {
      topicId = "";
    }
    // An unknown topic falls back to the topic list rather than a blank map.
    if (!topicById[topicId]) return blank;

    const params = new URLSearchParams(loc.search);
    const scope = parseScope(params);
    // /topic/<id>/insights is the answer page for one question, at the scope
    // the question was asked about.
    if (segments[2] === "insights") {
      return {
        view: "insights",
        topicId,
        scope,
        question: params.get("q") || "",
      };
    }
    return { view: "topic", topicId, scope, question: "" };
  }

  return blank;
}

// Serialise a scope onto a query string. National is the implicit default and
// contributes nothing, keeping the common URL short.
function appendScope(params, scope) {
  if (!scope || scope.level === "national") return params;
  params.set("level", scope.level);
  if (scope.county) params.set("county", scope.county);
  if (scope.subcounty) params.set("subcounty", scope.subcounty);
  if (scope.ward) params.set("ward", scope.ward);
  return params;
}

export function buildUrl(route) {
  switch (route?.view) {
    case "signin":
      return "/signin";
    case "register":
      return "/register";
    case "reports":
      return "/reports";
    case "topic": {
      const base = `/topic/${encodeURIComponent(route.topicId)}`;
      const params = appendScope(new URLSearchParams(), route.scope);
      const query = params.toString();
      return query ? `${base}?${query}` : base;
    }
    case "insights": {
      const base = `/topic/${encodeURIComponent(route.topicId)}/insights`;
      const params = new URLSearchParams();
      if (route.question) params.set("q", route.question);
      appendScope(params, route.scope);
      const query = params.toString();
      return query ? `${base}?${query}` : base;
    }
    default:
      return "/";
  }
}

export function currentUrl(loc = window.location) {
  return `${loc.pathname}${loc.search}`;
}

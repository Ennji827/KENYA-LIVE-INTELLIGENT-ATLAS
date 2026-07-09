// Workspace analysis engine.
//
// Produces insights (with reasons) and structured reports from whatever the user
// is currently looking at: a topic + a scope (national / county / sub-county) +
// the set of regions visible on the map. The AI panel tries the backend
// intelligence endpoint first and falls back to this deterministic local
// analyser, mirroring the app's existing "local rules provider" pattern.

import {
  getTopic,
  aggregate,
  formatValue,
  SOURCE_STATUS_LABEL,
} from "../data/topics";

function stats(topicId, regions) {
  const clean = regions.filter((r) => typeof r.value === "number");
  if (!clean.length) return null;
  const sorted = [...clean].sort((a, b) => b.value - a.value);
  const values = clean.map((r) => r.value);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return {
    count: clean.length,
    total: aggregate(topicId, values),
    mean: Number(mean.toFixed(getTopic(topicId).decimals)),
    top: sorted.slice(0, 3),
    bottom: sorted.slice(-3).reverse(),
    max: sorted[0],
    min: sorted[sorted.length - 1],
  };
}

// Human label for the child-region tier under a given scope.
function childLabel(scope) {
  if (scope.level === "national") return "counties";
  if (scope.level === "county") return "sub-counties";
  return "areas";
}

export function scopeLabel(scope) {
  if (scope.level === "national") return "National";
  if (scope.level === "county") return scope.county;
  if (scope.level === "subcounty") return `${scope.subcounty}, ${scope.county}`;
  return "National";
}

// Build the list of insights (each with a supporting reason) for a workspace.
export function localInsights(topicId, scope, regions, question = "") {
  const topic = getTopic(topicId);
  const s = stats(topicId, regions);
  const tier = childLabel(scope);
  const insights = [];

  if (!s) {
    return [
      {
        text: `No verified ${topic.label.toLowerCase()} values are available for ${scopeLabel(
          scope,
        )}.`,
        reason:
          "This topic is scaffolded and no live data source has been connected yet.",
      },
    ];
  }

  // Headline distribution.
  insights.push({
    text: `Across ${s.count} ${tier}, ${topic.metricLabel.toLowerCase()} ${
      topic.aggregation === "sum" ? "totals" : "averages"
    } ${formatValue(topicId, topic.aggregation === "sum" ? s.total : s.mean)}.`,
    reason: `Computed by ${
      topic.aggregation === "sum" ? "summing" : "averaging"
    } the ${s.count} ${tier} in view.`,
  });

  // Leaders.
  insights.push({
    text: `${s.top[0].name} leads with ${formatValue(topicId, s.top[0].value)}${
      s.top[1] ? `, followed by ${s.top[1].name} and ${s.top[2]?.name}` : ""
    }.`,
    reason: `${s.top[0].name} holds the highest value among the ${tier} in this view.`,
  });

  // Gap / inequality.
  const spread = s.min.value > 0 ? (s.max.value / s.min.value).toFixed(1) : "—";
  insights.push({
    text: `There is a wide spread: ${s.max.name} (${formatValue(
      topicId,
      s.max.value,
    )}) is about ${spread}× ${s.min.name} (${formatValue(topicId, s.min.value)}).`,
    reason:
      "Large max-to-min ratios flag uneven distribution that may warrant targeted intervention.",
  });

  // Laggards / attention.
  const attention = topic.higherIsBetter === true ? s.bottom : s.top;
  const attentionVerb =
    topic.higherIsBetter === true ? "lowest and may need attention" : "highest concentration";
  insights.push({
    text: `${attention.map((r) => r.name).join(", ")} show the ${attentionVerb}.`,
    reason:
      topic.higherIsBetter === true
        ? "For this topic higher is better, so the smallest values are the priority."
        : "These regions concentrate the most of this measure.",
  });

  // Tailor to the question if the user asked something specific.
  const q = question.toLowerCase();
  if (q) {
    if (/(lowest|least|bottom|worst|underserved)/.test(q)) {
      insights.unshift({
        text: `Lowest ${topic.metricLabel.toLowerCase()}: ${s.bottom
          .map((r) => `${r.name} (${formatValue(topicId, r.value)})`)
          .join(", ")}.`,
        reason: "Directly answers your question about the lowest-ranked regions.",
      });
    } else if (/(highest|most|top|best|leading)/.test(q)) {
      insights.unshift({
        text: `Highest ${topic.metricLabel.toLowerCase()}: ${s.top
          .map((r) => `${r.name} (${formatValue(topicId, r.value)})`)
          .join(", ")}.`,
        reason: "Directly answers your question about the top-ranked regions.",
      });
    } else if (/(average|mean|typical)/.test(q)) {
      insights.unshift({
        text: `The typical (mean) value is ${formatValue(topicId, s.mean)} across ${
          s.count
        } ${tier}.`,
        reason: "Directly answers your question about the average.",
      });
    } else if (/(why|reason|cause|driver)/.test(q)) {
      insights.unshift({
        text: `Drivers cannot be confirmed from scaffolded data — but the pattern concentrates around ${s.top[0].name}.`,
        reason:
          "Causal attribution requires connected, verified sources; only the distribution is available now.",
      });
    }
  }

  return insights;
}

// Assemble a full structured report for the current workspace.
export function buildReport(topicId, scope, regions) {
  const topic = getTopic(topicId);
  const s = stats(topicId, regions);
  const tier = childLabel(scope);
  const insights = localInsights(topicId, scope, regions);

  return {
    id: `RPT-${topicId}-${scope.level}`,
    title: `${topic.label} intelligence report — ${scopeLabel(scope)}`,
    topic: topic.label,
    scope: scopeLabel(scope),
    tier,
    headline: s
      ? `${topic.metricLabel}: ${formatValue(
          topicId,
          topic.aggregation === "sum" ? s.total : s.mean,
        )} across ${s.count} ${tier}`
      : "No verified data available",
    findings: insights,
    regions: [...regions].sort((a, b) => b.value - a.value),
    unit: topic.unit,
    sourceStatus: SOURCE_STATUS_LABEL,
  };
}

// Export a report as a downloadable CSV of its regions.
export function reportToCsv(report) {
  const header = `Region,Value (${report.unit})`;
  const rows = report.regions.map((r) => `${escapeCsv(r.name)},${r.value}`);
  return [header, ...rows].join("\n");
}

function escapeCsv(value) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

// Trigger a browser download of text content.
export function downloadText(filename, content, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

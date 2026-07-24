import React, { useEffect, useState } from "react";
import { getTopic } from "../data/topics";
import { listCounties, listSubcounties, listWards } from "../utils/geo";

// "Area of interest" chooser shown right after a topic is opened.
// Lets the user start at National level or focus on a specific
// County (and optionally a Sub-county) before the workspace loads.
export default function AreaSelect({ topicId, onConfirm, onCancel }) {
  const topic = getTopic(topicId);
  const counties = listCounties();
  const [mode, setMode] = useState("national"); // "national" | "county"
  const [county, setCounty] = useState("");
  const [subcounty, setSubcounty] = useState("");
  const [subcounties, setSubcounties] = useState([]);
  const [ward, setWard] = useState("");
  const [wards, setWards] = useState([]);

  useEffect(() => {
    let cancelled = false;
    if (!county) {
      setSubcounties([]);
      setSubcounty("");
      return;
    }
    listSubcounties(county).then((list) => {
      if (!cancelled) setSubcounties(list);
    });
    setSubcounty("");
    return () => {
      cancelled = true;
    };
  }, [county]);

  useEffect(() => {
    let cancelled = false;
    if (!subcounty) {
      setWards([]);
      setWard("");
      return;
    }
    listWards(subcounty, county).then((list) => {
      if (!cancelled) setWards(list);
    });
    setWard("");
    return () => {
      cancelled = true;
    };
  }, [subcounty, county]);

  const canStart = mode === "national" || Boolean(county);

  const start = () => {
    if (mode === "national") {
      onConfirm({ level: "national", county: "", subcounty: "", ward: "" });
    } else if (ward) {
      onConfirm({ level: "ward", county, subcounty, ward });
    } else if (subcounty) {
      onConfirm({ level: "subcounty", county, subcounty, ward: "" });
    } else {
      onConfirm({ level: "county", county, subcounty: "", ward: "" });
    }
  };

  return (
    <div className="area-select">
      <button className="area-select__back" onClick={onCancel}>
        ← All topics
      </button>

      <div className="area-select__head" style={{ "--accent": topic.ramp[1] }}>
        <span className="area-select__icon">{topic.icon}</span>
        <div>
          <div className="area-select__eyebrow">{topic.category}</div>
          <h1>{topic.label}</h1>
          <p>{topic.description}</p>
        </div>
      </div>

      <h2 className="area-select__title">Choose your area of interest</h2>

      <div className="area-options">
        <button
          type="button"
          className={`area-option${mode === "national" ? " is-active" : ""}`}
          onClick={() => setMode("national")}
        >
          <span className="area-option__badge">National</span>
          <span className="area-option__label">Whole country</span>
          <span className="area-option__desc">
            See the distribution across all 47 counties, then drill down on the
            map.
          </span>
        </button>

        <button
          type="button"
          className={`area-option${mode === "county" ? " is-active" : ""}`}
          onClick={() => setMode("county")}
        >
          <span className="area-option__badge">Focused</span>
          <span className="area-option__label">A specific county</span>
          <span className="area-option__desc">
            Jump straight to a county and its sub-counties for more concise data.
          </span>
        </button>
      </div>

      {mode === "county" && (
        <div className="area-pickers">
          <label>
            <span>County</span>
            <select value={county} onChange={(e) => setCounty(e.target.value)}>
              <option value="">Select a county…</option>
              {counties.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Sub-county (optional)</span>
            <select
              value={subcounty}
              onChange={(e) => setSubcounty(e.target.value)}
              disabled={!county || subcounties.length === 0}
            >
              <option value="">
                {county ? "All sub-counties" : "Select a county first"}
              </option>
              {subcounties.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Ward (optional)</span>
            <select
              value={ward}
              onChange={(e) => setWard(e.target.value)}
              disabled={!subcounty || wards.length === 0}
            >
              <option value="">
                {subcounty ? "All wards" : "Select a sub-county first"}
              </option>
              {wards.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="area-select__actions">
        <button className="btn" disabled={!canStart} onClick={start}>
          Open workspace →
        </button>
      </div>
    </div>
  );
}

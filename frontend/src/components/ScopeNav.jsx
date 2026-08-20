import React, { useEffect, useMemo, useState } from "react";
import { listCounties, listSubcounties, listWards } from "../utils/geo";

// Ordered administrative hierarchy. `field` is the scope key that must be set
// before the level can be entered; national has no prerequisite.
const LEVELS = [
  { id: "national", label: "National", field: null },
  { id: "county", label: "County", field: "county" },
  { id: "subcounty", label: "Sub-county", field: "subcounty" },
  { id: "ward", label: "Ward", field: "ward" },
];

// Scope with everything below `level` cleared, so switching up never leaves a
// stale child name behind.
function scopeAt(scope, level) {
  const idx = LEVELS.findIndex((l) => l.id === level);
  return {
    level,
    county: idx >= 1 ? scope.county : "",
    subcounty: idx >= 2 ? scope.subcounty : "",
    ward: idx >= 3 ? scope.ward : "",
  };
}

// Navigation bar for the map section: a level rail for vertical moves
// (National ⇄ County ⇄ Sub-county ⇄ Ward) and cascading pickers for lateral
// moves (Nairobi → Kisumu) without going back through the area chooser.
export default function ScopeNav({ scope, onScope }) {
  const counties = useMemo(() => listCounties(), []);
  const [subcounties, setSubcounties] = useState([]);
  const [wards, setWards] = useState([]);

  useEffect(() => {
    let cancelled = false;
    if (!scope.county) {
      setSubcounties([]);
      return;
    }
    listSubcounties(scope.county).then((list) => {
      if (!cancelled) setSubcounties(list);
    });
    return () => {
      cancelled = true;
    };
  }, [scope.county]);

  useEffect(() => {
    let cancelled = false;
    if (!scope.subcounty) {
      setWards([]);
      return;
    }
    listWards(scope.subcounty, scope.county).then((list) => {
      if (!cancelled) setWards(list);
    });
    return () => {
      cancelled = true;
    };
  }, [scope.subcounty, scope.county]);

  const currentIdx = LEVELS.findIndex((l) => l.id === scope.level);
  const parent = currentIdx > 0 ? LEVELS[currentIdx - 1] : null;
  const parentName =
    parent?.id === "national"
      ? "National"
      : parent?.id === "county"
      ? scope.county
      : scope.subcounty;

  const goUp = () => parent && onScope(scopeAt(scope, parent.id));

  // Backspace steps up one level, the way a file browser does. Ignored while
  // typing in a field so form input is never hijacked. (Escape is deliberately
  // left alone — it belongs to the report/payment modals.)
  useEffect(() => {
    if (!parent) return undefined;
    const onKey = (e) => {
      if (e.key !== "Backspace") return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.target?.isContentEditable) return;
      e.preventDefault();
      onScope(scopeAt(scope, parent.id));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scope, parent, onScope]);

  const pickCounty = (name) =>
    onScope(
      name
        ? { level: "county", county: name, subcounty: "", ward: "" }
        : { level: "national", county: "", subcounty: "", ward: "" },
    );

  const pickSubcounty = (name) =>
    onScope({
      level: name ? "subcounty" : "county",
      county: scope.county,
      subcounty: name,
      ward: "",
    });

  const pickWard = (name) =>
    onScope({
      level: name ? "ward" : "subcounty",
      county: scope.county,
      subcounty: scope.subcounty,
      ward: name,
    });

  return (
    <div className="scope-nav">
      <div className="scope-nav__row">
        <button
          type="button"
          className="scope-nav__up"
          onClick={goUp}
          disabled={!parent}
          title={parent ? `Up to ${parentName}` : "Already at the top level"}
        >
          ↑ Up
        </button>

        <div
          className="scope-levels"
          role="group"
          aria-label="Administrative level"
        >
          {LEVELS.map((l, i) => {
            const available = !l.field || Boolean(scope[l.field]);
            const active = scope.level === l.id;
            return (
              <button
                key={l.id}
                type="button"
                className={`scope-level${active ? " is-active" : ""}`}
                disabled={!available}
                aria-pressed={active}
                onClick={() => onScope(scopeAt(scope, l.id))}
                title={
                  available
                    ? `Show ${l.label.toLowerCase()} level`
                    : `Pick a ${LEVELS[i - 1].label.toLowerCase()} first`
                }
              >
                {l.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="scope-nav__pickers">
        <label className="scope-pick">
          <span>County</span>
          <select
            value={scope.county}
            onChange={(e) => pickCounty(e.target.value)}
          >
            <option value="">All counties · National</option>
            {counties.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="scope-pick">
          <span>Sub-county</span>
          <select
            value={scope.subcounty}
            onChange={(e) => pickSubcounty(e.target.value)}
            disabled={!scope.county || subcounties.length === 0}
          >
            <option value="">
              {scope.county ? "All sub-counties" : "Pick a county first"}
            </option>
            {subcounties.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="scope-pick">
          <span>Ward</span>
          <select
            value={scope.ward}
            onChange={(e) => pickWard(e.target.value)}
            disabled={!scope.subcounty || wards.length === 0}
          >
            <option value="">
              {scope.subcounty ? "All wards" : "Pick a sub-county first"}
            </option>
            {wards.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

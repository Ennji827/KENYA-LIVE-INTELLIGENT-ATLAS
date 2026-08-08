import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  regionValue,
  rampColor,
  formatValue,
  getTopic,
  dotColor as topicDotColor,
} from "../data/topics";
import { loadGeo, countiesUrl, loadRegionFeatures, nameKeyFor } from "../utils/geo";

// Kenya national bounds as a sensible default view.
const KENYA_CENTER = [0.23, 37.9];
const KENYA_ZOOM = 6;

// Selectable satellite/terrain base layers (Google tiles: lyrs s=satellite,
// y=hybrid imagery+labels, p=terrain+labels). Served across mt0–mt3 subdomains.
const BASE_LAYERS = {
  hybrid: {
    name: "Hybrid",
    url: "https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
    attribution: "&copy; Google",
  },
  satellite: {
    name: "Satellite",
    url: "https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
    attribution: "&copy; Google",
  },
  terrain: {
    name: "Terrain",
    url: "https://{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}",
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
    attribution: "&copy; Google",
  },
};
const BASE_ORDER = ["hybrid", "satellite", "terrain"];

// Is there room beside the map for chrome to sit open?
//
// Read once, as the initial value of the panels' open state, rather than
// tracked continuously: it decides a *default*, and re-deriving it on resize
// would reopen a panel the visitor had deliberately closed.
const roomForOpenChrome = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(min-width: 1024px)").matches;

// ── Icons ────────────────────────────────────────────────────────────
const LayersIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5" />
  </svg>
);

const ExpandIcon = ({ on }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {on ? (
      <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
    ) : (
      <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
    )}
  </svg>
);

// Extent of a feature or collection, walked straight over the coordinate
// arrays.
//
// This used to build a throwaway `L.geoJSON(target)` just to call getBounds()
// on it. That instantiates a complete second set of Leaflet paths — every ring
// of every polygon turned into LatLng objects — purely to read four numbers.
// Cheap for one sub-county; at national level it is all 47 counties as
// MultiPolygons out of a 4.6 MB file, on top of the layer Leaflet is already
// building for the choropleth, and the resulting main-thread stall is what made
// the map appear to lose its boundaries every time it went back up to national.
// A numeric walk over the same coordinates costs a fraction of that.
function boundsOf(geojson) {
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;

  const visit = (coords) => {
    if (typeof coords[0] === "number") {
      const [lon, lat] = coords;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (let i = 0; i < coords.length; i += 1) visit(coords[i]);
  };

  const features =
    geojson.type === "FeatureCollection" ? geojson.features : [geojson];
  features.forEach((feature) => {
    const coordinates = feature?.geometry?.coordinates;
    if (Array.isArray(coordinates) && coordinates.length) visit(coordinates);
  });

  if (minLat > maxLat || minLon > maxLon) return null;
  return L.latLngBounds([minLat, minLon], [maxLat, maxLon]);
}

// Fit the map to whatever is currently in focus: a single selected region when
// one is chosen (so clicking a name zooms into that sub-county), otherwise the
// whole rendered collection.
function FitBounds({ geojson, selectedRegion, nameKey }) {
  const map = useMap();
  useEffect(() => {
    if (!geojson) return;
    try {
      let target = geojson;
      if (selectedRegion) {
        const feature = geojson.features.find(
          (f) => f.properties?.[nameKey] === selectedRegion,
        );
        if (feature) target = feature;
      }
      const bounds = boundsOf(target);
      if (bounds && bounds.isValid()) {
        // Cap the zoom when focusing a single region so small sub-counties
        // don't snap to an extreme street-level zoom.
        map.fitBounds(bounds, {
          padding: [20, 20],
          maxZoom: selectedRegion ? 11 : undefined,
        });
      }
    } catch {
      // Keep the default view if bounds cannot be computed.
    }
  }, [geojson, selectedRegion, nameKey, map]);
  return null;
}

// Dedicated pane for the dot layer, above the choropleth (overlayPane, z 400)
// but below markers (z 600).
const DOT_PANE = "facility-dots";

// Individual facility locations drawn over the choropleth.
//
// Built imperatively rather than as react-leaflet <CircleMarker> elements: a
// national school view is ~12,000 dots, and putting that many components
// through React's reconciler on every scope change is far more expensive than
// letting Leaflet own them. They share one canvas renderer for the same
// reason — 12,000 SVG nodes would stall the browser.
//
// The pane is explicitly `pointer-events: none`. Leaflet gives a canvas
// renderer's container pointer events by default (only SVG paths opt out
// unless they carry .leaflet-interactive), so a canvas stacked over the
// choropleth silently eats every click — including click-to-drill, since the
// region paths are siblings rather than ancestors and never see the event.
// Letting the layer stay purely visual keeps region hover, tooltips and
// drill-down working exactly as they do without it.
function FacilityDots({ points, color, show }) {
  const map = useMap();
  useEffect(() => {
    if (!show || !points?.length) return undefined;

    let pane = map.getPane(DOT_PANE);
    if (!pane) {
      pane = map.createPane(DOT_PANE);
      pane.style.zIndex = 450;
    }
    pane.style.pointerEvents = "none";

    const renderer = L.canvas({ padding: 0.5, pane: DOT_PANE });
    const group = L.layerGroup();

    points.forEach(([lon, lat]) => {
      if (typeof lon !== "number" || typeof lat !== "number") return;
      L.circleMarker([lat, lon], {
        renderer,
        pane: DOT_PANE,
        interactive: false,
        radius: 3.5,
        weight: 1,
        color: "#0f172a",
        opacity: 0.85,
        fillColor: color,
        fillOpacity: 0.9,
      }).addTo(group);
    });

    group.addTo(map);
    return () => {
      map.removeLayer(group);
    };
  }, [map, points, color, show]);
  return null;
}

// The map sizes to the viewport now rather than a fixed 520px, so its
// container height changes on window resize, panel reflow and entering or
// leaving fullscreen. Leaflet caches its container size and does not observe
// that itself — without this the tiles render as grey bands until the next pan
// or zoom.
function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

// Fullscreen for an arbitrary element, tracking the *browser's* idea of what is
// fullscreen rather than a local boolean — pressing Escape or the OS chrome
// exits without going through our button, and a local flag would then be wrong.
function useFullscreen(ref) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sync = () =>
      setActive(
        Boolean(document.fullscreenElement || document.webkitFullscreenElement),
      );
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  const toggle = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const isOn = document.fullscreenElement || document.webkitFullscreenElement;
    if (isOn) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    } else {
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    }
  }, [ref]);

  // iOS Safari has no element fullscreen at all; hide the control rather than
  // offering one that silently does nothing.
  const supported =
    typeof document !== "undefined" &&
    Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);

  return { active, toggle, supported };
}

// Colour key for the choropleth.
//
// The map has always coloured regions on a per-view ramp with no key at all,
// which makes a shaded map unreadable: a visitor can see that Turkana is darker
// than Nyeri but not what either value is, and the scale silently re-fits on
// every drill so the same colour means something different one level down.
// This states the two ends and the unit, and says that the scale is relative to
// what is currently on screen.
function MapLegend({ topic, topicId, min, max, dotColor, coverage, live }) {
  // Open on a desktop where it costs a corner; collapsed to its title bar on a
  // phone, where it would otherwise cover a fifth of the map.
  const [open, setOpen] = useState(roomForOpenChrome);
  const [lo, hi] = topic?.ramp || ["#e2e8f0", "#64748b"];
  const hasScale = Number.isFinite(min) && Number.isFinite(max) && max > min;

  return (
    <div className={`map-legend${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="map-legend__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="map-legend__title">{topic?.metricLabel || "Legend"}</span>
        <span className="map-legend__caret" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div className="map-legend__body">
          <div
            className="map-legend__ramp"
            style={{ background: `linear-gradient(90deg, ${lo}, ${hi})` }}
            aria-hidden="true"
          />
          <div className="map-legend__scale">
            <span className="u-num">
              {hasScale ? formatValue(topicId, min) : "—"}
            </span>
            <span className="u-num">
              {hasScale ? formatValue(topicId, max) : "—"}
            </span>
          </div>
          <p className="map-legend__note">
            Scale fits the regions currently in view
            {live ? ` · ${live}` : ""}
          </p>

          {/* The point layer's key lives here rather than as a second floating
              caption: the old bottom-right caption sat on top of the zoom
              control and the Leaflet attribution on anything narrower than a
              desktop. It also states when the national view was thinned, which
              is the difference between "there are 11,980 schools" and "11,980
              of them are drawn". */}
          {coverage?.returned > 0 && (
            <div className="map-legend__key">
              <span
                className="map-legend__swatch"
                style={{ background: dotColor }}
                aria-hidden="true"
              />
              <span>
                <span className="u-num">
                  {coverage.returned.toLocaleString()}
                </span>
                {coverage.truncated ? (
                  <>
                    {" of "}
                    <span className="u-num">
                      {coverage.in_scope.toLocaleString()}
                    </span>{" "}
                    {topic?.label?.toLowerCase() || "facility"} locations drawn —
                    drill in for all of them
                  </>
                ) : (
                  <> {topic?.label?.toLowerCase() || "facility"} locations</>
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TopicMap({
  topicId,
  level, // "national" | "county" | "subcounty"
  county, // parent county name when level === "county" or "subcounty"
  subcounty, // parent sub-county name when level === "subcounty" (renders wards)
  selectedRegion,
  onDrill,
  onRegionsLoaded,
  liveValues, // optional { [regionName]: number } overriding scaffolded values
  overlayTile, // optional { url, opacity, unit } Earth Engine raster overlay
  facilityPoints, // optional { points, categories, coverage } dot layer
  dotColor, // optional override; defaults to the topic's own registry colour
  liveLabel, // optional "Live · <source>" string, surfaced in the legend
}) {
  const topic = getTopic(topicId);
  // One registry is drawn at a time, so the dot colour identifies *which*
  // network is on screen — police cyan, schools amber, and so on.
  const activeDotColor = dotColor || topicDotColor(topicId);
  // The GEE raster underlays the choropleth (tiles sit below the vector pane),
  // so region colours + tooltips stay on top and clickable. Toggle to compare
  // the smooth per-pixel distribution against the per-region aggregate.
  const [showOverlay, setShowOverlay] = useState(true);
  // Facility dots default on: for the registry topics they are the point of
  // the view, showing where things actually are rather than only how many.
  const [showDots, setShowDots] = useState(true);
  // Layer controls live in a popover behind the layers button. It starts open
  // on a desktop, where it costs a corner of a large map, and closed on
  // smaller screens, where an always-on control rail is wider than the map.
  const [layersOpen, setLayersOpen] = useState(roomForOpenChrome);
  // The geometry currently drawn, tagged with the area it came from. The tag
  // does two things: it lets the shapes already on screen stay there until the
  // next area's features have actually arrived — so a navigation never leaves
  // the map empty — and it guarantees the name key used to read a feature always
  // matches the level that feature came from, instead of the two disagreeing for
  // a frame while a load is in flight.
  const [view, setView] = useState(null); // { level, county, subcounty, data }
  const [loading, setLoading] = useState(true);
  // The full set of county boundaries, kept as a persistent context outline so
  // the national extent stays visible even when drilled into a single county.
  const [outlineGeo, setOutlineGeo] = useState(null);
  const [error, setError] = useState(null);
  const [baseLayer, setBaseLayer] = useState("hybrid");
  const base = BASE_LAYERS[baseLayer];
  const onRegionsLoadedRef = useRef(onRegionsLoaded);
  onRegionsLoadedRef.current = onRegionsLoaded;

  const shellRef = useRef(null);
  const fullscreen = useFullscreen(shellRef);

  const geojson = view?.data || null;
  // Read from the level the drawn features belong to, not the requested one.
  const nameKey = nameKeyFor(view?.level || level); // subcounty renders wards

  // Load the national county outline once; it underlays every drill level.
  useEffect(() => {
    let cancelled = false;
    loadGeo(countiesUrl())
      .then((data) => {
        if (!cancelled) setOutlineGeo(data);
      })
      .catch(() => {
        /* Outline is contextual only; ignore load failures. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Prefer a live value for a region when one is available; otherwise fall
  // back to the deterministic scaffolded value from topics.js.
  const valueFor = (name) => {
    const live = liveValues?.[name];
    return typeof live === "number" ? live : regionValue(topicId, name);
  };

  // Boundary geometry for the current area. Keyed strictly on *where* we are —
  // never on the topic or its values. A refreshed value feed must not be able
  // to unmount the shapes: navigating up a level refires the (slow) metric
  // request, and folding that into this effect blanked the map until it
  // resolved. It also means an upward move that renders the same features
  // (ward -> sub-county) now keeps the existing geometry untouched.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);

    loadRegionFeatures({ level, county, subcounty })
      .then((features) => {
        if (cancelled) return;
        setLoading(false);
        if (!features.length) {
          // Say so rather than rendering a silently empty map. The previous
          // area stays drawn, so this reads as "that lookup found nothing"
          // instead of wiping the map.
          setError(
            `No boundaries found for ${subcounty || county || "this area"}`,
          );
          return;
        }
        setView({
          level,
          county: county || "",
          subcounty: subcounty || "",
          data: { type: "FeatureCollection", features },
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setLoading(false);
        setError(err.message || "Unable to load boundaries");
      });

    return () => {
      cancelled = true;
    };
  }, [level, county, subcounty]);

  // Ranked region list for the panels alongside the map. Recomputed when the
  // geometry changes *or* when live values land, without disturbing what is
  // currently drawn.
  useEffect(() => {
    if (!geojson || !onRegionsLoadedRef.current) return;
    const regions = geojson.features
      .map((f) => {
        const name = f.properties?.[nameKey];
        return { name, value: valueFor(name) };
      })
      .filter((r) => r.name)
      .sort((a, b) => b.value - a.value);
    onRegionsLoadedRef.current(regions);
  }, [geojson, nameKey, topicId, liveValues]);

  // Colour scale bounds for the currently visible features.
  const [min, max] = useMemo(() => {
    if (!geojson) return [0, 1];
    const values = geojson.features
      .map((f) => valueFor(f.properties?.[nameKey]))
      .filter((v) => typeof v === "number");
    if (!values.length) return [0, 1];
    return [Math.min(...values), Math.max(...values)];
  }, [geojson, topicId, nameKey, liveValues]);

  const styleFeature = (feature) => {
    const name = feature.properties?.[nameKey];
    const value = valueFor(name);
    const isSelected = selectedRegion && name === selectedRegion;
    return {
      fillColor: rampColor(topicId, value, min, max),
      weight: isSelected ? 3 : 1,
      color: isSelected ? "#0f172a" : "#e2e8f0",
      fillOpacity: 0.6,
      dashArray: isSelected ? "" : "0",
    };
  };

  // What a click does depends on the level, so the tooltip says it rather than
  // leaving the visitor to discover that regions are clickable at all.
  const drillHint =
    level === "national"
      ? "Click to open county"
      : level === "county"
        ? "Click to open sub-county"
        : "Click to focus ward";

  const onEachFeature = (feature, layer) => {
    const name = feature.properties?.[nameKey];
    const value = valueFor(name);
    layer.bindTooltip(
      `<span class="map-tip__name">${name}</span>` +
        `<span class="map-tip__value">${formatValue(topicId, value)}</span>` +
        `<span class="map-tip__hint">${drillHint}</span>`,
      { sticky: true, className: "map-tip", direction: "top", opacity: 1 },
    );
    layer.on({
      click: () => onDrill && onDrill(name),
      mouseover: (e) => e.target.setStyle({ weight: 3, color: "#0f172a" }),
      mouseout: (e) => e.target.setStyle(styleFeature(feature)),
    });
  };

  const hasDots = facilityPoints?.points?.length > 0;
  const hasOverlay = Boolean(overlayTile?.url);

  return (
    <div className="map-shell" ref={shellRef}>
      {/* ── Controls ──────────────────────────────────────────────
          One toolbar holding the base-map rail and the overlay
          toggles. From tablet up it sits open over the map's top-
          right corner; on a phone it is a panel behind the Layers
          button, because a three-way rail plus two toggles is wider
          than the map itself at 360px. */}
      <div className="map-controls">
        <button
          type="button"
          className={`map-btn map-btn--icon map-controls__trigger${layersOpen ? " is-active" : ""}`}
          onClick={() => setLayersOpen((v) => !v)}
          aria-expanded={layersOpen}
          aria-controls="map-layers"
        >
          <LayersIcon />
          <span className="u-sr">Map layers</span>
        </button>

        <div
          id="map-layers"
          className={`map-controls__panel${layersOpen ? " is-open" : ""}`}
        >
          <div className="map-control-group">
            <span className="u-eyebrow map-control-group__label">Base map</span>
            <div className="map-seg" role="group" aria-label="Base map style">
              {BASE_ORDER.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`map-seg__btn${baseLayer === key ? " is-active" : ""}`}
                  onClick={() => setBaseLayer(key)}
                  aria-pressed={baseLayer === key}
                >
                  {BASE_LAYERS[key].name}
                </button>
              ))}
            </div>
          </div>

          {(hasDots || hasOverlay) && (
            <div className="map-control-group">
              <span className="u-eyebrow map-control-group__label">Overlays</span>
              <div className="map-toggles">
                {hasDots && (
                  <button
                    type="button"
                    className={`map-toggle${showDots ? " is-active" : ""}`}
                    onClick={() => setShowDots((v) => !v)}
                    aria-pressed={showDots}
                    title={`${facilityPoints.points.length.toLocaleString()} ${topic?.label || "facility"} locations`}
                  >
                    <span
                      className="map-legend__swatch"
                      style={{ background: activeDotColor }}
                      aria-hidden="true"
                    />
                    Locations
                  </button>
                )}
                {hasOverlay && (
                  <button
                    type="button"
                    className={`map-toggle${showOverlay ? " is-active" : ""}`}
                    onClick={() => setShowOverlay((v) => !v)}
                    aria-pressed={showOverlay}
                    title="Google Earth Engine raster layer"
                  >
                    <span className="map-toggle__raster" aria-hidden="true" />
                    Satellite raster
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {fullscreen.supported && (
          <button
            type="button"
            className={`map-btn map-btn--icon${fullscreen.active ? " is-active" : ""}`}
            onClick={fullscreen.toggle}
            aria-pressed={fullscreen.active}
          >
            <ExpandIcon on={fullscreen.active} />
            <span className="u-sr">
              {fullscreen.active ? "Exit fullscreen" : "View map fullscreen"}
            </span>
          </button>
        )}
      </div>

      <MapContainer
        center={KENYA_CENTER}
        zoom={KENYA_ZOOM}
        scrollWheelZoom
        zoomControl={false}
        style={{ height: "100%", width: "100%", background: "#0b1b2b" }}
      >
        <InvalidateOnResize />
        {/* Moved off the top-left default: the scope rail and the status pill
            both live up there, and three stacked chrome elements in one corner
            is where the old layout ran out of room on a tablet. */}
        <ZoomControlAt position="bottomright" />
        <TileLayer
          key={baseLayer}
          url={base.url}
          subdomains={base.subdomains}
          attribution={base.attribution}
          maxZoom={20}
        />
        {/* Earth Engine raster overlay: rendered in the tile pane (below the
            vector choropleth), so region fills and tooltips remain on top. */}
        {hasOverlay && showOverlay && (
          <TileLayer
            key={overlayTile.url}
            url={overlayTile.url}
            opacity={overlayTile.opacity ?? 0.7}
            attribution="&copy; Google Earth Engine"
            zIndex={250}
          />
        )}
        {/* Persistent national county outline: rendered first (underneath) and
            non-interactive, so drilling into one county never hides the rest of
            the country's boundaries. Drawn at *every* level, national included:
            it is loaded once and never re-created, so it is the one layer that
            cannot be mid-reload, and keeping it means there is always a boundary
            on screen no matter what the choropleth above it is doing. At national
            it sits exactly under the choropleth's own county strokes. */}
        {outlineGeo && (
          <GeoJSON
            key="national-outline"
            data={outlineGeo}
            interactive={false}
            style={{
              fillOpacity: 0,
              color: "#f8fafc",
              weight: 1,
              opacity: 0.65,
            }}
          />
        )}
        {geojson && (
          <>
            <GeoJSON
              key={`${topicId}:${view.level}:${view.county || "national"}:${view.subcounty}:${selectedRegion || ""}`}
              data={geojson}
              style={styleFeature}
              onEachFeature={onEachFeature}
            />
            <FitBounds
              geojson={geojson}
              selectedRegion={selectedRegion}
              nameKey={nameKey}
            />
          </>
        )}
        <FacilityDots
          points={facilityPoints?.points}
          color={activeDotColor}
          show={showDots}
        />
      </MapContainer>

      {/* Colour key + point-layer key, bottom left. */}
      <MapLegend
        topic={topic}
        topicId={topicId}
        min={min}
        max={max}
        dotColor={activeDotColor}
        coverage={showDots ? facilityPoints?.coverage : null}
        live={liveLabel}
      />

      {/* Status reads as a small corner pill, never a sheet over the map. The
          previous version covered the whole map with a translucent panel while
          boundaries loaded, which hid the imagery and — being an ordinary div
          stacked above Leaflet's panes — swallowed every click and scroll until
          it went away. */}
      {(error || loading) && (
        <div
          className={`map-status${error ? " map-status--error" : ""}`}
          role="status"
        >
          {!error && <span className="map-status__spinner" aria-hidden="true" />}
          {error || "Loading boundaries…"}
        </div>
      )}
    </div>
  );
}

// react-leaflet v4 removed the `zoomControlPosition` prop, so the control is
// added by hand once the map exists.
function ZoomControlAt({ position }) {
  const map = useMap();
  useEffect(() => {
    const control = L.control.zoom({ position });
    control.addTo(map);
    return () => control.remove();
  }, [map, position]);
  return null;
}

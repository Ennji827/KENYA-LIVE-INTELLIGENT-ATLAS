import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { regionValue, rampColor, formatValue } from "../data/topics";
import { loadGeo, countiesUrl, subcountiesUrl, wardsUrl } from "../utils/geo";

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
      const layer = L.geoJSON(target);
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
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
}) {
  // The GEE raster underlays the choropleth (tiles sit below the vector pane),
  // so region colours + tooltips stay on top and clickable. Toggle to compare
  // the smooth per-pixel distribution against the per-region aggregate.
  const [showOverlay, setShowOverlay] = useState(true);
  const [geojson, setGeojson] = useState(null);
  // The full set of county boundaries, kept as a persistent context outline so
  // the national extent stays visible even when drilled into a single county.
  const [outlineGeo, setOutlineGeo] = useState(null);
  const [error, setError] = useState(null);
  const [baseLayer, setBaseLayer] = useState("hybrid");
  const base = BASE_LAYERS[baseLayer];
  const onRegionsLoadedRef = useRef(onRegionsLoaded);
  onRegionsLoadedRef.current = onRegionsLoaded;

  const nameKey =
    level === "national"
      ? "ADM1_EN"
      : level === "county"
      ? "ADM2_EN"
      : "ADM3_EN"; // subcounty level renders wards

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

  useEffect(() => {
    let cancelled = false;
    setGeojson(null);
    setError(null);

    const url =
      level === "national"
        ? countiesUrl()
        : level === "county"
        ? subcountiesUrl()
        : wardsUrl();

    loadGeo(url)
      .then((data) => {
        if (cancelled) return;
        let features = data.features;
        if (level === "county") {
          features = features.filter(
            (f) => f.properties?.ADM1_EN === county,
          );
        } else if (level === "subcounty") {
          features = features.filter(
            (f) => f.properties?.ADM2_EN === subcounty,
          );
        }
        const filtered = { type: "FeatureCollection", features };
        setGeojson(filtered);

        const regions = features
          .map((f) => {
            const name = f.properties?.[nameKey];
            return { name, value: valueFor(name) };
          })
          .filter((r) => r.name)
          .sort((a, b) => b.value - a.value);
        if (onRegionsLoadedRef.current) onRegionsLoadedRef.current(regions);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Unable to load boundaries");
      });

    return () => {
      cancelled = true;
    };
    // liveValues included so regions recompute when live data arrives.
  }, [topicId, level, county, subcounty, nameKey, liveValues]);

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

  const onEachFeature = (feature, layer) => {
    const name = feature.properties?.[nameKey];
    const value = valueFor(name);
    layer.bindTooltip(
      `<strong>${name}</strong><br/>${formatValue(topicId, value)}`,
      { sticky: true },
    );
    layer.on({
      click: () => onDrill && onDrill(name),
      mouseover: (e) => e.target.setStyle({ weight: 3, color: "#0f172a" }),
      mouseout: (e) => e.target.setStyle(styleFeature(feature)),
    });
  };

  return (
    <div className="topic-map">
      <div className="topic-map__layers" role="group" aria-label="Base map style">
        {BASE_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            className={`topic-map__layer-btn${baseLayer === key ? " is-active" : ""}`}
            onClick={() => setBaseLayer(key)}
            aria-pressed={baseLayer === key}
          >
            {BASE_LAYERS[key].name}
          </button>
        ))}
        {overlayTile?.url && (
          <button
            type="button"
            className={`topic-map__layer-btn${showOverlay ? " is-active" : ""}`}
            onClick={() => setShowOverlay((v) => !v)}
            aria-pressed={showOverlay}
            title="Google Earth Engine raster layer"
          >
            GEE layer
          </button>
        )}
      </div>
      <MapContainer
        center={KENYA_CENTER}
        zoom={KENYA_ZOOM}
        scrollWheelZoom
        style={{ height: "100%", width: "100%", background: "#0b1b2b" }}
      >
        <TileLayer
          key={baseLayer}
          url={base.url}
          subdomains={base.subdomains}
          attribution={base.attribution}
          maxZoom={20}
        />
        {/* Earth Engine raster overlay: rendered in the tile pane (below the
            vector choropleth), so region fills and tooltips remain on top. */}
        {overlayTile?.url && showOverlay && (
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
            the country's boundaries. Skipped at national level, where the
            choropleth already draws every county. */}
        {outlineGeo && level !== "national" && (
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
              key={`${topicId}:${level}:${county || "national"}:${subcounty || ""}:${selectedRegion || ""}`}
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
      </MapContainer>
      {error && <div className="topic-map__error">{error}</div>}
      {!geojson && !error && (
        <div className="topic-map__loading">Loading boundaries…</div>
      )}
    </div>
  );
}

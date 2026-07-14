import React, { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { regionValue, rampColor, formatValue } from "../data/topics";
import { loadGeo, countiesUrl, subcountiesUrl } from "../utils/geo";

// Kenya national bounds as a sensible default view.
const KENYA_CENTER = [0.23, 37.9];
const KENYA_ZOOM = 6;

// Fit the map to whatever layer is currently rendered.
function FitBounds({ geojson }) {
  const map = useMap();
  useEffect(() => {
    if (!geojson) return;
    try {
      const layer = L.geoJSON(geojson);
      const bounds = layer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
    } catch {
      // Keep the default view if bounds cannot be computed.
    }
  }, [geojson, map]);
  return null;
}

export default function TopicMap({
  topicId,
  level, // "national" | "county"
  county, // parent county name when level === "county"
  selectedRegion,
  onDrill,
  onRegionsLoaded,
  liveValues, // optional { [regionName]: number } overriding scaffolded values
}) {
  const [geojson, setGeojson] = useState(null);
  const [error, setError] = useState(null);
  const onRegionsLoadedRef = useRef(onRegionsLoaded);
  onRegionsLoadedRef.current = onRegionsLoaded;

  const nameKey = level === "national" ? "ADM1_EN" : "ADM2_EN";

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

    const url = level === "national" ? countiesUrl() : subcountiesUrl();

    loadGeo(url)
      .then((data) => {
        if (cancelled) return;
        let features = data.features;
        if (level === "county") {
          features = features.filter(
            (f) => f.properties?.ADM1_EN === county,
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
  }, [topicId, level, county, nameKey, liveValues]);

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
      color: isSelected ? "#0f172a" : "#94a3b8",
      fillOpacity: 0.75,
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
      <MapContainer
        center={KENYA_CENTER}
        zoom={KENYA_ZOOM}
        scrollWheelZoom
        style={{ height: "100%", width: "100%", background: "#dbeafe" }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap contributors'
          opacity={0.35}
        />
        {geojson && (
          <>
            <GeoJSON
              key={`${topicId}:${level}:${county || "national"}:${selectedRegion || ""}`}
              data={geojson}
              style={styleFeature}
              onEachFeature={onEachFeature}
            />
            <FitBounds geojson={geojson} />
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

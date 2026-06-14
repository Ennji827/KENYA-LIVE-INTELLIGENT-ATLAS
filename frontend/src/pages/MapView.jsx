import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import LiveMap from "../components/maps/LiveMap";
import LiveWeatherForecastPanel from "../components/LiveWeatherForecastPanel";
import useAEISStore from "../store/useAEISStore";
import { getCountyByName } from "../data/sampleDashboardData";

function readLocalFarms() {
  try {
    const saved = localStorage.getItem("aeis_farms");
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    return [];
  }
}

export default function MapView({ filter }) {
  const [baseMap, setBaseMap] = useState("street");
  const [drawMode, setDrawMode] = useState(false);
  const [farms, setFarms] = useState(() => readLocalFarms());
  const [mapInstance, setMapInstance] = useState(null);
  const [gpsStatus, setGpsStatus] = useState("GPS ready");
  const gpsMarkerRef = useRef(null);
  const selectedCounty = getCountyByName(filter?.county);

  const layers = useAEISStore((state) => state.layers);
  const setLayerVisibility = useAEISStore((state) => state.setLayerVisibility);
  const fetchGeoJSONData = useAEISStore((state) => state.fetchGeoJSONData);
  const loadingGeoJSON = useAEISStore((state) => state.loadingGeoJSON);
  const geoJSONError = useAEISStore((state) => state.geoJSONError);

  useEffect(() => {
    fetchGeoJSONData();
  }, [fetchGeoJSONData]);

  useEffect(() => {
    localStorage.setItem("aeis_farms", JSON.stringify(farms));
  }, [farms]);

  const liveLayerControls = useMemo(
    () => [
      { key: "counties", label: "Counties" },
      { key: "subcounties", label: "Sub-counties" },
      { key: "wards", label: "Wards" },
      { key: "nasaTrueColor", label: "NASA true color" },
      { key: "nasaNdvi", label: "NASA NDVI" },
      { key: "nasaLst", label: "NASA LST" },
      { key: "geeNdvi", label: "GEE NDVI" },
      { key: "geeNdwi", label: "GEE NDWI" },
      { key: "geeLst", label: "GEE LST" },
      { key: "segmentation", label: "Mapped features" },
    ],
    []
  );

  const locateUser = () => {
    if (!navigator.geolocation) {
      setGpsStatus("GPS is not available in this browser.");
      return;
    }

    setGpsStatus("Checking GPS...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latlng = [position.coords.latitude, position.coords.longitude];
        if (mapInstance) {
          mapInstance.setView(latlng, 13);
          if (gpsMarkerRef.current) {
            gpsMarkerRef.current.setLatLng(latlng);
          } else {
            gpsMarkerRef.current = L.marker(latlng).addTo(mapInstance).bindPopup("Current GPS location");
          }
        }
        setGpsStatus(`GPS located: ${latlng[0].toFixed(5)}, ${latlng[1].toFixed(5)}`);
      },
      (error) => setGpsStatus(error.message || "GPS permission denied."),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <>
      <div className="aeis-topbar">
        <div>
          <div className="aeis-kicker">Map intelligence</div>
          <h1 className="aeis-title">AEIS-K Map Intelligence</h1>
          <p className="aeis-subtitle">
            Existing Leaflet boundaries, farm mapping, and GPS tools are preserved here, with live public NASA GIBS true-color, NDVI, and land-surface-temperature imagery available as map overlays.
          </p>
        </div>
        <div className="aeis-status-pill">
          {filter.county ? `${filter.county} / ${filter.ward}` : "National map view"}
        </div>
      </div>

      <div className="aeis-card aeis-map-card">
        <div className="aeis-map-toolbar">
          <select value={baseMap} onChange={(event) => setBaseMap(event.target.value)} className="aeis-layer-chip">
            <option value="street">Street basemap</option>
            <option value="satellite">Satellite basemap</option>
            <option value="hybrid">Hybrid basemap</option>
          </select>
          <button type="button" className={`aeis-layer-chip ${drawMode ? "active" : ""}`} onClick={() => setDrawMode((value) => !value)}>
            Farm drawing
          </button>
          <button type="button" className="aeis-layer-chip" onClick={locateUser}>
            Locate GPS
          </button>
          {liveLayerControls.map((layer) => (
            <button
              key={layer.key}
              type="button"
              className={`aeis-layer-chip ${layers[layer.key] ? "active" : ""}`}
              onClick={() => {
                const providerLayer = layer.key.startsWith("nasa") || layer.key.startsWith("gee");
                if (providerLayer) setBaseMap("satellite");
                if (providerLayer) {
                  ["nasaTrueColor", "nasaNdvi", "nasaLst", "geeNdvi", "geeNdwi", "geeLst"].forEach((key) => {
                    setLayerVisibility(key, key === layer.key ? !layers[layer.key] : false);
                  });
                  return;
                }
                setLayerVisibility(layer.key, !layers[layer.key]);
              }}
            >
              {layer.label}
            </button>
          ))}
        </div>
        <div className="aeis-map-toolbar" style={{ color: "#64748b", fontWeight: 800 }}>
          {loadingGeoJSON ? "Loading admin boundaries..." : geoJSONError || gpsStatus}
        </div>
        <div className="aeis-map-wrap">
          <LiveMap
            baseMap={baseMap}
            drawMode={drawMode}
            farms={farms}
            onMapReady={setMapInstance}
            onFarmCreated={(farm) => setFarms((current) => [...current, farm])}
            dashboardMode
            mapHeight="560px"
          />
        </div>
      </div>
      <div style={{ height: 16 }} />
      <LiveWeatherForecastPanel countyName={selectedCounty?.name || ""} />
    </>
  );
}

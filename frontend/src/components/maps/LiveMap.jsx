import React, { useEffect, useCallback, useState, useRef } from "react";
import { MapContainer, Pane, TileLayer, WMSTileLayer, useMap, ScaleControl, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet-draw";
import * as turf from '@turf/turf'; // Needed for spatial queries
import useAEISStore from "../../store/useAEISStore";

import TopBar from "../Ui/TopBar";
import LayerManager from "../Ui/LayerManager"; // Assuming this is correct
import InfoPanel from "../Ui/InfoPanel";

import CountyLayer from "./CountyLayer";
import CountyCodeLabels from "./CountyCodeLabels";
import BoundaryLabels from "./BoundaryLabels";
import SubCountyLayer from "./SubCountyLayer";
import WardLayer from "./WardLayer";
import SegmentationLayer from "./SegmentationLayer";
import { getApiBase } from "../../utils/api";
import {
  countyName,
  sameCounty,
  sameSubCounty,
  subCountyCode,
  wardCode,
  wardName,
} from "../../utils/boundaries";

window.L = L;
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

const COLORS = {
  farm: { color: '#22c55e', weight: 3, fillOpacity: 0.3 }
};

const baseMaps = {
  street: {
    name: "OpenStreetMap",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  satellite: {
    name: "World imagery",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Esri, Maxar, Earthstar Geographics, and contributors",
  },
  terrain: {
    name: "OpenTopoMap",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: 'Map data &copy; OpenStreetMap contributors, map style &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
  },
};

const DAY_MS = 24 * 60 * 60 * 1000;

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function safeDailyGibsDate(lagDays) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - lagDays);
  return formatIsoDate(date);
}

function safeModis8DayDate(lagDays = 4) {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - lagDays);

  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const offset = Math.max(0, Math.floor((date.getTime() - yearStart) / DAY_MS));
  const cycleOffset = Math.floor(offset / 8) * 8;
  return formatIsoDate(new Date(yearStart + cycleOffset * DAY_MS));
}

const latestGibsDates = {
  trueColor: safeDailyGibsDate(2),
  ndvi: safeModis8DayDate(4),
  lst: safeDailyGibsDate(3),
};

const realImageryLayers = {
  nasaTrueColor: {
    label: "NASA MODIS true color",
    date: latestGibsDates.trueColor,
    opacity: 0.82,
    maxNativeZoom: 9,
    url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${latestGibsDates.trueColor}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg`,
    attribution: "NASA GIBS",
  },
  nasaNdvi: {
    label: "NASA MODIS NDVI 8-day",
    date: latestGibsDates.ndvi,
    opacity: 0.72,
    maxNativeZoom: 9,
    url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDVI_8Day/default/${latestGibsDates.ndvi}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`,
    attribution: "NASA GIBS",
  },
  nasaLst: {
    label: "NASA MODIS LST day",
    date: latestGibsDates.lst,
    opacity: 0.68,
    maxNativeZoom: 7,
    url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Land_Surface_Temp_Day/default/${latestGibsDates.lst}/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`,
    attribution: "NASA GIBS",
  },
};

function MapBinder({ onReady }) {
  const map = useMap();

  useEffect(() => {
    onReady(map);
  }, [map, onReady]);

  return null;
}

/**
 * Internal helper to track map zoom level changes
 */
function ZoomHandler({ onZoomChange }) {
  const map = useMapEvents({
    zoomend: () => {
      onZoomChange(map.getZoom());
    }
  });
  return null;
}

const NorthArrow = () => {
  return (
    <div className="leaflet-top leaflet-left" style={{ marginTop: '220px', marginLeft: '10px' }}>
      <div className="leaflet-control" style={{ 
        background: 'none', 
        border: 'none', 
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        color: '#1b5e20',
        textShadow: '0 0 4px white'
      }}>
        <div style={{ fontWeight: 'bold', fontSize: '12px' }}>N</div>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L4.5 20.29L5.21 21L12 18L18.79 21L19.5 20.29L12 2Z" />
        </svg>
      </div>
    </div>
  );
};

export default function LiveMap({ 
  baseMap = 'street', 
  drawMode = false, 
  farms = [], 
  onFarmCreated,
  onMapReady,
  dashboardMode = false,
  accessCountyName = "",
  segmentClass = "buildings",
  onSegmentationStats,
  mapHeight = "100vh",
  hoverSelectEnabled = false,
  onCountySelect,
  onSubCountySelect,
  onWardSelect,
}) {
  const [map, setMap] = useState(null);
  const [currentZoom, setCurrentZoom] = useState(6);
  const [geeConfig, setGeeConfig] = useState(null);
  const [landsatLatest, setLandsatLatest] = useState(null);
  const [landsatStatus, setLandsatStatus] = useState("");
  const farmLayersRef = useRef({});
  const fetchAreaAnalysis = useAEISStore((s) => s.fetchAreaAnalysis);

  // Get GeoJSON data from global store
  const counties = useAEISStore((s) => s.counties);
  const subcounties = useAEISStore((s) => s.subcounties);
  const wards = useAEISStore((s) => s.wards);

  const selectedCounty = useAEISStore((s) => s.selectedCounty);
  const selectedSubCounty = useAEISStore((s) => s.selectedSubCounty);
  const selectedWard = useAEISStore((s) => s.selectedWard);

  const setSelectedCounty = useAEISStore((s) => s.setSelectedCounty);
  const setSelectedSubCounty = useAEISStore((s) => s.setSelectedSubCounty);
  const setSelectedWard = useAEISStore((s) => s.setSelectedWard);

  const hoveredCounty = useAEISStore((s) => s.hoveredCounty);
  const hoveredSubCounty = useAEISStore((s) => s.hoveredSubCounty);
  const hoveredWard = useAEISStore((s) => s.hoveredWard);

  const setHoveredCounty = useAEISStore((s) => s.setHoveredCounty);
  const setHoveredSubCounty = useAEISStore((s) => s.setHoveredSubCounty);
  const setHoveredWard = useAEISStore((s) => s.setHoveredWard);

  const layers = useAEISStore((s) => s.layers);
  const hoverAutoSelectRef = useRef(false);
  const geeLayerKeys = ["geeNdvi", "geeNdwi", "geeLst"];
  const activeGeeLayers = geeLayerKeys
    .filter((key) => layers[key])
    .map((key) => geeConfig?.layers?.[key])
    .filter(Boolean);
  const activeConfiguredGeeLayers = activeGeeLayers.filter((layer) => layer.configured && layer.tile_url);
  const activeMissingGeeLayers = activeGeeLayers.filter((layer) => !layer.configured || !layer.tile_url);
  const selectedCountyName = countyName(selectedCounty);
  const accessCountyFeature = React.useMemo(
    () => (accessCountyName ? { properties: { ADM1_EN: accessCountyName } } : null),
    [accessCountyName]
  );

  useEffect(() => {
    let cancelled = false;
    if (!layers.landsatLatest) {
      setLandsatLatest(null);
      setLandsatStatus("");
      return undefined;
    }

    async function loadLatestLandsat() {
      const query = new URLSearchParams({ max_cloud: "35", lookback_days: "365" });
      if (selectedCountyName) query.set("county", selectedCountyName);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 45000);
      setLandsatStatus("Finding latest Landsat scene...");
      try {
        const response = await fetch(`${getApiBase()}/api/data/imagery/landsat/latest?${query}`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Landsat source unavailable");
        if (!cancelled) {
          setLandsatLatest(payload);
          setLandsatStatus(
            payload.map_overlay
              ? `${payload.scene?.platform || "Landsat"} map ${payload.map_overlay.date}`
              : payload.scene
              ? `${payload.scene.platform || "Landsat"} catalog ${payload.scene.date}`
              : "No low-cloud Landsat scene found"
          );
        }
      } catch (error) {
        if (!cancelled) {
          setLandsatLatest(null);
          setLandsatStatus(
            error.name === "AbortError"
              ? "Landsat catalogue is taking too long; retry the layer"
              : error.message || "Landsat source unavailable"
          );
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }

    loadLatestLandsat();
    return () => {
      cancelled = true;
    };
  }, [layers.landsatLatest, selectedCountyName]);

  useEffect(() => {
    let cancelled = false;
    async function loadGeeConfig() {
      try {
        const response = await fetch(`${getApiBase()}/api/gee/layers`);
        if (!response.ok) throw new Error("GEE layer endpoint unavailable");
        const payload = await response.json();
        if (!cancelled) setGeeConfig(payload);
      } catch (error) {
        if (!cancelled) {
          setGeeConfig({
            status: "unavailable",
            layers: {
              geeNdvi: { key: "geeNdvi", label: "GEE Sentinel-2 NDVI", configured: false, note: "Backend GEE endpoint is unavailable." },
              geeNdwi: { key: "geeNdwi", label: "GEE Sentinel-2 NDWI", configured: false, note: "Backend GEE endpoint is unavailable." },
              geeLst: { key: "geeLst", label: "GEE Landsat LST", configured: false, note: "Backend GEE endpoint is unavailable." },
            },
          });
        }
      }
    }
    loadGeeConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleCounties = React.useMemo(() => {
    if (!counties || !accessCountyName) return counties;
    return {
      ...counties,
      features: counties.features.filter((feature) => sameCounty(feature, accessCountyFeature)),
    };
  }, [accessCountyFeature, accessCountyName, counties]);

  const visibleSubcounties = React.useMemo(() => {
    if (!subcounties || !accessCountyName) return subcounties;
    return {
      ...subcounties,
      features: subcounties.features.filter((feature) => sameCounty(feature, accessCountyFeature)),
    };
  }, [accessCountyFeature, accessCountyName, subcounties]);

  const accessibleWards = React.useMemo(() => {
    if (!wards || !accessCountyName) return wards;
    return {
      ...wards,
      features: wards.features.filter((feature) => sameCounty(feature, accessCountyFeature)),
    };
  }, [accessCountyFeature, accessCountyName, wards]);

  const zoomTo = useCallback(
    (feature, opts = {}) => {
      if (!map || !feature) return;

      const layer = L.geoJSON(feature);
      const bounds = layer.getBounds();

      if (!bounds.isValid()) return;

      const flyOptions = {
        padding: [30, 30],
        maxZoom: opts.maxZoom ?? 12,
        duration: opts.duration ?? 0.75,
        easeLinearity: 0.25,
      };

      try {
        map.flyToBounds(bounds, flyOptions);
      } catch (e) {
        map.fitBounds(bounds, { padding: [30, 30] });
      }
    },
    [map]
  );

  useEffect(() => {
    if (!map || !selectedCounty) return;
    if (hoverAutoSelectRef.current) return;
    zoomTo(selectedCounty, { duration: 0.85, maxZoom: 8 });
  }, [map, selectedCounty, zoomTo]);

  useEffect(() => {
    if (!map || !selectedSubCounty) return;
    zoomTo(selectedSubCounty, { duration: 0.75, maxZoom: 10 });
  }, [map, selectedSubCounty, zoomTo]);

  useEffect(() => {
    if (!map || !selectedWard) return;
    zoomTo(selectedWard, { duration: 0.65, maxZoom: 12 });
  }, [map, selectedWard, zoomTo]);

  // Reactive National View Reset: Fly back to Kenya when selection is cleared
  useEffect(() => {
    if (!map) return;
    if (!selectedCounty && !selectedSubCounty && !selectedWard) {
      if (hoverAutoSelectRef.current) return;
      map.flyTo([0.0236, 37.9062], 6, { duration: 1.5 });
    }
  }, [map, selectedCounty, selectedSubCounty, selectedWard]);

  const handleMapReady = useCallback((mapInstance) => {
    setMap(mapInstance);
    setCurrentZoom(mapInstance.getZoom());
    if (onMapReady) onMapReady(mapInstance);
  }, [onMapReady]);

  useEffect(() => {
    if (!map) return undefined;
    const frame = window.requestAnimationFrame(() => {
      map.invalidateSize();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [map, mapHeight]);

  // Helper: Find subcounties inside a county (memoized for performance)
  const linkedSubcounties = React.useMemo(() => {
    if (!visibleSubcounties || !selectedCounty) return [];
    return visibleSubcounties.features.filter((feature) => sameCounty(feature, selectedCounty));
  }, [visibleSubcounties, selectedCounty]);

  const countyWards = React.useMemo(() => {
    if (!accessibleWards || !selectedCounty) return [];
    return accessibleWards.features.filter((feature) => sameCounty(feature, selectedCounty));
  }, [accessibleWards, selectedCounty]);

  // Helper: Find wards inside a subcounty (memoized for performance)
  const linkedWards = React.useMemo(() => {
    if (!accessibleWards || !selectedSubCounty) return [];
    const source = selectedCounty ? countyWards : accessibleWards.features;
    return source.filter((feature) => sameSubCounty(feature, selectedSubCounty));
  }, [accessibleWards, countyWards, selectedCounty, selectedSubCounty]);

  const visibleWards = React.useMemo(() => {
    if (!accessibleWards) return null;
    if (!selectedCounty) return null;
    if (!selectedSubCounty) {
      return {
        ...accessibleWards,
        features: countyWards,
      };
    }
    return {
      ...accessibleWards,
      features: linkedWards,
    };
  }, [accessibleWards, countyWards, linkedWards, selectedCounty, selectedSubCounty]);

  const linkedSubcountyData = React.useMemo(() => {
    if (!visibleSubcounties || !selectedCounty) return null;
    return { ...visibleSubcounties, features: linkedSubcounties };
  }, [linkedSubcounties, selectedCounty, visibleSubcounties]);

  const countyLabelData = React.useMemo(() => {
    if (!visibleCounties || !selectedCounty) return visibleCounties;
    const selectedName = selectedCounty.properties?.ADM1_EN;
    return {
      ...visibleCounties,
      features: visibleCounties.features.filter(
        (feature) => feature.properties?.ADM1_EN === selectedName
      ),
    };
  }, [selectedCounty, visibleCounties]);

  const linkedWardData = React.useMemo(() => {
    if (!visibleWards || !selectedSubCounty) return null;
    return { ...visibleWards, features: linkedWards };
  }, [linkedWards, selectedSubCounty, visibleWards]);

  const segmentationScope = React.useMemo(() => {
    if (selectedWard) {
      return {
        level: "ward",
        id: selectedWard.properties?.shapeID || selectedWard.properties?.ADM3_PCODE || selectedWard.properties?.shapeName,
      };
    }
    if (selectedSubCounty) {
      return {
        level: "subcounty",
        id: selectedSubCounty.properties?.ADM2_PCODE || selectedSubCounty.properties?.ADM2_EN,
      };
    }
    if (selectedCounty) {
      return {
        level: "county",
        id: selectedCounty.properties?.ADM1_PCODE || selectedCounty.properties?.ADM1_EN,
      };
    }
    return { level: "", id: "" };
  }, [selectedCounty, selectedSubCounty, selectedWard]);

  // Setup drawing
  useEffect(() => {
    if (!map || !drawMode) return;
    
    const drawControl = new L.Control.Draw({
      position: 'topleft',
      draw: {
        polygon: { shapeOptions: COLORS.farm, showArea: true },
        rectangle: { shapeOptions: COLORS.farm },
        circle: false, marker: false, polyline: false
      }
    });
    
    map.addControl(drawControl);
    
    const handleCreated = async (e) => {
      const layer = e.layer;
      const geojson = layer.toGeoJSON();
      let area = 0;
      try { area = (turf.area(geojson) / 10000).toFixed(2); } catch(e) { area = '?'; }
      
      const name = prompt('Farm name:', `Farm ${farms.length + 1}`);
      const farmId = Date.now();
      
      const analysisData = await fetchAreaAnalysis(geojson.geometry);
      
      const newFarm = { 
        id: farmId, 
        name: name || `Farm ${farms.length + 1}`, 
        geometry: geojson, 
        area: area + ' ha',
        analysis: analysisData
      };
      
      onFarmCreated?.(newFarm);
    };

    map.on(L.Draw.Event.CREATED, handleCreated);
    
    return () => {
      map.off(L.Draw.Event.CREATED, handleCreated);
      map.removeControl(drawControl);
    };
  }, [map, drawMode, farms.length, fetchAreaAnalysis, onFarmCreated]);

  // Sync farm layers
  useEffect(() => {
    if (!map) return;
    
    // Remove layers no longer in state
    Object.keys(farmLayersRef.current).forEach(id => {
      if (!farms.find(f => f.id.toString() === id)) {
        map.removeLayer(farmLayersRef.current[id]);
        delete farmLayersRef.current[id];
      }
    });

    // Add new layers
    farms.forEach(farm => {
      if (!farmLayersRef.current[farm.id]) {
        const layer = L.geoJSON(farm.geometry, { 
          style: COLORS.farm, 
          onEachFeature: (f, l) => l.bindPopup(`<b>${farm.name}</b><br/>Area: ${farm.area}`) 
        }).addTo(map);
        farmLayersRef.current[farm.id] = layer;
      }
    });
  }, [map, farms]);

  // Handle keyboard focus for navigation automatically when map is ready
  useEffect(() => {
    if (map) {
      const container = map.getContainer();
      container.setAttribute('tabindex', '0');
      container.focus();
    }
  }, [map]);

  return (
    <div style={{ height: mapHeight, position: "relative" }}>
      {!dashboardMode && (
        <>
          <TopBar />
          <LayerManager />
          <InfoPanel />
        </>
      )}

      <MapContainer
        preferCanvas={true} // Crucial for performance with many polygons
        center={[0.0236, 37.9062]}
        zoom={6}
        scrollWheelZoom={true}
        keyboard={true}
        style={{ height: "100%", width: "100%" }}
      >
        <MapBinder onReady={handleMapReady} />
        <ZoomHandler onZoomChange={setCurrentZoom} />

        <ScaleControl position="bottomleft" imperial={false} />
        <NorthArrow />

        <TileLayer
          url={(baseMaps[baseMap] || baseMaps.street).url}
          attribution={(baseMaps[baseMap] || baseMaps.street).attribution}
        />
        {layers.landsatLatest && landsatLatest?.map_overlay && (
          <WMSTileLayer
            url={landsatLatest.map_overlay.url}
            layers={landsatLatest.map_overlay.layers}
            styles={landsatLatest.map_overlay.styles}
            format={landsatLatest.map_overlay.format}
            transparent={landsatLatest.map_overlay.transparent}
            version={landsatLatest.map_overlay.version}
            time={landsatLatest.map_overlay.date}
            opacity={0.82}
            attribution="Digital Earth Africa; Landsat Collection 2 courtesy USGS"
          />
        )}
        {layers.nasaTrueColor && (
          <TileLayer
            url={realImageryLayers.nasaTrueColor.url}
            opacity={realImageryLayers.nasaTrueColor.opacity}
            maxNativeZoom={realImageryLayers.nasaTrueColor.maxNativeZoom}
            attribution={realImageryLayers.nasaTrueColor.attribution}
          />
        )}
        {layers.nasaNdvi && (
          <TileLayer
            url={realImageryLayers.nasaNdvi.url}
            opacity={realImageryLayers.nasaNdvi.opacity}
            maxNativeZoom={realImageryLayers.nasaNdvi.maxNativeZoom}
            attribution={realImageryLayers.nasaNdvi.attribution}
          />
        )}
        {layers.nasaLst && (
          <TileLayer
            url={realImageryLayers.nasaLst.url}
            opacity={realImageryLayers.nasaLst.opacity}
            maxNativeZoom={realImageryLayers.nasaLst.maxNativeZoom}
            attribution={realImageryLayers.nasaLst.attribution}
          />
        )}
        {activeConfiguredGeeLayers.map((layer) => (
          <TileLayer
            key={layer.key}
            url={layer.tile_url}
            opacity={layer.opacity ?? 0.72}
            attribution="Google Earth Engine"
          />
        ))}
        {(layers.landsatLatest || layers.nasaTrueColor || layers.nasaNdvi || layers.nasaLst || activeGeeLayers.length > 0) && (
          <div className="aeis-map-source-badge leaflet-bottom leaflet-right">
            <div className="leaflet-control">
              {layers.landsatLatest && (
                <span>
                  Latest Landsat: {landsatStatus || "loading"}
                  {landsatLatest?.map_overlay?.cloud_cover != null ? ` | ${landsatLatest.map_overlay.cloud_cover}% cloud` : ""}
                </span>
              )}
              {[realImageryLayers.nasaTrueColor, realImageryLayers.nasaNdvi, realImageryLayers.nasaLst]
                .filter((item) =>
                  (item === realImageryLayers.nasaTrueColor && layers.nasaTrueColor) ||
                  (item === realImageryLayers.nasaNdvi && layers.nasaNdvi) ||
                  (item === realImageryLayers.nasaLst && layers.nasaLst)
                )
                .map((item) => (
                  <span key={item.label}>{item.label}: {item.date}</span>
                ))}
              {activeGeeLayers.map((item) => (
                <span key={item.key}>
                  {item.label}: {item.configured ? "Earth Engine tile" : `set ${item.env || "GEE env"}`}
                </span>
              ))}
            </div>
          </div>
        )}
        {activeMissingGeeLayers.length > 0 && (
          <div className="aeis-map-provider-warning leaflet-top leaflet-right">
            <div className="leaflet-control">
              <strong>GEE layer not connected</strong>
              <span>Configure {activeMissingGeeLayers.map((layer) => layer.env || layer.key).join(", ")} in the backend environment.</span>
            </div>
          </div>
        )}

        <Pane name="aeis-counties-pane" style={{ zIndex: 410 }}>
          {visibleCounties && (layers?.counties ?? true) && (
            <CountyLayer
              key={`counties-${selectedCounty?.properties?.ADM1_PCODE || "all"}`}
              data={visibleCounties}
              selectedCounty={selectedCounty}
              onSelect={(f) => {
                hoverAutoSelectRef.current = false;
                setSelectedCounty(f);
                setSelectedSubCounty(null);
                setSelectedWard(null);
                onCountySelect?.(f);
                zoomTo(f);
              }}
              onHover={(f) => {
                setHoveredCounty(f);
                if (!hoverSelectEnabled) return;
                if (accessCountyName) return;

                hoverAutoSelectRef.current = true;
                if (f) {
                  setSelectedCounty(f);
                  setSelectedSubCounty(null);
                  setSelectedWard(null);
                } else {
                  setSelectedCounty(null);
                  setSelectedSubCounty(null);
                  setSelectedWard(null);
                }
              }}
            />
          )}
        </Pane>
        {countyLabelData && (layers?.counties ?? true) && (
          <CountyCodeLabels data={countyLabelData} visible showNames={Boolean(selectedCounty)} />
        )}

        <Pane name="aeis-subcounties-pane" style={{ zIndex: 430 }}>
          {linkedSubcountyData && (layers?.subcounties) && selectedCounty && (
            <SubCountyLayer
              key={`subcounties-${selectedCountyName || "none"}-${subCountyCode(selectedSubCounty) || "all"}`}
              data={linkedSubcountyData}
              selectedCounty={selectedCounty}
              selectedSubCounty={selectedSubCounty}
              onSelect={(f) => {
                hoverAutoSelectRef.current = false;
                setSelectedSubCounty(f);
                setSelectedWard(null);
                onSubCountySelect?.(f);
                zoomTo(f);
              }}
              onHover={(f) => setHoveredSubCounty(f)}
            />
          )}
        </Pane>
        {linkedSubcountyData && layers?.subcounties && (
          <BoundaryLabels
            data={linkedSubcountyData}
            visible
            nameProperty="ADM2_EN"
            className="subcounty"
            minZoom={7}
          />
        )}

        <Pane name="aeis-wards-pane" style={{ zIndex: 450 }}>
          {visibleWards && (layers?.wards) && selectedCounty && (selectedSubCounty || currentZoom >= 10 || selectedWard) && (
            <WardLayer
              key={`wards-${subCountyCode(selectedSubCounty) || "county"}-${wardCode(selectedWard) || wardName(selectedWard) || "none"}`}
              data={visibleWards}
              selectedCounty={selectedCounty}
              selectedSubCounty={selectedSubCounty}
              selectedWard={selectedWard}
              onSelect={(f) => {
                hoverAutoSelectRef.current = false;
                setSelectedWard(f);
                onWardSelect?.(f);
                zoomTo(f);
              }}
              onHover={(f) => setHoveredWard(f)}
            />
          )}
        </Pane>
        {linkedWardData && layers?.wards && selectedSubCounty && (
          <BoundaryLabels
            data={linkedWardData}
            visible
            nameProperty="shapeName"
            className="ward"
            minZoom={9}
          />
        )}

        <SegmentationLayer
          visible={layers.segmentation}
          scopeLevel={segmentationScope.level}
          scopeId={segmentationScope.id}
          segmentClass={segmentClass}
          onStats={onSegmentationStats}
        />
      </MapContainer>
    </div>
  );
}

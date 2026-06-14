import React, { useEffect, useCallback, useState, useRef } from "react";
import { MapContainer, TileLayer, useMap, ScaleControl, useMapEvents } from "react-leaflet";
import L from "leaflet";
import * as turf from '@turf/turf'; // Needed for spatial queries
import useAEISStore from "../../store/useAEISStore";

import TopBar from "../Ui/TopBar";
import LayerManager from "../Ui/LayerManager"; // Assuming this is correct
import InfoPanel from "../Ui/InfoPanel";

import CountyLayer from "./CountyLayer";
import CountyCodeLabels from "./CountyCodeLabels";
import SubCountyLayer from "./SubCountyLayer";
import WardLayer from "./WardLayer";
import SegmentationLayer from "./SegmentationLayer";
import { getApiBase } from "../../utils/api";

const COLORS = {
  farm: { color: '#22c55e', weight: 3, fillOpacity: 0.3 }
};

const baseMaps = {
  street: { name: 'Street', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' },
  satellite: { name: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' },
  hybrid: { name: 'Hybrid', url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}' }
};

const realImageryLayers = {
  nasaTrueColor: {
    label: "NASA MODIS true color",
    date: "2026-06-14",
    opacity: 0.82,
    maxNativeZoom: 9,
    url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2026-06-14/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg",
    attribution: "NASA GIBS",
  },
  nasaNdvi: {
    label: "NASA MODIS NDVI 8-day",
    date: "2026-06-13",
    opacity: 0.72,
    maxNativeZoom: 9,
    url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDVI_8Day/default/2026-06-13/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png",
    attribution: "NASA GIBS",
  },
  nasaLst: {
    label: "NASA MODIS LST day",
    date: "2026-06-14",
    opacity: 0.68,
    maxNativeZoom: 7,
    url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_Land_Surface_Temp_Day/default/2026-06-14/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png",
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
  hoverSelectEnabled = true,
}) {
  const [map, setMap] = useState(null);
  const [currentZoom, setCurrentZoom] = useState(6);
  const [geeConfig, setGeeConfig] = useState(null);
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
      features: counties.features.filter((feature) => feature.properties?.ADM1_EN === accessCountyName),
    };
  }, [counties, accessCountyName]);

  const visibleSubcounties = React.useMemo(() => {
    if (!subcounties || !accessCountyName) return subcounties;
    return {
      ...subcounties,
      features: subcounties.features.filter((feature) => feature.properties?.ADM1_EN === accessCountyName),
    };
  }, [subcounties, accessCountyName]);

  const accessibleWards = React.useMemo(() => {
    if (!wards || !accessCountyName) return wards;
    return {
      ...wards,
      features: wards.features.filter((feature) => feature.properties?.ADM1_EN === accessCountyName),
    };
  }, [wards, accessCountyName]);

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

  // Helper: Find subcounties inside a county (memoized for performance)
  const linkedSubcounties = React.useMemo(() => {
    if (!visibleSubcounties || !selectedCounty) return [];
    const countyName = (selectedCounty.properties?.ADM1_EN || selectedCounty.properties?.NAME || "").toLowerCase();
    
    return visibleSubcounties.features.filter(sub => {
      try {
        const parent = (sub.properties?.ADM1_EN || sub.properties?.County || sub.properties?.NAME_1 || sub.properties?.NAME || "").toLowerCase();
        const target = (countyName || "").toLowerCase();
        if (!target || !parent) return false;
        return parent.toLowerCase().includes(countyName.toLowerCase()) || 
               countyName.toLowerCase().includes(parent.toLowerCase());
      } catch(e) { return false; }
    });
  }, [visibleSubcounties, selectedCounty]);

  // Helper: Find wards inside a subcounty (memoized for performance)
  const linkedWards = React.useMemo(() => {
    if (!accessibleWards || !selectedSubCounty) return [];
    const subcountyFeature = selectedSubCounty;
    const subcountyName = (subcountyFeature.properties?.ADM2_EN || subcountyFeature.properties?.NAME || "").toLowerCase();

    return accessibleWards.features.filter(ward => {
      try {
        const parent = (ward.properties?.ADM2_EN || ward.properties?.SubCounty || ward.properties?.NAME_2 || "").toLowerCase();
        if (!subcountyName || !parent) return false;
        // Robust fuzzy matching for varying administrative name conventions
        return parent.toLowerCase().includes(subcountyName.toLowerCase()) || 
               subcountyName.toLowerCase().includes(parent.toLowerCase()) ||
               ward.properties?.ADM2_PCODE === subcountyFeature.properties?.ADM2_PCODE;
      } catch(e) { return false; }
    });
  }, [accessibleWards, selectedSubCounty]);

  const visibleWards = React.useMemo(() => {
    if (!accessibleWards) return null;
    if (!selectedSubCounty) return accessibleWards;

    return {
      ...accessibleWards,
      features: linkedWards,
    };
  }, [accessibleWards, selectedSubCounty, linkedWards]);

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

        <TileLayer url={baseMaps[baseMap].url} />
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
        {(layers.nasaTrueColor || layers.nasaNdvi || layers.nasaLst || activeGeeLayers.length > 0) && (
          <div className="aeis-map-source-badge leaflet-bottom leaflet-right">
            <div className="leaflet-control">
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
        {visibleCounties && (layers?.counties ?? true) && (
          <CountyCodeLabels data={visibleCounties} visible />
        )}

        {visibleSubcounties && (layers?.subcounties) && (
          <SubCountyLayer
            key={`subcounties-${selectedCounty?.properties?.ADM1_PCODE || "none"}-${selectedSubCounty?.properties?.ADM2_PCODE || "all"}`}
            data={visibleSubcounties}
            selectedCounty={selectedCounty}
            selectedSubCounty={selectedSubCounty}
            onSelect={(f) => {
              hoverAutoSelectRef.current = false;
              setSelectedSubCounty(f);
              setSelectedWard(null);
              zoomTo(f);
            }}
            onHover={(f) => setHoveredSubCounty(f)}
          />
        )}

        {visibleWards && (layers?.wards) && (selectedSubCounty || currentZoom >= 10 || selectedWard) && (
          <WardLayer
            key={`wards-${selectedSubCounty?.properties?.ADM2_PCODE || "all"}-${selectedWard?.properties?.shapeID || selectedWard?.properties?.shapeName || "none"}`}
            data={visibleWards}
            selectedCounty={selectedCounty}
            selectedSubCounty={selectedSubCounty}
            selectedWard={selectedWard}
            onSelect={(f) => {
              hoverAutoSelectRef.current = false;
              setSelectedWard(f);
              zoomTo(f);
            }}
            onHover={(f) => setHoveredWard(f)}
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

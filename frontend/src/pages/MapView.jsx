import React, { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import * as turf from "@turf/turf";
import {
  Crosshair,
  Leaf,
  Map as MapIcon,
  PencilRuler,
  Satellite,
  ThermometerSun,
} from "lucide-react";
import LiveMap from "../components/maps/LiveMap";
import CountyAtlasPanel from "../components/CountyAtlasPanel";
import LiveWeatherForecastPanel from "../components/LiveWeatherForecastPanel";
import useAEISStore from "../store/useAEISStore";

function readLocalFarms() {
  try {
    const saved = localStorage.getItem("aeis_farms");
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    return [];
  }
}

function nameOf(feature, property) {
  return feature?.properties?.[property] || "";
}

export default function MapView({ filter, setFilter, lockedCounty = "" }) {
  const [baseMap, setBaseMap] = useState("street");
  const [drawMode, setDrawMode] = useState(false);
  const [farms, setFarms] = useState(() => readLocalFarms());
  const [mapInstance, setMapInstance] = useState(null);
  const [gpsStatus, setGpsStatus] = useState("GPS is optional");
  const [segmentClass, setSegmentClass] = useState("hospitals");
  const [segmentationStats, setSegmentationStats] = useState({ count: 0, status: "hidden" });
  const gpsMarkerRef = useRef(null);

  const counties = useAEISStore((state) => state.counties);
  const subcounties = useAEISStore((state) => state.subcounties);
  const wards = useAEISStore((state) => state.wards);
  const selectedCounty = useAEISStore((state) => state.selectedCounty);
  const selectedSubCounty = useAEISStore((state) => state.selectedSubCounty);
  const selectedWard = useAEISStore((state) => state.selectedWard);
  const layers = useAEISStore((state) => state.layers);
  const setSelectedCounty = useAEISStore((state) => state.setSelectedCounty);
  const setSelectedSubCounty = useAEISStore((state) => state.setSelectedSubCounty);
  const setSelectedWard = useAEISStore((state) => state.setSelectedWard);
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

  useEffect(() => {
    if (!counties?.features?.length) return;
    const targetCountyName = lockedCounty || filter.county;

    if (!targetCountyName) {
      if (selectedCounty) setSelectedCounty(null);
      return;
    }

    const countyFeature = counties.features.find(
      (feature) => nameOf(feature, "ADM1_EN") === targetCountyName
    );
    if (!countyFeature) return;

    if (nameOf(selectedCounty, "ADM1_EN") !== targetCountyName) {
      setSelectedCounty(countyFeature);
    }
  }, [counties, filter.county, lockedCounty, selectedCounty, setSelectedCounty]);

  useEffect(() => {
    if (!filter.subcounty || !subcounties?.features?.length || !selectedCounty) {
      if (!filter.subcounty && selectedSubCounty) setSelectedSubCounty(null);
      return;
    }

    const feature = subcounties.features.find(
      (item) =>
        nameOf(item, "ADM1_EN") === nameOf(selectedCounty, "ADM1_EN") &&
        nameOf(item, "ADM2_EN") === filter.subcounty
    );
    if (feature && nameOf(selectedSubCounty, "ADM2_EN") !== filter.subcounty) {
      setSelectedSubCounty(feature);
    }
  }, [filter.subcounty, selectedCounty, selectedSubCounty, setSelectedSubCounty, subcounties]);

  useEffect(() => {
    if (!filter.ward || !wards?.features?.length || !selectedCounty) {
      if (!filter.ward && selectedWard) setSelectedWard(null);
      return;
    }

    const feature = wards.features.find((item) => {
      const wardName = nameOf(item, "shapeName") || nameOf(item, "ADM3_EN");
      return (
        wardName === filter.ward &&
        (!filter.subcounty || nameOf(item, "ADM2_EN") === filter.subcounty) &&
        (!nameOf(item, "ADM1_EN") || nameOf(item, "ADM1_EN") === nameOf(selectedCounty, "ADM1_EN"))
      );
    });
    const selectedWardName = nameOf(selectedWard, "shapeName") || nameOf(selectedWard, "ADM3_EN");
    if (feature && selectedWardName !== filter.ward) setSelectedWard(feature);
  }, [filter.subcounty, filter.ward, selectedCounty, selectedWard, setSelectedWard, wards]);

  useEffect(() => {
    setLayerVisibility("counties", true);
    setLayerVisibility("subcounties", Boolean(selectedCounty));
    setLayerVisibility("wards", Boolean(selectedSubCounty));
    setLayerVisibility("landsatLatest", true);
    if (!selectedCounty) setLayerVisibility("segmentation", false);
  }, [selectedCounty, selectedSubCounty, setLayerVisibility]);

  const selectCounty = useCallback(
    (feature) => {
      const county = nameOf(feature, "ADM1_EN");
      if (!county || (lockedCounty && county !== lockedCounty)) return;
      setSelectedCounty(feature);
      setFilter({ county, subcounty: "", ward: "" });
    },
    [lockedCounty, setFilter, setSelectedCounty]
  );

  const selectSubCounty = useCallback(
    (feature) => {
      const subcounty = nameOf(feature, "ADM2_EN");
      const county = nameOf(feature, "ADM1_EN") || nameOf(selectedCounty, "ADM1_EN");
      if (!county || !subcounty) return;
      setSelectedSubCounty(feature);
      setFilter({ county, subcounty, ward: "" });
    },
    [selectedCounty, setFilter, setSelectedSubCounty]
  );

  const selectWard = useCallback(
    (feature) => {
      const ward = nameOf(feature, "shapeName") || nameOf(feature, "ADM3_EN");
      if (!ward || !selectedCounty) return;
      setSelectedWard(feature);
      setFilter({
        county: nameOf(selectedCounty, "ADM1_EN"),
        subcounty: nameOf(selectedSubCounty, "ADM2_EN"),
        ward,
      });
    },
    [selectedCounty, selectedSubCounty, setFilter, setSelectedWard]
  );

  const clearSelection = useCallback(() => {
    if (lockedCounty) return;
    setSelectedCounty(null);
    setSelectedSubCounty(null);
    setSelectedWard(null);
    setFilter({ county: "", subcounty: "", ward: "" });
  }, [lockedCounty, setFilter, setSelectedCounty, setSelectedSubCounty, setSelectedWard]);

  const chooseProviderLayer = (layerName) => {
    setBaseMap(layerName ? "satellite" : baseMap);
    ["landsatLatest", "nasaTrueColor", "nasaNdvi", "nasaLst", "geeNdvi", "geeNdwi", "geeLst"].forEach((key) => {
      setLayerVisibility(key, key === layerName ? !layers[layerName] : false);
    });
  };

  const selectFeatureLayer = (nextClass) => {
    const shouldHide = layers.segmentation && segmentClass === nextClass;
    setSegmentClass(nextClass);
    setLayerVisibility("segmentation", !shouldHide);
  };

  const locateUser = () => {
    if (!navigator.geolocation) {
      setGpsStatus("GPS is unavailable. The atlas remains fully usable.");
      return;
    }

    setGpsStatus("Checking location...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latlng = [position.coords.latitude, position.coords.longitude];
        if (mapInstance) {
          mapInstance.setView(latlng, 12);
          if (gpsMarkerRef.current) {
            gpsMarkerRef.current.setLatLng(latlng);
          } else {
            gpsMarkerRef.current = L.marker(latlng)
              .addTo(mapInstance)
              .bindPopup("Current location");
          }
        }

        if (lockedCounty && selectedCounty) {
          const inside = turf.booleanPointInPolygon(
            turf.point([position.coords.longitude, position.coords.latitude]),
            selectedCounty
          );
          setGpsStatus(inside ? `Inside ${lockedCounty} County` : `Location is outside ${lockedCounty} County`);
          return;
        }
        setGpsStatus(`Located to ${Math.round(position.coords.accuracy)} m accuracy`);
      },
      () => setGpsStatus("GPS permission was not available. The atlas remains fully usable."),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  };

  const activeProviderLayer = ["landsatLatest", "nasaTrueColor", "nasaNdvi", "nasaLst"].find((key) => layers[key]) || "";
  const countyName = nameOf(selectedCounty, "ADM1_EN");

  return (
    <>
      <div className="aeis-topbar aeis-atlas-topbar">
        <div>
          <div className="aeis-kicker">{lockedCounty ? "County atlas" : "National atlas"}</div>
          <h1 className="aeis-title">Kenya Live Atlas</h1>
          <p className="aeis-subtitle">
            Click a county to see its official number, boundary area, named sub-counties, wards, live mapped features, satellite context, and seven-day weather.
          </p>
        </div>
        <div className="aeis-status-pill">
          {lockedCounty ? `${lockedCounty} only` : countyName || "47 counties"}
        </div>
      </div>

      <div className="aeis-atlas-toolbar" aria-label="Map display controls">
        <div className="aeis-atlas-control-group">
          <span>Basemap</span>
          <div className="aeis-segmented-control">
            <button type="button" className={baseMap === "street" ? "active" : ""} onClick={() => setBaseMap("street")}>
              <MapIcon size={16} /> Map
            </button>
            <button type="button" className={baseMap === "satellite" ? "active" : ""} onClick={() => setBaseMap("satellite")}>
              <Satellite size={16} /> Satellite
            </button>
            <button type="button" className={baseMap === "terrain" ? "active" : ""} onClick={() => setBaseMap("terrain")}>
              <MapIcon size={16} /> Terrain
            </button>
          </div>
        </div>
        <div className="aeis-atlas-control-group">
          <span>Earth observation</span>
          <div className="aeis-atlas-toggle-row">
            <button
              type="button"
              className={activeProviderLayer === "landsatLatest" ? "active" : ""}
              onClick={() => chooseProviderLayer("landsatLatest")}
            >
              <Satellite size={16} /> Latest Landsat
            </button>
            <button
              type="button"
              className={activeProviderLayer === "nasaTrueColor" ? "active" : ""}
              onClick={() => chooseProviderLayer("nasaTrueColor")}
            >
              <Satellite size={16} /> True colour
            </button>
            <button
              type="button"
              className={activeProviderLayer === "nasaNdvi" ? "active" : ""}
              onClick={() => chooseProviderLayer("nasaNdvi")}
            >
              <Leaf size={16} /> Vegetation
            </button>
            <button
              type="button"
              className={activeProviderLayer === "nasaLst" ? "active" : ""}
              onClick={() => chooseProviderLayer("nasaLst")}
            >
              <ThermometerSun size={16} /> Surface heat
            </button>
          </div>
        </div>
        <div className="aeis-atlas-utility-actions">
          <button type="button" onClick={locateUser} title="Use optional browser GPS">
            <Crosshair size={17} /> Locate
          </button>
          <button
            type="button"
            className={drawMode ? "active" : ""}
            onClick={() => setDrawMode((value) => !value)}
            title="Draw a farm boundary"
          >
            <PencilRuler size={17} /> Farm
          </button>
        </div>
      </div>

      <div className="aeis-atlas-layout">
        <CountyAtlasPanel
          counties={counties}
          selectedCounty={selectedCounty}
          selectedSubCounty={selectedSubCounty}
          selectedWard={selectedWard}
          subcounties={subcounties}
          wards={wards}
          lockedCounty={lockedCounty}
          segmentClass={segmentClass}
          segmentationVisible={layers.segmentation}
          segmentationStats={segmentationStats}
          onCountySelect={selectCounty}
          onSubCountySelect={selectSubCounty}
          onWardSelect={selectWard}
          onClear={clearSelection}
          onFeatureLayerChange={selectFeatureLayer}
        />

        <section className="aeis-atlas-map-column" aria-label="Interactive atlas map">
          <div className="aeis-atlas-map">
            <LiveMap
              baseMap={baseMap}
              drawMode={drawMode}
              farms={farms}
              onMapReady={setMapInstance}
              onFarmCreated={(farm) => setFarms((current) => [...current, farm])}
              dashboardMode
              accessCountyName={lockedCounty}
              segmentClass={segmentClass}
              onSegmentationStats={setSegmentationStats}
              onCountySelect={selectCounty}
              onSubCountySelect={selectSubCounty}
              onWardSelect={selectWard}
              hoverSelectEnabled={false}
              mapHeight="640px"
            />
          </div>
          <div className="aeis-atlas-map-status" role="status">
            <span>{loadingGeoJSON ? "Loading boundaries..." : geoJSONError || "Administrative boundaries ready"}</span>
            <span>{gpsStatus}</span>
          </div>
        </section>
      </div>

      <LiveWeatherForecastPanel countyName={countyName} mapAdjacent />
    </>
  );
}

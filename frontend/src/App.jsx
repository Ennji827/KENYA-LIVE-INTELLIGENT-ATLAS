﻿import React, { useState, useEffect, useCallback, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import 'leaflet.heat';
import * as turf from '@turf/turf';
import useAEISStore from './store/useAEISStore';
import LiveMap from './components/maps/LiveMap';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, BarChart, Bar, Cell } from 'recharts';
import { MetricRow, ChartCard, Legend, VarianceBadge, Breadcrumbs, DataTable, LoadingSpinner } from './components/Ui/AppComponents'; // New import for shared components
import { SEGMENT_PROFILES } from './utils/heatmapData';
import { getApiBase } from './utils/api';

// API base URL from environment variables
const API_BASE = getApiBase();

function App() {
  // Get GeoJSON data and fetching state from global store
  const counties = useAEISStore((s) => s.counties);
  const subcounties = useAEISStore((s) => s.subcounties);
  const wards = useAEISStore((s) => s.wards);
  // Ensure selectors return stable references to prevent infinite loops
  const loadingGeoJSON = useAEISStore(useCallback((s) => s.loadingGeoJSON, []));
  const geoJSONError = useAEISStore(useCallback((s) => s.geoJSONError, []));
  const fetchGeoJSONData = useAEISStore(useCallback((s) => s.fetchGeoJSONData, []));

  // Get selected area state and actions from global store
  const selectedCounty = useAEISStore((s) => s.selectedCounty);
  const selectedSubCounty = useAEISStore((s) => s.selectedSubCounty);
  const selectedWard = useAEISStore((s) => s.selectedWard);
  const setSelectedCounty = useAEISStore((s) => s.setSelectedCounty);
  const setSelectedSubCounty = useAEISStore((s) => s.setSelectedSubCounty); // Ensure consistent casing
  const setHoveredCounty = useAEISStore((s) => s.setHoveredCounty);
  const setSelectedWard = useAEISStore((s) => s.setSelectedWard);
  const setHoveredSubcounty = useAEISStore((s) => s.setHoveredSubCounty);
  const setHoveredWard = useAEISStore((s) => s.setHoveredWard);
  const hoveredCounty = useAEISStore((s) => s.hoveredCounty);
  const hoveredSubCounty = useAEISStore((s) => s.hoveredSubCounty);
  const hoveredWard = useAEISStore((s) => s.hoveredWard);
  const fetchAnalysis = useAEISStore((s) => s.fetchAnalysis);
  const fetchAreaAnalysis = useAEISStore((s) => s.fetchAreaAnalysis);
  const selectedAnalysis = useAEISStore((s) => s.selectedAnalysis);
  const layers = useAEISStore((s) => s.layers) || { counties: true }; // Fallback to avoid crashes
  const setLayerVisibility = useAEISStore((s) => s.setLayerVisibility);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawMode, setDrawMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [farms, setFarms] = useState(() => {
    const saved = localStorage.getItem('aeis_farms');
    return saved ? JSON.parse(saved) : [];
  });
  const [mapInstance, setMapInstance] = useState(null);
  const [baseMap, setBaseMap] = useState('street');
  const [countryAnalysis, setCountryAnalysis] = useState(null);
  const [compareCounty, setCompareCounty] = useState(null);
  const [apiStatus, setApiStatus] = useState('Connecting to local API...');
  const [activeChartMetric, setActiveChartMetric] = useState('ndvi');
  const [insightView, setInsightView] = useState('visual'); // 'visual' or 'tabular'
  const [automationEnabled, setAutomationEnabled] = useState(true);
  const [refreshSeconds, setRefreshSeconds] = useState(30);
  const [automationStatus, setAutomationStatus] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [nextSyncAt, setNextSyncAt] = useState(null);
  const [syncCount, setSyncCount] = useState(0);
  const [accessCountyName, setAccessCountyName] = useState('');
  const [segmentClass, setSegmentClass] = useState('buildings');
  const [segmentThreshold, setSegmentThreshold] = useState(0.72);
  const [segmentationStats, setSegmentationStats] = useState({ count: 0 });
  const [feedPage, setFeedPage] = useState(0);
  const [countySession, setCountySession] = useState(null);
  const [loginCountyName, setLoginCountyName] = useState('');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLatitude, setLoginLatitude] = useState('');
  const [loginLongitude, setLoginLongitude] = useState('');
  const [loginStatus, setLoginStatus] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const chartMetrics = {
    ndvi: { label: 'Crop Health (NDVI)', color: '#6366f1', unit: '' },
    moisture: { label: 'Soil Moisture', color: '#0ea5e9', unit: '%' },
    ndwi: { label: 'Water Index (NDWI)', color: '#0284c7', unit: '' },
    ndbi: { label: 'Built-up Index (NDBI)', color: '#ea580c', unit: '' },
    rainfall: { label: 'Rainfall', color: '#0891b2', unit: ' mm' },
    forest: { label: 'Forest Share', color: '#16a34a', unit: '%' },
  };

  // Mock data for charts
  const historicalNDVI = React.useMemo(() => [
    { month: 'Jan', ndvi: 0.42, moisture: 30 },
    { month: 'Feb', ndvi: 0.45, moisture: 28 },
    { month: 'Mar', ndvi: 0.61, moisture: 42 },
    { month: 'Apr', ndvi: 0.74, moisture: 65 },
    { month: 'May', ndvi: 0.72, moisture: 58 },
    { month: 'Jun', ndvi: 0.65, moisture: 45 },
  ], []);

  const hasSelectedScope = Boolean(selectedCounty || selectedSubCounty || selectedWard);
  const activeAnalysis = selectedAnalysis || (hasSelectedScope ? null : countryAnalysis);
  const activeTrendData = activeAnalysis?.trend || historicalNDVI;
  const landUseDistribution = React.useMemo(() => {
    const landUse = activeAnalysis?.land_use;
    if (!landUse) {
      return [
        { name: 'Crop', value: 45, color: '#22c55e' },
        { name: 'Forest', value: 25, color: '#16a34a' },
        { name: 'Other', value: 30, color: '#94a3b8' },
      ];
    }

    return [
      { name: 'Crop', value: landUse.cropland || 0, color: '#22c55e' },
      { name: 'Grass', value: landUse.grassland || 0, color: '#84cc16' },
      { name: 'Forest', value: landUse.forest || 0, color: '#16a34a' },
      { name: 'Water', value: landUse.water || 0, color: '#0ea5e9' },
      { name: 'Built', value: landUse.built_up || 0, color: '#64748b' },
      { name: 'Bare', value: landUse.bare_land || 0, color: '#f59e0b' },
    ];
  }, [activeAnalysis]);

  // Get name from any feature
  const getName = useCallback((feature) => {
    if (!feature) return 'Unknown';
    const p = feature.properties || {};
    return p.shapeName || 
           p.ADM2_EN || 
           p.ADM1_EN || 
           p.NAME || 
           p.County || 
           p.COUNTY_NAM || 
           p.COUNTY_NAME || 
           'Unknown';
  }, []);

  const getCountyName = useCallback((feature) => feature?.properties?.ADM1_EN || getName(feature), [getName]);

  // Helper to extract official code (e.g., KE001 -> 1, KE047 -> 47)
  const getCountyCode = useCallback((f) => {
    const p = f.properties || {};
    const code = p.COUNTY_COD || p.ADM1_PCODE || p.ID_1 || "";
    const num = parseInt(String(code).replace(/\D/g, '')); // Extracts 1 from KE001
    return isNaN(num) ? 999 : num;
  }, []);

  const getAnalysisIdentifier = useCallback((feature, level) => {
    const p = feature?.properties || {};
    if (level === 'ward') return p.shapeID || p.ADM3_PCODE || p.shapeName || getName(feature);
    if (level === 'subcounty') return p.ADM2_PCODE || p.ADM2_EN || getName(feature);
    return p.ADM1_PCODE || p.ADM1_EN || getCountyName(feature);
  }, [getCountyName, getName]);

  // Persist farms to localStorage
  useEffect(() => {
    localStorage.setItem('aeis_farms', JSON.stringify(farms));
  }, [farms]);

  useEffect(() => {
    if (fetchGeoJSONData) fetchGeoJSONData(); // Call conditionally
  }, [fetchGeoJSONData]);

  useEffect(() => {
    setFeedPage(0);
  }, [accessCountyName, countryAnalysis?.generated_at]);

  const refreshIntelligence = useCallback(async () => {
    try {
      const [countryResponse, automationResponse] = await Promise.all([
        fetch(`${API_BASE}/api/analysis/country`),
        fetch(`${API_BASE}/api/automation/status`),
      ]);

      if (!countryResponse.ok) {
        throw new Error(`Backend Error: ${countryResponse.status} ${countryResponse.statusText}`);
      }
      if (!automationResponse.ok) {
        throw new Error(`Automation Error: ${automationResponse.status} ${automationResponse.statusText}`);
      }

      const [countryData, automationData] = await Promise.all([
        countryResponse.json(),
        automationResponse.json(),
      ]);

      setCountryAnalysis(countryData);
      setAutomationStatus(automationData);
      setApiStatus('Local API connected');
      setLastSyncAt(new Date());
      setNextSyncAt(new Date(Date.now() + refreshSeconds * 1000));
      setSyncCount((count) => count + 1);

      if (selectedWard) {
        await fetchAnalysis('ward', getAnalysisIdentifier(selectedWard, 'ward'));
      } else if (selectedSubCounty) {
        await fetchAnalysis('subcounty', getAnalysisIdentifier(selectedSubCounty, 'subcounty'));
      } else if (selectedCounty) {
        await fetchAnalysis('county', getAnalysisIdentifier(selectedCounty, 'county'));
      }
    } catch (error) {
      console.error("Analysis Fetch Error:", error);
      setApiStatus(`API Error: ${error.message}. Ensure backend is running.`);
    }
  }, [fetchAnalysis, getAnalysisIdentifier, refreshSeconds, selectedCounty, selectedSubCounty, selectedWard]);

  useEffect(() => {
    refreshIntelligence();
  }, [refreshIntelligence]);

  useEffect(() => {
    if (!automationEnabled) {
      setNextSyncAt(null);
      return undefined;
    }

    setNextSyncAt(new Date(Date.now() + refreshSeconds * 1000));
    const timer = window.setInterval(refreshIntelligence, refreshSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [automationEnabled, refreshIntelligence, refreshSeconds]);

  // Effect to manage layer visibility based on selection
  useEffect(() => {
    // CRITICAL: Check most specific first (Ward > SubCounty > County)
    if (!setLayerVisibility || typeof setLayerVisibility !== 'function') return;

    if (selectedSubCounty) {
      setLayerVisibility('counties', true);
      setLayerVisibility('subcounties', true);
      setLayerVisibility('wards', true);
    } else if (selectedCounty) {
      setLayerVisibility('counties', true);
      setLayerVisibility('subcounties', true);
      setLayerVisibility('wards', false); // Hide wards when only county is selected
    } else {
      setLayerVisibility('counties', true); // Always show counties by default
      setLayerVisibility('subcounties', false);
      setLayerVisibility('wards', false);
    }
  }, [selectedCounty, selectedSubCounty, setLayerVisibility]);

  // Sort counties by official numeric code (Mombasa = 1, Nairobi = 47)
  const sortedCounties = React.useMemo(() => {
    if (!counties) return [];
    return [...counties.features].sort((a, b) => getCountyCode(a) - getCountyCode(b));
  }, [counties, getCountyCode]);

  useEffect(() => {
    if (!loginCountyName && sortedCounties.length > 0) {
      const firstCounty = sortedCounties[0];
      const name = getCountyName(firstCounty);
      setLoginCountyName(name);
      setLoginUsername(`${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}_county`);
    }
  }, [getCountyName, loginCountyName, sortedCounties]);

  const accessibleCounties = React.useMemo(() => {
    if (!accessCountyName) return sortedCounties;
    return sortedCounties.filter((feature) => getCountyName(feature) === accessCountyName);
  }, [accessCountyName, getCountyName, sortedCounties]);

  // HIGH PERFORMANCE HIERARCHY FILTERING
  const linkedSubcounties = React.useMemo(() => {
    if (!subcounties || !selectedCounty) return [];
    const countyName = selectedCounty.properties?.ADM1_EN;
    return subcounties.features.filter(sub => {
      try {
        return sub.properties?.ADM1_EN === countyName;
      } catch(e) { return false; }
    });
  }, [subcounties, selectedCounty]);

  const linkedWards = React.useMemo(() => {
    if (!wards || !selectedSubCounty) return [];
    const subcountyCode = selectedSubCounty.properties?.ADM2_PCODE;
    const subcountyName = selectedSubCounty.properties?.ADM2_EN;
    return wards.features.filter((ward) => {
      try {
        const parentName = ward.properties?.ADM2_EN || ward.properties?.SubCounty;
        return (
          (subcountyCode && ward.properties?.ADM2_PCODE === subcountyCode) ||
          (subcountyName && parentName === subcountyName)
        );
      } catch(e) { return false; }
    });
  }, [wards, selectedSubCounty]);

  // Filtered counties based on search
  const filteredCounties = React.useMemo(() => {
    if (!sortedCounties) return [];
    if (!searchQuery) return accessibleCounties;
    const q = searchQuery.toLowerCase();
    return accessibleCounties.filter(f => 
      getCountyName(f).toLowerCase().includes(q)
    );
  }, [accessibleCounties, searchQuery, getCountyName]);

  // Filtered subcounties based on search
  const filteredSubcounties = React.useMemo(() => {
    if (!linkedSubcounties) return [];
    if (!searchQuery) return linkedSubcounties;
    const q = searchQuery.toLowerCase();
    return linkedSubcounties.filter(f => 
      getName(f).toLowerCase().includes(q)
    );
  }, [linkedSubcounties, searchQuery, getName]);

  // Global search matching all subcounties across all counties
  const globalFilteredSubcounties = React.useMemo(() => {
    if (!subcounties || !searchQuery) return [];
    const q = searchQuery.toLowerCase();
    return subcounties.features.filter(f => 
      (!accessCountyName || f.properties?.ADM1_EN === accessCountyName) &&
      getName(f).toLowerCase().includes(q)
    );
  }, [subcounties, searchQuery, getName, accessCountyName]);

  // Global search matching all wards across the country
  const globalFilteredWards = React.useMemo(() => {
    if (!wards || !searchQuery || searchQuery.length < 3) return [];
    const q = searchQuery.toLowerCase();
    return wards.features.filter(f => 
      (!accessCountyName || f.properties?.ADM1_EN === accessCountyName) &&
      (f.properties?.shapeName || "").toLowerCase().includes(q)
    );
  }, [wards, searchQuery, accessCountyName]);

  // Unified search results for global lookup
  const searchResults = React.useMemo(() => {
    if (!searchQuery) return [];
    const q = searchQuery.toLowerCase();
    
    const matchedCounties = (accessibleCounties || [])
      .filter(f => getCountyName(f).toLowerCase().includes(q))
      .map(f => ({ 
        type: 'County', 
        name: `[${String(getCountyCode(f)).padStart(3, '0')}] ${getCountyName(f)}`, 
        feature: f, 
        parent: null 
      }));

    const matchedSubcounties = globalFilteredSubcounties.map(f => ({
      type: 'Sub-County',
      name: getName(f),
      parent: f.properties?.ADM1_EN || f.properties?.NAME_1 || f.properties?.County || f.properties?.NAME,
      feature: f
    }));

    const matchedWards = globalFilteredWards.map(f => ({
      type: 'Ward',
      name: f.properties?.shapeName,
      parent: f.properties?.ADM2_EN || f.properties?.SubCounty,
      parentCode: f.properties?.ADM2_PCODE,
      county: f.properties?.ADM1_EN,
      countyCode: f.properties?.ADM1_PCODE,
      feature: f
    }));

    return [...matchedCounties, ...matchedSubcounties, ...matchedWards].slice(0, 15);
  }, [searchQuery, accessibleCounties, globalFilteredSubcounties, globalFilteredWards, getCountyName, getCountyCode, getName]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(-1);
  }, [searchResults]);

  const handleKeyDown = (e) => {
    if (searchResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev < searchResults.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev > 0 ? prev - 1 : searchResults.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const indexToSelect = activeIndex >= 0 ? activeIndex : 0;
      if (searchResults[indexToSelect]) {
        handleSearchResultSelect(searchResults[indexToSelect]);
      }
    } else if (e.key === 'Escape') {
      setSearchQuery('');
    }
  };

  useEffect(() => {
    if (selectedWard) {
      fetchAnalysis('ward', getAnalysisIdentifier(selectedWard, 'ward'));
      return;
    }
    if (selectedSubCounty) {
      fetchAnalysis('subcounty', getAnalysisIdentifier(selectedSubCounty, 'subcounty'));
      return;
    }
    if (selectedCounty) {
      fetchAnalysis('county', getAnalysisIdentifier(selectedCounty, 'county'));
    }
  }, [fetchAnalysis, getAnalysisIdentifier, selectedCounty, selectedSubCounty, selectedWard]);

  // Zoom to feature with smooth animation
  const zoomToFeature = (feature, opts = {}) => {
    if (!mapInstance || !feature) return;
    const layer = L.geoJSON(feature);
    const bounds = layer.getBounds();
    if (!bounds.isValid()) return;

    const flyOptions = {
      padding: [35, 35],
      maxZoom: opts.maxZoom ?? 12,
      duration: opts.duration ?? 0.75,
      easeLinearity: 0.25,
    };

    try {
      mapInstance.flyToBounds(bounds, flyOptions);
    } catch (e) {
      mapInstance.fitBounds(bounds, { padding: [35, 35] });
    }
  };

  // Select handlers
  const selectCounty = (county) => {
    if (accessCountyName && getCountyName(county) !== accessCountyName) return;
    setSelectedCounty(county); // Use Zustand action
    setSelectedSubCounty(null); // Use Zustand action
    setSelectedWard(null); // Use Zustand action
    zoomToFeature(county);
  };

  const handleAccessProfileChange = (countyName) => {
    setAccessCountyName(countyName);

    if (!countyName) {
      setSelectedCounty(null);
      setSelectedSubCounty(null);
      setSelectedWard(null);
      setSearchQuery('');
      if (mapInstance) mapInstance.setView([0.0236, 37.9062], 6);
      return;
    }

    const county = sortedCounties.find((feature) => getCountyName(feature) === countyName);
    if (county) {
      setSelectedCounty(county);
      setSelectedSubCounty(null);
      setSelectedWard(null);
      setSearchQuery('');
      zoomToFeature(county, { maxZoom: 8 });
    }
  };

  const selectLoginCounty = (countyName) => {
    setLoginCountyName(countyName);
    const username = `${countyName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}_county`;
    setLoginUsername(username);
    setLoginStatus('');
  };

  const requestLoginGPS = () => {
    if (!navigator.geolocation) {
      setLoginStatus('GPS is not available in this browser.');
      return;
    }

    setLoginStatus('Checking GPS...');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLoginLatitude(position.coords.latitude.toFixed(6));
        setLoginLongitude(position.coords.longitude.toFixed(6));
        setLoginStatus('GPS captured.');
      },
      (error) => {
        setLoginStatus(error.message || 'GPS permission was denied.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleCountyLogin = async (event) => {
    event.preventDefault();
    const feature = sortedCounties.find((county) => getCountyName(county) === loginCountyName);
    if (!feature) {
      setLoginStatus('Select a county first.');
      return;
    }

    setLoggingIn(true);
    setLoginStatus('Signing in...');

    try {
      const response = await fetch(`${API_BASE}/api/auth/county-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          county_code: feature.properties?.ADM1_PCODE,
          username: loginUsername,
          password: loginPassword,
          latitude: Number(loginLatitude),
          longitude: Number(loginLongitude),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'County login failed');

      setCountySession(data);
      setLoginPassword('');
      setLoginStatus(`Signed in: ${data.county}`);
      handleAccessProfileChange(data.county);
    } catch (error) {
      setLoginStatus(error.message);
    } finally {
      setLoggingIn(false);
    }
  };

  const signOutCounty = () => {
    setCountySession(null);
    setLoginStatus('County session ended.');
    handleAccessProfileChange('');
  };

  const handleSearchResultSelect = (result) => {
    const q = result.name.toLowerCase();
    
    if (result.type === 'County') {
      selectCounty(result.feature);
    } 
    else if (result.type === 'Sub-County') {
      // Find parent county to maintain visibility
      const parent = counties?.features.find(c => 
        getCountyName(c).toLowerCase().includes((result.parent || "").toLowerCase())
      );
      if (parent) setSelectedCounty(parent);
      
      setTimeout(() => {
        selectSubcounty(result.feature);
        zoomToFeature(result.feature);
      }, 50);
    } 
    else if (result.type === 'Ward') {
      // Deep drill-down for Wards
      const subParent = subcounties?.features.find(s => 
        (result.parentCode && s.properties?.ADM2_PCODE === result.parentCode) ||
        (s.properties?.ADM2_EN || "").toLowerCase() === (result.parent || "").toLowerCase() ||
        (s.properties?.NAME || "").toLowerCase() === (result.parent || "").toLowerCase()
      );
      
      if (subParent) {
        const countyParent = counties?.features.find(c => 
          (result.countyCode && c.properties?.ADM1_PCODE === result.countyCode) ||
          getCountyName(c).toLowerCase().includes((subParent.properties?.ADM1_EN || "").toLowerCase())
        );
        
        if (countyParent) setSelectedCounty(countyParent);
        
        setTimeout(() => {
          // Order matters: Set parents first, then the child
          useAEISStore.getState().setSelectedCounty(countyParent);
          useAEISStore.getState().setSelectedSubCounty(subParent);
          setSelectedWard(result.feature);
          zoomToFeature(result.feature, { maxZoom: 13 });
        }, 100);
      }
    }
    setSearchQuery('');
  };

  const selectSubcounty = (sub) => {
    setSelectedSubCounty(sub); // Use Zustand action
    setSelectedWard(null); // Use Zustand action
    zoomToFeature(sub, { maxZoom: 10 });
  };

  const selectWard = (ward) => {
    setSelectedWard(ward); // Use Zustand action
    zoomToFeature(ward, { maxZoom: 13 });
  };

  const exportFarms = useCallback(() => {
    if (farms.length === 0) return;

    const featureCollection = {
      type: 'FeatureCollection',
      features: farms.map(f => {
        const feature = JSON.parse(JSON.stringify(f.geometry));
        // Flatten analytical results into properties for standard GIS software compatibility
        feature.properties = {
          ...feature.properties,
          name: f.name,
          area_turf: f.area,
          id: f.id,
          // Analytical Results
          area_ha: f.analysis?.area_ha,
          ndvi: f.analysis?.crop_health?.ndvi,
          crop_health_status: f.analysis?.crop_health?.status,
          soil_moisture_index: f.analysis?.soil_moisture?.index,
          soil_moisture_status: f.analysis?.soil_moisture?.status,
          crop_strength_index: f.analysis?.crop_strength?.index,
          crop_strength_status: f.analysis?.crop_strength?.status,
          land_classification: f.analysis?.classification,
          roads_km: f.analysis?.infrastructure?.roads_km,
          cropland_pct: f.analysis?.land_use?.cropland,
          grassland_pct: f.analysis?.land_use?.grassland,
          forest_pct: f.analysis?.land_use?.forest,
          built_up_pct: f.analysis?.land_use?.built_up,
          bare_land_pct: f.analysis?.land_use?.bare_land,
          analysis_generated_at: f.analysis?.generated_at
        };
        return feature;
      })
    };

    const blob = new Blob([JSON.stringify(featureCollection, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'aeis_farms.geojson';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [farms]);

  const handleFileChange = useCallback(async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target.result;
        const geojson = JSON.parse(content);

        let featuresToProcess = [];
        if (geojson.type === 'FeatureCollection') {
          featuresToProcess = geojson.features;
        } else if (geojson.type === 'Feature') {
          featuresToProcess = [geojson];
        } else if (geojson.type === 'Polygon' || geojson.type === 'MultiPolygon') {
          featuresToProcess = [{ type: 'Feature', geometry: geojson, properties: {} }];
        } else {
          alert('Unsupported GeoJSON type. Please upload a FeatureCollection, Feature, Polygon, or MultiPolygon.');
          return;
        }

        const newFarms = [];
        for (const feature of featuresToProcess) {
          if (feature.geometry && (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')) {
            let area = 0;
            try { area = (turf.area(feature) / 10000).toFixed(2); } catch(e) { area = '?'; }

            const farmId = Date.now() + Math.random(); // Ensure unique ID for batch upload
            const farmName = feature.properties?.name || feature.properties?.NAME || `Imported Farm ${newFarms.length + 1}`;

            const analysisData = await fetchAreaAnalysis(feature.geometry);

            const newFarm = {
              id: farmId,
              name: farmName,
              geometry: feature,
              area: area + ' ha',
              analysis: analysisData
            };
            newFarms.push(newFarm);
          }
        }
        setFarms(prev => [...prev, ...newFarms]);
      } catch (error) {
        alert('Error parsing GeoJSON file: ' + error.message);
        console.error('Error parsing GeoJSON:', error);
      }
    };
    reader.readAsText(file);
  }, [fetchAreaAnalysis]);

  const deleteFarm = useCallback((id, name) => {
    if (!window.confirm(`Are you sure you want to delete "${name}"?`)) {
      return;
    }
    setFarms(prev => prev.filter(f => f.id !== id));
  }, []);

  const reset = () => {
    if (accessCountyName) {
      const county = sortedCounties.find((feature) => getCountyName(feature) === accessCountyName);
      if (county) {
        setSelectedCounty(county);
        setSelectedSubCounty(null);
        setSelectedWard(null);
        setSearchQuery('');
        zoomToFeature(county, { maxZoom: 8 });
      }
      return;
    }

    setSelectedCounty(null);
    setSelectedSubCounty(null);
    setSelectedWard(null);
    setSearchQuery('');
    if (mapInstance) mapInstance.setView([0.0236, 37.9062], 6);
  };
 
  const apiReady = apiStatus === 'Local API connected';
  const priorityCounties = automationStatus?.priority_counties || countryAnalysis?.priority_counties || [];
  const visiblePriorityCounties = accessCountyName
    ? priorityCounties.filter((row) => row.county === accessCountyName)
    : priorityCounties;
  const countyFeedRows = React.useMemo(() => {
    const rows = countryAnalysis?.counties || [];
    const filtered = accessCountyName
      ? rows.filter((row) => row.county === accessCountyName)
      : rows;
    return [...filtered].sort((a, b) => String(a.county_code || '').localeCompare(String(b.county_code || '')));
  }, [accessCountyName, countryAnalysis]);
  const feedPageSize = 5;
  const totalFeedPages = Math.max(1, Math.ceil(countyFeedRows.length / feedPageSize));
  const visibleCountyFeedRows = countyFeedRows.slice(feedPage * feedPageSize, feedPage * feedPageSize + feedPageSize);
  const nationalRisk = automationStatus?.national_risk || countryAnalysis?.risk;
  const formatTime = (date) => date ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Waiting';
  const riskColor = (level) => {
    if (level === 'critical') return '#dc2626';
    if (level === 'high') return '#f97316';
    if (level === 'watch') return '#ca8a04';
    return '#059669';
  };
  const focusPriorityCounty = (row) => {
    if (accessCountyName && row.county !== accessCountyName) return;
    const feature = counties?.features.find((county) =>
      county.properties?.ADM1_PCODE === row.county_code ||
      getCountyName(county) === row.county
    );
    if (feature) selectCounty(feature);
  };
  const activeScopeLabel = selectedWard
    ? `Ward: ${getName(selectedWard)}`
    : selectedSubCounty
    ? `Sub-county: ${getName(selectedSubCounty)}`
    : selectedCounty
    ? `County: ${getCountyName(selectedCounty)}`
    : 'Kenya National View';
  const activeRoadTypes = activeAnalysis?.infrastructure?.road_types || {};
  const forecastData = activeAnalysis?.weather?.forecast_14_day || [];
  const forestTrendData = activeAnalysis?.forest_trend || [];
  const recommendations = activeAnalysis?.recommendations || [];
  const currentAccessLabel = accessCountyName ? `${accessCountyName} County Login` : 'National Command Login';

  return (
    <div style={{ height: '100vh', width: '100%', position: 'relative' }}>
      {/* Control Panel */}
      <button 
        onClick={() => setSidebarOpen(!sidebarOpen)}
        style={{
          position: 'absolute', top: 20, right: sidebarOpen ? 340 : 20, zIndex: 2001,
          background: 'white', border: 'none', borderRadius: '12px', width: 40, height: 40,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', cursor: 'pointer', transition: 'all 0.3s ease',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20
        }}
        title={sidebarOpen ? "Close Sidebar" : "Open Dashboard"}
      >
        {sidebarOpen ? '✕' : '📊'}
      </button>

      <div style={{
        position: 'absolute', top: 20, right: sidebarOpen ? 20 : -400, zIndex: 2000,
        background: 'rgba(255, 255, 255, 0.96)', backdropFilter: 'blur(10px)',
        padding: 24, borderRadius: 20,
        boxShadow: '0 10px 40px rgba(0,0,0,0.1)', width: 300,
        boxSizing: 'border-box',
        maxHeight: '90vh', overflowY: 'auto', overflowX: 'hidden', transition: 'right 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        border: '1px solid rgba(255, 255, 255, 0.3)'
      }}>
        <h2 style={{ margin: '0 0 4px 0', fontSize: 22, fontWeight: 800, color: '#1e293b', letterSpacing: '-0.5px' }}>🇰🇪 AEIS-K</h2>
        <p style={{ margin: '0 0 20px 0', fontSize: 13, color: '#64748b' }}>National Agricultural Intelligence</p>

        {/* Digital Twin Hierarchy Status - Permanent Decision Support Context */}
        <div style={{ 
          marginBottom: 20, padding: '14px', background: '#f1f5f9', 
          borderRadius: '14px', border: '1px solid #e2e8f0',
          boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.03)'
        }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>📍 Command Center Focus</div>
          <div style={{ fontSize: 13, color: '#0f172a', fontWeight: 700, lineHeight: 1.5 }}>
            <span onClick={reset} style={{ cursor: 'pointer', color: '#2563eb', textDecoration: 'underline' }}>Kenya</span>
            {selectedCounty && <><span style={{ margin: '0 4px', color: '#94a3b8' }}>›</span><span onClick={() => selectCounty(selectedCounty)} style={{ cursor: 'pointer', color: '#2563eb' }}>{getCountyName(selectedCounty)}</span></>}
            {selectedSubCounty && <><span style={{ margin: '0 4px', color: '#94a3b8' }}>›</span><span onClick={() => selectSubcounty(selectedSubCounty)} style={{ cursor: 'pointer', color: '#2563eb' }}>{getName(selectedSubCounty)}</span></>}
            {selectedWard && <><span style={{ margin: '0 4px', color: '#94a3b8' }}>›</span><span>{getName(selectedWard)}</span></>}
          </div>
        </div>

        <div style={{
          fontSize: 12,
          color: apiReady ? '#047857' : '#92400e',
          marginBottom: 24,
          lineHeight: 1.4,
          padding: '12px',
          background: apiReady ? '#f0fdf4' : '#fffbeb',
          borderRadius: '12px',
          border: `1px solid ${apiReady ? '#bcf0da' : '#fef3c7'}`
        }}>
          {apiStatus}
        </div>

        <div style={{
          marginBottom: 18,
          padding: '14px',
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 14
        }}>
          <label style={{ display: 'block', fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>
            Access Profile
          </label>
          {countySession ? (
            <>
              <div style={{ padding: 10, borderRadius: 10, background: 'white', border: '1px solid #cbd5e1', fontSize: 13, fontWeight: 800, color: '#0f172a' }}>
                {countySession.county} County
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: '#0f766e', fontWeight: 700 }}>
                GPS verified | County-only boundary access
              </div>
              <button
                onClick={signOutCounty}
                style={{ width: '100%', marginTop: 10, padding: 9, borderRadius: 9, border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer', fontSize: 12, fontWeight: 800 }}
              >
                Sign out county
              </button>
            </>
          ) : (
            <>
              <select
                value={accessCountyName}
                onChange={(event) => handleAccessProfileChange(event.target.value)}
                style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid #cbd5e1', background: 'white', fontSize: 13, fontWeight: 700, color: '#0f172a' }}
              >
                <option value="">National Command Center</option>
                {sortedCounties.map((feature) => (
                  <option key={feature.properties?.ADM1_PCODE || getCountyName(feature)} value={getCountyName(feature)}>
                    {getCountyName(feature)} County Scope
                  </option>
                ))}
              </select>
              <div style={{ marginTop: 8, fontSize: 11, color: accessCountyName ? '#0f766e' : '#475569', fontWeight: 700 }}>
                {currentAccessLabel}
              </div>
            </>
          )}
        </div>

        {!countySession && (
          <form onSubmit={handleCountyLogin} style={{
            marginBottom: 18,
            padding: '14px',
            background: '#f0fdfa',
            border: '1px solid #99f6e4',
            borderRadius: 14
          }}>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 800, color: '#0f766e', textTransform: 'uppercase', marginBottom: 8 }}>
              County Login
            </label>
            <select
              value={loginCountyName}
              onChange={(event) => selectLoginCounty(event.target.value)}
              style={{ width: '100%', padding: 9, borderRadius: 10, border: '1px solid #99f6e4', background: 'white', fontSize: 12, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}
            >
              {sortedCounties.map((feature) => (
                <option key={feature.properties?.ADM1_PCODE || getCountyName(feature)} value={getCountyName(feature)}>
                  {getCountyName(feature)}
                </option>
              ))}
            </select>
            <input
              value={loginUsername}
              onChange={(event) => setLoginUsername(event.target.value)}
              placeholder="County username"
              style={{ width: '100%', boxSizing: 'border-box', padding: 9, borderRadius: 10, border: '1px solid #99f6e4', marginBottom: 8, fontSize: 12 }}
            />
            <input
              type="password"
              value={loginPassword}
              onChange={(event) => setLoginPassword(event.target.value)}
              placeholder="Password"
              style={{ width: '100%', boxSizing: 'border-box', padding: 9, borderRadius: 10, border: '1px solid #99f6e4', marginBottom: 8, fontSize: 12 }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <input
                value={loginLatitude}
                onChange={(event) => setLoginLatitude(event.target.value)}
                placeholder="Latitude"
                style={{ minWidth: 0, padding: 9, borderRadius: 10, border: '1px solid #99f6e4', fontSize: 12 }}
              />
              <input
                value={loginLongitude}
                onChange={(event) => setLoginLongitude(event.target.value)}
                placeholder="Longitude"
                style={{ minWidth: 0, padding: 9, borderRadius: 10, border: '1px solid #99f6e4', fontSize: 12 }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                type="button"
                onClick={requestLoginGPS}
                style={{ padding: 9, borderRadius: 9, border: '1px solid #14b8a6', background: 'white', color: '#0f766e', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
              >
                Use GPS
              </button>
              <button
                type="submit"
                disabled={loggingIn}
                style={{ padding: 9, borderRadius: 9, border: 'none', background: '#0f766e', color: 'white', fontSize: 12, fontWeight: 800, cursor: loggingIn ? 'default' : 'pointer' }}
              >
                {loggingIn ? 'Checking' : 'Sign in'}
              </button>
            </div>
            {loginStatus && (
              <div style={{ marginTop: 8, fontSize: 11, color: loginStatus.toLowerCase().includes('failed') || loginStatus.toLowerCase().includes('denied') || loginStatus.toLowerCase().includes('outside') ? '#b91c1c' : '#0f766e', fontWeight: 700, lineHeight: 1.35 }}>
                {loginStatus}
              </div>
            )}
          </form>
        )}

        <div style={{
          marginBottom: 18,
          padding: '14px',
          background: '#0f172a',
          color: 'white',
          borderRadius: 14,
          boxShadow: '0 8px 20px rgba(15, 23, 42, 0.16)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#93c5fd', fontWeight: 800 }}>Automation Monitor</div>
              <div style={{ fontSize: 17, fontWeight: 800 }}>{automationEnabled ? 'Running' : 'Paused'}</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={automationEnabled}
                onChange={(event) => setAutomationEnabled(event.target.checked)}
              />
              Auto
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 10, padding: '8px' }}>
              <div style={{ fontSize: 10, color: '#cbd5e1', fontWeight: 700 }}>Last sync</div>
              <div style={{ fontSize: 12, fontWeight: 800 }}>{formatTime(lastSyncAt)}</div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 10, padding: '8px' }}>
              <div style={{ fontSize: 10, color: '#cbd5e1', fontWeight: 700 }}>Next sync</div>
              <div style={{ fontSize: 12, fontWeight: 800 }}>{automationEnabled ? formatTime(nextSyncAt) : 'Paused'}</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select
              value={refreshSeconds}
              onChange={(event) => setRefreshSeconds(Number(event.target.value))}
              style={{ flex: 1, padding: 8, borderRadius: 9, border: '1px solid #334155', background: '#1e293b', color: 'white', fontSize: 12 }}
            >
              <option value={15}>15 sec cycle</option>
              <option value={30}>30 sec cycle</option>
              <option value={60}>60 sec cycle</option>
            </select>
            <button
              onClick={refreshIntelligence}
              style={{ padding: '9px 10px', border: 'none', borderRadius: 9, background: '#38bdf8', color: '#082f49', fontWeight: 800, cursor: 'pointer', fontSize: 12 }}
            >
              Sync
            </button>
          </div>

          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#cbd5e1' }}>
            <span>Cycles: {syncCount}</span>
            {nationalRisk && (
              <span style={{ color: riskColor(nationalRisk.level), fontWeight: 900 }}>
                Risk {nationalRisk.score} / {nationalRisk.level}
              </span>
            )}
          </div>
        </div>
        
        {loadingGeoJSON && <LoadingSpinner />}

        {geoJSONError && (
          <div style={{ 
            padding: '12px', background: '#fef2f2', border: '1px solid #fee2e2', 
            borderRadius: '12px', color: '#b91c1c', fontSize: 12, marginBottom: 20 
          }}>
            ❌ <b>Map Load Error:</b> {geoJSONError}
          </div>
        )}

        {counties && subcounties && wards && (
          <div style={{
            fontSize: 11,
            color: '#065f46',
            marginBottom: 16,
            padding: '10px 12px',
            background: '#ecfdf5',
            borderRadius: 10,
            border: '1px solid #a7f3d0',
            fontWeight: 700,
            lineHeight: 1.35
          }}>
            Boundaries ready: {counties.features.length} counties, {subcounties.features.length} sub-counties, {wards.features.length} wards
          </div>
        )}
        
        {/* Base Map */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase' }}>Basemap Style</label>
          <select value={baseMap} onChange={e => setBaseMap(e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid #e2e8f0', borderRadius: 10, background: '#f8fafc', fontSize: 14 }}>
            <option value="street">Street</option>
            <option value="satellite">Satellite</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </div>

        <div style={{ marginBottom: 24, background: '#f1f5f9', padding: 16, borderRadius: 12 }}>
          <strong style={{ display: 'block', fontSize: 12, marginBottom: 10, color: '#475569', textTransform: 'uppercase' }}>Country Overview</strong>
          {countryAnalysis ? (
            <>
              <MetricRow label="Counties" value={countryAnalysis.admin_units?.counties || 0} />
              <MetricRow label="Sub-counties" value={countryAnalysis.admin_units?.subcounties || 0} />
              <MetricRow label="Wards" value={countryAnalysis.admin_units?.wards || 0} />
                <MetricRow 
                  label="Crop health NDVI" 
                  value={<>{countryAnalysis.crop_health?.ndvi ?? 'N/A'} {compareCounty && <VarianceBadge value={countryAnalysis.crop_health?.ndvi} compareValue={0.52} />}</>} 
                  status={countryAnalysis.crop_health?.status}
                />
                <MetricRow 
                  label="Soil moisture" 
                  value={<>{countryAnalysis.soil_moisture?.index ?? 0}% {compareCounty && <VarianceBadge value={countryAnalysis.soil_moisture?.index} compareValue={42} />}</>} 
                  status={countryAnalysis.soil_moisture?.status} 
                />
                <MetricRow label="Crop strength" value={`${countryAnalysis.crop_strength?.index || 0}%`} status={countryAnalysis.crop_strength?.status} />
                <MetricRow label="Cropland share" value={`${countryAnalysis.land_use?.cropland || 0}%`} />
                <MetricRow
                  label="National risk"
                  value={countryAnalysis.risk ? `${countryAnalysis.risk.score}/100` : 'N/A'}
                  status={countryAnalysis.risk?.level}
                />
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed #cbd5e1', display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 600 }}>
                  <span style={{ color: '#059669' }}>AUTO BASELINE: READY</span>
                  <span style={{ color: '#0284c7' }}>MODE: {countryAnalysis.data_mode || 'setup'}</span>
                </div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>
              Waiting for API data...
            </div>
          )}
        </div>

        {visibleCountyFeedRows.length > 0 && (
          <div style={{ marginBottom: 24, padding: '14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: '#334155', textTransform: 'uppercase' }}>County Intelligence Feed</div>
              <div style={{ fontSize: 10, color: '#64748b', fontWeight: 800 }}>{feedPage + 1}/{totalFeedPages}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {visibleCountyFeedRows.map((row) => (
                <button
                  key={row.county_code || row.county}
                  onClick={() => focusPriorityCounty(row)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 8,
                    alignItems: 'center',
                    width: '100%',
                    textAlign: 'left',
                    border: '1px solid #e2e8f0',
                    background: 'white',
                    borderRadius: 10,
                    padding: '9px 10px',
                    cursor: 'pointer'
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.county}</span>
                    <span style={{ display: 'block', fontSize: 10, color: '#64748b', fontWeight: 700 }}>NDVI {row.crop_health?.ndvi} | NDBI {row.indices?.ndbi} | Roads {row.infrastructure?.roads_km} km</span>
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 900, color: riskColor(row.risk?.level), textTransform: 'uppercase' }}>
                    {row.risk?.score}
                  </span>
                </button>
              ))}
            </div>
            {!accessCountyName && totalFeedPages > 1 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button
                  onClick={() => setFeedPage((page) => Math.max(0, page - 1))}
                  disabled={feedPage === 0}
                  style={{ flex: 1, padding: '8px', borderRadius: 9, border: '1px solid #cbd5e1', background: feedPage === 0 ? '#f1f5f9' : 'white', cursor: feedPage === 0 ? 'default' : 'pointer', fontWeight: 800, fontSize: 11 }}
                >
                  Prev
                </button>
                <button
                  onClick={() => setFeedPage((page) => Math.min(totalFeedPages - 1, page + 1))}
                  disabled={feedPage >= totalFeedPages - 1}
                  style={{ flex: 1, padding: '8px', borderRadius: 9, border: '1px solid #cbd5e1', background: feedPage >= totalFeedPages - 1 ? '#f1f5f9' : 'white', cursor: feedPage >= totalFeedPages - 1 ? 'default' : 'pointer', fontWeight: 800, fontSize: 11 }}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}

        {/* Intelligence Parameters (NDVI/NDWI Heatmaps) */}
        <div style={{ marginBottom: 24, padding: '12px', background: '#f8fafc', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
          <label style={{ display: 'block', fontSize: 10, fontWeight: 800, color: '#64748b', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>🛰️ Intelligence Feeds</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <button 
              onClick={() => setLayerVisibility('ndvi', !layers.ndvi)}
              style={{ 
                padding: '10px', borderRadius: '12px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '11px',
                background: layers.ndvi ? '#22c55e' : '#f1f5f9', color: layers.ndvi ? 'white' : '#64748b',
                boxShadow: layers.ndvi ? '0 4px 12px rgba(34, 197, 94, 0.3)' : 'none', transition: 'all 0.2s'
              }}>🌱 NDVI HEAT</button>
            <button 
              onClick={() => setLayerVisibility('ndwi', !layers.ndwi)}
              style={{ 
                padding: '10px', borderRadius: '12px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '11px',
                background: layers.ndwi ? '#0ea5e9' : '#f1f5f9', color: layers.ndwi ? 'white' : '#64748b',
                boxShadow: layers.ndwi ? '0 4px 12px rgba(14, 165, 233, 0.3)' : 'none', transition: 'all 0.2s'
              }}>💧 NDWI HEAT</button>
            <button 
              onClick={() => setLayerVisibility('ndbi', !layers.ndbi)}
              style={{ 
                gridColumn: '1 / -1',
                padding: '10px', borderRadius: '12px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '11px',
                background: layers.ndbi ? '#ea580c' : '#f1f5f9', color: layers.ndbi ? 'white' : '#64748b',
                boxShadow: layers.ndbi ? '0 4px 12px rgba(234, 88, 12, 0.3)' : 'none', transition: 'all 0.2s'
              }}>NDBI BUILT-UP</button>
            <button 
              onClick={() => setLayerVisibility('segmentation', !layers.segmentation)}
              style={{ 
                gridColumn: '1 / -1',
                padding: '10px', borderRadius: '12px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '11px',
                background: layers.segmentation ? SEGMENT_PROFILES[segmentClass].color : '#f1f5f9', color: layers.segmentation ? 'white' : '#64748b',
                boxShadow: layers.segmentation ? `0 4px 12px ${SEGMENT_PROFILES[segmentClass].color}44` : 'none', transition: 'all 0.2s'
              }}>SIMILAR PIXEL DOTS</button>
          </div>
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
            <select
              value={segmentClass}
              onChange={(event) => setSegmentClass(event.target.value)}
              style={{ width: '100%', padding: 9, borderRadius: 10, border: '1px solid #cbd5e1', background: 'white', fontSize: 12, fontWeight: 700, color: '#0f172a' }}
            >
              {Object.entries(SEGMENT_PROFILES).map(([key, profile]) => (
                <option key={key} value={key}>{profile.label}</option>
              ))}
            </select>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 10 }}>
              <input
                type="range"
                min="0.55"
                max="0.9"
                step="0.01"
                value={segmentThreshold}
                onChange={(event) => setSegmentThreshold(Number(event.target.value))}
              />
              <span style={{ fontSize: 11, color: '#475569', fontWeight: 800 }}>{Math.round(segmentThreshold * 100)}%</span>
            </div>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>
              Matches: {segmentationStats.count || 0}
            </div>
          </div>
        </div>

        {/* Quick Search */}
        <div style={{ marginBottom: 20, position: 'relative' }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase' }}>🔍 Search Regions</label>
          <input 
            type="text" 
            placeholder="Type county or sub-county..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{ 
              width: '100%', padding: '10px', border: '1px solid #e2e8f0', 
              borderRadius: 10, background: '#f8fafc', fontSize: 14,
              boxSizing: 'border-box'
            }}
          />
          {/* Global Search Results Dropdown */}
          {searchQuery && searchResults.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 3000,
              marginTop: 8, background: 'white', borderRadius: 12, 
              boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
              maxHeight: 280, overflowY: 'auto', border: '1px solid #e2e8f0'
            }}>
              {searchResults.map((res, i) => (
                <div 
                  key={i} 
                  onClick={() => handleSearchResultSelect(res)}
                  style={{
                    padding: '12px 16px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    transition: 'background 0.2s',
                    background: i === activeIndex ? '#f1f5f9' : 'white'
                  }}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{res.name}</div>
                    {res.parent && <div style={{ fontSize: 11, color: '#64748b' }}>{res.parent} County</div>}
                  </div>
                  <span style={{ 
                    fontSize: 9, padding: '3px 8px', borderRadius: 6, 
                    background: res.type === 'County' ? '#eff6ff' : '#fff7ed',
                    color: res.type === 'County' ? '#2563eb' : '#ea580c',
                    fontWeight: 800, textTransform: 'uppercase', flexShrink: 0, marginLeft: 8
                  }}>
                    {res.type}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* County Dropdown */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 600, fontSize: 12, color: '#64748b', textTransform: 'uppercase' }}>County Focus</label>
          <select value={selectedCounty ? getCountyName(selectedCounty) : ''} onChange={e => {
            const selected = sortedCounties.find(f => getCountyName(f) === e.target.value);
            if (selected) selectCounty(selected);
          }} style={{ width: '100%', padding: 10, marginTop: 5, borderRadius: 10, border: '1px solid #e2e8f0' }}>
            <option value="">-- Select County --</option>
            {filteredCounties.map((f, i) => (
              <option key={i} value={getCountyName(f)}>[{String(getCountyCode(f)).padStart(3, '0')}] {getCountyName(f)}</option>
            ))}
          </select>
        </div>

        {/* Sub-county Dropdown - populated from spatial relationship */}
        {selectedCounty && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontWeight: 600, fontSize: 12, color: '#64748b', textTransform: 'uppercase' }}>Sub-County ({filteredSubcounties.length})</label>
            <select value={selectedSubCounty ? getName(selectedSubCounty) : ''} onChange={e => {
              const selected = filteredSubcounties.find(f => getName(f) === e.target.value);
              if (selected) selectSubcounty(selected);
            }} style={{ width: '100%', padding: 10, marginTop: 5, borderRadius: 10, border: '1px solid #e2e8f0' }}>
              <option value="">-- Select Sub-County --</option>
              {filteredSubcounties.map((f, i) => <option key={i} value={getName(f)}>{getName(f)}</option>)}
            </select>
          </div>
        )}

        {/* Ward Dropdown - populated from spatial relationship */}
        {selectedSubCounty && wards && (
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontWeight: 600, fontSize: 12, color: '#64748b', textTransform: 'uppercase' }}>Ward ({linkedWards.length})</label>
            <select value={getName(selectedWard) !== 'Unknown' ? getName(selectedWard) : ''} onChange={e => {
              const selected = linkedWards.find(f => getName(f) === e.target.value);
              if (selected) selectWard(selected);
            }} style={{ width: '100%', padding: 10, marginTop: 5, borderRadius: 10, border: '1px solid #e2e8f0' }}>
              <option value="">-- Select Ward --</option>
              {linkedWards.map((f, i) => <option key={i} value={getName(f)}>{getName(f)}</option>)}
            </select>
          </div>
        )}

        {activeAnalysis && (
          <div style={{ marginBottom: 24, background: '#f8fafc', padding: 16, borderRadius: 12, border: '1px solid #e2e8f0' }}>
            <strong style={{ display: 'block', fontSize: 12, marginBottom: 10, color: '#334155', textTransform: 'uppercase' }}>Active Intelligence</strong>
            <div style={{ fontSize: 16, fontWeight: 900, color: '#0f172a', marginBottom: 8 }}>{activeScopeLabel}</div>
            <MetricRow label="Estimated area" value={activeAnalysis.area_km2 ? `${activeAnalysis.area_km2} km2` : 'N/A'} />
            <MetricRow label="Crop health NDVI" value={activeAnalysis.crop_health?.ndvi ?? 'N/A'} status={activeAnalysis.crop_health?.status} />
            <MetricRow label="Water index NDWI" value={activeAnalysis.indices?.ndwi ?? 'N/A'} />
            <MetricRow label="Built-up NDBI" value={activeAnalysis.indices?.ndbi ?? 'N/A'} />
            <MetricRow label="Cropland" value={`${activeAnalysis.land_use?.cropland ?? 0}%`} />
            <MetricRow label="Built-up area" value={`${activeAnalysis.land_use?.built_up ?? 0}%`} />
            <MetricRow label="Water bodies" value={`${activeAnalysis.land_use?.water ?? 0}%`} />
            <MetricRow label="Forest" value={`${activeAnalysis.land_use?.forest ?? 0}%`} />
            <MetricRow label="Road network" value={`${activeAnalysis.infrastructure?.roads_km ?? 0} km`} />
            <MetricRow label="Tarmac roads" value={`${activeRoadTypes.tarmac ?? 0} km`} />
            <MetricRow label="All-weather roads" value={`${activeRoadTypes.all_weather ?? 0} km`} />
            <MetricRow label="Marram roads" value={`${activeRoadTypes.marram ?? 0} km`} />
            <MetricRow label="Rainfall signal" value={activeAnalysis.weather?.rainfall_signal || 'N/A'} />
            <MetricRow label="Risk score" value={activeAnalysis.risk ? `${activeAnalysis.risk.score}/100` : 'N/A'} status={activeAnalysis.risk?.level} />

            {recommendations.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed #cbd5e1' }}>
                <div style={{ fontSize: 10, fontWeight: 900, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Recommended Actions</div>
                {recommendations.map((item, index) => (
                  <div key={index} style={{ fontSize: 12, lineHeight: 1.35, color: '#334155', marginBottom: 6, fontWeight: 600 }}>
                    {index + 1}. {item}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Data Visualizations Section */}
        {activeAnalysis && (
          <div style={{ marginTop: 24 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 12, textTransform: 'uppercase' }}>📈 Data Insights</label>
            
            <ChartCard title={`${selectedAnalysis ? 'Selected Area' : 'National'} ${chartMetrics[activeChartMetric].label}`}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                {Object.entries(chartMetrics).map(([key, meta]) => (
                  <button
                    key={key}
                    onClick={() => setActiveChartMetric(key)}
                    style={{
                      padding: '4px 10px',
                      fontSize: '10px',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      background: activeChartMetric === key ? meta.color : 'white',
                      color: activeChartMetric === key ? 'white' : '#64748b',
                      cursor: 'pointer',
                      fontWeight: 700,
                      transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: activeChartMetric === key ? `0 2px 8px ${meta.color}44` : 'none'
                    }}
                  >
                    {key.toUpperCase()}
                  </button>
                ))}
              </div>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={activeTrendData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="month" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis fontSize={10} tickLine={false} axisLine={false} />
                  <RechartsTooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                    formatter={(value) => [`${value}${chartMetrics[activeChartMetric].unit}`, chartMetrics[activeChartMetric].label]}
                  />
                  <Line 
                    type="monotone" 
                    dataKey={activeChartMetric} 
                    stroke={chartMetrics[activeChartMetric].color} 
                    strokeWidth={3} 
                    dot={{ r: 4, fill: chartMetrics[activeChartMetric].color }} 
                    activeDot={{ r: 6 }} 
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Land Use Composition (%)">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={landUseDistribution} layout="vertical">
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" fontSize={10} tickLine={false} axisLine={false} width={50} />
                  <RechartsTooltip cursor={{ fill: 'transparent' }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
                    {landUseDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {forecastData.length > 0 && (
              <ChartCard title="14-Day Rainfall Forecast (mm)">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={forecastData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="day" fontSize={9} tickLine={false} axisLine={false} interval={2} />
                    <YAxis fontSize={10} tickLine={false} axisLine={false} />
                    <RechartsTooltip cursor={{ fill: 'rgba(14, 165, 233, 0.08)' }} />
                    <Bar dataKey="rainfall_mm" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}

            {forestTrendData.length > 0 && (
              <ChartCard title="20-Year Forest Trend (%)">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={forestTrendData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="year" fontSize={9} tickLine={false} axisLine={false} interval={3} />
                    <YAxis fontSize={10} tickLine={false} axisLine={false} />
                    <RechartsTooltip 
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                      formatter={(value) => [`${value}%`, 'Forest']}
                    />
                    <Line type="monotone" dataKey="forest" stroke="#16a34a" strokeWidth={3} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', marginBottom: 20 }}>
          <button 
            onClick={reset} 
            style={{ flex: 1, padding: 12, background: '#1e293b', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontWeight: 700, transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', letterSpacing: '1px' }}>
            🏠 HOME
          </button>
          <button style={{ padding: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, cursor: 'pointer' }} title="System Status">📊</button>
        </div>

        {/* Draw Mode */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 10, textTransform: 'uppercase' }}>Farm Utilities</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#1e293b', cursor: 'pointer', background: drawMode ? '#f0f9ff' : 'transparent', padding: '8px 12px', borderRadius: 10, border: `1px solid ${drawMode ? '#bae6fd' : '#e2e8f0'}` }}>
            <input type="checkbox" checked={drawMode} onChange={e => setDrawMode(e.target.checked)} />
            ✏️ Enable Farm Drawing
          </label>
        </div>

        {/* Import GeoJSON */}
        <div style={{ marginBottom: 15 }}>
          <input
            type="file"
            accept=".geojson,.json"
            onChange={handleFileChange}
            style={{ display: 'none' }}
            id="geojson-upload-input"
          />
          <label
            htmlFor="geojson-upload-input"
            style={{ display: 'block', width: '100%', padding: 12, background: '#eff6ff', color: '#2563eb', border: '2px dashed #bfdbfe', borderRadius: 12, cursor: 'pointer', textAlign: 'center', fontWeight: 700, fontSize: 13 }}
          >
            ⬆️ Import GeoJSON
          </label>
        </div>


        {/* Farms List */}
        {farms.length > 0 && (
          <div style={{ marginTop: 24, borderTop: '1px solid #e2e8f0', paddingTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: 13, color: '#1e293b' }}>📋 Registered Farms ({farms.length})</strong>
              <button 
                onClick={exportFarms}
                style={{ 
                  fontSize: 11, padding: '5px 12px', cursor: 'pointer', 
                  borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0', fontWeight: 600 
                }}
              >
                📥 CSV/GeoJSON
              </button>
            </div>
            <div style={{ maxHeight: 150, overflowY: 'auto', marginTop: 5, fontSize: 12 }}>
              {farms.map(f => (
                <div key={f.id} style={{ 
                  padding: '10px', 
                  borderBottom: '1px solid #f1f5f9', 
                  display: 'flex', 
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: '#fff',
                  marginBottom: 6,
                  borderRadius: 8
                }}>
                  <div><div style={{ fontWeight: 600, color: '#334155' }}>{f.name}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{f.area}</div></div>
                  <button 
                    onClick={() => deleteFarm(f.id, f.name)}
                    style={{
                      background: '#fee2e2',
                      color: '#ef4444',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >✕</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Hover Info Overlay */}
      {(hoveredCounty || hoveredSubCounty || hoveredWard) && (
        <div style={{
          position: 'absolute', bottom: 30, left: 30, zIndex: 1000,
          background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(4px)',
          color: 'white', padding: '12px 20px', borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)', pointerEvents: 'none',
          display: 'flex', flexDirection: 'column', gap: 2, border: '1px solid rgba(255,255,255,0.1)'
        }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', opacity: 0.7, fontWeight: 700 }}>Quick Look</span>
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {getName(hoveredWard || hoveredSubCounty || hoveredCounty)}
          </div>
          <div style={{ fontSize: 12, opacity: 0.9 }}>
            {hoveredWard ? 'Ward' : hoveredSubCounty ? 'Sub-County' : 'County'}
          </div>
        </div>
      )}

      {/* Map Legends Overlay */}
      {(layers.ndvi || layers.ndwi || layers.ndbi || layers.segmentation || layers.counties) && (
        <div style={{ position: 'absolute', bottom: 30, right: sidebarOpen ? 340 : 30, zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '10px', transition: 'right 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
          <div style={{ color: '#1e293b', fontSize: '10px', fontWeight: 800, textAlign: 'right', textShadow: '0 0 10px white' }}>MAP LEGEND</div>
          {layers.counties && <Legend type="admin" />}
          {layers.ndvi && <Legend type="ndvi" />}
          {layers.ndwi && <Legend type="ndwi" />}
          {layers.ndbi && <Legend type="ndbi" />}
          {layers.segmentation && <Legend type="segmentation" />}
        </div>
      )}

      {/* Map */}
      <LiveMap 
        baseMap={baseMap}
        drawMode={drawMode}
        farms={farms}
        onMapReady={setMapInstance}
        onFarmCreated={newFarm => setFarms(prev => [...prev, newFarm])}
        dashboardMode={true}
        accessCountyName={accessCountyName}
        segmentClass={segmentClass}
        segmentThreshold={segmentThreshold}
        onSegmentationStats={setSegmentationStats}
      />
    </div>
  );
}

export default App;

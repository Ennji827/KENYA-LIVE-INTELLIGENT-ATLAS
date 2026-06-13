import React, { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import * as turf from '@turf/turf';
import { buildSpatialLinks, getSubcountiesForCounty, getWardsForSubcounty } from './spatialLinker';

// Fix Leaflet icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Professional colors
const STYLES = {
  county: { color: '#2563eb', weight: 2, fillOpacity: 0, opacity: 0.8 },
  countySelected: { color: '#1e3a8a', weight: 4, fillOpacity: 0.1, opacity: 1 },
  subcounty: { color: '#ea580c', weight: 1.5, fillOpacity: 0, opacity: 0.7 },
  subcountySelected: { color: '#9a3412', weight: 3, fillOpacity: 0.1, opacity: 1 },
  ward: { color: '#dc2626', weight: 1, fillOpacity: 0, opacity: 0.6 },
  wardSelected: { color: '#991b1b', weight: 2.5, fillOpacity: 0.1, opacity: 1 },
  farm: { color: '#22c55e', weight: 3, fillOpacity: 0.3, opacity: 0.8 }
};

const baseMaps = {
  street: { name: 'Street', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' },
  satellite: { name: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' },
  hybrid: { name: 'Hybrid', url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}' }
};

function App() {
  const [counties, setCounties] = useState(null);
  const [subcounties, setSubcounties] = useState(null);
  const [wards, setWards] = useState(null);
  const [links, setLinks] = useState(null);
  const [selectedCounty, setSelectedCounty] = useState(null);
  const [selectedSubcounty, setSelectedSubcounty] = useState(null);
  const [selectedWard, setSelectedWard] = useState(null);
  const [drawMode, setDrawMode] = useState(false);
  const [farms, setFarms] = useState([]);
  const [map, setMap] = useState(null);
  const [baseMap, setBaseMap] = useState('street');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('Loading...');

  // Load data and build spatial links
  useEffect(() => {
    setStatus('Loading GeoJSON files...');
    
    Promise.all([
      fetch('/data/counties.geojson').then(r => r.json()),
      fetch('/data/sub_counties.geojson').then(r => r.json()),
      fetch('/data/wards.geojson').then(r => r.json())
    ]).then(([countiesData, subcountiesData, wardsData]) => {
      
      setCounties(countiesData);
      setSubcounties(subcountiesData);
      setWards(wardsData);
      
      setStatus('Building spatial links using coordinates...');
      console.log('Building spatial links...');
      
      // Build the spatial relationships
      const spatialLinks = buildSpatialLinks(countiesData, subcountiesData, wardsData);
      setLinks(spatialLinks);
      
      setStatus(`Ready: ${spatialLinks.totalCounties} counties, ${spatialLinks.totalSubcounties} subcounties, ${spatialLinks.totalWards} wards linked by geography`);
      setLoading(false);
      
    }).catch(err => {
      console.error('Error:', err);
      setStatus('Error loading data: ' + err.message);
      setLoading(false);
    });
  }, []);

  // Zoom to a feature
  const zoomToFeature = (feature) => {
    if (!map || !feature) return;
    try {
      const layer = L.geoJSON(feature);
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    } catch(e) { console.log('Zoom error:', e); }
  };

  // Selection handlers
  const selectCounty = (county) => {
    setSelectedCounty(county);
    setSelectedSubcounty(null);
    setSelectedWard(null);
    zoomToFeature(county);
  };

  const selectSubcounty = (sub) => {
    setSelectedSubcounty(sub);
    setSelectedWard(null);
    zoomToFeature(sub);
  };

  const selectWard = (ward) => {
    setSelectedWard(ward);
    zoomToFeature(ward);
  };

  const reset = () => {
    setSelectedCounty(null);
    setSelectedSubcounty(null);
    setSelectedWard(null);
    if (map) map.setView([0.0236, 37.9062], 6);
  };

  // Get names from properties
  const getCountyName = (f) => f.properties?.ADM1_EN || 'County';
  const getSubcountyName = (f) => f.properties?.ADM2_EN || 'Subcounty';
  const getWardName = (f) => f.properties?.shapeName || 'Ward';

  // Style functions
  const getCountyStyle = (feature) => ({
    color: STYLES.county.color,
    weight: selectedCounty === feature ? STYLES.countySelected.weight : STYLES.county.weight,
    fillOpacity: selectedCounty === feature ? STYLES.countySelected.fillOpacity : STYLES.county.fillOpacity,
    opacity: selectedCounty === feature ? STYLES.countySelected.opacity : STYLES.county.opacity
  });

  const getSubcountyStyle = (feature) => ({
    color: STYLES.subcounty.color,
    weight: selectedSubcounty === feature ? STYLES.subcountySelected.weight : STYLES.subcounty.weight,
    fillOpacity: selectedSubcounty === feature ? STYLES.subcountySelected.fillOpacity : STYLES.subcounty.fillOpacity,
    opacity: selectedSubcounty === feature ? STYLES.subcountySelected.opacity : STYLES.subcounty.opacity
  });

  const getWardStyle = (feature) => ({
    color: STYLES.ward.color,
    weight: selectedWard === feature ? STYLES.wardSelected.weight : STYLES.ward.weight,
    fillOpacity: selectedWard === feature ? STYLES.wardSelected.fillOpacity : STYLES.ward.fillOpacity,
    opacity: selectedWard === feature ? STYLES.wardSelected.opacity : STYLES.ward.opacity
  });

  // Get linked data using spatial relationships
  const linkedSubcounties = (selectedCounty && links) 
    ? getSubcountiesForCounty(links.countyToSubcounties, selectedCounty) 
    : [];
    
  const linkedWards = (selectedSubcounty && links) 
    ? getWardsForSubcounty(links.subcountyToWards, selectedSubcounty) 
    : [];

  // Setup drawing
  useEffect(() => {
    if (!map || !drawMode) return;
    
    const drawControl = new L.Control.Draw({
      position: 'topleft',
      draw: {
        polygon: { shapeOptions: STYLES.farm, showArea: true },
        rectangle: { shapeOptions: STYLES.farm },
        circle: false, marker: false, polyline: false
      },
      edit: { featureGroup: new L.FeatureGroup(), remove: true }
    });
    
    map.addControl(drawControl);
    
    const onDrawCreated = (e) => {
      const layer = e.layer;
      const geojson = layer.toGeoJSON();
      let area = 0;
      try { area = (turf.area(geojson) / 10000).toFixed(2); } catch(e) { area = '?'; }
      
      const name = prompt('Farm name:', `Farm ${farms.length + 1}`);
      const newFarm = { 
        id: Date.now(), 
        name: name || `Farm ${farms.length + 1}`, 
        geometry: geojson, 
        area: area + ' ha' 
      };
      setFarms(prev => [...prev, newFarm]);
      
      L.geoJSON(geojson, { 
        style: STYLES.farm, 
        onEachFeature: (f, l) => l.bindPopup(`<b>${newFarm.name}</b><br/>Area: ${newFarm.area}`) 
      }).addTo(map);
    };
    
    map.on(L.Draw.Event.CREATED, onDrawCreated);
    
    return () => {
      map.removeControl(drawControl);
      map.off(L.Draw.Event.CREATED, onDrawCreated);
    };
  }, [map, drawMode, farms.length]);

  return (
    <div style={{ height: '100vh', width: '100%', position: 'relative' }}>
      {/* Control Panel */}
      <div style={{
        position: 'absolute', top: 20, right: 20, zIndex: 1000,
        background: 'white', padding: 16, borderRadius: 12,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)', width: 300,
        maxHeight: '85vh', overflowY: 'auto'
      }}>
        <h3 style={{ margin: '0 0 8px 0' }}>🗺️ Kenya GIS</h3>
        {status && <div style={{ fontSize: 11, color: '#059669', marginBottom: 12 }}>{status}</div>}
        
        <select value={baseMap} onChange={e => setBaseMap(e.target.value)} style={{ width: '100%', padding: 8, marginBottom: 15, borderRadius: 6 }}>
          {Object.entries(baseMaps).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
        </select>

        {/* County Dropdown */}
        <div style={{ marginBottom: 15 }}>
          <label style={{ fontWeight: 'bold', fontSize: 12 }}>County:</label>
          <select value={selectedCounty ? getCountyName(selectedCounty) : ''} onChange={e => {
            const selected = counties?.features.find(f => getCountyName(f) === e.target.value);
            if (selected) selectCounty(selected);
          }} style={{ width: '100%', padding: 6, marginTop: 5, borderRadius: 6 }}>
            <option value="">-- Select County --</option>
            {counties?.features.map((f, i) => <option key={i} value={getCountyName(f)}>{getCountyName(f)}</option>)}
          </select>
        </div>

        {/* Subcounty Dropdown - populated from spatial links */}
        {selectedCounty && (
          <div style={{ marginBottom: 15 }}>
            <label style={{ fontWeight: 'bold', fontSize: 12 }}>Sub-County ({linkedSubcounties.length}):</label>
            <select value={selectedSubcounty ? getSubcountyName(selectedSubcounty) : ''} onChange={e => {
              const selected = linkedSubcounties.find(f => getSubcountyName(f) === e.target.value);
              if (selected) selectSubcounty(selected);
            }} style={{ width: '100%', padding: 6, marginTop: 5, borderRadius: 6 }}>
              <option value="">-- Select Sub-County --</option>
              {linkedSubcounties.map((f, i) => <option key={i} value={getSubcountyName(f)}>{getSubcountyName(f)}</option>)}
            </select>
          </div>
        )}

        {/* Ward Dropdown - populated from spatial links */}
        {selectedSubcounty && (
          <div style={{ marginBottom: 15 }}>
            <label style={{ fontWeight: 'bold', fontSize: 12 }}>Ward ({linkedWards.length}):</label>
            <select value={selectedWard ? getWardName(selectedWard) : ''} onChange={e => {
              const selected = linkedWards.find(f => getWardName(f) === e.target.value);
              if (selected) selectWard(selected);
            }} style={{ width: '100%', padding: 6, marginTop: 5, borderRadius: 6 }}>
              <option value="">-- Select Ward --</option>
              {linkedWards.map((f, i) => <option key={i} value={getWardName(f)}>{getWardName(f)}</option>)}
            </select>
          </div>
        )}

        <button onClick={reset} style={{ width: '100%', padding: 8, background: '#6b7280', color: 'white', border: 'none', borderRadius: 6, marginBottom: 15, cursor: 'pointer' }}>Reset View</button>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 15 }}>
          <input type="checkbox" checked={drawMode} onChange={e => setDrawMode(e.target.checked)} />
          ✏️ Draw Farm Mode
        </label>

        {farms.length > 0 && (
          <div>
            <strong>📋 Farms ({farms.length})</strong>
            <div style={{ maxHeight: 150, overflowY: 'auto', marginTop: 5, fontSize: 11 }}>
              {farms.map(f => <div key={f.id} style={{ padding: 5, borderBottom: '1px solid #eee' }}><b>{f.name}</b><br/>{f.area}</div>)}
            </div>
          </div>
        )}
      </div>

      {/* Map */}
      <MapContainer center={[0.0236, 37.9062]} zoom={6} style={{ height: '100%', width: '100%' }} whenCreated={setMap}>
        <TileLayer url={baseMaps[baseMap].url} />
        
        {/* Counties Layer */}
        {counties && (
          <GeoJSON 
            data={counties} 
            style={getCountyStyle} 
            onEachFeature={(f, l) => {
              l.bindPopup(`<b>${getCountyName(f)}</b>`);
              l.on('click', () => selectCounty(f));
              l.on('mouseover', () => l.setStyle({ weight: 4, color: '#000' }));
              l.on('mouseout', () => l.setStyle(getCountyStyle(f)));
            }}
          />
        )}
        
        {/* Subcounties Layer - only show when county selected */}
        {selectedCounty && subcounties && linkedSubcounties.length > 0 && !selectedSubcounty && (
          <GeoJSON 
            data={{ type: 'FeatureCollection', features: linkedSubcounties }} 
            style={getSubcountyStyle} 
            onEachFeature={(f, l) => {
              l.bindPopup(`<b>${getSubcountyName(f)}</b><br/>Sub-County`);
              l.on('click', () => selectSubcounty(f));
              l.on('mouseover', () => l.setStyle({ weight: 3, color: '#000' }));
              l.on('mouseout', () => l.setStyle(getSubcountyStyle(f)));
            }}
          />
        )}
        
        {/* Wards Layer - only show when subcounty selected */}
        {selectedSubcounty && wards && linkedWards.length > 0 && !selectedWard && (
          <GeoJSON 
            data={{ type: 'FeatureCollection', features: linkedWards }} 
            style={getWardStyle} 
            onEachFeature={(f, l) => {
              l.bindPopup(`<b>${getWardName(f)}</b><br/>Ward`);
              l.on('click', () => selectWard(f));
              l.on('mouseover', () => l.setStyle({ weight: 3, color: '#000' }));
              l.on('mouseout', () => l.setStyle(getWardStyle(f)));
            }}
          />
        )}
        
        {/* Farms */}
        {farms.map(f => <GeoJSON key={f.id} data={f.geometry} style={STYLES.farm} />)}
      </MapContainer>
    </div>
  );
}

export default App;

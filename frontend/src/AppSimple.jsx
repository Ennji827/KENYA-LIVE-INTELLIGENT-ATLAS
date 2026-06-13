import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

function App() {
  const [counties, setCounties] = useState(null);
  const [subcounties, setSubcounties] = useState(null);
  const [wards, setWards] = useState(null);
  const [active, setActive] = useState('counties');

  useEffect(() => {
    fetch('/data/counties.geojson')
      .then(r => r.json())
      .then(setCounties)
      .catch(console.error);
  }, []);

  const loadSub = () => {
    if (subcounties) { setActive('subcounties'); return; }
    fetch('/data/sub_counties.geojson')
      .then(r => r.json())
      .then(d => { setSubcounties(d); setActive('subcounties'); })
      .catch(console.error);
  };

  const loadWards = () => {
    if (wards) { setActive('wards'); return; }
    fetch('/data/wards.geojson')
      .then(r => r.json())
      .then(d => { setWards(d); setActive('wards'); })
      .catch(console.error);
  };

  let currentData = null;
  if (active === 'counties') currentData = counties;
  if (active === 'subcounties') currentData = subcounties;
  if (active === 'wards') currentData = wards;

  return (
    <div style={{height: '100vh'}}>
      <div style={{position: 'absolute', top: 10, right: 10, zIndex: 1000, background: 'white', padding: 10, borderRadius: 8}}>
        <button onClick={() => setActive('counties')}>Counties</button>
        <button onClick={loadSub}>Sub-Counties</button>
        <button onClick={loadWards}>Wards</button>
      </div>
      <MapContainer center={[0.0236, 37.9062]} zoom={6} style={{height: '100%'}}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {currentData && <GeoJSON data={currentData} style={{weight:2, color:'blue', fillOpacity:0}} />}
      </MapContainer>
    </div>
  );
}

export default App;
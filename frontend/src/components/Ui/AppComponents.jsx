import React, { useCallback } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, BarChart, Bar, Cell } from 'recharts';

export function MetricRow({ label, value, status }) {
  const normalizedStatus = String(status || '').toLowerCase();
  const statusStyle = normalizedStatus === 'critical' || normalizedStatus === 'high' || normalizedStatus === 'stress' || normalizedStatus === 'dry'
    ? { color: '#dc2626', background: '#fee2e2' }
    : normalizedStatus === 'watch' || normalizedStatus === 'moderate'
    ? { color: '#ca8a04', background: '#fef3c7' }
    : { color: '#059669', background: '#dcfce7' };

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 10,
      padding: '10px 0',
      borderBottom: '1px solid #f1f5f9',
      fontSize: 13
    }}>
      <span style={{ color: '#64748b', fontWeight: 500 }}>{label}</span>
      <strong style={{ color: '#0f172a', textAlign: 'right' }}>
        {value}
        {status && <span style={{
          display: 'inline-block', marginLeft: 6, color: statusStyle.color,
          fontSize: 11, background: statusStyle.background, padding: '2px 8px', borderRadius: 12, fontWeight: 600
        }}>{status}</span>}
      </strong>
    </div>
  );
}

export function ChartCard({ title, children }) {
  return (
    <div style={{
      background: 'white', borderRadius: '16px', padding: '16px',
      marginBottom: '20px', border: '1px solid #f1f5f9', boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
    }}>
      <h4 style={{ margin: '0 0 16px 0', fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>{title}</h4>
      <div style={{ height: '180px', width: '100%' }}>{children}</div>
    </div>
  );
}

export function Legend({ type }) {
  if (type === 'admin') {
    const items = [
      { label: 'County', color: '#6366f1' },
      { label: 'Sub-County', color: '#9a3412' },
      { label: 'Ward', color: '#f20a0a' },
    ];
    return (
      <div style={{
        background: 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(8px)',
        padding: '12px', borderRadius: '14px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        border: '1px solid rgba(255,255,255,0.4)', width: '160px'
      }}>
        <div style={{ fontSize: '10px', fontWeight: 800, color: '#64748b', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Boundaries</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {items.map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '18px', height: 0, borderTop: `3px solid ${item.color}` }} />
              <span style={{ fontSize: '10px', color: '#475569', fontWeight: 700 }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'segmentation') {
    const items = [
      { label: 'Buildings', color: '#dc2626' },
      { label: 'Cropland', color: '#16a34a' },
      { label: 'Water', color: '#0284c7' },
      { label: 'Forest', color: '#166534' },
      { label: 'Bare land', color: '#d97706' },
    ];

    return (
      <div style={{
        background: 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(8px)',
        padding: '12px', borderRadius: '14px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
        border: '1px solid rgba(255,255,255,0.4)', width: '160px'
      }}>
        <div style={{ fontSize: '10px', fontWeight: 800, color: '#64748b', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Mapped Features</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {items.map(item => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: item.color }} />
              <span style={{ fontSize: '10px', color: '#475569', fontWeight: 700 }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const configs = {
    ndvi: {
      title: 'Vegetation (NDVI)',
      gradient: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #008000, #004d00)',
      labels: ['Sparse', 'Dense']
    },
    ndwi: {
      title: 'Water (NDWI)',
      gradient: 'linear-gradient(to right, #8b4513, #daa520, #87ceeb, #0047ab, #00008b)',
      labels: ['Arid', 'Moist']
    },
    ndbi: {
      title: 'Built-up (NDBI)',
      gradient: 'linear-gradient(to right, #f8fafc, #facc15, #f97316, #dc2626, #7f1d1d)',
      labels: ['Open', 'Dense']
    },
  };
  const config = configs[type] || configs.ndvi;

  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(8px)',
      padding: '12px', borderRadius: '14px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      border: '1px solid rgba(255,255,255,0.4)', width: '160px'
    }}>
      <div style={{ fontSize: '10px', fontWeight: 800, color: '#64748b', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{config.title}</div>
      <div style={{ height: '8px', borderRadius: '10px', background: config.gradient, marginBottom: '6px' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#94a3b8', fontWeight: 700 }}>
        <span>{config.labels[0]}</span>
        <span>{config.labels[1]}</span>
      </div>
    </div>
  );
}

export function VarianceBadge({ value, compareValue }) {
  if (!value || !compareValue) return null;
  const diff = ((value - compareValue) / compareValue * 100).toFixed(1);
  const isPositive = parseFloat(diff) >= 0;
  return (
    <span style={{ fontSize: '10px', color: isPositive ? '#059669' : '#dc2626', fontWeight: 700, marginLeft: '8px' }}>
      {isPositive ? '+' : '-'} {Math.abs(diff)}%
    </span>
  );
}

export function Breadcrumbs({ county, selectedSubCounty, ward, onReset, onCountyClick, onSubCountyClick }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px', 
      fontSize: '11px', color: '#64748b', fontWeight: 700,
      background: 'white', padding: '8px 14px', borderRadius: '10px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)', marginBottom: '16px',
      textTransform: 'uppercase', letterSpacing: '0.5px', border: '1px solid #f1f5f9'
    }}>
      <span onClick={onReset} style={{ cursor: 'pointer', color: '#6366f1' }}>Kenya</span>
      {county && (
        <>
          <span style={{ opacity: 0.5 }}>/</span>
          <span 
            onClick={() => onCountyClick(county)}
            style={{ cursor: 'pointer', color: selectedSubCounty ? '#6366f1' : '#0f172a' }}
          >
            {county.properties?.ADM1_EN}
          </span>
        </>
      )}
      {selectedSubCounty && (
        <>
          <span style={{ opacity: 0.5 }}>/</span>
          <span 
            onClick={() => onSubCountyClick(selectedSubCounty)}
            style={{ cursor: 'pointer', color: ward ? '#6366f1' : '#0f172a' }}
          >
            {selectedSubCounty.properties?.ADM2_EN}
          </span>
        </>
      )}
      {ward && (
        <>
          <span style={{ opacity: 0.5 }}>/</span>
          <span style={{ color: '#0f172a' }}>{ward.properties?.shapeName}</span>
        </>
      )}
    </div>
  );
}

export function DataTable({ historicalData, landUseData }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '20px' }}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '16px', border: '1px solid #f1f5f9' }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>Historical Trends</h4>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#64748b' }}>
                <th style={{ padding: '6px 2px' }}>Month</th>
                <th style={{ padding: '6px 2px' }}>NDVI</th>
                <th style={{ padding: '6px 2px' }}>Moisture</th>
              </tr>
            </thead>
            <tbody>
              {historicalData.map((d, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f8fafc' }}>
                  <td style={{ padding: '6px 2px', fontWeight: 600, color: '#1e293b' }}>{d.month}</td>
                  <td style={{ padding: '6px 2px', color: '#334155' }}>{d.ndvi}</td>
                  <td style={{ padding: '6px 2px', color: '#334155' }}>{d.moisture}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ background: 'white', borderRadius: '16px', padding: '16px', border: '1px solid #f1f5f9' }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700 }}>Land Distribution</h4>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0', textAlign: 'left', color: '#64748b' }}>
                <th style={{ padding: '6px 2px' }}>Classification</th>
                <th style={{ padding: '6px 2px' }}>Share</th>
              </tr>
            </thead>
            <tbody>
              {landUseData.map((d, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f8fafc' }}>
                  <td style={{ padding: '6px 2px', fontWeight: 600, color: '#1e293b' }}>{d.name}</td>
                  <td style={{ padding: '6px 2px', color: '#334155' }}>{d.value}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function LoadingSpinner() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '10px 0 24px 0',
      gap: '12px'
    }}>
      <div className="aeis-spinner" />
      <span style={{ 
        fontSize: 11, 
        color: '#94a3b8', 
        fontWeight: 700, 
        letterSpacing: '1px',
        textTransform: 'uppercase'
      }}>Syncing Geodata</span>
      <style>{`
        .aeis-spinner {
          width: 24px;
          height: 24px;
          border: 2.5px solid #f1f5f9;
          border-top: 2.5px solid #6366f1;
          border-radius: 50%;
          animation: aeis-spin 0.8s linear infinite;
        }
        @keyframes aeis-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

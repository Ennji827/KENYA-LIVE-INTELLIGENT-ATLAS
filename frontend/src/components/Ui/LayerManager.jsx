import React from 'react';
import useAEISStore from '../../store/useAEISStore';

export default function LayerManager() {
  const layers = useAEISStore((state) => state.layers);
  const toggleLayer = useAEISStore((state) => state.toggleLayer);

  return (
    <div style={{
      position: 'absolute',
      top: 20,
      left: 20,
      zIndex: 1000,
      background: 'white',
      padding: 12,
      borderRadius: 8,
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      width: 180,
      fontSize: 14
    }}>
      <h4 style={{ margin: '0 0 10px 0', fontSize: 16 }}>Layers</h4>
      <div style={{ marginBottom: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={layers.counties}
            onChange={() => toggleLayer('counties')}
            style={{ marginRight: 8 }}
          />
          Counties
        </label>
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={layers.segmentation}
            onChange={() => toggleLayer('segmentation')}
            style={{ marginRight: 8 }}
          />
          Similar Pixels
        </label>
      </div>
    </div>
  );
}

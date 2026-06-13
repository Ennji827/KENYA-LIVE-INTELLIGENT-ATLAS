import React, { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import { generateNDVIHeatmap } from "../../utils/heatmapData";

export default function NDVIHeatmapLayer({ visible = false, boundary = null }) {
  const map = useMap();
  const heatmapLayerRef = React.useRef(null);

  useEffect(() => {
    if (!map) return;

    if (heatmapLayerRef.current) {
      try {
        map.removeLayer(heatmapLayerRef.current);
      } catch (e) {}
      heatmapLayerRef.current = null;
    }

    if (visible) {
      // Generate NDVI heatmap data inside Kenya or the active county/sub-county/ward.
      const ndviData = generateNDVIHeatmap(boundary);

      // Convert to Leaflet.heat format: [[lat, lon, intensity], ...]
      const heatData = ndviData.map((point) => [
        point.lat,
        point.lon,
        point.intensity,
      ]);

      // Create heatmap layer with NDVI color scheme
      const heatmapLayer = L.heatLayer(heatData, {
        radius: 42,
        blur: 26,
        maxZoom: 15,
        max: 1.0,
        minOpacity: 0.28,
        gradient: {
          0.0: "#ff0000", // Red - low vegetation
          0.25: "#ffff00", // Yellow
          0.5: "#00ff00", // Green - medium vegetation
          0.75: "#008000", // Dark green
          1.0: "#004d00", // Very dark green - high vegetation
        },
      });

      heatmapLayer.addTo(map);
      heatmapLayerRef.current = heatmapLayer;
    }
  }, [map, visible, boundary]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (heatmapLayerRef.current && map) {
        try {
          map.removeLayer(heatmapLayerRef.current);
        } catch (e) {}
      }
    };
  }, [map]);

  return null;
}

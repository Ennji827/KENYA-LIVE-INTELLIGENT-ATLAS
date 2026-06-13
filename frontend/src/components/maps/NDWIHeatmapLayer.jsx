import React, { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import { generateNDWIHeatmap } from "../../utils/heatmapData";

export default function NDWIHeatmapLayer({ visible = false, boundary = null }) {
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
      // Generate NDWI heatmap data inside Kenya or the active county/sub-county/ward.
      const ndwiData = generateNDWIHeatmap(boundary);

      // Convert to Leaflet.heat format: [[lat, lon, intensity], ...]
      const heatData = ndwiData.map((point) => [
        point.lat,
        point.lon,
        point.intensity,
      ]);

      // Create heatmap layer with NDWI color scheme (water/moisture)
      const heatmapLayer = L.heatLayer(heatData, {
        radius: 42,
        blur: 26,
        maxZoom: 15,
        max: 1.0,
        minOpacity: 0.2,
        gradient: {
          0.0: "#8b4513", // Brown - low water
          0.25: "#daa520", // Goldenrod
          0.5: "#87ceeb", // Sky blue - moderate moisture
          0.75: "#0047ab", // Cobalt blue
          1.0: "#00008b", // Dark blue - high water
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

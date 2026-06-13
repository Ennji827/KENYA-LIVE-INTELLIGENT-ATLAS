import React, { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import { generateNDBIHeatmap } from "../../utils/heatmapData";

export default function NDBIHeatmapLayer({ visible = false, boundary = null }) {
  const map = useMap();
  const heatmapLayerRef = React.useRef(null);

  useEffect(() => {
    if (!map) return;

    if (heatmapLayerRef.current) {
      try {
        map.removeLayer(heatmapLayerRef.current);
      } catch (error) {
        // Layer may already be detached during map refresh.
      }
      heatmapLayerRef.current = null;
    }

    if (visible) {
      const heatData = generateNDBIHeatmap(boundary).map((point) => [
        point.lat,
        point.lon,
        point.intensity,
      ]);

      const heatmapLayer = L.heatLayer(heatData, {
        radius: 40,
        blur: 24,
        maxZoom: 15,
        max: 1.0,
        minOpacity: 0.22,
        gradient: {
          0.0: "#f8fafc",
          0.3: "#facc15",
          0.55: "#f97316",
          0.8: "#dc2626",
          1.0: "#7f1d1d",
        },
      });

      heatmapLayer.addTo(map);
      heatmapLayerRef.current = heatmapLayer;
    }
  }, [map, visible, boundary]);

  useEffect(() => {
    return () => {
      if (heatmapLayerRef.current && map) {
        try {
          map.removeLayer(heatmapLayerRef.current);
        } catch (error) {
          // Layer may already be detached during map teardown.
        }
      }
    };
  }, [map]);

  return null;
}

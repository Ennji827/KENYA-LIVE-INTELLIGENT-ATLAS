import React, { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { generateSegmentationPoints } from "../../utils/heatmapData";

export default function SegmentationLayer({
  visible = false,
  boundary = null,
  segmentClass = "buildings",
  threshold = 0.72,
  onStats,
}) {
  const map = useMap();
  const layerRef = React.useRef(null);

  useEffect(() => {
    if (!map) return;

    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (!visible) {
      onStats?.({ count: 0, segmentClass, threshold });
      return undefined;
    }

    const points = generateSegmentationPoints({ boundary, segmentClass, threshold });
    const group = L.layerGroup();

    points.forEach((point) => {
      L.circleMarker([point.lat, point.lon], {
        radius: 2.5 + point.similarity * 2.5,
        stroke: false,
        fillColor: point.color,
        fillOpacity: 0.5,
        pane: "overlayPane",
      })
        .bindTooltip(`${point.label} similarity ${Math.round(point.similarity * 100)}%`, {
          sticky: true,
          opacity: 0.85,
        })
        .addTo(group);
    });

    group.addTo(map);
    layerRef.current = group;
    onStats?.({ count: points.length, segmentClass, threshold });

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, visible, boundary, segmentClass, threshold, onStats]);

  return null;
}

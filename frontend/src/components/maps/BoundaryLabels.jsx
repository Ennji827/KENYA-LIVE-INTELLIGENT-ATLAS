import React, { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import * as turf from "@turf/turf";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export default function BoundaryLabels({
  data,
  visible = true,
  nameProperty,
  className = "",
  minZoom = 0,
}) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!map) return undefined;

    const removeLabels = () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };

    const drawLabels = () => {
      removeLabels();
      if (!visible || !data?.features?.length || map.getZoom() < minZoom) return;

      const labelLayer = L.layerGroup();
      data.features.forEach((feature) => {
        const name = feature.properties?.[nameProperty];
        if (!name) return;

        try {
          const point = turf.pointOnFeature(feature);
          const [lon, lat] = point.geometry.coordinates;
          L.marker([lat, lon], {
            interactive: false,
            icon: L.divIcon({
              className: `aeis-boundary-label ${className}`.trim(),
              html: `<span>${escapeHtml(name)}</span>`,
              iconSize: [120, 24],
              iconAnchor: [60, 12],
            }),
          }).addTo(labelLayer);
        } catch (error) {
          // Skip malformed geometries while keeping the remaining labels visible.
        }
      });

      labelLayer.addTo(map);
      layerRef.current = labelLayer;
    };

    drawLabels();
    map.on("zoomend", drawLabels);

    return () => {
      map.off("zoomend", drawLabels);
      removeLabels();
    };
  }, [className, data, map, minZoom, nameProperty, visible]);

  return null;
}

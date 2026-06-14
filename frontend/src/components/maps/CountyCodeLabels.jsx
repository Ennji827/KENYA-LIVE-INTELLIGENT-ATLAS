import React, { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import * as turf from "@turf/turf";

function countyCode(feature) {
  const pcode = feature?.properties?.ADM1_PCODE || "";
  const digits = String(pcode).replace(/\D/g, "");
  return digits ? digits.padStart(3, "0") : "";
}

export default function CountyCodeLabels({ data, visible = true }) {
  const map = useMap();
  const layerRef = useRef(null);

  useEffect(() => {
    if (!map) return;

    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (!visible || !data?.features?.length) return;

    const labelLayer = L.layerGroup();

    data.features.forEach((feature) => {
      const code = countyCode(feature);
      const name = feature.properties?.ADM1_EN || "County";
      if (!code) return;

      try {
        const point = turf.pointOnFeature(feature);
        const [lon, lat] = point.geometry.coordinates;
        const marker = L.marker([lat, lon], {
          interactive: false,
          icon: L.divIcon({
            className: "aeis-county-code-pin",
            html: `<span>${code}</span>`,
            iconSize: [38, 22],
            iconAnchor: [19, 11],
          }),
        });
        marker.bindTooltip(`${code} ${name}`, { direction: "top", opacity: 0.9 });
        labelLayer.addLayer(marker);
      } catch (error) {
        // Skip malformed geometries; boundary layer still renders the county.
      }
    });

    labelLayer.addTo(map);
    layerRef.current = labelLayer;

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [data, map, visible]);

  return null;
}

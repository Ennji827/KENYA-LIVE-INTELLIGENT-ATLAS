import React, { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { getApiBase } from "../../utils/api";

export default function SegmentationLayer({
  visible = false,
  scopeLevel = "",
  scopeId = "",
  segmentClass = "buildings",
  onStats,
}) {
  const map = useMap();
  const layerRef = React.useRef(null);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    if (!visible) {
      onStats?.({ count: 0, segmentClass, status: "hidden", source: "none" });
      return undefined;
    }

    if (!scopeLevel || !scopeId) {
      onStats?.({
        count: 0,
        segmentClass,
        status: "select_scope",
        source: "none",
        message: "Select or hover a county to load real mapped features.",
      });
      return undefined;
    }

    onStats?.({ count: 0, segmentClass, status: "loading", source: "openstreetmap" });

    const url = `${getApiBase()}/api/segmentation/${encodeURIComponent(segmentClass)}?level=${encodeURIComponent(scopeLevel)}&id=${encodeURIComponent(scopeId)}&limit=900`;

    fetch(url)
      .then((response) => response.json())
      .then((payload) => {
        if (cancelled) return;

        const points = payload.points || [];
        const group = L.layerGroup();

        points.forEach((point) => {
          L.circleMarker([point.lat, point.lon], {
            radius: 4,
            stroke: true,
            color: "#ffffff",
            weight: 0.6,
            fillColor: point.color,
            fillOpacity: 0.72,
            pane: "overlayPane",
          })
            .bindTooltip(`${point.label} | ${point.source || payload.source}`, {
              sticky: true,
              opacity: 0.9,
            })
            .addTo(group);
        });

        group.addTo(map);
        layerRef.current = group;
        onStats?.({
          count: points.length,
          segmentClass,
          status: payload.status,
          source: payload.source || payload.provider,
          message: payload.message,
          level: payload.level,
          identifier: payload.identifier,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        onStats?.({
          count: 0,
          segmentClass,
          status: "error",
          source: "openstreetmap",
          message: error.message,
        });
      });

    return () => {
      cancelled = true;
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
        layerRef.current = null;
      }
    };
  }, [map, visible, scopeLevel, scopeId, segmentClass, onStats]);

  return null;
}

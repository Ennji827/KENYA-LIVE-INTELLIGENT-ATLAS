import React from "react";
import { GeoJSON } from "react-leaflet";
import { sameCounty, sameSubCounty, sameWard, wardName } from "../../utils/boundaries";

const COLORS = {
  hover: "#111827",
  selected: "#7c2d12",
  faded: "#cbd5e1",
  activeBoundary: "#dc2626"
};

export default function WardLayer({
  data,
  selectedCounty, // Needed for context if no subcounty is selected
  selectedWard,
  selectedSubCounty, // Needed for isInSubCounty logic
  onSelect,
  onHover,
  zoomTo,
}) {
  const isWardSelected = (f) => {
    return sameWard(f, selectedWard);
  };

  const isInSubCounty = (f) => {
    if (isWardSelected(f)) return true;
    if (selectedSubCounty) return sameSubCounty(f, selectedSubCounty);
    if (selectedCounty) return sameCounty(f, selectedCounty);

    return false;
  };

  const getStyle = (f) => {
    const active = isInSubCounty(f);
    // Always prioritize selected state
    if (isWardSelected(f)) {
      return {
        color: COLORS.selected,
        weight: 5,
        fillOpacity: 0.12,
        fillColor: "#fb923c",
        opacity: 1,
      };
    }
    // Normal state
    return {
      color: active ? COLORS.activeBoundary : COLORS.faded,
      weight: active ? 1.2 : 0.5,
      fillOpacity: active ? 0.04 : 0,
      fillColor: active ? "#fed7aa" : "transparent",
      opacity: 1,
    };
  };

  const hoverStyle = (f) => {
    // If already selected, make it more prominent on hover
    if (isWardSelected(f)) {
      return {
        color: COLORS.selected,
        weight: 6,
        fillOpacity: 0.14,
        fillColor: "#fb923c",
        opacity: 1,
      };
    }
    // Normal hover
    return {
      weight: 4,
      color: COLORS.hover,
      fillOpacity: 0.1,
      fillColor: "#fed7aa",
      opacity: 1,
    };
  };

  return (
    <GeoJSON
      key={selectedWard?.properties?.shapeName || "no-selection"}
      data={data}
      style={getStyle}
      onEachFeature={(f, layer) => {
        const name = wardName(f) || "Ward";

        layer.bindTooltip(name, {
          sticky: true,
          direction: "auto",
        });

        layer.on("click", () => {
          onSelect(f);
          zoomTo?.(f);
          try { layer.bringToFront(); } catch (e) {}
        });

        layer.on("mouseover", () => {
          layer.setStyle(hoverStyle(f));
          try { layer.bringToFront(); } catch (e) {}
          onHover?.(f);
        });

        layer.on("mouseout", () => {
          layer.setStyle(getStyle(f));
          onHover?.(null);
        });
      }}
    />
  );
}

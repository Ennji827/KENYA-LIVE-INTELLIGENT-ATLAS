import React from "react";
import { GeoJSON } from "react-leaflet";

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
    if (!selectedWard) return false;
    const s = selectedWard.properties;
    const p = f.properties;
    return (s.shapeID && s.shapeID === p.shapeID) ||
           (s.ADM3_PCODE && s.ADM3_PCODE === p.ADM3_PCODE) || 
           (s.shapeName === p.shapeName && s.ADM2_EN === p.ADM2_EN);
  };

  const isInSubCounty = (f) => {
    if (isWardSelected(f)) return true;
    if (!selectedSubCounty) return false; // Only show wards if a subcounty is selected

    const parent = f.properties?.ADM2_EN || f.properties?.SubCounty || f.properties?.NAME_2;
    const selected = selectedSubCounty.properties?.ADM2_EN || selectedSubCounty.properties?.NAME;
    
    return (f.properties?.ADM2_PCODE && f.properties?.ADM2_PCODE === selectedSubCounty.properties?.ADM2_PCODE) ||
           (parent === selected);
  };

  const getStyle = (f) => {
    const active = isInSubCounty(f);
    // Always prioritize selected state
    if (isWardSelected(f)) {
      return {
        color: COLORS.selected,
        weight: 5,
        fillOpacity: 0,
        fillColor: "transparent",
        opacity: 1,
      };
    }
    // Normal state
    return {
      color: active ? COLORS.activeBoundary : COLORS.faded,
      weight: active ? 1.2 : 0.5,
      fillOpacity: 0,
      fillColor: "transparent",
      opacity: 1,
    };
  };

  const hoverStyle = (f) => {
    // If already selected, make it more prominent on hover
    if (isWardSelected(f)) {
      return {
        color: COLORS.selected,
        weight: 6,
        fillOpacity: 0,
        fillColor: "transparent",
        opacity: 1,
      };
    }
    // Normal hover
    return {
      weight: 4,
      color: COLORS.hover,
      fillOpacity: 0,
      fillColor: "transparent",
      opacity: 1,
    };
  };

  return (
    <GeoJSON
      key={selectedWard?.properties?.shapeName || "no-selection"}
      data={data}
      style={getStyle}
      onEachFeature={(f, layer) => {
        const name = f.properties?.shapeName || "Ward";
        const isSelected = isWardSelected(f);

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

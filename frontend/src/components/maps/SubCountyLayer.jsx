import React from "react";
import { GeoJSON } from "react-leaflet";

const COLORS = {
  normal: "#f97316",
  selected: "#c2410c",
  hover: "#111827",
};

export default function SubCountyLayer({
  data,
  selectedCounty,
  selectedSubCounty,
  onSelect,
  onHover,
  zoomTo,
}) {
  const isInCounty = (f) => {
    if (!selectedCounty) return false; // Only show subcounties if a county is selected
    const p = f.properties;
    const s = selectedCounty.properties;
    
    // Primary match on PCODE (Standard)
    if (p.ADM1_PCODE && s.ADM1_PCODE) return p.ADM1_PCODE === s.ADM1_PCODE;
    // Fallback to strict name matching
    return (p.ADM1_EN || p.County || p.NAME_1) === (s.ADM1_EN || s.NAME);
  };

  const isSelected = (f) => {
    const selected = selectedSubCounty?.properties;
    const current = f.properties;
    return (
      (selected?.ADM2_PCODE && selected.ADM2_PCODE === current?.ADM2_PCODE) ||
      (selected?.ADM2_EN && selected.ADM2_EN === current?.ADM2_EN)
    );
  };

  const style = (f) => {
    const active = isInCounty(f);
    const selected = isSelected(f);

    return {
      color: selected
        ? COLORS.selected
        : active 
        ? COLORS.normal 
        : "transparent", // Hide subcounties of other counties for clarity

      weight: selected ? 4 : active ? 1.5 : 0, 
      fillOpacity: 0,
      fillColor: "transparent",
      opacity: 1,
    };
  };

  return (
    <GeoJSON
      data={data}
      style={style}
      onEachFeature={(f, layer) => {
        const name = f.properties?.ADM2_EN || "SubCounty";

        layer.bindTooltip(name, {
          sticky: true,
          direction: "auto",
          opacity: 0.9,
        });

        layer.on("click", () => {
          onSelect(f);
          zoomTo?.(f);
          try { layer.bringToFront(); } catch (e) {}
        });

        layer.on("mouseover", () => {
          layer.setStyle({
            weight: 4,
            color: COLORS.hover,
            fillOpacity: 0,
            fillColor: "transparent",
            opacity: 1,
          });
          try { layer.bringToFront(); } catch (e) {}
          onHover?.(f);
        });

        layer.on("mouseout", () => {
          layer.setStyle(style(f));
          onHover?.(null);
        });
      }}
    />
  );
}

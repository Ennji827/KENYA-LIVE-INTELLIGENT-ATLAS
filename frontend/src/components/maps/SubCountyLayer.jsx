import React from "react";
import { GeoJSON } from "react-leaflet";
import { sameCounty, sameSubCounty, subCountyName } from "../../utils/boundaries";

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
    if (!selectedCounty) return false;
    return sameCounty(f, selectedCounty);
  };

  const isSelected = (f) => {
    return sameSubCounty(f, selectedSubCounty);
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
      fillOpacity: selected ? 0.15 : active ? 0.06 : 0,
      fillColor: selected ? "#fb923c" : "#fdba74",
      opacity: 1,
    };
  };

  return (
    <GeoJSON
      data={data}
      style={style}
      onEachFeature={(f, layer) => {
        const name = subCountyName(f) || "Sub-county";

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
            fillOpacity: 0.14,
            fillColor: "#fdba74",
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

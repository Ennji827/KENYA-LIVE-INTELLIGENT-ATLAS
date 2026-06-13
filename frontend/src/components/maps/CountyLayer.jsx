import React from "react";
import { GeoJSON } from "react-leaflet";

const COLORS = {
  normal: "#2563eb",
  hover: "#0f172a",
  selected: "#dc2626",
  faded: "#94a3b8",
};

export default function CountyLayer({
  data,
  selectedCounty,
  onSelect,
  onHover,
  zoomTo,
}) {
  const isSelected = (f) => {
    const nameA = (f.properties?.ADM1_EN || f.properties?.NAME || "").toLowerCase();
    const nameB = (selectedCounty?.properties?.ADM1_EN || selectedCounty?.properties?.NAME || "").toLowerCase();
    return nameA !== "" && nameA === nameB;
  };

  const style = (f) => {
    const selected = isSelected(f);

    return {
      color: selected ? COLORS.selected : (selectedCounty ? COLORS.faded : COLORS.normal),
      weight: selected ? 3.5 : 2,
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
        const name = f.properties?.ADM1_EN || "County";

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
            weight: 5,
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

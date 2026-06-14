import React from "react";
import { GeoJSON } from "react-leaflet";

const COLORS = {
  normal: "#2563eb",
  hover: "#0f172a",
  selected: "#dc2626",
  faded: "#94a3b8",
};

const COUNTY_PALETTE = [
  "#0f766e",
  "#2563eb",
  "#65a30d",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#be123c",
  "#166534",
];

function colorForCounty(feature) {
  const pcode = feature.properties?.ADM1_PCODE || feature.properties?.ADM1_EN || "";
  let total = 0;
  for (let index = 0; index < pcode.length; index += 1) total += pcode.charCodeAt(index);
  return COUNTY_PALETTE[total % COUNTY_PALETTE.length];
}

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
      fillOpacity: selected ? 0.12 : selectedCounty ? 0.02 : 0.08,
      fillColor: selected ? COLORS.selected : colorForCounty(f),
      opacity: 1,
    };
  };

  return (
    <GeoJSON
      data={data}
      style={style}
      onEachFeature={(f, layer) => {
        const name = f.properties?.ADM1_EN || "County";
        const rawCode = String(f.properties?.ADM1_PCODE || "").replace(/\D/g, "");
        const code = rawCode ? rawCode.padStart(3, "0") : "";

        layer.bindTooltip(`${code ? `${code} ` : ""}${name}`, {
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
            fillOpacity: 0.16,
            fillColor: colorForCounty(f),
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

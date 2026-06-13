import useAEISStore from "../../store/useAEISStore";

export default function InfoPanel() {
  const selectedCounty = useAEISStore(
    (state) => state.selectedCounty
  );

  const selectedSubCounty = useAEISStore((state) => state.selectedSubCounty);

  const selectedWard = useAEISStore((state) => state.selectedWard);

  const hoveredCounty = useAEISStore((state) => state.hoveredCounty);
  const hoveredSubCounty = useAEISStore((state) => state.hoveredSubCounty);
  const hoveredWard = useAEISStore((state) => state.hoveredWard);

  const analysis = useAEISStore((state) => state.selectedAnalysis);
  const loading = useAEISStore((state) => state.loadingAnalysis);

  // Robust attribute getter to prevent "Empty Text Box" syndrome
  const getName = (feature) => {
    if (!feature || !feature.properties) return null;
    const p = feature.properties;
    return p.shapeName || p.ADM2_EN || p.ADM1_EN || p.NAME || p.County || p.SubCounty || p.NAME_1 || p.NAME_2;
  };

  const renderMetric = (label, value, unit = "") => (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', margin: '4px 0' }}>
      <span style={{ color: '#64748b' }}>{label}</span>
      <span style={{ fontWeight: '600' }}>{value ? `${value}${unit}` : 'N/A'}</span>
    </div>
  );

  const getClassificationStyle = (type) => {
    switch (type) {
      case "Urban":
        return { bg: "#fee2e2", text: "#991b1b", border: "#571e1e" };
      case "Peri-urban":
        return { bg: "#ffedd5", text: "#9a3412", border: "#b9d420" };
      case "Rural":
        return { bg: "#dcfce7", text: "#166534", border: "#bbf7d0" };
      default:
        return { bg: "#f1f5f9", text: "#475569", border: "#e2e8f0" };
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        bottom: "20px",
        right: "20px",
        width: "320px",
        zIndex: 1000,

        background: "rgba(255,255,255,0.96)",
        backdropFilter: "blur(14px)",
        borderRadius: "18px",
        padding: "18px",
        boxShadow: "0 12px 32px rgba(0,0,0,0.15)",
      }}
    >
      <h3
        style={{
          margin: 0,
          color: "#1b5e20",
        }}
      >
        📊 Area Information
      </h3>

      <hr />

      <div
        style={{
          padding: "10px",
          background: "#f8fafc",
          borderRadius: "12px",
          marginBottom: "10px",
        }}
      >
        <div style={{ color: "#64748b", fontSize: "12px" }}>
          COUNTY
        </div>

        <div
          style={{
            fontWeight: "700",
            fontSize: "15px",
          }}
        >
          {getName(hoveredCounty) || getName(selectedCounty) || "None Selected"}
        </div>
      </div>

      <div
        style={{
          padding: "10px",
          background: "#f8fafc",
          borderRadius: "12px",
          marginBottom: "10px",
        }}
      >
        <div style={{ color: "#64748b", fontSize: "12px" }}>
          SUB COUNTY
        </div>

        <div
          style={{
            fontWeight: "700",
            fontSize: "15px",
          }}
        > 
          {getName(hoveredSubCounty) || getName(selectedSubCounty) || "None Selected"}
        </div>
      </div>

      <div
        style={{
          padding: "10px",
          background: "#f8fafc",
          borderRadius: "12px",
        }}
      >
        <div style={{ color: "#64748b", fontSize: "12px" }}>
          WARD
        </div>

        <div
          style={{
            fontWeight: "700",
            fontSize: "15px",
          }}
        >
          {getName(hoveredWard) || getName(selectedWard) || "None Selected"}
        </div>
      </div>

      {analysis && (
        <div style={{ marginTop: '15px', borderTop: '1px solid #e2e8f0', paddingTop: '10px' }}>
          <h4 style={{ fontSize: '13px', margin: '0 0 8px 0', color: '#1b5e20' }}>
            {analysis.area_ha ? `🚜 Farm Analysis (${analysis.area_ha} ha)` : "🌍 Detailed Analysis"}
          </h4>
          {loading ? <div style={{ fontSize: '12px' }}>Calculating metrics...</div> : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', margin: '4px 0' }}>
                <span style={{ color: '#64748b' }}>Area Type</span>
                {analysis?.classification ? (
                  <span style={{
                    fontWeight: '700',
                    fontSize: '10px',
                    padding: '2px 10px',
                    borderRadius: '20px',
                    backgroundColor: getClassificationStyle(analysis.classification).bg,
                    color: getClassificationStyle(analysis.classification).text,
                    border: `1px solid ${getClassificationStyle(analysis.classification).border}`,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>
                    {analysis.classification}
                  </span>
                ) : <span style={{ fontWeight: '600' }}>N/A</span>}
              </div>
              {renderMetric("Cropland", analysis?.land_use?.cropland, "%")}
              {renderMetric("Grassland", analysis?.land_use?.grassland, "%")}
              {renderMetric("Forest", analysis?.land_use?.forest, "%")}
              {renderMetric("Bareland", analysis?.land_use?.bare_land, "%")}
              {renderMetric("Built-up", analysis?.land_use?.built_up, "%")}
              <div style={{ margin: '8px 0', borderTop: '1px dashed #cbd5e1' }} />
              {renderMetric("Road Network", analysis?.infrastructure?.roads_km, " km")}
            </>
          )}
        </div>
      )}
    </div>
  );
}

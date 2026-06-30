export default function TopBar() {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: "50px",
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        background: "rgba(27,94,32,0.95)",
        color: "white",
        fontWeight: "600",
        backdropFilter: "blur(10px)",
      }}
    >
      <div>🌍 AEIS-K | Climate, Water & Land Intelligence</div>

      <div style={{ fontSize: "12px", opacity: 0.9 }}>
        LIVE GIS DASHBOARD
      </div>
    </div>
  );
}

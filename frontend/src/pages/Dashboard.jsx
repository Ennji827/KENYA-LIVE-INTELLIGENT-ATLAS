import React, { useCallback, useEffect, useMemo, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import AuthGateway, { clearAuthSession, readAuthSession, saveAuthSession } from "../components/AuthGateway";
import StatCard from "../components/StatCard";
import CountyFilter from "../components/CountyFilter";
import LandCoverChart from "../components/LandCoverChart";
import CropHealthPanel from "../components/CropHealthPanel";
import AlertsPanel from "../components/AlertsPanel";
import ReportsPanel from "../components/ReportsPanel";
import FertilizerPanel from "../components/FertilizerPanel";
import PersistentMapPanel from "../components/PersistentMapPanel";
import RemoteSensingImageryPanel from "../components/RemoteSensingImageryPanel";
import CountyIntelligenceBrief from "../components/CountyIntelligenceBrief";
import DataAuthorityPanel from "../components/DataAuthorityPanel";
import RealtimeOperationsFeed from "../components/RealtimeOperationsFeed";
import SystemActualizationPanel from "../components/SystemActualizationPanel";
import MapView from "./MapView";
import CountyDashboard from "./CountyDashboard";
import FarmerDashboard from "./FarmerDashboard";
import Reports from "./Reports";
import AdminPanel from "./AdminPanel";
import CountySites from "./CountySites";
import {
  alerts as sampleAlerts,
  getCountyByName,
  getDashboardKpis,
  nationalSummary,
  reports as sampleReports,
  sampleCounties,
} from "../data/sampleDashboardData";
import { getApiBase } from "../utils/api";
import "../styles/dashboard.css";

function Header({ eyebrow = "National agriculture overview" }) {
  return (
    <div className="aeis-topbar">
      <div>
        <div className="aeis-kicker">{eyebrow}</div>
        <h1 className="aeis-title">{nationalSummary.title}</h1>
        <p className="aeis-subtitle">{nationalSummary.subtitle}</p>
      </div>
      <div className="aeis-status-pill">{sampleCounties.length} counties tracked</div>
    </div>
  );
}

function CommandCenterOverview({ counties }) {
  return (
    <div className="aeis-grid">
      <div className="aeis-card aeis-card-pad">
        <h2 className="aeis-section-title">National Command Center Data Sources</h2>
        <p className="aeis-section-copy">
          AEIS-K now shows only connected sources or source-required states. Select a county for boundary context, and use the live forecast below the map for current weather.
        </p>
        <div className="aeis-command-feed-grid">
          <div>
            <h3 className="aeis-mini-heading">Connected Now</h3>
            <div className="aeis-command-list">
              <div className="aeis-command-row"><span>GIS</span><strong>County, sub-county, ward boundaries</strong><em>Local</em></div>
              <div className="aeis-command-row"><span>WX</span><strong>Live weather forecast</strong><em>API</em></div>
              <div className="aeis-command-row"><span>IMG</span><strong>NASA true color, NDVI, LST map layers</strong><em>NASA</em></div>
              <div className="aeis-command-row"><span>OSM</span><strong>Mapped feature dots</strong><em>Live</em></div>
            </div>
          </div>
          <div>
            <h3 className="aeis-mini-heading">Source Required</h3>
            <div className="aeis-command-list">
              <div className="aeis-command-row"><span>NDVI</span><strong>County/farm raster values</strong><em>GEE</em></div>
              <div className="aeis-command-row"><span>NDWI</span><strong>County/farm moisture raster values</strong><em>GEE</em></div>
              <div className="aeis-command-row"><span>LC</span><strong>Classified land-cover percentages</strong><em>Source</em></div>
              <div className="aeis-command-row"><span>REG</span><strong>Verified farmer registry</strong><em>County</em></div>
            </div>
          </div>
          <div>
            <h3 className="aeis-mini-heading">Public Sharing Guard</h3>
            <div className="aeis-command-list">
              <div className="aeis-command-row"><span>LOCK</span><strong>Hide test passwords on public link</strong><em>On</em></div>
              <div className="aeis-command-row"><span>GPS</span><strong>Block county GPS bypass unless unlocked</strong><em>On</em></div>
              <div className="aeis-command-row"><span>AUTH</span><strong>SQLite login/session audit</strong><em>On</em></div>
              <div className="aeis-command-row"><span>MAP</span><strong>Only provider-backed index layers</strong><em>On</em></div>
            </div>
          </div>
        </div>
      </div>

      <div className="aeis-card aeis-card-pad">
        <h2 className="aeis-section-title">County Separation Registry</h2>
        <p className="aeis-section-copy">
          Each county is pinned by its official three-digit code and can run as an isolated county workspace after county login.
        </p>
        <div className="aeis-county-registry">
          {counties.map((county) => (
            <div key={county.name}>
              <span>{county.countyCode}</span>
              <strong>{county.name}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function insightForKpi(label) {
  if (label === "Registered Farms" || label === "Total Mapped Area") return "farmers";
  if (label === "Average NDVI") return "imagery";
  if (label === "Rainfall Risk") return "rainfall";
  if (label === "Crop Stress Level") return "stress";
  if (label === "Fertilizer Demand") return "fertilizer";
  if (["Cropland %", "Bare Land %", "Built-up Area %", "Grassland %"].includes(label)) return "landcover";
  return null;
}

function OperationsContext({ activeInsight, county, stats }) {
  const context = {
    farmers: {
      title: "County Farmer Registry Context",
      copy: `${county.name} farmer registry values are hidden until a verified county registry source is connected.`,
      rows: [
        ["Registered farms", "Source required"],
        ["Mapped area", "Source required"],
        ["Registry status", "Connect verified county source"],
      ],
    },
    rainfall: {
      title: "Rainfall Decision Context",
      copy: `${county.name} rainfall decisions should use the live forecast below the map and official station/history feeds when connected.`,
      rows: [
        ["Live forecast", "Below map"],
        ["Historical rainfall", "Source required"],
        ["Official station feed", "Source required"],
      ],
    },
    stress: {
      title: "Crop Stress Operations",
      copy: `Crop stress for ${county.name} is blocked until source-dated NDVI/NDWI rasters and field validation inputs are connected.`,
      rows: [
        ["Average NDVI", "Provider required"],
        ["Stress level", "Blocked"],
        ["Stress score", "Blocked"],
      ],
    },
    imagery: {
      title: "NDVI / NDWI Imagery Context",
      copy: `NDVI and NDWI for ${county.name} require real NASA/GEE/Sentinel/Landsat raster sources before values are published.`,
      rows: [
        ["NASA context layer", "Available on map"],
        ["GEE NDVI tile", "Configure provider"],
        ["GEE NDWI tile", "Configure provider"],
      ],
    },
    fertilizer: {
      title: "Fertilizer Planning Context",
      copy: `Fertilizer planning for ${county.name} is hidden until verified registry, acreage, crop stage, soil, and rainfall data are connected.`,
      rows: [
        ["Demand", "Source required"],
        ["Registered farms", "Source required"],
        ["Mapped area", "Source required"],
      ],
    },
    landcover: {
      title: "Land-Cover Planning Context",
      copy: `${county.name} land-cover percentages are hidden until a classified land-cover source is connected.`,
      rows: [
        ["Cropland", "Source required"],
        ["Bare land", "Source required"],
        ["Built-up area", "Source required"],
      ],
    },
  }[activeInsight];

  if (!context) return null;

  return (
    <div className="aeis-card aeis-card-pad">
      <h2 className="aeis-section-title">{context.title}</h2>
      <p className="aeis-section-copy">{context.copy}</p>
      <div className="aeis-metric-list">
        {context.rows.map(([label, value]) => (
          <div className="aeis-metric-row" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardHome({ filter, setFilter, dashboardData, alertData, reportData, lockedCounty }) {
  const [activeInsight, setActiveInsight] = useState("farmers");
  const selectedCounty = getCountyByName(filter.county);
  const stats = selectedCounty?.stats;
  const countyKpis = getDashboardKpis(selectedCounty || dashboardData).map((kpi) => ({
    ...kpi,
    note: kpi.label === "Registered Farms" && selectedCounty ? `${filter.county} county scope` : kpi.note,
  }));

  return (
    <>
      <Header />
      <div className="aeis-grid aeis-kpi-grid">
        {countyKpis.map((kpi) => {
          const insight = insightForKpi(kpi.label);
          return (
            <StatCard
              key={kpi.label}
              {...kpi}
              active={Boolean(selectedCounty && insight && activeInsight === insight)}
              onClick={selectedCounty && insight ? () => setActiveInsight(insight) : undefined}
            />
          );
        })}
      </div>

      <div style={{ height: 16 }} />
      <CountyFilter counties={sampleCounties} value={filter} onChange={setFilter} lockedCounty={lockedCounty} />

      <div style={{ height: 16 }} />
      <div className="aeis-grid aeis-two-col">
        <div className="aeis-grid">
          <div className="aeis-card aeis-card-pad">
            <h2 className="aeis-section-title">National Agriculture Overview</h2>
            <p className="aeis-section-copy">
              AEIS-K combines real county boundaries, farm mapping tools, provider-backed imagery layers, live weather forecast,
              and source-required safeguards into one county decision-support workspace for Kenya's 47 counties.
            </p>
            <div className="aeis-grid aeis-four-col">
              <StatCard label="Counties Tracked" value={dashboardData.countiesTracked || sampleCounties.length} tone="green" />
              <StatCard label="Reports Ready" value={dashboardData.reportsReady} tone="navy" />
              <StatCard label="Selected County" value={filter.county || "National"} tone="green" />
              <StatCard label="Selected Ward" value={filter.ward || "All wards"} tone="blue" />
            </div>
          </div>
          {selectedCounty ? (
            <>
              <CountyIntelligenceBrief county={selectedCounty} />
              <OperationsContext activeInsight={activeInsight} county={selectedCounty} stats={stats} />
              <LandCoverChart stats={stats} />
            </>
          ) : (
            <CommandCenterOverview counties={sampleCounties} />
          )}
          <ReportsPanel reports={reportData.slice(0, 3)} compact />
        </div>
        <div className="aeis-grid">
          <RealtimeOperationsFeed countyName={selectedCounty?.name || ""} />
          {selectedCounty ? (
            <>
              <RemoteSensingImageryPanel county={selectedCounty} />
              <DataAuthorityPanel county={selectedCounty} />
              <CropHealthPanel stats={stats} title={`${filter.county} Crop Health`} />
              <FertilizerPanel stats={stats} countyName={filter.county} />
            </>
          ) : (
            <>
              <SystemActualizationPanel compact />
              <DataAuthorityPanel />
              <div className="aeis-card aeis-card-pad">
                <h2 className="aeis-section-title">County Login Model</h2>
                <p className="aeis-section-copy">
                  Yes. AEIS-K can individualize every county. The backend already supports county-specific users, sessions, GPS geofencing, and county-scoped access.
                </p>
                <div className="aeis-metric-list">
                  <div className="aeis-metric-row"><span>County accounts</span><strong>47 email-based workspaces</strong></div>
                  <div className="aeis-metric-row"><span>SQL audit</span><strong>Login, GPS failure, logout</strong></div>
                  <div className="aeis-metric-row"><span>Google SSO</span><strong>Provider-ready allow-list</strong></div>
                </div>
              </div>
            </>
          )}
          <AlertsPanel alerts={alertData} />
        </div>
      </div>
    </>
  );
}

export default function Dashboard() {
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState(null);
  const [activePage, setActivePage] = useState("home");
  const [filter, setFilter] = useState({
    county: "",
    subcounty: "",
    ward: "",
  });
  const [dashboardData, setDashboardData] = useState(nationalSummary);
  const [alertData, setAlertData] = useState(sampleAlerts);
  const [reportData, setReportData] = useState(sampleReports);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const saved = readAuthSession();
      if (!saved) {
        setAuthReady(true);
        return;
      }

      if (saved.token) {
        try {
          const response = await fetch(`${getApiBase()}/api/auth/validate-session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: saved.token }),
          });
          if (response.ok) {
            const payload = await response.json();
            const restored = {
              ...payload,
              auth_mode: payload.role,
              lockedCounty: payload.role === "county" ? payload.county : "",
            };
            saveAuthSession(restored);
            if (!cancelled) setSession(restored);
          } else {
            clearAuthSession();
          }
        } catch (error) {
          clearAuthSession();
        }
      } else {
        clearAuthSession();
      }

      if (!cancelled) setAuthReady(true);
    }

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session) return;

    if (session.role === "county") {
      const county = getCountyByName(session.county);
      if (!county) return;
      setFilter({
        county: county.name,
        subcounty: "",
        ward: "",
      });
      setActivePage("county");
      return;
    }

  }, [session]);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboardApi() {
      try {
        const apiBase = getApiBase();
        const [summaryResponse, alertsResponse, reportsResponse] = await Promise.all([
          fetch(`${apiBase}/api/dashboard/summary`),
          fetch(`${apiBase}/api/dashboard/alerts`),
          fetch(`${apiBase}/api/dashboard/reports`),
        ]);

        if (!summaryResponse.ok || !alertsResponse.ok || !reportsResponse.ok) return;

        const [summary, alertsPayload, reportsPayload] = await Promise.all([
          summaryResponse.json(),
          alertsResponse.json(),
          reportsResponse.json(),
        ]);

        if (!cancelled) {
          setDashboardData(summary.summary || nationalSummary);
          setAlertData(alertsPayload.alerts || sampleAlerts);
          setReportData(reportsPayload.reports || sampleReports);
        }
      } catch (error) {
        if (!cancelled) {
          setDashboardData(nationalSummary);
        }
      }
    }

    loadDashboardApi();
    return () => {
      cancelled = true;
    };
  }, []);

  const lockedCounty = session?.role === "county" ? session.lockedCounty || session.county : "";

  const setScopedFilter = useMemo(() => {
    if (!lockedCounty) return setFilter;
    return (nextFilter) => {
      const county = getCountyByName(lockedCounty);
      if (!county) return;
      setFilter({
        county: county.name,
        subcounty: nextFilter.subcounty || "",
        ward: nextFilter.ward || "",
      });
    };
  }, [lockedCounty]);

  const handleLogout = async () => {
    const current = session;
    clearAuthSession();
    setSession(null);
    setFilter({ county: "", subcounty: "", ward: "" });
    setActivePage("home");

    if (current?.token) {
      try {
        await fetch(`${getApiBase()}/api/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: current.token }),
        });
      } catch (error) {
        // Local session is already cleared.
      }
    }
  };

  const handleOpenCountySite = useCallback((county) => {
    if (!county) return;
    setFilter({
      county: county.name,
      subcounty: "",
      ward: "",
    });
    setActivePage("county");
  }, []);

  const handleSidebarCountySelect = useCallback((countyName) => {
    if (!countyName) {
      setFilter({ county: "", subcounty: "", ward: "" });
      setActivePage("home");
      return;
    }

    const county = getCountyByName(countyName);
    if (!county) return;
    setFilter({
      county: county.name,
      subcounty: "",
      ward: "",
    });
    setActivePage("county");
  }, []);

  const page = useMemo(() => {
    const selectedCounty = getCountyByName(filter.county);
    const sharedProps = {
      filter,
      setFilter: setScopedFilter,
      selectedCounty,
      alerts: alertData,
      reports: reportData,
      lockedCounty,
      session,
      onOpenCounty: handleOpenCountySite,
    };

    if (activePage === "map") return <MapView {...sharedProps} />;
    if (activePage === "county") return <CountyDashboard {...sharedProps} />;
    if (activePage === "farmer") return <FarmerDashboard {...sharedProps} />;
    if (activePage === "reports") return <Reports {...sharedProps} />;
    if (activePage === "county-sites" && !["ministry", "analyst"].includes(session?.role)) {
      return (
        <div className="aeis-card aeis-card-pad">
          <h1 className="aeis-section-title">Restricted Workspace</h1>
          <p className="aeis-section-copy">The all-county site directory is only available inside a national AEIS-K session.</p>
        </div>
      );
    }
    if (activePage === "county-sites") return <CountySites {...sharedProps} />;
    if (activePage === "admin" && session?.role !== "ministry") {
      return (
        <div className="aeis-card aeis-card-pad">
          <h1 className="aeis-section-title">Restricted Workspace</h1>
          <p className="aeis-section-copy">Admin / Ministry tools are only available inside the national command center session.</p>
        </div>
      );
    }
    if (activePage === "admin") return <AdminPanel {...sharedProps} />;

    return (
      <DashboardHome
        filter={filter}
        setFilter={setScopedFilter}
        dashboardData={dashboardData}
        alertData={alertData}
        reportData={reportData}
        lockedCounty={lockedCounty}
      />
    );
  }, [activePage, alertData, dashboardData, filter, handleOpenCountySite, lockedCounty, reportData, session, setScopedFilter]);

  if (!authReady) {
    return (
      <div className="aeis-auth-shell">
        <div className="aeis-card aeis-card-pad">Loading AEIS-K session...</div>
      </div>
    );
  }

  if (!session) {
    return <AuthGateway onAuthenticated={setSession} />;
  }

  return (
    <DashboardLayout
      activePage={activePage}
      onPageChange={setActivePage}
      session={session}
      onLogout={handleLogout}
      counties={sampleCounties}
      selectedCounty={filter.county}
      lockedCounty={lockedCounty}
      onCountySelect={handleSidebarCountySelect}
    >
      {activePage === "map" ? (
        page
      ) : (
        <div className="aeis-workspace-grid">
          <div className="aeis-workspace-main">{page}</div>
          <PersistentMapPanel filter={filter} />
        </div>
      )}
    </DashboardLayout>
  );
}

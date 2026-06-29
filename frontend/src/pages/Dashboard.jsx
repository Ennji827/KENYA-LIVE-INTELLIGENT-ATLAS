import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  ClipboardCheck,
  Database,
  FileCheck2,
  MapPinned,
  RadioTower,
} from "lucide-react";
import DashboardLayout from "../components/DashboardLayout";
import AuthGateway, { clearAuthSession, readAuthSession, saveAuthSession } from "../components/AuthGateway";
import StatCard from "../components/StatCard";
import CommandCenterHero from "../components/CommandCenterHero";
import CountyFilter from "../components/CountyFilter";
import LandCoverChart from "../components/LandCoverChart";
import CropHealthPanel from "../components/CropHealthPanel";
import AlertsPanel from "../components/AlertsPanel";
import ReportsPanel from "../components/ReportsPanel";
import FertilizerPanel from "../components/FertilizerPanel";
import RemoteSensingImageryPanel from "../components/RemoteSensingImageryPanel";
import CountyIntelligenceBrief from "../components/CountyIntelligenceBrief";
import DataAuthorityPanel from "../components/DataAuthorityPanel";
import RealtimeOperationsFeed from "../components/RealtimeOperationsFeed";
import {
  getCountyByName,
  nationalSummary,
  kenyaCounties,
} from "../data/kenyaCountyCatalog";
import { getApiBase } from "../utils/api";
import "../styles/dashboard.css";

const LandingPage = lazy(() => import("./LandingPage"));
const MapView = lazy(() => import("./MapView"));
const CountyDashboard = lazy(() => import("./CountyDashboard"));
const FarmerDashboard = lazy(() => import("./FarmerDashboard"));
const Reports = lazy(() => import("./Reports"));
const IntelligenceAssistant = lazy(() => import("./IntelligenceAssistant"));
const AdminPanel = lazy(() => import("./AdminPanel"));
const CountySites = lazy(() => import("./CountySites"));
const PersistentMapPanel = lazy(() => import("../components/PersistentMapPanel"));
const LiveWeatherForecastPanel = lazy(() => import("../components/LiveWeatherForecastPanel"));
const ClimateInsightStudio = lazy(() => import("../components/ClimateInsightStudio"));
const EnvironmentalIntelligenceHub = lazy(() => import("../components/EnvironmentalIntelligenceHub"));

function WorkspaceLoading() {
  return (
    <div className="aeis-card aeis-card-pad aeis-workspace-loading" role="status">
      <span className="aeis-skeleton wide" />
      <span className="aeis-skeleton" />
      <span className="aeis-skeleton short" />
    </div>
  );
}

function CommandCenterOverview({ dashboardData }) {
  const gaps = dashboardData.dataGaps || [];
  return (
    <div className="aeis-card aeis-card-pad">
      <h2 className="aeis-section-title">National Evidence Coverage</h2>
      <p className="aeis-section-copy">
        Connected services available for current analysis. Select a county when you need local detail.
      </p>
      <div className="aeis-command-feed-grid aeis-command-feed-grid-compact">
        <div>
          <h3 className="aeis-mini-heading">Connected evidence</h3>
          <div className="aeis-command-list">
            <div className="aeis-command-row"><span>GIS</span><strong>47 county boundaries with sub-county and ward drill-down</strong><em>Ready</em></div>
            <div className="aeis-command-row"><span>WX</span><strong>Open-Meteo ten-day forecasts</strong><em>Live</em></div>
            <div className="aeis-command-row"><span>HIST</span><strong>NASA POWER climate history</strong><em>Live</em></div>
            <div className="aeis-command-row"><span>SAT</span><strong>Sentinel-2 and Landsat catalogues</strong><em>Live</em></div>
          </div>
        </div>
        <div>
          <h3 className="aeis-mini-heading">Operational records</h3>
          <div className="aeis-command-list">
            <div className="aeis-command-row"><span>GIS</span><strong>Uploaded GIS datasets</strong><em>{dashboardData.uploadedAssets || 0}</em></div>
            <div className="aeis-command-row"><span>FIELD</span><strong>Verified field reports</strong><em>{dashboardData.verifiedFieldReports || 0}</em></div>
            <div className="aeis-command-row"><span>AI</span><strong>Saved intelligence analyses</strong><em>{dashboardData.intelligenceInsights || 0}</em></div>
            <div className="aeis-command-row"><span>PUB</span><strong>Published reports</strong><em>{dashboardData.publishedReports || 0}</em></div>
          </div>
        </div>
      </div>
      {gaps.length > 0 && (
        <details className="aeis-data-gaps-disclosure">
          <summary>{gaps.length} datasets are not yet connected</summary>
          <p>They remain excluded from headline KPIs until an authoritative provider is configured.</p>
          <ul>
            {gaps.map((gap) => <li key={gap}>{gap}</li>)}
          </ul>
        </details>
      )}
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

function DashboardHome({
  filter,
  setFilter,
  dashboardData,
  alertData,
  reportData,
  lockedCounty,
  session,
  dataStatus,
  updatedAt,
  onRefresh,
  onNavigate,
  onAskAssistant,
}) {
  const [activeInsight, setActiveInsight] = useState("farmers");
  const selectedCounty = getCountyByName(filter.county);
  const stats = selectedCounty?.stats;
  const heroKpis = selectedCounty
    ? [
        { label: "County Scope", value: selectedCounty.countyCode, note: selectedCounty.name, tone: "navy", icon: MapPinned },
        { label: "Weather Forecast", value: "10 days", note: "Open-Meteo best match", tone: "blue", icon: RadioTower },
        { label: "Boundaries", value: "Loaded", note: "County, sub-county and ward", tone: "green", icon: MapPinned },
        { label: "Satellite Search", value: "2 catalogues", note: "Sentinel-2 and Landsat", tone: "green", icon: Database },
      ]
    : [
        { label: "County Coverage", value: dashboardData.countiesTracked ?? 47, note: "47 of 47 administrative areas", tone: "green", icon: MapPinned },
        { label: "Connected Sources", value: dashboardData.connectedSources ?? "—", note: "Weather, climate and satellite", tone: "blue", icon: RadioTower },
        { label: "GIS Datasets", value: dashboardData.uploadedAssets ?? "—", note: "Validated uploaded assets", tone: "navy", icon: Database },
        { label: "Active Alerts", value: dashboardData.openAlerts ?? "—", note: "Unresolved operational alerts", tone: dashboardData.openAlerts ? "amber" : "green", icon: BellRing },
        { label: "Verified Field Reports", value: dashboardData.verifiedFieldReports ?? "—", note: `${dashboardData.fieldReports ?? "—"} total submitted`, tone: "green", icon: ClipboardCheck },
        { label: "Reports", value: dashboardData.reportsReady ?? "—", note: `${dashboardData.publishedReports ?? "—"} published`, tone: "navy", icon: FileCheck2 },
      ];

  return (
    <>
      <CommandCenterHero
        selectedCounty={selectedCounty}
        session={session}
        dataStatus={dataStatus}
        updatedAt={updatedAt}
        onRefresh={onRefresh}
        onNavigate={onNavigate}
      />
      <div className="aeis-grid aeis-kpi-grid">
        {heroKpis.map((kpi) => {
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
      <CountyFilter counties={kenyaCounties} value={filter} onChange={setFilter} lockedCounty={lockedCounty} />

      <div style={{ height: 16 }} />
      <Suspense fallback={<WorkspaceLoading />}>
        <EnvironmentalIntelligenceHub
          session={session}
          county={selectedCounty}
          onOpenAssistant={onAskAssistant}
        />
      </Suspense>

      <div style={{ height: 16 }} />
      <Suspense fallback={<WorkspaceLoading />}>
        <ClimateInsightStudio
          session={session}
          county={selectedCounty}
          onOpenAssistant={onAskAssistant}
        />
      </Suspense>

      <div style={{ height: 16 }} />
      <div className="aeis-grid aeis-two-col">
        <div className="aeis-grid">
          {selectedCounty ? (
            <>
              <CountyIntelligenceBrief county={selectedCounty} />
              <OperationsContext activeInsight={activeInsight} county={selectedCounty} stats={stats} />
              <LandCoverChart stats={stats} />
            </>
          ) : (
            <CommandCenterOverview dashboardData={dashboardData} />
          )}
          <ReportsPanel reports={reportData.slice(0, 3)} compact />
        </div>
        <div className="aeis-grid">
          {selectedCounty ? (
            <RealtimeOperationsFeed countyName={selectedCounty.name} />
          ) : (
            <Suspense fallback={<WorkspaceLoading />}>
              <LiveWeatherForecastPanel />
            </Suspense>
          )}
          {selectedCounty ? (
            <>
              <RemoteSensingImageryPanel county={selectedCounty} />
              <details className="aeis-secondary-details">
                <summary>Advanced source gates and planning tools</summary>
                <div className="aeis-grid aeis-secondary-details-body">
                  <DataAuthorityPanel county={selectedCounty} />
                  <CropHealthPanel stats={stats} title={`${filter.county} Crop Health`} />
                  <FertilizerPanel stats={stats} countyName={filter.county} />
                </div>
              </details>
            </>
          ) : (
            <AlertsPanel alerts={alertData} />
          )}
          {selectedCounty && <AlertsPanel alerts={alertData} />}
        </div>
      </div>
    </>
  );
}

export default function Dashboard() {
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState(null);
  const [portalView, setPortalView] = useState("landing"); // landing | signin | register
  const [activePage, setActivePage] = useState("home");
  const [filter, setFilter] = useState({
    county: "",
    subcounty: "",
    ward: "",
  });
  const [dashboardData, setDashboardData] = useState(nationalSummary);
  const [alertData, setAlertData] = useState([]);
  const [reportData, setReportData] = useState([]);
  const [dashboardStatus, setDashboardStatus] = useState("loading");
  const [dashboardUpdatedAt, setDashboardUpdatedAt] = useState(null);
  const [assistantDraft, setAssistantDraft] = useState("");

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
            const countyScopedRoles = ["county", "field_officer", "farmer"];
            const restored = {
              ...payload,
              auth_mode: payload.role,
              lockedCounty: countyScopedRoles.includes(payload.role) ? payload.county : "",
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

    if (["county", "field_officer", "farmer"].includes(session.role)) {
      const county = getCountyByName(session.county);
      if (!county) return;
      setFilter({
        county: county.name,
        subcounty: "",
        ward: "",
      });
      setActivePage(session.role === "farmer" ? "farmer" : "county");
      return;
    }

  }, [session]);

  const loadDashboardApi = useCallback(async () => {
    if (!session?.token) return;
    setDashboardStatus((current) => (current === "loading" ? "loading" : "refreshing"));

    const apiBase = getApiBase();
    const requests = [
      fetch(`${apiBase}/api/dashboard/summary`),
      fetch(`${apiBase}/api/dashboard/alerts`, {
        headers: { Authorization: `Bearer ${session.token}` },
      }),
      fetch(`${apiBase}/api/dashboard/reports`, {
        headers: { Authorization: `Bearer ${session.token}` },
      }),
    ];

    const results = await Promise.allSettled(requests);
    let successfulSources = 0;
    let newestTimestamp = null;

    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      if (result.status !== "fulfilled" || !result.value.ok) continue;
      try {
        const payload = await result.value.json();
        successfulSources += 1;
        if (index === 0) {
          setDashboardData(payload.summary || nationalSummary);
          newestTimestamp = payload.generated_at || newestTimestamp;
        } else if (index === 1) {
          setAlertData(payload.alerts || []);
          newestTimestamp = payload.generated_at || newestTimestamp;
        } else {
          setReportData(payload.reports || []);
          newestTimestamp = payload.generated_at || newestTimestamp;
        }
      } catch (error) {
        // A malformed source is isolated so healthy dashboard sources still render.
      }
    }

    if (successfulSources === requests.length) setDashboardStatus("ready");
    else if (successfulSources > 0) setDashboardStatus("partial");
    else setDashboardStatus("error");
    if (successfulSources > 0) setDashboardUpdatedAt(newestTimestamp || new Date().toISOString());
  }, [session?.token]);

  useEffect(() => {
    if (!session?.token) return undefined;
    loadDashboardApi();
    const timer = window.setInterval(loadDashboardApi, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [loadDashboardApi, session?.token]);

  const lockedCounty = ["county", "field_officer", "farmer"].includes(session?.role)
    ? session.lockedCounty || session.county
    : "";

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
    setPortalView("landing");
    setFilter({ county: "", subcounty: "", ward: "" });
    setActivePage("home");
    setDashboardData(nationalSummary);
    setAlertData([]);
    setReportData([]);
    setDashboardStatus("loading");
    setDashboardUpdatedAt(null);

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

  const handleAskAssistant = useCallback((prompt) => {
    setAssistantDraft(prompt || "");
    setActivePage("intelligence");
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
      initialQuestion: assistantDraft,
      onAskAssistant: handleAskAssistant,
    };

    if (activePage === "map") return <MapView {...sharedProps} />;
    if (activePage === "intelligence") return <IntelligenceAssistant {...sharedProps} />;
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
    if (activePage === "admin" && !["ministry", "auditor"].includes(session?.role)) {
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
        session={session}
        dataStatus={dashboardStatus}
        updatedAt={dashboardUpdatedAt}
        onRefresh={loadDashboardApi}
        onNavigate={setActivePage}
        onAskAssistant={handleAskAssistant}
      />
    );
  }, [
    activePage,
    alertData,
    dashboardData,
    dashboardStatus,
    dashboardUpdatedAt,
    filter,
    handleOpenCountySite,
    handleAskAssistant,
    assistantDraft,
    loadDashboardApi,
    lockedCounty,
    reportData,
    session,
    setScopedFilter,
  ]);

  if (!authReady) {
    return (
      <div className="auth-shell">
        <div className="auth-card" style={{ textAlign: "center", color: "#64748b", fontWeight: 700 }}>
          Loading AEIS-K…
        </div>
      </div>
    );
  }

  if (!session) {
    if (portalView === "landing") {
      return (
        <Suspense fallback={null}>
          <LandingPage
            onSignIn={() => setPortalView("signin")}
            onSignUp={() => setPortalView("register")}
          />
        </Suspense>
      );
    }
    return (
      <AuthGateway
        onAuthenticated={setSession}
        initialView={portalView === "register" ? "register" : "signin"}
        onBack={() => setPortalView("landing")}
      />
    );
  }

  return (
    <DashboardLayout
      activePage={activePage}
      onPageChange={setActivePage}
      session={session}
      onLogout={handleLogout}
      counties={kenyaCounties}
      selectedCounty={filter.county}
      lockedCounty={lockedCounty}
      onCountySelect={handleSidebarCountySelect}
    >
      {["map", "intelligence", "reports", "admin", "county-sites"].includes(activePage) ? (
        <Suspense fallback={<WorkspaceLoading />}>{page}</Suspense>
      ) : (
        <div className="aeis-workspace-grid">
          <div className="aeis-workspace-main">
            <Suspense fallback={<WorkspaceLoading />}>{page}</Suspense>
          </div>
          <Suspense fallback={<WorkspaceLoading />}>
            <PersistentMapPanel filter={filter} />
          </Suspense>
        </div>
      )}
    </DashboardLayout>
  );
}

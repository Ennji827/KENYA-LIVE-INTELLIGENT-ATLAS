// Centralized AEIS-K backend API client.
//
// The topic-centric UI previously talked to only a handful of endpoints
// (auth, payments, intelligence/query). This module wires up every backend
// endpoint the dashboard build (origin/main) consumed, so the whole surface
// is available from one place instead of hand-rolled `fetch` calls scattered
// across components.
//
// Auth: protected endpoints expect `Authorization: Bearer <token>`. The public
// portal stores its session (including `token`) under `aeis_auth_session`
// (see AuthGateway). We attach that token to every request when present —
// harmless for public endpoints, required for protected ones.
//
// Every helper returns the parsed JSON body and throws an Error (with `.status`
// and `.payload`) on a non-2xx response, so callers can `try/catch` and fall
// back to local scaffolding when the backend is unreachable.

import { getApiBase } from "./api";

const SESSION_KEY = "aeis_auth_session";

// Read the bearer token from the stored auth session, if any.
export function sessionToken() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw)?.token || "" : "";
  } catch {
    return "";
  }
}

// Core request helper. `query` is an object serialized to a query string.
async function request(path, { method = "GET", body, query, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = sessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let url = `${getApiBase()}${path}`;
  if (query) {
    const params = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    ).toString();
    if (params) url += `?${params}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request to ${path} failed (${res.status}).`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

const enc = encodeURIComponent;

// ── Metadata & system ────────────────────────────────────────────
export const fetchMetadata = () => request("/api/metadata");
export const fetchSystemAccess = () => request("/api/system/access");
export const fetchSystemActualization = () => request("/api/system/actualization");
export const updatePublicAccess = (body) =>
  request("/api/system/public-access", { method: "POST", body });

// ── Dashboard ────────────────────────────────────────────────────
export const fetchDashboardSummary = () => request("/api/dashboard/summary");
export const fetchDashboardRealtime = (county) =>
  request("/api/dashboard/realtime", { query: { county } });
export const fetchDashboardCounty = (identifier) =>
  request(`/api/dashboard/county/${enc(identifier)}`);
export const fetchDashboardAlerts = () => request("/api/dashboard/alerts"); // protected
export const fetchDashboardReports = () => request("/api/dashboard/reports"); // protected

// ── Weather ──────────────────────────────────────────────────────
// No county → national forecast summary; with county → live county forecast.
export const fetchWeatherForecast = (county) =>
  request("/api/weather/forecast", { query: { county } });

// ── Analysis ─────────────────────────────────────────────────────
export const fetchCountryAnalysis = () => request("/api/analysis/country");
export const fetchCountyAnalysis = (identifier) =>
  request(`/api/analysis/county/${enc(identifier)}`);
export const fetchSubcountyAnalysis = (identifier) =>
  request(`/api/analysis/subcounty/${enc(identifier)}`);
export const fetchWardAnalysis = (identifier) =>
  request(`/api/analysis/ward/${enc(identifier)}`);
export const fetchAreaAnalysis = (geometry) =>
  request("/api/analysis/area", { method: "POST", body: { geometry } });
export const evaluateIndices = (body) =>
  request("/api/indices/evaluate", { method: "POST", body });
export const fetchAutomationStatus = () => request("/api/automation/status");
export const fetchSegmentation = (segmentClass, { level = "county", id, limit } = {}) =>
  request(`/api/segmentation/${enc(segmentClass)}`, { query: { level, id, limit } });

// ── Data catalog, assets & imagery ───────────────────────────────
export const fetchDataSources = () => request("/api/data/sources");
export const registerDataSource = (body) =>
  request("/api/data/sources", { method: "POST", body }); // ministry only
export const fetchDataAssets = (limit) =>
  request("/api/data/assets", { query: { limit } }); // protected
export const uploadDataAsset = (body) =>
  request("/api/data/assets/upload", { method: "POST", body }); // protected
export const fetchNasaPowerHistory = (query) =>
  request("/api/data/history/nasa-power", { query });
export const fetchSentinel2 = (query) =>
  request("/api/data/imagery/sentinel-2", { query });
export const fetchLandsatLatest = (query) =>
  request("/api/data/imagery/landsat/latest", { query });

// ── GEE layers ───────────────────────────────────────────────────
export const fetchGeeLayers = () => request("/api/gee/layers");

// ── Live topic metrics from OpenStreetMap (roads / forests / water_bodies) ──
// No county → national per-county aggregate; with county → that county only.
export const fetchOsmMetric = (topic, county) =>
  request(`/api/osm/metric/${enc(topic)}`, { query: { county } });

// ── Live topic metrics from Google Earth Engine ───────────────────
// Zonal statistics + a raster tile URL for the child regions of the current
// scope (forests / farmland / water_bodies / rainfall / weather).
export const fetchGeeMetric = (topic, { level, county, subcounty } = {}) =>
  request(`/api/gee/metric/${enc(topic)}`, {
    query: { level, county, subcounty },
  });

export const fetchGeeStatus = () => request("/api/gee/status");

// ── Intelligence ─────────────────────────────────────────────────
export const fetchIntelligenceStatus = () => request("/api/intelligence/status"); // protected
export const fetchIntelligenceInsights = (limit = 20) =>
  request("/api/intelligence/insights", { query: { limit } }); // protected
export const postIntelligenceQuery = (body) =>
  request("/api/intelligence/query", { method: "POST", body }); // protected + permission

// ── Reports ──────────────────────────────────────────────────────
export const fetchReports = (query) => request("/api/reports", { query }); // protected (report_read)
export const fetchReport = (reportId) => request(`/api/reports/${reportId}`); // protected
export const createReport = (body) =>
  request("/api/reports", { method: "POST", body }); // protected (report_generate)
// Move a report along its workflow (draft → reviewed → approved → published).
// Role enforcement lives on the backend; the client mirrors it for button gating.
export const transitionReport = (reportId, status, note = "") =>
  request(`/api/reports/${reportId}/transition`, { method: "POST", body: { status, note } });

// Export a report as a file. Unlike the JSON helpers this returns a Blob, so the
// bearer token must ride on the request manually (an <a href> can't send headers).
export async function downloadReport(reportId, exportFormat) {
  const headers = {};
  const token = sessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(
    `${getApiBase()}/api/reports/${reportId}/export/${enc(exportFormat)}`,
    { headers },
  );
  if (!res.ok) {
    let payload = {};
    try {
      payload = await res.json();
    } catch {
      /* non-JSON error body */
    }
    const err = new Error(payload.error || `Export failed (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return { blob: await res.blob(), filename: `aeis-report-${reportId}.${exportFormat}` };
}

// ── Field reports ────────────────────────────────────────────────
export const fetchFieldReports = (query) =>
  request("/api/field-reports", { query }); // protected
export const submitFieldReport = (body) =>
  request("/api/field-reports", { method: "POST", body }); // protected
export const verifyFieldReport = (reportId, body) =>
  request(`/api/field-reports/${reportId}/verify`, { method: "POST", body }); // protected

// ── Processing jobs ──────────────────────────────────────────────
export const fetchJobs = () => request("/api/jobs"); // protected
export const fetchJob = (jobId) => request(`/api/jobs/${jobId}`);

// Poll a background job until it settles or the timeout elapses.
export async function waitForJob(jobId, { onProgress, timeoutMs = 180_000, intervalMs = 1000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const payload = await fetchJob(jobId);
    const job = payload.job;
    onProgress?.(job);
    if (job.status === "succeeded") return job;
    if (job.status === "failed") throw new Error(job.error || "Background processing failed.");
    if (job.status === "cancelled") throw new Error("Background processing was cancelled.");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Processing is still running. It remains queued and can be checked again.");
}

// ── Users (staff admin) ──────────────────────────────────────────
export const fetchUsers = () => request("/api/users"); // protected
export const createUser = (body) => request("/api/users", { method: "POST", body });
export const updateUser = (userId, body) =>
  request(`/api/users/${userId}`, { method: "PATCH", body });

// ── Session & governance ─────────────────────────────────────────
export const validateSession = (body) =>
  request("/api/auth/validate-session", { method: "POST", body });
export const logout = (body) => request("/api/auth/logout", { method: "POST", body });
export const fetchCountyAccounts = () => request("/api/auth/county-accounts");
export const fetchAccessModel = () => request("/api/auth/access-model");
export const fetchAuditLog = (limit) =>
  request("/api/auth/audit-log", { query: { limit } });

// ── Boundaries ───────────────────────────────────────────────────
export const fetchBoundaryCounties = () => request("/api/boundary/counties");
export const fetchBoundaryCounty = (identifier) =>
  request(`/api/boundary/county/${enc(identifier)}`);

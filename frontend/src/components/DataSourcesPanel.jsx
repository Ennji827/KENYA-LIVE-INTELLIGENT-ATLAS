import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getApiBase } from "../utils/api";

function isoDate(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

function twentyYearsAgo() {
  const value = new Date();
  value.setFullYear(value.getFullYear() - 20);
  return isoDate(value);
}

function sentinelArchiveStart() {
  return "2015-06-27";
}

function formatBytes(value) {
  if (!Number.isFinite(Number(value))) return "--";
  const bytes = Number(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function latestRows(records = [], count = 12) {
  return records.slice(Math.max(0, records.length - count)).reverse();
}

export default function DataSourcesPanel({ session, selectedCounty, readOnly = false }) {
  const apiBase = getApiBase();
  const defaultCounty = selectedCounty?.name || "Mombasa";
  const [catalog, setCatalog] = useState(null);
  const [assets, setAssets] = useState([]);
  const [status, setStatus] = useState("Loading data-source catalogue...");
  const [history, setHistory] = useState(null);
  const [imagery, setImagery] = useState(null);
  const [historyForm, setHistoryForm] = useState({
    county: defaultCounty,
    temporal: "monthly",
    start: twentyYearsAgo(),
    end: isoDate(),
  });
  const [imageryForm, setImageryForm] = useState({
    county: defaultCounty,
    collection: "sentinel-2-l2a",
    start: sentinelArchiveStart(),
    end: isoDate(),
    max_cloud: "30",
  });
  const [uploadForm, setUploadForm] = useState({
    name: "",
    scope_level: selectedCounty ? "county" : "national",
    scope_name: selectedCounty?.name || "",
    scope_code: selectedCounty?.countyCode || "",
    acquisition_start: "",
    acquisition_end: "",
    file: null,
  });

  useEffect(() => {
    if (!selectedCounty?.name) return;
    setHistoryForm((current) => ({ ...current, county: selectedCounty.name }));
    setImageryForm((current) => ({ ...current, county: selectedCounty.name }));
    setUploadForm((current) => ({
      ...current,
      scope_level: "county",
      scope_name: selectedCounty.name,
      scope_code: selectedCounty.countyCode || "",
    }));
  }, [selectedCounty]);

  const loadCatalog = useCallback(async () => {
    try {
      const [catalogResponse, assetsResponse] = await Promise.all([
        fetch(`${apiBase}/api/data/sources`),
        fetch(`${apiBase}/api/data/assets?limit=50`, {
          headers: { Authorization: `Bearer ${session?.token || ""}` },
        }),
      ]);
      const [catalogPayload, assetsPayload] = await Promise.all([
        catalogResponse.json(),
        assetsResponse.json(),
      ]);
      if (!catalogResponse.ok) throw new Error(catalogPayload.error || "Data-source catalogue unavailable.");
      if (!assetsResponse.ok) throw new Error(assetsPayload.error || "GIS asset list unavailable.");
      setCatalog(catalogPayload);
      setAssets(assetsPayload.assets || []);
      setStatus(`${catalogPayload.sources?.length || 0} sources and ${assetsPayload.assets?.length || 0} uploaded assets ready.`);
    } catch (error) {
      setStatus(error.message || "Data-source catalogue unavailable.");
    }
  }, [apiBase, session?.token]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const connectedSources = useMemo(
    () => (catalog?.sources || []).filter((source) => source.enabled),
    [catalog],
  );

  async function loadHistory(event) {
    event.preventDefault();
    setStatus("Loading NASA POWER history...");
    setHistory(null);
    const query = new URLSearchParams(historyForm);
    try {
      const response = await fetch(`${apiBase}/api/data/history/nasa-power?${query}`, {
        headers: { Authorization: `Bearer ${session?.token || ""}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Historical climate query failed.");
      setHistory(payload);
      setStatus(`${payload.record_count} NASA POWER records loaded through ${payload.latest_available || "the latest available date"}.`);
    } catch (error) {
      setStatus(error.message || "Historical climate query failed.");
    }
  }

  async function loadImagery(event) {
    event.preventDefault();
    setStatus("Searching the Copernicus Sentinel-2 catalogue...");
    setImagery(null);
    const query = new URLSearchParams({ ...imageryForm, limit: "20" });
    try {
      const response = await fetch(`${apiBase}/api/data/imagery/sentinel-2?${query}`, {
        headers: { Authorization: `Bearer ${session?.token || ""}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Sentinel-2 search failed.");
      setImagery(payload);
      setStatus(`${payload.item_count} recent Sentinel-2 scenes found for ${payload.county}.`);
    } catch (error) {
      setStatus(error.message || "Sentinel-2 search failed.");
    }
  }

  async function uploadAsset(event) {
    event.preventDefault();
    if (!uploadForm.file) {
      setStatus("Choose a GIS file before uploading.");
      return;
    }
    setStatus(`Uploading ${uploadForm.file.name}...`);
    const formData = new FormData();
    Object.entries(uploadForm).forEach(([key, value]) => {
      if (value) formData.append(key, value);
    });
    try {
      const response = await fetch(`${apiBase}/api/data/assets/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.token || ""}` },
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "GIS upload failed.");
      setStatus(`${payload.asset.name} uploaded and catalogued.`);
      setUploadForm((current) => ({ ...current, name: "", acquisition_start: "", acquisition_end: "", file: null }));
      await loadCatalog();
    } catch (error) {
      setStatus(error.message || "GIS upload failed.");
    }
  }

  return (
    <div className="aeis-card aeis-card-pad aeis-data-manager">
      <div className="aeis-data-manager-head">
        <div>
          <div className="aeis-kicker">Historical and uploaded data</div>
          <h2 className="aeis-section-title">GIS Data Sources</h2>
          <p className="aeis-section-copy">
            Query ten years of source-backed climate or satellite metadata, and add approved county GIS files without changing application code.
          </p>
        </div>
        <div className="aeis-status-pill">{catalog?.summary?.connected_apis ?? 0} APIs connected</div>
      </div>

      <div className="aeis-provider-list">
        {connectedSources.map((source) => (
          <div className="aeis-provider-row" key={source.slug}>
            <div>
              <strong>{source.name}</strong>
              <span>{source.description}</span>
            </div>
            <em className={source.access?.includes("connected") || source.access === "configured" ? "actual" : "needed"}>
              {source.access?.replaceAll("_", " ") || "registered"}
            </em>
            <b>{source.coverage_start || "--"} → {source.latest_available || source.coverage_end || "present"}</b>
          </div>
        ))}
      </div>

      <div className="aeis-data-query-grid">
        <form className="aeis-data-query-card" onSubmit={loadHistory}>
          <div>
            <strong>NASA climate history</strong>
            <span>Rainfall, temperature, humidity, and wind</span>
          </div>
          <div className="aeis-data-form-grid">
            <label className="aeis-field">
              <span>County</span>
              <input value={historyForm.county} onChange={(event) => setHistoryForm({ ...historyForm, county: event.target.value })} />
            </label>
            <label className="aeis-field">
              <span>Interval</span>
              <select value={historyForm.temporal} onChange={(event) => setHistoryForm({ ...historyForm, temporal: event.target.value })}>
                <option value="monthly">Monthly</option>
                <option value="daily">Daily</option>
              </select>
            </label>
            <label className="aeis-field">
              <span>Start</span>
              <input type="date" value={historyForm.start} onChange={(event) => setHistoryForm({ ...historyForm, start: event.target.value })} />
            </label>
            <label className="aeis-field">
              <span>End</span>
              <input type="date" value={historyForm.end} onChange={(event) => setHistoryForm({ ...historyForm, end: event.target.value })} />
            </label>
          </div>
          <button type="submit" className="aeis-btn">Load climate history</button>
        </form>

        <form className="aeis-data-query-card" onSubmit={loadImagery}>
          <div>
            <strong>Sentinel-2 imagery catalogue</strong>
            <span>Scene dates, cloud cover, thumbnails, and product links</span>
          </div>
          <div className="aeis-data-form-grid">
            <label className="aeis-field">
              <span>County</span>
              <input value={imageryForm.county} onChange={(event) => setImageryForm({ ...imageryForm, county: event.target.value })} />
            </label>
            <label className="aeis-field">
              <span>Collection</span>
              <select value={imageryForm.collection} onChange={(event) => setImageryForm({ ...imageryForm, collection: event.target.value })}>
                <option value="sentinel-2-l2a">Level-2A surface reflectance</option>
                <option value="sentinel-2-l1c">Level-1C top-of-atmosphere</option>
              </select>
            </label>
            <label className="aeis-field">
              <span>Start</span>
              <input type="date" value={imageryForm.start} onChange={(event) => setImageryForm({ ...imageryForm, start: event.target.value })} />
            </label>
            <label className="aeis-field">
              <span>End</span>
              <input type="date" value={imageryForm.end} onChange={(event) => setImageryForm({ ...imageryForm, end: event.target.value })} />
            </label>
            <label className="aeis-field">
              <span>Maximum cloud %</span>
              <input type="number" min="0" max="100" value={imageryForm.max_cloud} onChange={(event) => setImageryForm({ ...imageryForm, max_cloud: event.target.value })} />
            </label>
          </div>
          <button type="submit" className="aeis-btn">Search Sentinel-2</button>
        </form>
      </div>

      {history && (
        <div className="aeis-data-results">
          <div className="aeis-data-result-summary">
            <strong>{history.scope} climate history</strong>
            <span>{history.earliest_available} → {history.latest_available}</span>
            <em>{history.record_count} records</em>
          </div>
          <div className="aeis-table-wrap">
            <table className="aeis-table">
              <thead>
                <tr><th>Date</th><th>Rain mm/day</th><th>Temp °C</th><th>Humidity %</th><th>Wind m/s</th></tr>
              </thead>
              <tbody>
                {latestRows(history.records).map((row) => (
                  <tr key={row.date}>
                    <td>{row.date}</td>
                    <td>{row.PRECTOTCORR ?? "--"}</td>
                    <td>{row.T2M ?? "--"}</td>
                    <td>{row.RH2M ?? "--"}</td>
                    <td>{row.WS2M ?? "--"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {imagery && (
        <div className="aeis-data-results">
          <div className="aeis-data-result-summary">
            <strong>{imagery.county} Sentinel-2 scenes</strong>
            <span>{imagery.start} → {imagery.end}</span>
            <em>{imagery.item_count} scenes</em>
          </div>
          <div className="aeis-imagery-result-grid">
            {imagery.items.map((item) => (
              <article key={item.id}>
                {item.thumbnail && <img src={item.thumbnail} alt="" loading="lazy" />}
                <div>
                  <strong>{item.datetime?.slice(0, 10) || item.id}</strong>
                  <span>{item.platform || "Sentinel-2"} · {item.cloud_cover ?? "--"}% cloud</span>
                  <a href={item.metadata || item.product} target="_blank" rel="noreferrer">Open source metadata</a>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {!readOnly && <form className="aeis-upload-card" onSubmit={uploadAsset}>
        <div>
          <strong>Add approved GIS data</strong>
          <span>GeoJSON, GeoPackage, GeoTIFF, CSV, or zipped Shapefile · maximum 100 MB</span>
        </div>
        <div className="aeis-data-form-grid">
          <label className="aeis-field">
            <span>Dataset name</span>
            <input value={uploadForm.name} onChange={(event) => setUploadForm({ ...uploadForm, name: event.target.value })} placeholder="e.g. Mombasa farms 2026" />
          </label>
          <label className="aeis-field">
            <span>Scope</span>
            <select value={uploadForm.scope_level} onChange={(event) => setUploadForm({ ...uploadForm, scope_level: event.target.value })}>
              <option value="national">National</option>
              <option value="county">County</option>
              <option value="subcounty">Sub-county</option>
              <option value="ward">Ward</option>
              <option value="farm">Farm</option>
            </select>
          </label>
          <label className="aeis-field">
            <span>Scope name</span>
            <input value={uploadForm.scope_name} onChange={(event) => setUploadForm({ ...uploadForm, scope_name: event.target.value })} />
          </label>
          <label className="aeis-field">
            <span>Acquisition date</span>
            <input type="date" value={uploadForm.acquisition_start} onChange={(event) => setUploadForm({ ...uploadForm, acquisition_start: event.target.value, acquisition_end: event.target.value })} />
          </label>
        </div>
        <input
          type="file"
          accept=".geojson,.json,.gpkg,.tif,.tiff,.csv,.zip"
          onChange={(event) => setUploadForm({ ...uploadForm, file: event.target.files?.[0] || null })}
        />
        <button type="submit" className="aeis-btn">Upload and catalogue</button>
      </form>}

      <div className="aeis-data-results">
        <div className="aeis-data-result-summary">
          <strong>Uploaded GIS assets</strong>
          <span>Files remain private to the AEIS-K runtime</span>
          <em>{assets.length} assets</em>
        </div>
        {assets.length ? (
          <div className="aeis-table-wrap">
            <table className="aeis-table">
              <thead><tr><th>Name</th><th>Format</th><th>Scope</th><th>Quality</th><th>Features</th><th>Size</th><th>Date</th></tr></thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.id}>
                    <td>{asset.name}</td>
                    <td>{asset.file_format}</td>
                    <td>{asset.scope_name || asset.scope_level}</td>
                    <td>
                      <span className={`aeis-quality-badge ${asset.quality?.processing_status || "unknown"}`}>
                        {asset.quality?.confidence || "unknown"} / {asset.quality?.processing_status || asset.status}
                      </span>
                      {(asset.quality?.missing_data_warning || asset.quality?.projection_warning || asset.quality?.duplicate_warning) && (
                        <small className="aeis-quality-warning">
                          {asset.quality.missing_data_warning || asset.quality.projection_warning || asset.quality.duplicate_warning}
                        </small>
                      )}
                    </td>
                    <td>{asset.feature_count ?? "--"}</td>
                    <td>{formatBytes(asset.size_bytes)}</td>
                    <td>{asset.created_at?.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="aeis-source-note">No uploaded GIS assets yet.</p>}
      </div>

      <p className="aeis-source-note">{status}</p>
    </div>
  );
}

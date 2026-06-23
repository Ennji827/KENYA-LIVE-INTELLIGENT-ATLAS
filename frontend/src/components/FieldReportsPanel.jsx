import React, { useEffect, useState } from "react";
import { CheckCircle2, ClipboardList, Save } from "lucide-react";
import { getApiBase } from "../utils/api";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function FieldReportsPanel({ session, countyName, subcountyName = "", wardName = "" }) {
  const draftKey = `aeis_field_draft_${session?.username || "user"}`;
  const emptyForm = {
    title: "",
    county_name: countyName || session?.county || "",
    subcounty_name: subcountyName,
    ward_name: wardName,
    crop_type: "",
    observation_date: today(),
    observations: "",
    latitude: "",
    longitude: "",
  };
  const [form, setForm] = useState(() => {
    try {
      return { ...emptyForm, ...JSON.parse(localStorage.getItem(draftKey) || "{}") };
    } catch {
      return emptyForm;
    }
  });
  const [reports, setReports] = useState([]);
  const [message, setMessage] = useState("Loading field observations...");

  const authHeader = { Authorization: `Bearer ${session?.token || ""}` };
  const canSubmit = session?.permissions?.some((permission) =>
    ["field_report_create", "field_report_verify"].includes(permission));
  const canVerify = session?.permissions?.includes("field_report_verify");

  const loadReports = async () => {
    try {
      const response = await fetch(`${getApiBase()}/api/field-reports`, { headers: authHeader });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Field reports unavailable.");
      setReports(payload.results || []);
      setMessage(`${payload.results?.length || 0} field observation(s) available.`);
    } catch (error) {
      setMessage(error.message);
    }
  };

  useEffect(() => {
    loadReports();
  }, [session?.token]);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      county_name: countyName || session?.county || current.county_name,
      subcounty_name: subcountyName || current.subcounty_name,
      ward_name: wardName || current.ward_name,
    }));
  }, [countyName, session?.county, subcountyName, wardName]);

  const saveDraft = () => {
    localStorage.setItem(draftKey, JSON.stringify(form));
    setMessage("Offline draft saved on this device.");
  };

  const submit = async (event) => {
    event.preventDefault();
    setMessage("Submitting field observation...");
    try {
      const response = await fetch(`${getApiBase()}/api/field-reports`, {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Field report submission failed.");
      localStorage.removeItem(draftKey);
      setForm({ ...emptyForm, county_name: countyName || session?.county || "" });
      setMessage("Field observation submitted for verification.");
      loadReports();
    } catch (error) {
      localStorage.setItem(draftKey, JSON.stringify(form));
      setMessage(`${error.message} Draft saved on this device.`);
    }
  };

  const verify = async (reportId, status) => {
    const response = await fetch(`${getApiBase()}/api/field-reports/${reportId}/verify`, {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error || "Verification update failed.");
      return;
    }
    setMessage(`Field report marked ${payload.verification_status}.`);
    loadReports();
  };

  return (
    <section className="aeis-card aeis-card-pad aeis-field-reports">
      <div className="aeis-card-heading">
        <div>
          <h2 className="aeis-section-title"><ClipboardList size={18} /> Field Reports</h2>
          <p className="aeis-section-copy">Capture ward and farm observations, save an offline draft, and submit evidence for county verification.</p>
        </div>
        <span className="aeis-status-pill">{reports.length} reports</span>
      </div>

      {canSubmit && (
        <form className="aeis-field-report-form" onSubmit={submit}>
          <input required placeholder="Observation title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          <input placeholder="Crop type" value={form.crop_type} onChange={(event) => setForm({ ...form, crop_type: event.target.value })} />
          <input placeholder="Sub-county" value={form.subcounty_name} onChange={(event) => setForm({ ...form, subcounty_name: event.target.value })} />
          <input placeholder="Ward" value={form.ward_name} onChange={(event) => setForm({ ...form, ward_name: event.target.value })} />
          <input type="date" value={form.observation_date} onChange={(event) => setForm({ ...form, observation_date: event.target.value })} />
          <input type="number" step="any" placeholder="Latitude (optional)" value={form.latitude} onChange={(event) => setForm({ ...form, latitude: event.target.value })} />
          <input type="number" step="any" placeholder="Longitude (optional)" value={form.longitude} onChange={(event) => setForm({ ...form, longitude: event.target.value })} />
          <textarea required rows={3} placeholder="What did you observe?" value={form.observations} onChange={(event) => setForm({ ...form, observations: event.target.value })} />
          <div className="aeis-field-report-actions">
            <button type="button" onClick={saveDraft}><Save size={15} /> Save offline draft</button>
            <button type="submit" className="aeis-btn">Submit report</button>
          </div>
        </form>
      )}

      <p className="aeis-source-note">{message}</p>
      <div className="aeis-field-report-list">
        {reports.slice(0, 12).map((report) => (
          <article key={report.id}>
            <div>
              <strong>{report.title}</strong>
              <span>{report.county_name}{report.ward_name ? ` / ${report.ward_name}` : ""} · {report.observation_date}</span>
              <p>{report.observations}</p>
            </div>
            <em className={`aeis-report-status ${report.verification_status === "verified" ? "approved" : "draft"}`}>
              {report.verification_status}
            </em>
            {canVerify && report.verification_status === "submitted" && (
              <div className="aeis-field-verify">
                <button type="button" onClick={() => verify(report.id, "verified")}><CheckCircle2 size={14} /> Verify</button>
                <button type="button" onClick={() => verify(report.id, "rejected")}>Reject</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

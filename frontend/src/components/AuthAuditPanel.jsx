import React, { useEffect, useState } from "react";
import { getApiBase } from "../utils/api";

function formatDate(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function statusClass(status) {
  return String(status).toLowerCase() === "success" ? "success" : "failed";
}

export default function AuthAuditPanel({ session }) {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState("Loading audit log...");

  const loadAuditLog = async () => {
    setStatus("Loading audit log...");
    try {
      const response = await fetch(`${getApiBase()}/api/auth/audit-log?limit=80`, {
        headers: { Authorization: `Bearer ${session?.token || ""}` },
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatus(payload.error || "Audit log unavailable.");
        return;
      }
      setEvents(payload.events || []);
      setStatus(`${payload.events?.length || 0} recent authentication events`);
    } catch (error) {
      setStatus(error.message || "Audit log unavailable.");
    }
  };

  useEffect(() => {
    loadAuditLog();
  }, [session?.token]);

  return (
    <div className="aeis-card aeis-card-pad">
      <div className="aeis-card-heading">
        <div>
          <h2 className="aeis-section-title">Authentication Audit Log</h2>
          <p className="aeis-section-copy">
            Django audit record of county email login attempts, GPS failures, successful sessions, and sign-outs.
          </p>
        </div>
        <button type="button" className="aeis-btn ghost" onClick={loadAuditLog}>
          Refresh
        </button>
      </div>
      <div className="aeis-audit-status">{status}</div>
      <div className="aeis-table-wrap">
        <table className="aeis-table aeis-audit-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Event</th>
              <th>Status</th>
              <th>County</th>
              <th>Email</th>
              <th>IP</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {events.length ? (
              events.map((event, index) => (
                <tr key={`${event.created_at}-${event.email}-${index}`}>
                  <td>{formatDate(event.created_at)}</td>
                  <td>{event.event_type}</td>
                  <td>
                    <span className={`aeis-auth-status ${statusClass(event.status)}`}>{event.status}</span>
                  </td>
                  <td>{event.county_code ? `${event.county_code} ${event.county_name}` : event.county_name || "N/A"}</td>
                  <td>{event.email || event.username || "N/A"}</td>
                  <td>{event.ip_address || "N/A"}</td>
                  <td>{event.reason || "verified"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="7">No authentication events recorded yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

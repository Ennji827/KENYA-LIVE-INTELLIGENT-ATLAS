import React, { useEffect, useState } from "react";
import { getApiBase } from "../utils/api";
import { readAuthSession } from "./AuthGateway";

function statusText(account) {
  return account.is_active ? "Active" : "Disabled";
}

function scopeLabel(account) {
  if (account.role === "county") return `${account.county_code} ${account.county}`;
  return account.boundary_scope || "national";
}

export default function AccessControlPanel() {
  const [model, setModel] = useState(null);
  const [publicAccess, setPublicAccess] = useState(null);
  const [status, setStatus] = useState("Loading access model...");

  const loadAccessModel = async () => {
    setStatus("Loading access model...");
    try {
      const response = await fetch(`${getApiBase()}/api/auth/access-model`);
      const payload = await response.json();
      if (!response.ok) {
        setStatus(payload.error || "Access model unavailable.");
        return;
      }
      setModel(payload);
      setStatus(`${payload.county_account_count || 0} county workspaces and ${payload.national_accounts?.length || 0} national profiles active`);
    } catch (error) {
      setStatus(error.message || "Access model unavailable.");
    }

    try {
      const response = await fetch(`${getApiBase()}/api/system/access`);
      const payload = await response.json();
      if (response.ok) setPublicAccess(payload.public_access || null);
    } catch (error) {
      setPublicAccess(null);
    }
  };

  const togglePublicLock = async () => {
    const session = readAuthSession();
    if (!session?.token) {
      setStatus("Ministry session token is required to change public access lock.");
      return;
    }

    const nextLocked = !publicAccess?.locked;
    setStatus(nextLocked ? "Locking public presentation mode..." : "Unlocking public presentation mode...");
    try {
      const response = await fetch(`${getApiBase()}/api/system/public-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: session.token, locked: nextLocked }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatus(payload.error || "Public access lock update failed.");
        return;
      }
      setPublicAccess(payload.public_access);
      setStatus(nextLocked ? "Public access locked." : "Public presentation mode unlocked.");
    } catch (error) {
      setStatus(error.message || "Public access lock update failed.");
    }
  };

  useEffect(() => {
    loadAccessModel();
  }, []);

  const nationalAccounts = model?.national_accounts || [];
  const countyAccounts = model?.county_accounts || [];

  return (
    <div className="aeis-card aeis-card-pad">
      <div className="aeis-card-heading">
        <div>
          <h2 className="aeis-section-title">Access Control Registry</h2>
          <p className="aeis-section-copy">
            Role-based AEIS-K login model for national command users, analysts, and county-isolated workspaces.
          </p>
        </div>
        <div className="aeis-btn-row">
          <button type="button" className="aeis-btn ghost" onClick={loadAccessModel}>
            Refresh
          </button>
          <button type="button" className={publicAccess?.locked ? "aeis-btn" : "aeis-btn secondary"} onClick={togglePublicLock}>
            {publicAccess?.locked ? "Unlock public mode" : "Lock public mode"}
          </button>
        </div>
      </div>

      <div className="aeis-audit-status">{status}</div>
      {publicAccess && (
        <div className="aeis-auth-provider-card">
          <strong>{publicAccess.locked ? "Public link locked" : "Public presentation mode unlocked"}</strong>
          <span>
            {publicAccess.locked
              ? "Test passwords are hidden and remote county bypass is blocked."
              : "Test passwords and remote county field-test access are visible for presentation use."}
          </span>
        </div>
      )}

      <div className="aeis-grid aeis-three-col">
        <div className="aeis-score-block">
          <span>Auth storage</span>
          <strong>SQLite</strong>
          <small>{model?.auth_model || "role based access control"}</small>
        </div>
        <div className="aeis-score-block">
          <span>County workspaces</span>
          <strong>{countyAccounts.length || 47}</strong>
          <small>Locked by county code and session scope</small>
        </div>
        <div className="aeis-score-block">
          <span>Session lifetime</span>
          <strong>{Math.round((model?.session_seconds || 28800) / 3600)}h</strong>
          <small>Backend token validation required</small>
        </div>
      </div>

      <div style={{ height: 16 }} />
      <h3 className="aeis-mini-heading">National profiles</h3>
      <div className="aeis-table-wrap">
        <table className="aeis-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Email</th>
              <th>Scope</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {nationalAccounts.map((account) => (
              <tr key={account.email}>
                <td>{account.role}</td>
                <td>{account.email}</td>
                <td>{scopeLabel(account)}</td>
                <td>{statusText(account)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ height: 16 }} />
      <h3 className="aeis-mini-heading">County workspace accounts</h3>
      <div className="aeis-table-wrap aeis-access-table-wrap">
        <table className="aeis-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>County</th>
              <th>Email</th>
              <th>Scope</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {countyAccounts.map((account) => (
              <tr key={account.email}>
                <td>{account.county_code}</td>
                <td>{account.county}</td>
                <td>{account.email}</td>
                <td>{account.boundary_scope}</td>
                <td>{statusText(account)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from "react";
import { getApiBase } from "../utils/api";
import { kenyaCounties } from "../data/kenyaCountyCatalog";
import KsaPoweredBy from "./KsaPoweredBy";

const STORAGE_KEY = "aeis_auth_session";

const FALLBACK_NATIONAL_PROFILES = [
  {
    role: "ministry",
    email: "ministry.command@aeis-k.local",
    username: "ministry_command",
    password: "",
    command_center: "AEIS-K National Command Center",
    boundary_scope: "national",
  },
  {
    role: "analyst",
    email: "national.analyst@aeis-k.local",
    username: "national_analyst",
    password: "",
    command_center: "AEIS-K National Intelligence Analyst",
    boundary_scope: "national_read_only",
  },
];

function slugForCounty(countyName) {
  return String(countyName || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "county";
}

function accountForCounty(countyName, accounts) {
  return accounts.find((item) => item.county === countyName);
}

function credentialsForCounty(countyName, accounts) {
  if (!countyName) {
    return {
      email: "",
      username: "",
      provider: "password",
    };
  }
  const account = accountForCounty(countyName, accounts);
  const slug = slugForCounty(countyName);
  return {
    email: account?.email || `${slug}@county.aeis-k.local`,
    username: account?.username || `${slug}_county`,
    provider: account?.provider || "password",
  };
}

function nationalProfileForRole(role, profiles) {
  return profiles.find((profile) => profile.role === role) || profiles[0] || FALLBACK_NATIONAL_PROFILES[0];
}

function roleLabel(role) {
  if (role === "ministry") return "Ministry command officer";
  if (role === "analyst") return "National intelligence analyst";
  return role;
}

export function saveAuthSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function readAuthSession() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch (error) {
    return null;
  }
}

export function clearAuthSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export default function AuthGateway({ onAuthenticated }) {
  const [mode, setMode] = useState("county");
  const [accounts, setAccounts] = useState([]);
  const [accessInfo, setAccessInfo] = useState(null);
  const [demoPassword, setDemoPassword] = useState("");
  const [nationalProfiles, setNationalProfiles] = useState(FALLBACK_NATIONAL_PROFILES);
  const [nationalRole, setNationalRole] = useState("ministry");
  const [nationalEmail, setNationalEmail] = useState(FALLBACK_NATIONAL_PROFILES[0].email);
  const [nationalPassword, setNationalPassword] = useState("");
  const [county, setCounty] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [gps, setGps] = useState(null);
  const [remoteDemoAccess, setRemoteDemoAccess] = useState(false);
  const [countyStatus, setCountyStatus] = useState("Select a county, enter the county password, then approve browser GPS.");
  const [nationalStatus, setNationalStatus] = useState("Use an approved AEIS-K national account to open the command center.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadAccessModel() {
      try {
        const response = await fetch(`${getApiBase()}/api/auth/county-accounts`);
        if (response.ok) {
          const payload = await response.json();
          if (!cancelled) {
            setAccounts(payload.accounts || []);
            setDemoPassword(payload.local_seed_password || "");
          }
        }
      } catch (error) {
        if (!cancelled) setAccounts([]);
      }

      try {
        const response = await fetch(`${getApiBase()}/api/system/access`);
        if (response.ok) {
          const payload = await response.json();
          if (!cancelled) {
            setAccessInfo(payload);
            if (Array.isArray(payload.national_demo_logins) && payload.national_demo_logins.length) {
              setNationalProfiles(payload.national_demo_logins);
            }
          }
        }
      } catch (error) {
        if (!cancelled) setAccessInfo(null);
      }
    }
    loadAccessModel();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!county) {
      setEmail("");
      setUsername("");
      setGps(null);
      setRemoteDemoAccess(false);
      setCountyStatus("Select a county, enter the county password, then approve browser GPS.");
      return;
    }
    const credentials = credentialsForCounty(county, accounts);
    setEmail(credentials.email);
    setUsername(credentials.username);
    setGps(null);
    setCountyStatus(`${county} selected. Use the county password, then approve browser GPS.`);
  }, [accounts, county]);

  const selectedNationalProfile = useMemo(
    () => nationalProfileForRole(nationalRole, nationalProfiles),
    [nationalProfiles, nationalRole]
  );

  useEffect(() => {
    setNationalEmail(selectedNationalProfile.email || "");
    setNationalPassword("");
    setNationalStatus(`${roleLabel(selectedNationalProfile.role)} selected. Enter the approved password to create an audited session.`);
  }, [selectedNationalProfile]);

  const selectedCounty = useMemo(
    () => kenyaCounties.find((item) => item.name === county) || null,
    [county]
  );
  const selectedCredentials = useMemo(() => credentialsForCounty(county, accounts), [accounts, county]);
  const revealDemoCredentials = Boolean(accessInfo?.public_access?.show_demo_credentials);
  const remoteDemoEnabled = Boolean(accessInfo?.public_access?.remote_county_demo_enabled);

  useEffect(() => {
    if (!remoteDemoEnabled && remoteDemoAccess) {
      setRemoteDemoAccess(false);
    }
  }, [remoteDemoAccess, remoteDemoEnabled]);

  const requestGps = () => {
    if (!selectedCounty) {
      setCountyStatus("Choose a county before requesting GPS.");
      return;
    }

    if (!navigator.geolocation) {
      setCountyStatus("Browser GPS is not available.");
      return;
    }

    setBusy(true);
    setCountyStatus("Requesting secure browser GPS...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextGps = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        setGps(nextGps);
        setCountyStatus(`GPS ready: ${nextGps.latitude.toFixed(5)}, ${nextGps.longitude.toFixed(5)}.`);
        setBusy(false);
      },
      (error) => {
        setCountyStatus(error.message || "GPS permission denied.");
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  const loginCounty = async (event) => {
    event.preventDefault();
    if (!selectedCounty) {
      setCountyStatus("Choose a county before opening a county workspace.");
      return;
    }
    if (!remoteDemoAccess && !gps) {
      setCountyStatus("Use browser GPS before county login.");
      return;
    }

    setBusy(true);
    setCountyStatus(remoteDemoAccess ? "Checking county remote access credentials..." : "Checking county email, password, and GPS boundary...");
    try {
      const response = await fetch(`${getApiBase()}/api/auth/county-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          county,
          county_code: selectedCounty.countyCode,
          email,
          username,
          password,
          latitude: gps?.latitude,
          longitude: gps?.longitude,
          demo_remote_access: remoteDemoAccess,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setCountyStatus(payload.error || "County login failed.");
        setBusy(false);
        return;
      }
      const session = { ...payload, auth_mode: "county", lockedCounty: payload.county };
      saveAuthSession(session);
      onAuthenticated(session);
    } catch (error) {
      setCountyStatus(error.message || "County login failed.");
      setBusy(false);
    }
  };

  const loginNational = async (event) => {
    event.preventDefault();
    if (!nationalEmail || !nationalPassword) {
      setNationalStatus("Enter national email and password.");
      return;
    }

    setBusy(true);
    setNationalStatus("Checking national access credentials...");
    try {
      const response = await fetch(`${getApiBase()}/api/auth/national-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: nationalEmail,
          username: selectedNationalProfile.username,
          password: nationalPassword,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setNationalStatus(payload.error || "National login failed.");
        setBusy(false);
        return;
      }
      const session = { ...payload, auth_mode: payload.role };
      saveAuthSession(session);
      onAuthenticated(session);
    } catch (error) {
      setNationalStatus(error.message || "National login failed.");
      setBusy(false);
    }
  };

  return (
    <div className="aeis-auth-shell">
      <div className="aeis-auth-panel">
        <div className="aeis-auth-brand">
          <div className="aeis-kicker">AEIS-K secure entry</div>
          <h1>AEIS-K Intelligence Dashboard</h1>
          <p>Agro-Environmental Intelligence System for Kenya</p>
          <KsaPoweredBy variant="auth" />
        </div>

        <div className="aeis-auth-tabs">
          <button type="button" className={mode === "county" ? "active" : ""} onClick={() => setMode("county")}>
            County Workspace
          </button>
          <button type="button" className={mode === "ministry" ? "active" : ""} onClick={() => setMode("ministry")}>
            National Access
          </button>
        </div>

        {mode === "county" ? (
          <form className="aeis-auth-form" onSubmit={loginCounty}>
            <div className="aeis-field">
              <label htmlFor="aeis-login-county">County</label>
              <select id="aeis-login-county" value={county} onChange={(event) => setCounty(event.target.value)}>
                <option value="">Select county</option>
                {kenyaCounties.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className="aeis-field">
              <label htmlFor="aeis-login-email">County email</label>
              <input
                id="aeis-login-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="county@county.aeis-k.local"
                autoComplete="username"
                disabled={!selectedCounty}
              />
            </div>
            <div className="aeis-field">
              <label htmlFor="aeis-login-password">Password</label>
              <input
                id="aeis-login-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="County password"
                autoComplete="current-password"
              />
            </div>
            <div className="aeis-auth-county-card">
              <span>{selectedCounty?.countyCode || "000"}</span>
              <div>
                <strong>{selectedCounty ? `${selectedCounty.name} County Workspace` : "Choose a county workspace"}</strong>
                <p>
                  {selectedCounty
                    ? `${selectedCredentials.email} is isolated to ${selectedCounty.displayName}; GPS and sign-in events are recorded by the backend.`
                    : "Each of the 47 county workspaces has its own email identity and county lock."}
                </p>
              </div>
            </div>
            {selectedCounty && revealDemoCredentials && demoPassword && (
              <div className="aeis-demo-credentials">
                <div>
                  <span>County email</span>
                  <strong>{selectedCredentials.email}</strong>
                </div>
                <div>
                  <span>Test password</span>
                  <strong>{demoPassword}</strong>
                </div>
                <button type="button" className="aeis-btn ghost" onClick={() => setPassword(demoPassword)}>
                  Use password
                </button>
              </div>
            )}
            {selectedCounty && remoteDemoEnabled && (
              <label className="aeis-demo-toggle">
                <input
                  type="checkbox"
                  checked={remoteDemoAccess}
                  onChange={(event) => {
                    setRemoteDemoAccess(event.target.checked);
                    setCountyStatus(
                      event.target.checked
                        ? "Remote field-test access enabled. GPS is skipped and the audit log marks this session as demo_remote_access."
                        : `${county} selected. Use the county password, then approve browser GPS.`
                    );
                  }}
                />
                <span>
                  <strong>Remote field-test access</strong>
                  <em>Allows testers outside the county boundary to open the selected county workspace. The session remains county-locked and audited.</em>
                </span>
              </label>
            )}
            <div className="aeis-auth-provider-card">
              <strong>County isolation</strong>
              <span>County officers can view and operate only their selected county workspace after login.</span>
              <em>Fallback username: {username || "select county"}</em>
            </div>
            {accessInfo && (
              <div className="aeis-auth-provider-card">
                <strong>Tester access</strong>
                <span>Same network URL: {accessInfo.live_url}</span>
                <span>{accessInfo.public_url ? `Public URL: ${accessInfo.public_url}` : accessInfo.outside_network}</span>
                <em>{accessInfo.public_access?.locked ? "Public lock active: test passwords hidden and remote bypass blocked." : "Presentation mode unlocked."}</em>
              </div>
            )}
            <div className="aeis-btn-row">
              <button type="button" className="aeis-btn ghost" onClick={requestGps} disabled={busy || !selectedCounty || remoteDemoAccess}>
                Use browser GPS
              </button>
              <button type="submit" className="aeis-btn" disabled={busy || !selectedCounty || !email || !password}>
                {remoteDemoAccess ? "Open remote county workspace" : "Open county workspace"}
              </button>
            </div>
            <p className="aeis-source-note">{countyStatus}</p>
          </form>
        ) : (
          <form className="aeis-auth-form" onSubmit={loginNational}>
            <div className="aeis-field">
              <label htmlFor="aeis-national-role">Access profile</label>
              <select id="aeis-national-role" value={nationalRole} onChange={(event) => setNationalRole(event.target.value)}>
                {nationalProfiles.map((profile) => (
                  <option key={profile.role} value={profile.role}>
                    {roleLabel(profile.role)}
                  </option>
                ))}
              </select>
            </div>
            <div className="aeis-field">
              <label htmlFor="aeis-national-email">National email</label>
              <input
                id="aeis-national-email"
                type="email"
                value={nationalEmail}
                onChange={(event) => setNationalEmail(event.target.value)}
                autoComplete="username"
              />
            </div>
            <div className="aeis-field">
              <label htmlFor="aeis-national-password">Password</label>
              <input
                id="aeis-national-password"
                type="password"
                value={nationalPassword}
                onChange={(event) => setNationalPassword(event.target.value)}
                placeholder="National password"
                autoComplete="current-password"
              />
            </div>
            <div className="aeis-auth-county-card ministry">
              <span>{selectedNationalProfile.role === "analyst" ? "AN" : "KE"}</span>
              <div>
                <strong>{selectedNationalProfile.command_center}</strong>
                <p>
                  Scope: {selectedNationalProfile.boundary_scope}. National access is token-based and recorded in the Django audit log.
                </p>
              </div>
            </div>
            {revealDemoCredentials && selectedNationalProfile.password && (
            <div className="aeis-demo-credentials">
              <div>
                <span>National email</span>
                <strong>{selectedNationalProfile.email}</strong>
              </div>
              <div>
                <span>Test password</span>
                <strong>{selectedNationalProfile.password}</strong>
              </div>
              <button type="button" className="aeis-btn ghost" onClick={() => setNationalPassword(selectedNationalProfile.password)}>
                Use password
              </button>
            </div>
            )}
            <div className="aeis-auth-provider-card">
              <strong>National role separation</strong>
              <span>Ministry officers can access administration tools. Analysts can review national intelligence without user-management controls.</span>
              <em>Fallback username: {selectedNationalProfile.username}</em>
            </div>
            {accessInfo && (
              <div className="aeis-auth-provider-card">
                <strong>Network access</strong>
                <span>Local live URL: {accessInfo.local_live_url}</span>
                <span>LAN live URL: {accessInfo.live_url}</span>
              </div>
            )}
            <div className="aeis-btn-row">
              <button type="submit" className="aeis-btn" disabled={busy || !nationalEmail || !nationalPassword}>
                Open {selectedNationalProfile.role === "analyst" ? "analyst workspace" : "national command center"}
              </button>
            </div>
            <p className="aeis-source-note">{nationalStatus}</p>
          </form>
        )}
      </div>
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { nationalLogin, countyLogin, fetchAccessModel } from "../utils/apiClient";
import { saveAuthSession } from "./AuthGateway";

// Government / staff sign-in. Unlike the public portal (name/email/Google), staff
// authenticate against role-based accounts:
//   â€¢ National / Ministry â€” email or username + password (ministry Â· analyst Â· auditor)
//   â€¢ County officer       â€” county + credentials + GPS geofence (or remote demo)
// A ministry session unlocks the full report workflow (generate Â· review Â· approve
// Â· publish); analyst and county sessions can generate and review.
export default function StaffLogin({ onAuthenticated, onBack, onPublic }) {
  const [tier, setTier] = useState("national"); // national | county

  // Reference data (accounts + demo password hints) from the public access model.
  const [model, setModel] = useState(null);

  // National / Ministry
  const [nId, setNId] = useState("");
  const [nPw, setNPw] = useState("");
  const [nError, setNError] = useState("");
  const [nBusy, setNBusy] = useState(false);

  // County
  const [cCode, setCCode] = useState("");
  const [cId, setCId] = useState("");
  const [cPw, setCPw] = useState("");
  const [cDemo, setCDemo] = useState(false);
  const [cGps, setCGps] = useState(null); // { latitude, longitude }
  const [cGpsMsg, setCGpsMsg] = useState("");
  const [cError, setCError] = useState("");
  const [cBusy, setCBusy] = useState(false);

  useEffect(() => {
    fetchAccessModel()
      .then(setModel)
      .catch(() => {});
  }, []);

  const finish = (payload) => {
    const session = { ...payload, auth_mode: "staff" };
    saveAuthSession(session);
    onAuthenticated(session);
  };

  // Prefill from a demo account chip.
  const useNationalDemo = (account) => {
    setNId(account.email || account.username);
    setNPw((model?.national_passwords || {})[account.role] || "");
    setNError("");
  };

  const handleNational = async (e) => {
    e.preventDefault();
    setNError("");
    setNBusy(true);
    try {
      const payload = await nationalLogin({ email: nId.trim(), password: nPw });
      finish(payload);
    } catch (err) {
      setNError(err.payload?.error || err.message || "Invalid national access credentials.");
      setNBusy(false);
    }
  };

  // When a county is picked, autofill its username and (in demo mode) password.
  const onSelectCounty = (code) => {
    setCCode(code);
    setCError("");
    const account = (model?.county_accounts || []).find((a) => a.county_code === code);
    if (account) setCId(account.email || account.username);
    if (model?.county_password) setCPw(model.county_password);
  };

  const captureGps = () => {
    setCGpsMsg("Requesting locationâ€¦");
    if (!navigator.geolocation) {
      setCGpsMsg("This browser does not expose GPS. Use remote demo access instead.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCGps({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setCGpsMsg("Location captured.");
      },
      (err) => setCGpsMsg(err.message || "Could not read GPS. Use remote demo access instead."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleCounty = async (e) => {
    e.preventDefault();
    setCError("");
    if (!cCode) {
      setCError("Select your county.");
      return;
    }
    if (!cDemo && !cGps) {
      setCError("Capture your GPS location, or enable remote demo access.");
      return;
    }
    setCBusy(true);
    try {
      const payload = await countyLogin({
        county_code: cCode,
        email: cId.trim(),
        password: cPw,
        demo_remote_access: cDemo,
        latitude: cDemo ? undefined : cGps?.latitude,
        longitude: cDemo ? undefined : cGps?.longitude,
      });
      finish(payload);
    } catch (err) {
      setCError(err.payload?.error || err.message || "County sign-in failed.");
      setCBusy(false);
    }
  };

  const nationalDemo = (model?.national_accounts || []).filter(
    (a) => (model?.national_passwords || {})[a.role],
  );

  return (
    <div className="auth-shell">
      <div className="auth-card">
        {onBack && (
          <button type="button" className="auth-back-link" onClick={onBack}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
            Back to home
          </button>
        )}

        <h2 className="auth-heading">Government access</h2>
        <p className="auth-sub">Sign in with your K-L-I-A staff account</p>

        <div className="staff-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tier === "national"}
            className={`staff-tab${tier === "national" ? " is-active" : ""}`}
            onClick={() => setTier("national")}
          >
            National / Ministry
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tier === "county"}
            className={`staff-tab${tier === "county" ? " is-active" : ""}`}
            onClick={() => setTier("county")}
          >
            County officer
          </button>
        </div>

        {/* â”€â”€ National / Ministry â”€â”€ */}
        {tier === "national" && (
          <form onSubmit={handleNational} className="auth-form">
            <div className="auth-field">
              <label htmlFor="n-id">Email or username</label>
              <input id="n-id" type="text" value={nId} onChange={(e) => setNId(e.target.value)} placeholder="ministry.command@k-l-i-a.local" autoComplete="username" required />
            </div>
            <div className="auth-field">
              <label htmlFor="n-pw">Password</label>
              <input id="n-pw" type="password" value={nPw} onChange={(e) => setNPw(e.target.value)} placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢" autoComplete="current-password" required />
            </div>
            {nError && <p className="auth-msg error">{nError}</p>}
            <button type="submit" className="auth-btn" disabled={nBusy}>
              {nBusy ? "Signing inâ€¦" : "Sign in"}
            </button>

            {nationalDemo.length > 0 && (
              <div className="staff-demo">
                <span className="staff-demo__label">Demo accounts</span>
                <div className="staff-demo__chips">
                  {nationalDemo.map((a) => (
                    <button key={a.role} type="button" className="chip" onClick={() => useNationalDemo(a)}>
                      {a.role}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </form>
        )}

        {/* â”€â”€ County officer â”€â”€ */}
        {tier === "county" && (
          <form onSubmit={handleCounty} className="auth-form">
            <div className="auth-field">
              <label htmlFor="c-county">County</label>
              <select id="c-county" value={cCode} onChange={(e) => onSelectCounty(e.target.value)} required>
                <option value="">â€” select county â€”</option>
                {(model?.county_accounts || []).map((a) => (
                  <option key={a.county_code} value={a.county_code}>{a.county}</option>
                ))}
              </select>
            </div>
            <div className="auth-field">
              <label htmlFor="c-id">Email or username</label>
              <input id="c-id" type="text" value={cId} onChange={(e) => setCId(e.target.value)} placeholder="county officer account" autoComplete="username" required />
            </div>
            <div className="auth-field">
              <label htmlFor="c-pw">Password</label>
              <input id="c-pw" type="password" value={cPw} onChange={(e) => setCPw(e.target.value)} placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢" autoComplete="current-password" required />
            </div>

            <div className="auth-field">
              <label>Location check</label>
              <button type="button" className="btn btn--ghost" onClick={captureGps} disabled={cDemo}>
                {cGps ? "âœ“ Location captured" : "Use my GPS location"}
              </button>
              {cGpsMsg && !cDemo && <p className="staff-gps-msg">{cGpsMsg}</p>}
              <label className="staff-check">
                <input type="checkbox" checked={cDemo} onChange={(e) => setCDemo(e.target.checked)} />
                Remote demo access (skip GPS)
              </label>
            </div>

            {cError && <p className="auth-msg error">{cError}</p>}
            <button type="submit" className="auth-btn" disabled={cBusy}>
              {cBusy ? "Signing inâ€¦" : "Sign in"}
            </button>
          </form>
        )}

        <p className="auth-switch">
          Not staff?{" "}
          <button type="button" className="auth-link" onClick={onPublic}>Public sign in</button>
        </p>
      </div>
    </div>
  );
}

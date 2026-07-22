import React, { useEffect, useState } from "react";
import { getApiBase } from "../utils/api";

const STORAGE_KEY = "aeis_auth_session";

const CITATIONS = [
  { value: "student",               label: "Student" },
  { value: "researcher",            label: "Researcher" },
  { value: "industry_professional", label: "Industry Professional" },
  { value: "decision_maker",        label: "Decision Maker" },
];

export function saveAuthSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function readAuthSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearAuthSession() {
  localStorage.removeItem(STORAGE_KEY);
}

const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

function useGoogleGis(onToken) {
  const [ready, setReady] = useState(false);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

  useEffect(() => {
    if (!clientId) return;
    let done = false;
    function init() {
      if (done) return;
      done = true;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (res) => onToken(res.credential),
        ux_mode: "popup",
      });
      setReady(true);
    }
    if (window.google?.accounts?.id) {
      init();
    } else {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = init;
      document.head.appendChild(s);
    }
  }, [clientId]);

  const prompt = () => ready && window.google.accounts.id.prompt();
  return { ready, prompt, enabled: !!clientId };
}

export default function AuthGateway({ onAuthenticated, initialView = "signin", onBack, onStaff }) {
  const [view, setView] = useState(initialView); // signin | register | forgot

  // Sign-in fields
  const [siEmail, setSiEmail]       = useState("");
  const [siPassword, setSiPassword] = useState("");
  const [siError, setSiError]       = useState("");
  const [siBusy, setSiBusy]         = useState(false);

  // Register fields
  const [rFirstName, setRFirstName]   = useState("");
  const [rLastName, setRLastName]     = useState("");
  const [rEmail, setREmail]           = useState("");
  const [rPassword, setRPassword]     = useState("");
  const [rConfirm, setRConfirm]       = useState("");
  const [rCitation, setRCitation]     = useState("");
  const [rError, setRError]           = useState("");
  const [rBusy, setRBusy]             = useState(false);

  // Forgot password
  const [fpEmail, setFpEmail]   = useState("");
  const [fpMsg, setFpMsg]       = useState("");
  const [fpBusy, setFpBusy]     = useState(false);

  // Google pending position (new Google user)
  const [pendingToken, setPendingToken]     = useState(null);
  const [gCitation, setGCitation]           = useState("");
  const [gError, setGError]                 = useState("");
  const [gBusy, setGBusy]                   = useState(false);

  const finish = (payload) => {
    saveAuthSession(payload);
    onAuthenticated(payload);
  };

  // ── Google GIS ──────────────────────────────────────────────
  const { prompt: googlePrompt, enabled: googleEnabled } = useGoogleGis(async (idToken) => {
    setGBusy(true); setGError("");
    try {
      const r = await fetch(`${getApiBase()}/api/auth/google-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: idToken, position: gCitation }),
      });
      const p = await r.json();
      if (r.ok) { finish({ ...p, auth_mode: "public" }); return; }
      if (p.error?.includes("position")) {
        setPendingToken(idToken);
        setGError("Select your citation to complete sign-up.");
      } else {
        setGError(p.error || "Google sign-in failed.");
      }
    } catch (e) { setGError(e.message || "Google sign-in failed."); }
    setGBusy(false);
  });

  const completeGoogle = async () => {
    if (!pendingToken || !gCitation) { setGError("Select your citation first."); return; }
    setGBusy(true); setGError("");
    try {
      const r = await fetch(`${getApiBase()}/api/auth/google-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: pendingToken, position: gCitation }),
      });
      const p = await r.json();
      if (r.ok) { finish({ ...p, auth_mode: "public" }); return; }
      setGError(p.error || "Google sign-in failed.");
    } catch (e) { setGError(e.message || "Google sign-in failed."); }
    setGBusy(false);
  };

  // ── Sign in ──────────────────────────────────────────────────
  const handleSignIn = async (e) => {
    e.preventDefault();
    setSiError(""); setSiBusy(true);
    try {
      const r = await fetch(`${getApiBase()}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: siEmail, password: siPassword }),
      });
      const p = await r.json();
      if (r.ok) { finish({ ...p, auth_mode: "public" }); return; }
      setSiError(p.error || "Invalid email or password.");
    } catch (e) { setSiError(e.message || "Sign in failed."); }
    setSiBusy(false);
  };

  // ── Register ─────────────────────────────────────────────────
  const handleRegister = async (e) => {
    e.preventDefault();
    setRError("");
    if (rPassword !== rConfirm) { setRError("Passwords do not match."); return; }
    if (rPassword.length < 8)   { setRError("Password must be at least 8 characters."); return; }
    if (!rCitation)              { setRError("Please select your citation."); return; }
    setRBusy(true);
    try {
      const r = await fetch(`${getApiBase()}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ first_name: rFirstName, last_name: rLastName, email: rEmail, password: rPassword, position: rCitation }),
      });
      const p = await r.json();
      if (r.ok) { finish({ ...p, auth_mode: "public" }); return; }
      setRError(p.error || "Registration failed.");
    } catch (e) { setRError(e.message || "Registration failed."); }
    setRBusy(false);
  };

  // ── Forgot password ──────────────────────────────────────────
  const handleForgot = async (e) => {
    e.preventDefault();
    setFpMsg(""); setFpBusy(true);
    try {
      await fetch(`${getApiBase()}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fpEmail }),
      });
      setFpMsg("If that email is registered, a reset link is on its way.");
    } catch { setFpMsg("If that email is registered, a reset link is on its way."); }
    setFpBusy(false);
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="auth-shell">
      <div className="auth-card">

        {/* Back to landing */}
        {onBack && (
          <button type="button" className="auth-back-link" onClick={onBack}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
            Back to home
          </button>
        )}

        {/* ── Sign In ── */}
        {view === "signin" && (
          <>
            <h2 className="auth-heading">Welcome back</h2>
            <p className="auth-sub">Sign in to your account</p>

            {googleEnabled && (
              <button type="button" className="auth-google-btn" onClick={googlePrompt} disabled={gBusy}>
                <GoogleIcon />
                <span>Continue with Google</span>
              </button>
            )}

            {pendingToken && (
              <div className="auth-field">
                <label htmlFor="si-gcit">Select your citation to finish sign-up</label>
                <select id="si-gcit" value={gCitation} onChange={(e) => setGCitation(e.target.value)}>
                  <option value="">— select citation —</option>
                  {CITATIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <button type="button" className="auth-btn" style={{ marginTop: 8 }} onClick={completeGoogle} disabled={!gCitation || gBusy}>
                  {gBusy ? "Please wait…" : "Complete sign-up"}
                </button>
              </div>
            )}
            {gError && <p className="auth-msg error">{gError}</p>}

            {googleEnabled && <div className="auth-divider"><span>or</span></div>}

            <form onSubmit={handleSignIn} className="auth-form">
              <div className="auth-field">
                <label htmlFor="si-email">Email address</label>
                <input id="si-email" type="email" value={siEmail} onChange={(e) => setSiEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
              </div>
              <div className="auth-field">
                <label htmlFor="si-pw">Password</label>
                <input id="si-pw" type="password" value={siPassword} onChange={(e) => setSiPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" required />
                <button type="button" className="auth-forgot-link" onClick={() => { setView("forgot"); setFpEmail(siEmail); }}>
                  Forgot password?
                </button>
              </div>
              {siError && <p className="auth-msg error">{siError}</p>}
              <button type="submit" className="auth-btn" disabled={siBusy}>
                {siBusy ? "Signing in…" : "Sign In"}
              </button>
            </form>

            <p className="auth-switch">
              Don't have an account?{" "}
              <button type="button" className="auth-link" onClick={() => setView("register")}>Create account</button>
            </p>
            {onStaff && (
              <p className="auth-switch">
                <button type="button" className="auth-link" onClick={onStaff}>Government / staff access →</button>
              </p>
            )}
          </>
        )}

        {/* ── Register ── */}
        {view === "register" && (
          <>
            <h2 className="auth-heading">Create account</h2>
            <p className="auth-sub">Join AEIS-K today</p>

            {googleEnabled && (
              <button type="button" className="auth-google-btn" onClick={googlePrompt} disabled={gBusy}>
                <GoogleIcon />
                <span>Sign up with Google</span>
              </button>
            )}

            {pendingToken && (
              <div className="auth-field">
                <label htmlFor="reg-gcit">Select your citation to finish sign-up</label>
                <select id="reg-gcit" value={gCitation} onChange={(e) => setGCitation(e.target.value)}>
                  <option value="">— select citation —</option>
                  {CITATIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <button type="button" className="auth-btn" style={{ marginTop: 8 }} onClick={completeGoogle} disabled={!gCitation || gBusy}>
                  {gBusy ? "Please wait…" : "Complete sign-up"}
                </button>
              </div>
            )}
            {gError && <p className="auth-msg error">{gError}</p>}

            {googleEnabled && <div className="auth-divider"><span>or</span></div>}

            <form onSubmit={handleRegister} className="auth-form">
              <div className="auth-field-row">
                <div className="auth-field">
                  <label htmlFor="r-fn">First name</label>
                  <input id="r-fn" type="text" value={rFirstName} onChange={(e) => setRFirstName(e.target.value)} placeholder="Jane" autoComplete="given-name" required />
                </div>
                <div className="auth-field">
                  <label htmlFor="r-ln">Last name</label>
                  <input id="r-ln" type="text" value={rLastName} onChange={(e) => setRLastName(e.target.value)} placeholder="Doe" autoComplete="family-name" />
                </div>
              </div>
              <div className="auth-field">
                <label htmlFor="r-em">Email address</label>
                <input id="r-em" type="email" value={rEmail} onChange={(e) => setREmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
              </div>
              <div className="auth-field">
                <label htmlFor="r-pw">Password</label>
                <input id="r-pw" type="password" value={rPassword} onChange={(e) => setRPassword(e.target.value)} placeholder="Min. 8 characters" autoComplete="new-password" required />
              </div>
              <div className="auth-field">
                <label htmlFor="r-cf">Confirm password</label>
                <input id="r-cf" type="password" value={rConfirm} onChange={(e) => setRConfirm(e.target.value)} placeholder="Re-enter password" autoComplete="new-password" required />
              </div>
              <div className="auth-field">
                <label htmlFor="r-cit">Citation</label>
                <select id="r-cit" value={rCitation} onChange={(e) => setRCitation(e.target.value)} required>
                  <option value="">— select your citation —</option>
                  {CITATIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              {rError && <p className="auth-msg error">{rError}</p>}
              <button type="submit" className="auth-btn" disabled={rBusy}>
                {rBusy ? "Creating account…" : "Create Account"}
              </button>
            </form>

            <p className="auth-switch">
              Already have an account?{" "}
              <button type="button" className="auth-link" onClick={() => setView("signin")}>Sign in</button>
            </p>
          </>
        )}

        {/* ── Forgot password ── */}
        {view === "forgot" && (
          <>
            <h2 className="auth-heading">Reset password</h2>
            <p className="auth-sub">Enter your email and we'll send a reset link.</p>

            {fpMsg ? (
              <>
                <p className="auth-msg success">{fpMsg}</p>
                <button type="button" className="auth-btn" style={{ marginTop: 8 }} onClick={() => setView("signin")}>
                  Back to sign in
                </button>
              </>
            ) : (
              <form onSubmit={handleForgot} className="auth-form">
                <div className="auth-field">
                  <label htmlFor="fp-em">Email address</label>
                  <input id="fp-em" type="email" value={fpEmail} onChange={(e) => setFpEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
                </div>
                <button type="submit" className="auth-btn" disabled={fpBusy}>
                  {fpBusy ? "Sending…" : "Send reset link"}
                </button>
              </form>
            )}

            <p className="auth-switch">
              <button type="button" className="auth-link" onClick={() => setView("signin")}>← Back to sign in</button>
            </p>
          </>
        )}

      </div>
    </div>
  );
}

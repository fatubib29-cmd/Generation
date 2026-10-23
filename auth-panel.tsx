"use client";

import { useState, type FormEvent } from "react";
import { apiRequest } from "@/lib/client-api";
import { Icon } from "@/components/common";

export function AuthPanel({ setupRequired, onAuthenticated }: { setupRequired: boolean; onAuthenticated: () => Promise<void> }) {
  const [mode, setMode] = useState<"sign-in" | "setup" | "recovery">(setupRequired ? "setup" : "sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (mode === "setup" && password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
    if (mode === "setup" && password.length < 12) {
      setError("Use at least 12 characters for the owner password.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "recovery") {
        const result = await apiRequest<{ available: boolean; message: string }>("auth/recovery", { method: "POST", body: { email } });
        setNotice(result.message);
        return;
      }
      await apiRequest(mode === "setup" ? "auth/setup" : "auth/login", {
        method: "POST",
        body: mode === "setup" ? { name, email, password } : { email, password },
      });
      await onAuthenticated();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to complete the request.";
      if (mode === "recovery") setNotice(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "setup" ? "Set up your owner account" : mode === "recovery" ? "Account recovery" : "Welcome back";
  const subtitle = mode === "setup"
    ? "Create the first secure owner account. This setup closes after the first registration."
    : mode === "recovery"
      ? "Reset delivery is not configured for this workspace yet."
      : "Sign in to your private business workspace.";

  return (
    <main className="login-shell">
      <section className="login-art">
        <img className="login-logo" src="/branding/osama-trusted-solutions-dark.svg" alt="Osama Trusted Solutions" />
        <div className="login-copy">
          <span className="eyebrow">A clearer view of your business</span>
          <h1>One secure place.<br />Every decision, accounted for.</h1>
          <p>Keep Osama Trusted Solutions and Qasemi Tours and Travels separate, review every financial draft, and let approved records—not guesswork—power your reports.</p>
        </div>
        <div className="login-foot">Private owner workspace · Exact-decimal accounting · Approval-first posting</div>
      </section>
      <section className="login-form-area">
        <div className="login-card">
          <img className="login-brand-mini" src="/branding/qasemi-tours-and-travels.svg" alt="Qasemi Tours and Travels" />
          <h2>{title}</h2>
          <p>{subtitle}</p>
          {error && <div className="alert" role="alert">{error}</div>}
          {notice && <div className="callout warn" role="status"><Icon name="warning" size={16} />{notice}</div>}
          <form onSubmit={submit}>
            {mode === "setup" && <div className="field"><label htmlFor="owner-name">Owner name</label><input id="owner-name" autoComplete="name" required minLength={2} value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" /></div>}
            <div className="field"><label htmlFor="email-address">Email address</label><input id="email-address" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></div>
            {mode !== "recovery" && <div className="field"><label htmlFor="password">Password {mode === "setup" && <em>· 12 characters minimum</em>}</label><input id="password" type="password" autoComplete={mode === "setup" ? "new-password" : "current-password"} required minLength={mode === "setup" ? 12 : 1} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "setup" ? "Create a strong password" : "Enter your password"} /></div>}
            {mode === "setup" && <div className="field"><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" autoComplete="new-password" required minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Re-enter your password" /></div>}
            {mode === "sign-in" && <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}><button type="button" className="btn btn-quiet btn-sm" onClick={() => { setMode("recovery"); setError(""); setNotice(""); }}>Forgot password?</button></div>}
            <button className="btn btn-primary btn-wide" style={{ marginTop: 20, minHeight: 44 }} type="submit" disabled={busy}>
              {busy ? <><span className="spinner" style={{ borderColor: "rgba(255,255,255,.3)", borderTopColor: "white" }} />Working…</> : mode === "setup" ? "Create secure owner account" : mode === "recovery" ? "Check recovery setup" : "Sign in"}
            </button>
          </form>
          {mode === "recovery" && <p style={{ marginTop: 15, color: "#8290a0", fontSize: 10, lineHeight: 1.6 }}>No password reset email will be sent until the administrator configures and verifies an email provider.</p>}
          {mode !== "setup" && <button type="button" className="btn btn-quiet btn-wide" style={{ marginTop: 7 }} onClick={() => { setMode(mode === "recovery" ? "sign-in" : setupRequired ? "setup" : "sign-in"); setError(""); setNotice(""); }}>{mode === "recovery" ? "Back to sign in" : setupRequired ? "Create the first owner account" : "Return to sign in"}</button>}
          <div className="login-security"><Icon name="shield" /> Passwords are stored as salted hashes. Session cookies are HTTP-only and business access is checked on the server.</div>
        </div>
      </section>
    </main>
  );
}

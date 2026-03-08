"use client";

import { useState } from "react";

/**
 * TEMPORARY password reset page. DELETE after use.
 * Located outside (shell) so the catch-all doesn't intercept it.
 */
export default function TmpResetPage() {
  const [email, setEmail] = useState("zino@useaccrue.com");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleReset = async () => {
    if (!email || !password || password.length < 8) {
      setResult("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/v1/tmp-admin-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (res.ok) {
        setResult("Password reset successfully! Go to /login to sign in.");
      } else {
        setResult(`Error: ${data.error || "Unknown error"}`);
      }
    } catch (err) {
      setResult(`Error: ${err instanceof Error ? err.message : "Request failed"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: 420, margin: "80px auto", fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 24, marginBottom: 24 }}>Temporary Password Reset</h1>
      <p style={{ color: "#666", marginBottom: 24 }}>Delete /app/tmp-reset and /app/api/v1/tmp-admin-reset after use.</p>

      <label style={{ display: "block", marginBottom: 16 }}>
        <span style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Email</span>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={{ width: "100%", padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 }}
        />
      </label>

      <label style={{ display: "block", marginBottom: 24 }}>
        <span style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>New Password</span>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Min 8 characters"
          style={{ width: "100%", padding: "8px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 14 }}
        />
      </label>

      <button
        onClick={handleReset}
        disabled={loading}
        style={{
          width: "100%", padding: "10px", background: "#e8922a", color: "white",
          border: "none", borderRadius: 8, fontSize: 16, fontWeight: 600, cursor: "pointer"
        }}
      >
        {loading ? "Resetting..." : "Reset Password"}
      </button>

      {result && (
        <p style={{
          marginTop: 16, padding: 12, borderRadius: 6,
          background: result.startsWith("Error") ? "#fef2f2" : "#f0fdf4",
          color: result.startsWith("Error") ? "#dc2626" : "#16a34a"
        }}>
          {result}
        </p>
      )}
    </main>
  );
}

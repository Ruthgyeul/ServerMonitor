'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { Server } from 'lucide-react';

// Minimal login for deployments that gate the API (DASHBOARD_PASSWORD, or
// API_AUTH_TOKEN). Posts the password to /api/auth/login, which sets the HttpOnly
// cookie the gate accepts; the dashboard then streams normally. See
// src/app/api/auth/login/route.ts.

function LoginForm() {
  const params = useSearchParams();
  // Only same-origin absolute paths. Reject protocol-relative ("//host") and
  // backslash variants so a crafted ?next= can't open-redirect after login.
  const rawNext = params.get('next') || '/';
  const next = /^\/(?![/\\])/.test(rawNext) ? rawNext : '/';

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (response.ok) {
        // Full navigation so the new cookie is attached to the SSE request.
        // `next` is already validated to a safe same-origin path above.
        window.location.href = next;
        return;
      }
      setError(response.status === 404 ? 'Login is not enabled on this server.' : 'Invalid password.');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="box-border flex w-full max-w-[380px] flex-col gap-[18px] rounded-xl border border-line-strong bg-card px-7 py-[30px]"
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-accent/35 bg-brand-tile">
          <Server size={16} className="text-accent" />
        </div>
        <span className="text-[15px] font-semibold">ServerMonitor</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-[-0.015em]">Sign in</h1>
        <p className="text-[13px] text-muted">Enter the dashboard password to continue.</p>
      </div>
      <input
        type="password"
        value={password}
        onChange={event => setPassword(event.target.value)}
        placeholder="Password"
        aria-label="Dashboard password"
        autoFocus
        autoComplete="current-password"
        className="rounded-lg border border-white/10 bg-sidebar px-3 py-2.5 font-mono text-[13px] outline-none focus:border-accent"
      />
      {error && <span className="text-[12.5px] text-crit-fg">{error}</span>}
      <button
        type="submit"
        disabled={submitting || password === ''}
        className="rounded-lg bg-accent px-3 py-2.5 text-[13px] font-medium text-canvas disabled:opacity-60"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}

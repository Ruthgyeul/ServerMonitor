'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { BrandLine, TerminalScreen, TerminalWindow } from '@/components/common/TerminalWindow';

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
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <BrandLine subtitle="Enter the dashboard password to continue." />
      <input
        type="password"
        autoFocus
        value={password}
        onChange={event => setPassword(event.target.value)}
        placeholder="Password"
        aria-label="Dashboard password"
        className="t-body w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-gray-100 outline-none transition-colors focus:border-[#38bdf8] focus:ring-1 focus:ring-[#38bdf8]/40"
      />
      {error && (
        <div className="t-micro flex items-center gap-1.5 text-red-400">
          <span aria-hidden>▸</span>
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={submitting || password.length === 0}
        className="t-body flex items-center justify-center gap-2 rounded-md bg-[#38bdf8] px-3 py-2 font-medium text-gray-900 transition-colors hover:bg-[#7dd3fc] disabled:opacity-50 disabled:hover:bg-[#38bdf8]"
      >
        {submitting && (
          <span className="h-1.5 w-1.5 animate-[pulseDot_1s_ease-in-out_infinite] rounded-full bg-gray-900" />
        )}
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <TerminalScreen>
      <TerminalWindow>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </TerminalWindow>
    </TerminalScreen>
  );
}

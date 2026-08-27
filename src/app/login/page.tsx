'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

// Minimal login for deployments that gate the API with API_AUTH_TOKEN. Posts the
// password to /api/auth/login, which sets the HttpOnly cookie the proxy accepts;
// the dashboard then streams normally. See src/app/api/auth/login/route.ts.

function LoginForm() {
  const params = useSearchParams();
  const next = params.get('next') || '/';

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
        window.location.href = next.startsWith('/') ? next : '/';
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
      className="flex w-full max-w-xs flex-col gap-4 rounded-lg border border-gray-800 bg-gray-950/60 p-6"
    >
      <div>
        <h1 className="text-base font-semibold text-gray-100">Server Monitor</h1>
        <p className="mt-1 text-xs text-gray-400">Enter the dashboard password to continue.</p>
      </div>
      <input
        type="password"
        autoFocus
        value={password}
        onChange={event => setPassword(event.target.value)}
        placeholder="Password"
        aria-label="Dashboard password"
        className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
      />
      {error && <div className="text-xs text-red-400">{error}</div>}
      <button
        type="submit"
        disabled={submitting || password.length === 0}
        className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gray-900 text-gray-100">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}

'use client';

import React, { useState } from 'react';
import { Bell, BellOff, Camera } from 'lucide-react';

// A small, unobtrusive control cluster pinned to the corner of the dashboard:
// toggle alert notifications/sound, and export the current snapshot as JSON.
// Kept out of the fixed card grid so it never affects the kiosk layout budget.

export const DashboardControls: React.FC<{ notifyEnabled: boolean; onToggleNotify: () => void }> = ({
  notifyEnabled,
  onToggleNotify
}) => {
  const [saving, setSaving] = useState(false);

  const exportSnapshot = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/system', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `server-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore — export is best-effort */
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed right-2 bottom-2 z-20 flex gap-1 opacity-40 transition-opacity hover:opacity-100">
      <button
        onClick={onToggleNotify}
        title={notifyEnabled ? 'Alert notifications on' : 'Alert notifications off'}
        aria-label="Toggle alert notifications"
        className="rounded border border-gray-700 bg-gray-800/90 p-1.5 text-gray-300 hover:text-white"
      >
        {notifyEnabled ? <Bell size={14} /> : <BellOff size={14} />}
      </button>
      <button
        onClick={exportSnapshot}
        disabled={saving}
        title="Export current snapshot as JSON"
        aria-label="Export snapshot"
        className="rounded border border-gray-700 bg-gray-800/90 p-1.5 text-gray-300 hover:text-white disabled:opacity-50"
      >
        <Camera size={14} />
      </button>
    </div>
  );
};

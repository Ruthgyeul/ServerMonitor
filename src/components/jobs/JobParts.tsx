import React from 'react';
import { CalendarClock } from 'lucide-react';

import { STATE_STYLE, type JobState } from '@/components/jobs/jobsView';
import { EmptyState } from '@/components/ui/EmptyState';

// Bits shared by the Jobs page and the overview panel.

export function JobDot({ state }: { state: JobState }) {
  return (
    <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: STATE_STYLE[state].dot }} />
  );
}

export function JobResultPill({ state }: { state: JobState }) {
  const style = STATE_STYLE[state];
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] whitespace-nowrap"
      style={{ color: style.fg, background: style.bg }}
    >
      {style.label}
    </span>
  );
}

export function NoJobs({ available }: { available: boolean }) {
  return available ? (
    <EmptyState
      icon={CalendarClock}
      title="No scheduled jobs found"
      body="Jobs appear here once systemd timers are detected on the host."
    />
  ) : (
    <EmptyState
      icon={CalendarClock}
      title="systemd not available"
      body="Timers can't be read on this host or inside this container."
    />
  );
}

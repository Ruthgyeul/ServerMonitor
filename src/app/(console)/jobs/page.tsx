'use client';

import React from 'react';

import { ControlButton } from '@/components/control/ControlButton';
import { jobUrl, permissionFor, sendControl, useControlStatus } from '@/components/control/controlApi';
import { JobDot, JobResultPill, NoJobs } from '@/components/jobs/JobParts';
import {
  durationLabel,
  jobState,
  JOBS_URL,
  relativeAgo,
  relativeIn,
  runBars,
  summarizeJobs
} from '@/components/jobs/jobsView';
import { useShellActions } from '@/components/shell/ShellActions';
import { PageBody } from '@/components/ui/PageBody';
import { Panel } from '@/components/ui/Panel';
import { useNow } from '@/hooks/useNow';
import { usePolled } from '@/hooks/usePolled';
import { PALETTE } from '@/lib/theme';
import { cn } from '@/lib/utils';
import type { JobList } from '@/types/system';

// Backups and scheduled jobs: summary cards, then one row per systemd timer
// with its schedule, last result, the last 14 runs and the run's output.

const POLL_MS = 30_000;
const COLUMNS = 'grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_120px_92px_160px_100px_210px] gap-3.5';
const ROW_BUTTON =
  'rounded-[5px] border border-line-strong px-[9px] py-1 text-[11.5px] text-fg-3 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent';

export default function JobsPage() {
  const list = usePolled<JobList>(JOBS_URL, POLL_MS);
  const now = useNow();
  const { openLogs } = useShellActions();
  const control = useControlStatus();
  const jobs = list?.jobs ?? [];

  if (now === null) return null;
  const summary = summarizeJobs(jobs, now);
  const stats = [
    { label: 'Jobs enabled', value: `${summary.enabled} / ${summary.total}`, color: PALETTE.text },
    {
      label: 'Failing (last run)',
      value: String(summary.failing),
      color: summary.failing > 0 ? PALETTE.critFg : PALETTE.okFg
    },
    {
      label: 'Last good backup',
      value: relativeAgo(summary.lastGoodBackupAt, now),
      color: summary.backupStale ? PALETTE.warnFg : PALETTE.text
    },
    { label: 'Next backup', value: relativeIn(summary.nextBackupAt, now), color: PALETTE.text }
  ];

  return (
    <PageBody>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
        {stats.map(stat => (
          <div
            key={stat.label}
            className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-card px-[18px] py-3.5"
          >
            <span className="text-xs text-muted">{stat.label}</span>
            <span className="font-mono text-xl font-medium" style={{ color: stat.color }}>
              {list === null ? '—' : stat.value}
            </span>
          </div>
        ))}
      </div>

      <Panel
        className="overflow-hidden"
        title="Scheduled jobs"
        actions={<span className="font-mono text-[11.5px] text-subtle">systemd timers</span>}
      >
        {list === null && <p className="p-[18px] text-[12.5px] text-subtle">Loading…</p>}
        {list !== null && jobs.length === 0 && <NoJobs available={list.available} />}
        {jobs.length > 0 && (
          <div className="overflow-x-auto">
            <div className="min-w-[1040px]">
              <div className={`${COLUMNS} px-[18px] pt-[9px] pb-1.5 text-[11px] text-faint`}>
                <span>Job</span>
                <span>Schedule</span>
                <span>Last run</span>
                <span>Result</span>
                <span>Last 14 runs</span>
                <span>Next run</span>
                <span className="text-right">Actions</span>
              </div>
              {jobs.map(job => {
                const state = jobState(job);
                return (
                  <div
                    key={job.id}
                    className={cn(
                      `${COLUMNS} items-center border-t border-line-soft px-[18px] py-[11px]`,
                      state === 'failed' && 'bg-crit/5'
                    )}
                  >
                    <div className="flex min-w-0 flex-col gap-[3px]">
                      <span className="flex items-center gap-2 text-[13px]">
                        <JobDot state={state} />
                        <span className="truncate">{job.name}</span>
                      </span>
                      <span
                        title={job.command ?? undefined}
                        className="truncate font-mono text-[11px] text-subtle"
                      >
                        {job.command ?? job.service}
                      </span>
                    </div>
                    <div className="flex min-w-0 flex-col gap-[3px]">
                      <span className="text-[12.5px] text-fg-2">{job.human}</span>
                      <span className="truncate font-mono text-[11px] text-subtle">
                        {job.schedule} · {job.id}
                      </span>
                    </div>
                    <div className="flex flex-col gap-[3px]">
                      <span className="font-mono text-xs">{relativeAgo(job.lastRunAt, now)}</span>
                      <span className="font-mono text-[11px] text-subtle">{durationLabel(job)}</span>
                    </div>
                    <span>
                      <JobResultPill state={state} />
                    </span>
                    <div className="flex gap-[2px]">
                      {job.history.length === 0 && (
                        <span className="text-[11px] text-faint">no runs recorded</span>
                      )}
                      {runBars(job).map((bar, index) => (
                        <span
                          key={index}
                          title={bar.tip}
                          className="h-4 max-w-[10px] flex-1 rounded-[2px]"
                          style={{ background: bar.color }}
                        />
                      ))}
                    </div>
                    <span className="font-mono text-xs text-fg-3">
                      {job.enabled ? relativeIn(job.nextRunAt, now) : '—'}
                    </span>
                    <div className="flex justify-end gap-1.5">
                      <ControlButton
                        label={job.running ? 'Running…' : 'Run now'}
                        permission={
                          job.running
                            ? { allowed: false, reason: 'Already running' }
                            : permissionFor(control, 'unit', job.id)
                        }
                        run={() => sendControl(jobUrl(job.id), { action: 'run' })}
                        refresh={[JOBS_URL]}
                      />
                      <button
                        onClick={() =>
                          openLogs({ kind: 'unit', name: job.service, title: `journalctl -u ${job.service}` })
                        }
                        className={ROW_BUTTON}
                      >
                        Output
                      </button>
                      <ControlButton
                        label={job.enabled ? 'Disable' : 'Enable'}
                        permission={permissionFor(control, 'unit', job.id)}
                        run={() =>
                          sendControl(jobUrl(job.id), { action: job.enabled ? 'disable' : 'enable' })
                        }
                        refresh={[JOBS_URL]}
                        confirm={
                          job.enabled
                            ? {
                                title: `Disable ${job.name}?`,
                                body: `systemctl disable --now ${job.id} — it won't run again until enabled.`,
                                confirmLabel: 'Disable'
                              }
                            : undefined
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Panel>
      <p className="text-xs leading-normal text-subtle">
        A failed backup raises a critical alert right away. Other failed jobs raise a warning.
      </p>
    </PageBody>
  );
}

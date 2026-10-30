'use client';

import React from 'react';
import Link from 'next/link';

import { JobDot, JobResultPill, NoJobs } from '@/components/jobs/JobParts';
import { jobState, JOBS_URL, relativeAgo, relativeIn, summarizeJobs } from '@/components/jobs/jobsView';
import { Panel } from '@/components/ui/Panel';
import { usePolled } from '@/hooks/usePolled';
import { cn } from '@/lib/utils';
import type { JobList } from '@/types/system';

// Overview brief of backups and scheduled jobs, with the age of the last good backup.

const POLL_MS = 30_000;
const COLUMNS = 'grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_120px_96px_110px] gap-3';

export function JobsPanel({ now }: { now: number }) {
  const list = usePolled<JobList>(JOBS_URL, POLL_MS);
  const jobs = list?.jobs ?? [];
  const summary = summarizeJobs(jobs, now);
  // No successful backup at all reads as stale, like an old one.
  const stale = summary.backupStale || summary.lastGoodBackupAt === null;

  return (
    <Panel
      className="overflow-hidden"
      title="Backups & scheduled jobs"
      actions={
        <>
          {list !== null && (
            <span className={cn('text-xs', stale ? 'text-warn-fg' : 'text-ok-fg')}>
              {summary.lastGoodBackupAt
                ? `Last backup ${relativeAgo(summary.lastGoodBackupAt, now)}`
                : 'No successful backup'}
            </span>
          )}
          <Link href="/jobs" className="text-xs">
            All jobs
          </Link>
        </>
      }
    >
      {list !== null && jobs.length === 0 ? (
        <NoJobs available={list.available} brief />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className={`${COLUMNS} px-[18px] pt-[9px] pb-1.5 text-[11px] text-faint`}>
              <span>Job</span>
              <span>Schedule</span>
              <span>Last run</span>
              <span>Result</span>
              <span className="text-right">Next run</span>
            </div>
            {jobs.map(job => {
              const state = jobState(job);
              return (
                <div
                  key={job.id}
                  className={cn(
                    `${COLUMNS} items-center border-t border-line-soft px-[18px] py-[9px] text-[12.5px]`,
                    state === 'failed' && 'bg-crit/5'
                  )}
                >
                  <span className="flex min-w-0 items-center gap-[9px]">
                    <JobDot state={state} />
                    <span className="truncate">{job.name}</span>
                  </span>
                  <span className="truncate text-muted">{job.human}</span>
                  <span className="font-mono text-[11.5px] text-fg-3">{relativeAgo(job.lastRunAt, now)}</span>
                  <span>
                    <JobResultPill state={state} />
                  </span>
                  <span className="text-right font-mono text-[11.5px] text-muted">
                    {job.enabled ? relativeIn(job.nextRunAt, now) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}

import React from 'react';

// Placeholder layout while the first sample is on its way: a banner bar, four
// KPI cards, then a chart card beside a list card.

const bar = 'animate-skeleton rounded bg-track';
const card = 'flex flex-col gap-3.5 rounded-[10px] border border-white/5 bg-card px-[18px] py-4';
const LIST_WIDTHS = ['92%', '78%', '85%', '64%', '88%', '70%'];

export function PageSkeleton({ what }: { what: string }) {
  return (
    <div
      aria-busy="true"
      className="box-border flex w-full max-w-[1600px] flex-col gap-4 px-4 pt-5 pb-10 desk:px-7"
    >
      <div className="h-11 rounded-lg border border-line-soft bg-card" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4">
        {[0, 1, 2, 3].map(index => (
          <div key={index} className={card}>
            <div className={`${bar} h-2.5 w-2/5`} />
            <div className={`${bar} h-[26px] w-[55%] rounded-[5px]`} />
            <div className={`${bar} h-10 rounded-[5px]`} />
            <div className={`${bar} h-2 w-[70%]`} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-4">
        <div className={`${card} min-w-0 flex-[2_1_560px]`}>
          <div className={`${bar} h-3 w-[30%]`} />
          <div className={`${bar} h-60 rounded-md`} />
        </div>
        <div className={`${card} min-w-0 flex-[1_1_320px]`}>
          <div className={`${bar} h-3 w-2/5`} />
          {LIST_WIDTHS.map(width => (
            <div key={width} className="flex items-center gap-2.5">
              <div className={`${bar} h-3.5 w-[34px] rounded-[3px]`} />
              <div className={`${bar} h-2.5 flex-1`} style={{ maxWidth: width }} />
            </div>
          ))}
        </div>
      </div>
      <span className="text-xs text-faint">Loading {what}…</span>
    </div>
  );
}

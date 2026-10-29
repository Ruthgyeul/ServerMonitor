import React from 'react';
import type { LucideIcon } from 'lucide-react';

// Centered "nothing here yet" block inside a panel.
export function EmptyState({
  icon: Icon,
  title,
  body
}: {
  icon: LucideIcon;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-[30px] text-center">
      <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-track">
        <Icon size={17} className="text-dim" />
      </span>
      <span className="text-[13px] font-medium text-fg-2">{title}</span>
      <span className="max-w-[320px] text-[12.5px] leading-normal text-pretty text-subtle">{body}</span>
    </div>
  );
}

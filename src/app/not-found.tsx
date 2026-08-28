import Link from 'next/link';

import { BrandLine, TerminalScreen, TerminalWindow } from '@/components/common/TerminalWindow';

export default function NotFound() {
  return (
    <TerminalScreen>
      <TerminalWindow>
        <div className="flex flex-col gap-4">
          <BrandLine subtitle="The page you're looking for doesn't exist." />
          <div className="flex items-center gap-1.5 font-mono text-sm text-gray-400">
            <span className="text-emerald-400">❯</span>
            <span className="font-bold text-gray-200">404</span>
            <span className="text-gray-500">— not found</span>
          </div>
          <Link
            href="/"
            className="self-start rounded-md bg-[#38bdf8] px-3 py-2 text-sm font-medium text-gray-900 transition-colors hover:bg-[#7dd3fc]"
          >
            Return home
          </Link>
        </div>
      </TerminalWindow>
    </TerminalScreen>
  );
}

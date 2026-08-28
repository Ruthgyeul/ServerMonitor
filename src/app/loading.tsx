import { TerminalScreen } from '@/components/common/TerminalWindow';

export default function Loading() {
  return (
    <TerminalScreen>
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-gray-700 border-t-[#38bdf8]" />
        <p className="font-mono text-sm text-gray-400">
          <span className="text-emerald-400">❯</span> Loading…
        </p>
      </div>
    </TerminalScreen>
  );
}

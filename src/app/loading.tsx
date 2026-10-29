export default function Loading() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas">
      <div className="h-9 w-9 animate-spin rounded-full border-2 border-track border-t-accent" />
      <p className="text-[13px] text-muted">Loading…</p>
    </main>
  );
}

// One instance per Node process. Next bundles the instrumentation hook (which
// starts the 24/7 collection loop) separately from the route handlers, so a
// plain module-level variable exists once per bundle: state written by one
// (an alert firing, a mute set from the UI) would be invisible to the other.
// Keeping such state on globalThis gives every bundle the same object.

const registry = globalThis as typeof globalThis & { __serverMonitorSingletons?: Map<string, unknown> };

export function processSingleton<T>(key: string, create: () => T): T {
  registry.__serverMonitorSingletons ??= new Map();
  const store = registry.__serverMonitorSingletons;
  if (!store.has(key)) store.set(key, create());
  return store.get(key) as T;
}

// Tests only: forget every singleton so a re-imported module starts fresh.
export function resetProcessSingletons(): void {
  registry.__serverMonitorSingletons?.clear();
}

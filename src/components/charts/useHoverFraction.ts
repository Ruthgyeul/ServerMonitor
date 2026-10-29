'use client';

import { useCallback, useState } from 'react';

// Pointer position across a chart as a 0–1 fraction of `[start, end]` of its
// width (the plot area may be inset by an axis gutter). null when not hovered.
export function useHoverFraction(start = 0, end = 1) {
  const [fraction, setFraction] = useState<number | null>(null);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width) return;
      const raw = (event.clientX - rect.left) / rect.width;
      setFraction(Math.min(1, Math.max(0, (raw - start) / (end - start))));
    },
    [start, end]
  );
  const onPointerLeave = useCallback(() => setFraction(null), []);

  return { fraction, handlers: { onPointerMove, onPointerLeave } };
}

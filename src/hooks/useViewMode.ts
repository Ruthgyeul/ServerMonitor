'use client';

import { useEffect, useState } from 'react';

export type ViewMode = 'kiosk' | 'responsive';

// 키오스크 캔버스를 이 배율 밑으로 줄여야 들어간다면, 글자가 읽히지 않는다
// (9px 라벨이 7px 아래로 내려간다). 그런 화면에는 반응형 레이아웃을 준다.
// 0.8 => 가로 819px, 세로 480px 이상이면 고정 배치를 유지한다.
// 대상인 7인치 패널(1024x600)은 배율 1.0 이라 항상 키오스크로 뜬다.
const KIOSK_MIN_SCALE = 0.8;

interface Viewport {
  width: number;
  height: number;
}

export interface ViewModeState {
  // 측정 전(SSR/첫 페인트)에는 null. 잘못된 레이아웃을 한 프레임 보여주지 않기 위함이다.
  mode: ViewMode | null;
  scale: number;
}

// `?kiosk=1` 로 고정 배치를 강제하고, `?kiosk=0` 으로 반응형을 강제한다.
// 키오스크 브라우저가 뷰포트를 이상하게 보고할 때 쓰는 탈출구.
function readOverride(): ViewMode | null {
  const value = new URLSearchParams(window.location.search).get('kiosk');
  if (value === '1' || value === 'true') return 'kiosk';
  if (value === '0' || value === 'false') return 'responsive';
  return null;
}

export function useViewMode(designWidth: number, designHeight: number): ViewModeState {
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [override, setOverride] = useState<ViewMode | null>(null);

  useEffect(() => {
    // 래퍼 엘리먼트가 아니라 뷰포트를 잰다. 반응형 레이아웃은 세로로 스크롤되므로
    // 래퍼 높이를 재면 "내용이 길다 -> 배율이 크다 -> 키오스크로 전환 -> 내용이 짧아진다"
    // 로 모드가 진동한다.
    const measure = () => setViewport({ width: window.innerWidth, height: window.innerHeight });

    measure();
    setOverride(readOverride());

    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);

  if (viewport === null) return { mode: null, scale: 1 };

  const scale = Math.min(viewport.width / designWidth, viewport.height / designHeight);
  return { mode: override ?? (scale >= KIOSK_MIN_SCALE ? 'kiosk' : 'responsive'), scale };
}

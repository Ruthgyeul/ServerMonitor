'use client';

import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CircleCheck, MonitorDown } from 'lucide-react';

import { Modal } from '@/components/ui/Modal';
import { useStoredString } from '@/hooks/useStoredString';

// "Install as an app" card in the sidebar footer. Uses the browser's install
// prompt when one was offered (Chromium); otherwise opens per-platform steps.

const DISMISSED_KEY = 'sm-pwa-dismissed';
const INSTALLED_KEY = 'sm-pwa-installed';

// Chromium's install prompt event (not in the DOM lib typings).
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const STANDALONE_QUERY = '(display-mode: standalone)';

function subscribeStandalone(notify: () => void): () => void {
  const query = window.matchMedia(STANDALONE_QUERY);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
}

function useInstallState() {
  const [dismissed, setDismissed] = useStoredString(DISMISSED_KEY);
  const [installedFlag, setInstalledFlag] = useStoredString(INSTALLED_KEY);
  const standalone = useSyncExternalStore(
    subscribeStandalone,
    () => window.matchMedia(STANDALONE_QUERY).matches,
    () => false
  );
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      deferred.current = event as BeforeInstallPromptEvent;
    };
    const onInstalled = () => setInstalledFlag('1');
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [setInstalledFlag]);

  const install = () => {
    const prompt = deferred.current;
    if (!prompt) {
      setHelpOpen(true);
      return;
    }
    deferred.current = null;
    void prompt.prompt();
    void prompt.userChoice.then(choice => {
      if (choice.outcome === 'accepted') setInstalledFlag('1');
    });
  };

  return {
    installed: standalone || installedFlag === '1',
    dismissed: dismissed === '1',
    helpOpen,
    install,
    dismiss: () => setDismissed('1'),
    closeHelp: () => setHelpOpen(false),
    markInstalled: () => {
      setInstalledFlag('1');
      setHelpOpen(false);
    }
  };
}

const PLATFORM_STEPS: [string, string][] = [
  ['Chrome · Edge (desktop)', 'Click the install icon at the right end of the address bar, then Install.'],
  ['Android', 'Browser menu → Add to Home screen.'],
  ['iPhone · iPad (Safari)', 'Share → Add to Home Screen.']
];

export function InstallPwa() {
  const state = useInstallState();

  return (
    <>
      {state.installed ? (
        <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-ok-fg">
          <CircleCheck size={13} className="shrink-0" />
          Installed · offline ready
        </div>
      ) : (
        !state.dismissed && (
          <div className="flex flex-col gap-2 rounded-lg border border-accent/25 bg-accent/6 p-3">
            <div className="flex items-center gap-2">
              <MonitorDown size={14} className="shrink-0 text-link" />
              <span className="text-[12.5px] font-medium">Install as an app</span>
            </div>
            <span className="text-[11.5px] leading-[1.45] text-muted">
              Own window, home-screen icon, and the last snapshot stays readable offline.
            </span>
            <div className="flex gap-1.5">
              <button
                onClick={state.install}
                className="rounded-[5px] bg-accent px-2.5 py-1 text-xs text-canvas"
              >
                Install
              </button>
              <button
                onClick={state.dismiss}
                className="rounded-[5px] px-2.5 py-1 text-xs text-muted hover:text-fg"
              >
                Not now
              </button>
            </div>
          </div>
        )
      )}

      {state.helpOpen && (
        <Modal title="Install ServerMonitor" onClose={state.closeHelp}>
          <ul className="flex flex-col">
            {PLATFORM_STEPS.map(([platform, steps]) => (
              <li key={platform} className="flex flex-col gap-[3px] border-b border-line-soft px-5 py-3">
                <span className="text-[13px]">{platform}</span>
                <span className="text-[12.5px] text-muted">{steps}</span>
              </li>
            ))}
          </ul>
          <p className="px-5 py-3 text-xs leading-normal text-subtle">
            Offline, the app opens to the last snapshot it received and reconnects automatically when the
            server is reachable.
          </p>
          <div className="flex justify-end gap-2 px-5 pb-[18px]">
            <button onClick={state.closeHelp} className="rounded-md px-3.5 py-1.5 text-[12.5px] text-fg-3">
              Later
            </button>
            <button
              onClick={state.markInstalled}
              className="rounded-md bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-canvas"
            >
              I&apos;ve installed it
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

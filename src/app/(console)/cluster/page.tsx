'use client';

import React, { useCallback, useState } from 'react';
import { ServerCog } from 'lucide-react';

import { NodeCard } from '@/components/cluster/NodeCard';
import { NodeModal } from '@/components/cluster/NodeModal';
import { useCluster } from '@/components/cluster/useCluster';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageBody } from '@/components/ui/PageBody';
import { useNow } from '@/hooks/useNow';
import { cn } from '@/lib/utils';

// Every configured node side by side, refreshed each second. A node's detail
// dialog is deep-linkable via ?node=<name>.

const POLL_INTERVAL_MS = 1000;

export default function ClusterPage() {
  const { nodes, history } = useCluster(POLL_INTERVAL_MS);
  const now = useNow();
  // Initialised lazily from ?node= (safe against hydration: the dialog only
  // renders once nodes have loaded client-side).
  const [selected, setSelected] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('node');
  });

  // Keep the URL in sync so the open node is shareable/bookmarkable.
  const openNode = useCallback((name: string | null) => {
    setSelected(name);
    const url = new URL(window.location.href);
    if (name) url.searchParams.set('node', name);
    else url.searchParams.delete('node');
    window.history.replaceState(null, '', url.toString());
  }, []);

  const list = nodes ?? [];
  const online = list.filter(node => node.result.ok).length;
  const open = list.find(node => node.name === selected);

  return (
    <PageBody>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 rounded-lg border border-line bg-card px-4 py-[11px]">
        <span className="flex items-center gap-2 text-[13px] font-medium">
          <span
            className={cn(
              'h-[7px] w-[7px] rounded-full',
              nodes === null ? 'bg-faint' : online < list.length ? 'bg-warn' : 'bg-ok'
            )}
          />
          {nodes === null ? 'Connecting…' : `${online} of ${list.length} nodes online`}
        </span>
        <span className="text-[12.5px] text-dim">
          Aggregated server-side · node IPs are not exposed to the browser
        </span>
        <span className="ml-auto text-[12.5px] text-dim">Click a node for details</span>
      </div>

      {nodes !== null && list.length === 0 ? (
        <div className="rounded-[10px] border border-line bg-card">
          <EmptyState
            icon={ServerCog}
            title="No cluster nodes configured"
            body="Set NEXT_PUBLIC_CLUSTER_SERVERS in your environment to list the nodes to monitor."
          />
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
          {list.map(node => (
            <NodeCard
              key={node.name}
              node={node}
              history={history[node.name] ?? []}
              now={now}
              onSelect={() => openNode(node.name)}
            />
          ))}
        </div>
      )}

      {open && <NodeModal node={open} now={now} onClose={() => openNode(null)} />}
    </PageBody>
  );
}

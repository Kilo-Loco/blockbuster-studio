import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError, startDownload } from '../lib/api';
import { toast, useJobsStore } from '../lib/store';
import { Gallery, paramsForTab, type GalleryTab } from '../components/create/Gallery';
import { Composer } from '../components/create/Composer';
import { SelectionBar } from '../components/create/SelectionBar';
import { Viewer } from '../components/create/Viewer';

export default function Create() {
  const [tab, setTab] = useState<GalleryTab>('all');
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastIndex, setLastIndex] = useState<number | null>(null);
  const qc = useQueryClient();

  const params = useMemo(() => paramsForTab(tab), [tab]);

  const query = useInfiniteQuery({
    queryKey: ['assets', tab],
    queryFn: ({ pageParam }) => api.assets({ ...params, cursor: pageParam, limit: 60 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
  });

  const assets = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  const jobsMap = useJobsStore((s) => s.jobs);
  const activeJobs = useMemo(
    () => Object.values(jobsMap).filter((j) => j.type === 'generate' && !j.projectId && (j.status === 'queued' || j.status === 'running')),
    [jobsMap],
  );

  function clearSelection() {
    setSelected(new Set());
    setLastIndex(null);
  }

  function handleTabChange(t: GalleryTab) {
    setTab(t);
    clearSelection();
  }

  function toggleSelect(id: string, index: number, shiftKey: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastIndex !== null) {
        const [start, end] = lastIndex < index ? [lastIndex, index] : [index, lastIndex];
        for (let i = start; i <= end; i++) {
          const a = assets[i];
          if (a) next.add(a.id);
        }
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastIndex(index);
  }

  function handleSelectAll() {
    setSelected(new Set(assets.map((a) => a.id)));
  }

  useEffect(() => {
    if (selected.size === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') clearSelection();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected.size]);

  async function handleDownloadSelected() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    toast({ title: `Preparing ${ids.length} file${ids.length === 1 ? '' : 's'}…` });
    try {
      const res = await api.downloadAssets({ assetIds: ids });
      startDownload(res.url);
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : undefined;
      toast({ title: 'Download failed', description: msg, variant: 'error' });
    }
  }

  async function handleFavoriteSelected() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((id) => api.updateAsset(id, { favorite: true })));
      qc.invalidateQueries({ queryKey: ['assets'] });
      toast({ title: `Favorited ${ids.length} item${ids.length === 1 ? '' : 's'}`, variant: 'success' });
    } catch {
      toast({ title: 'Could not favorite all selected items', variant: 'error' });
    }
  }

  async function handleDeleteSelected() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} item${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    try {
      await Promise.all(ids.map((id) => api.deleteAsset(id)));
      qc.invalidateQueries({ queryKey: ['assets'] });
      clearSelection();
      toast({ title: `Deleted ${ids.length} item${ids.length === 1 ? '' : 's'}`, variant: 'success' });
    } catch {
      toast({ title: 'Delete failed', variant: 'error' });
    }
  }

  return (
    <div className="relative h-full">
      <Gallery
        assets={assets}
        jobs={activeJobs}
        onOpen={setViewerIndex}
        hasNextPage={!!query.hasNextPage}
        isFetchingNextPage={query.isFetchingNextPage}
        fetchNextPage={() => void query.fetchNextPage()}
        tab={tab}
        onTabChange={handleTabChange}
        selectedIds={selected}
        onToggleSelect={toggleSelect}
      />
      {selected.size > 0 ? (
        <SelectionBar
          count={selected.size}
          onSelectAll={handleSelectAll}
          onDownload={() => void handleDownloadSelected()}
          onFavorite={() => void handleFavoriteSelected()}
          onDelete={() => void handleDeleteSelected()}
          onClear={clearSelection}
        />
      ) : (
        <Composer />
      )}
      {viewerIndex !== null && assets[viewerIndex] && (
        <Viewer assets={assets} index={viewerIndex} onIndexChange={setViewerIndex} onClose={() => setViewerIndex(null)} />
      )}
    </div>
  );
}

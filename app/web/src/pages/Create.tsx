import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useJobsStore } from '../lib/store';
import { Gallery, type GalleryTab } from '../components/create/Gallery';
import { Composer } from '../components/create/Composer';
import { Viewer } from '../components/create/Viewer';

export default function Create() {
  const [tab, setTab] = useState<GalleryTab>('all');
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const params = useMemo(() => {
    if (tab === 'images') return { kind: 'image' as const };
    if (tab === 'videos') return { kind: 'video' as const };
    if (tab === 'favorites') return { favorite: true };
    return {};
  }, [tab]);

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
        onTabChange={setTab}
      />
      <Composer />
      {viewerIndex !== null && assets[viewerIndex] && (
        <Viewer assets={assets} index={viewerIndex} onIndexChange={setViewerIndex} onClose={() => setViewerIndex(null)} />
      )}
    </div>
  );
}

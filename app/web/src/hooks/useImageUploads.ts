import { useState } from 'react';
import type { Asset } from '@shared/types';
import { api } from '../lib/api';
import { toast } from '../lib/store';

const CONCURRENCY = 3;

/**
 * Uploads a batch of images a few at a time and reports progress. Files that fail are named in
 * a toast; the ones that worked are still returned, so one bad file never drops the rest.
 */
export function useImageUploads() {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function upload(files: File[]): Promise<Asset[]> {
    const images = files.filter((f) => f.type.startsWith('image/'));
    const skipped = files.length - images.length;
    if (skipped > 0) toast({ title: `Skipped ${skipped} file${skipped === 1 ? '' : 's'} that ${skipped === 1 ? "isn't an image" : "aren't images"}`, variant: 'error' });
    if (images.length === 0) return [];

    const results: (Asset | null)[] = new Array(images.length).fill(null);
    const failed: string[] = [];
    let next = 0;
    let done = 0;
    setProgress({ done, total: images.length });

    async function worker() {
      while (next < images.length) {
        const i = next++;
        try {
          results[i] = await api.upload(images[i]);
        } catch {
          failed.push(images[i].name);
        }
        setProgress({ done: ++done, total: images.length });
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, images.length) }, worker));
    setProgress(null);

    if (failed.length > 0) {
      toast({
        title: `${failed.length} of ${images.length} uploads failed`,
        description: failed.join(', '),
        variant: 'error',
      });
    }
    // Keep the order the files were picked in.
    return results.filter((a): a is Asset => !!a);
  }

  return { upload, progress, uploading: progress !== null };
}

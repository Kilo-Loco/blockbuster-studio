import { useEffect, useRef, useState } from 'react';
import type { Asset } from '@shared/types';
import { api, ApiClientError } from '../../lib/api';
import { toast } from '../../lib/store';
import { Button, Dialog, ProgressRing } from '../ui';
import { Circle, RotateCcw, Square, Video as VideoIcon } from 'lucide-react';

const MAX_SECONDS = 15;

type Phase = 'requesting' | 'denied' | 'unsupported' | 'countdown' | 'recording' | 'preview' | 'uploading';

function pickMimeType(): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return '';
}

export function RecordDialog({ onClose, onUse }: { onClose: () => void; onUse: (asset: Asset) => void }) {
  const [phase, setPhase] = useState<Phase>('requesting');
  const [countdown, setCountdown] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const playbackRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function clearTimers() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    timerRef.current = null;
    countdownRef.current = null;
  }

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) setPhase('unsupported');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setPhase('countdown');
      } catch (e) {
        if (cancelled) return;
        const name = e instanceof DOMException ? e.name : '';
        if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setPhase('unsupported');
        } else {
          setPhase('denied');
        }
      }
    }
    void start();
    return () => {
      cancelled = true;
      clearTimers();
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== 'countdown') return;
    setCountdown(3);
    let n = 3;
    countdownRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        if (countdownRef.current) clearInterval(countdownRef.current);
        beginRecording();
      } else {
        setCountdown(n);
      }
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function beginRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = pickMimeType();
    mimeTypeRef.current = mimeType;
    chunksRef.current = [];
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      setError('This browser cannot record video.');
      setPhase('unsupported');
      return;
    }
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'video/webm' });
      setPreviewUrl(URL.createObjectURL(blob));
      setPhase('preview');
    };
    recorderRef.current = recorder;
    recorder.start();
    setElapsed(0);
    setPhase('recording');
    const startedAt = Date.now();
    timerRef.current = setInterval(() => {
      const secs = (Date.now() - startedAt) / 1000;
      setElapsed(secs);
      if (secs >= MAX_SECONDS) stopRecording();
    }, 100);
  }

  function stopRecording() {
    clearTimers();
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
  }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    chunksRef.current = [];
    setPhase('countdown');
  }

  async function useTake() {
    if (!chunksRef.current.length) return;
    const mimeType = mimeTypeRef.current || 'video/webm';
    const isMp4 = mimeType.includes('mp4');
    const blob = new Blob(chunksRef.current, { type: mimeType });
    const file = new File([blob], isMp4 ? 'perform.mp4' : 'perform.webm', { type: mimeType });
    setPhase('uploading');
    try {
      const asset = await api.upload(file);
      onUse(asset);
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : 'Upload failed';
      toast({ title: 'Upload failed', description: msg, variant: 'error' });
      setPhase('preview');
    }
  }

  function handleClose() {
    clearTimers();
    stopStream();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    onClose();
  }

  const pct = Math.min(1, elapsed / MAX_SECONDS);
  const remaining = Math.max(0, MAX_SECONDS - elapsed);

  return (
    <Dialog open onClose={handleClose} title="Record a performance" size="sm">
      <div className="flex flex-col items-center gap-4">
        {(phase === 'denied' || phase === 'unsupported') && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <VideoIcon className="size-8 text-[var(--color-ink-3)]" />
            <p className="text-sm text-[var(--color-ink-1)]">
              {phase === 'denied'
                ? "Camera access was denied. Allow camera access in your browser's site settings, then try again."
                : "No camera is available here, or this browser can't record video. Try uploading a video instead."}
            </p>
            {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
            <Button variant="secondary" size="sm" onClick={handleClose}>
              Close
            </Button>
          </div>
        )}

        {phase === 'requesting' && <p className="py-10 text-sm text-[var(--color-ink-2)]">Requesting camera…</p>}

        {(phase === 'countdown' || phase === 'recording') && (
          <div className="relative w-full overflow-hidden rounded-xl border border-[var(--color-hairline)] bg-black">
            <video ref={videoRef} autoPlay muted playsInline className="aspect-[3/4] w-full -scale-x-100 object-cover" />
            {phase === 'countdown' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <span className="font-serif text-6xl text-white">{countdown}</span>
              </div>
            )}
            {phase === 'recording' && (
              <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white backdrop-blur">
                <Circle className="size-2.5 animate-pulse fill-[var(--color-danger)] text-[var(--color-danger)]" />
                {remaining.toFixed(0)}s left
              </div>
            )}
          </div>
        )}

        {phase === 'recording' && (
          <div className="flex items-center gap-4">
            <div className="relative">
              <ProgressRing value={pct} size={56} />
              <button
                type="button"
                onClick={stopRecording}
                aria-label="Stop recording"
                className="absolute inset-0 m-auto flex size-8 items-center justify-center rounded-full bg-[var(--color-danger)] text-white transition-transform active:scale-90"
              >
                <Square className="size-3.5 fill-current" />
              </button>
            </div>
          </div>
        )}

        {phase === 'countdown' && <p className="text-xs text-[var(--color-ink-3)]">Get ready — recording starts in {countdown}…</p>}

        {(phase === 'preview' || phase === 'uploading') && previewUrl && (
          <>
            <video ref={playbackRef} src={previewUrl} controls playsInline className="aspect-[3/4] w-full rounded-xl border border-[var(--color-hairline)] object-cover" />
            <div className="flex w-full items-center justify-center gap-2">
              <Button variant="secondary" size="sm" icon={<RotateCcw className="size-3.5" />} onClick={retake} disabled={phase === 'uploading'}>
                Retake
              </Button>
              <Button variant="primary" size="sm" onClick={() => void useTake()} loading={phase === 'uploading'}>
                Use this take
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

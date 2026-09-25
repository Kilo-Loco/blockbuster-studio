import { NavLink, Outlet } from 'react-router';
import { Clapperboard, Film, Users, MapPin, Sparkles, Settings as SettingsIcon, ListVideo, Cpu, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import { useJobsStore, useUIStore } from '../lib/store';
import { useEngineState } from '../hooks/useEngineState';
import { IconButton, Tooltip, Progress } from './ui';
import { QueueDrawer } from './QueueDrawer';

const NAV = [
  { to: '/', label: 'Create', icon: Sparkles, end: true },
  { to: '/projects', label: 'Projects', icon: Film, requiresVideo: true },
  { to: '/cast', label: 'Cast', icon: Users },
  { to: '/locations', label: 'Locations', icon: MapPin, requiresVideo: true },
  { to: '/loras', label: 'LoRAs', icon: Clapperboard },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function AppShell() {
  const { system, isOff } = useEngineState();
  const jobs = useJobsStore((s) => s.jobs);
  const { queueOpen, setQueueOpen } = useUIStore();
  const activeCount = Object.values(jobs).filter((j) => j.status === 'queued' || j.status === 'running').length;

  const notReadyGroups = system?.models.filter((m) => m.enabled && !m.ready) ?? [];
  const showBanner = notReadyGroups.length > 0;

  // No storyboard-film capability without wan_i2v: Projects and Locations depend on it.
  const nav = NAV.filter((item) => !item.requiresVideo || !isOff('wan_i2v'));

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--color-bg-0)]">
      <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-[var(--color-hairline)] bg-[var(--color-bg-1)] py-4">
        <div className="mb-4 font-serif text-xl text-[var(--color-amber-400)]">B</div>
        {nav.map((item) => (
          <Tooltip key={item.to} label={item.label} side="right">
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  'flex size-11 items-center justify-center rounded-xl transition-colors',
                  isActive ? 'bg-[var(--color-amber-400)]/15 text-[var(--color-amber-400)]' : 'text-[var(--color-ink-2)] hover:bg-white/6 hover:text-[var(--color-ink-0)]',
                )
              }
              aria-label={item.label}
            >
              <item.icon className="size-5" />
            </NavLink>
          </Tooltip>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {system?.gpuCheck && !system.gpuCheck.ok && (
          <div role="alert" className="flex items-start gap-3 border-b border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-400" />
            <div>
              <div className="font-medium text-red-100">This Runpod machine's GPU isn't working.</div>
              <div className="mt-0.5 text-red-200/80">
                Nothing on this pod can fix it. In Runpod, <strong>terminate</strong> this pod and deploy the template again. You'll be
                placed on a different machine. <span className="chip-mono opacity-70">({system.gpuCheck.error ?? 'CUDA unavailable'})</span>
              </div>
            </div>
          </div>
        )}
        {system && system.disk.totalBytes > 0 && system.disk.totalBytes < 140e9 && (
          <div role="alert" className="flex items-start gap-3 border-b border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-400" />
            <div>
              <div className="font-medium text-red-100">This pod has no storage volume attached.</div>
              <div className="mt-0.5 text-red-200/80">
                The models need ~139&nbsp;GB and your projects need somewhere to live. In Runpod, terminate this pod and deploy
                again, clicking <strong>Add volume</strong> (200&nbsp;GB) before <strong>Deploy Pod</strong>.
                <span className="chip-mono opacity-70"> ({(system.disk.totalBytes / 1e9).toFixed(0)} GB available)</span>
              </div>
            </div>
          </div>
        )}
        {showBanner && (
          <div className="flex items-center gap-3 border-b border-[var(--color-amber-400)]/20 bg-[var(--color-amber-400)]/8 px-4 py-2 text-xs text-[var(--color-amber-300)]">
            <AlertTriangle className="size-3.5 shrink-0" />
            <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1">
              {notReadyGroups.map((g) => {
                const pct = g.totalBytes ? g.downloadedBytes / g.totalBytes : 0;
                return (
                  <span key={g.id} className="flex items-center gap-2">
                    <span>
                      Downloading {g.label}… {(pct * 100).toFixed(0)}% · {(g.downloadedBytes / 1e9).toFixed(1)}/{(g.totalBytes / 1e9).toFixed(1)} GB
                    </span>
                    <Progress value={pct} className="w-24" />
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-[var(--color-hairline)] px-4">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-1)] px-3 py-1.5 text-xs text-[var(--color-ink-2)]">
            <Cpu className="size-3.5" />
            <span className="chip-mono">{system?.comfy.gpuName ?? '—'}</span>
            {system?.comfy.vramFreeMB !== undefined && system?.comfy.vramTotalMB !== undefined && (
              <span className="chip-mono text-[var(--color-ink-3)]">
                {(system.comfy.vramFreeMB / 1024).toFixed(1)}/{(system.comfy.vramTotalMB / 1024).toFixed(1)} GB
              </span>
            )}
            <span className={clsx('size-1.5 rounded-full', system?.comfy.online ? 'bg-[var(--color-success)]' : 'bg-[var(--color-danger)]')} />
          </div>
          <button
            onClick={() => setQueueOpen(!queueOpen)}
            className="relative flex h-9 items-center gap-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-1)] px-3 text-xs text-[var(--color-ink-1)] hover:bg-[var(--color-bg-2)]"
          >
            <ListVideo className="size-4" />
            Queue
            {activeCount > 0 && (
              <span className="flex size-4 items-center justify-center rounded-full bg-[var(--color-amber-400)] text-[10px] font-bold text-black">
                {activeCount}
              </span>
            )}
          </button>
        </header>

        <main className="relative flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>

      <QueueDrawer />
    </div>
  );
}

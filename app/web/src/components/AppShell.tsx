import { NavLink, Outlet } from 'react-router';
import { Clapperboard, Film, Users, MapPin, Sparkles, Settings as SettingsIcon, ListVideo, Cpu, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import { useJobsStore, useUIStore } from '../lib/store';
import { useEngineState } from '../hooks/useEngineState';
import { IconButton, Tooltip, Progress } from './ui';
import { QueueDrawer } from './QueueDrawer';
import { Logo } from './Logo';

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
  // A volume smaller than the models this pod installs (plus a little room for renders) means none was attached.
  const modelBytes = (system?.models ?? []).filter((m) => m.enabled).reduce((sum, m) => sum + m.totalBytes, 0) || 139e9;
  const planBytes = modelBytes + 5e9;
  const showBanner = notReadyGroups.length > 0;

  // No storyboard-film capability without wan_i2v: Projects and Locations depend on it.
  const nav = NAV.filter((item) => !item.requiresVideo || !isOff('wan_i2v'));

  return (
    // Phones: navigation is a bottom tab bar (the side rail would take a quarter of the width).
    <div className="flex h-dvh w-screen flex-col-reverse overflow-hidden bg-[var(--color-bg-0)] sm:flex-row">
      <nav className="flex w-full shrink-0 items-center justify-around border-t border-[var(--color-hairline)] bg-[var(--color-bg-1)] px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] sm:w-16 sm:flex-col sm:justify-start sm:gap-1 sm:border-t-0 sm:border-r sm:px-0 sm:py-4">
        <Logo title="Blockbuster Studio" className="mb-4 hidden size-8 fill-[var(--color-amber-400)] sm:block" />
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
        {system && system.disk.totalBytes > 0 && system.disk.totalBytes < planBytes && (
          <div role="alert" className="flex items-start gap-3 border-b border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-400" />
            <div>
              <div className="font-medium text-red-100">This pod has no storage volume attached.</div>
              <div className="mt-0.5 text-red-200/80">
                The models need ~{Math.ceil(modelBytes / 1e9)}&nbsp;GB and your projects need somewhere to live. In Runpod, terminate
                this pod and deploy again, clicking <strong>Add volume</strong> and choosing <strong>Volume disk</strong> before{' '}
                <strong>Deploy Pod</strong>.
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

        <header className="flex h-14 shrink-0 items-center justify-end gap-2 border-b border-[var(--color-hairline)] px-4 sm:gap-3">
          <Logo title="Blockbuster Studio" className="mr-auto size-7 fill-[var(--color-amber-400)] sm:hidden" />
          <div className="flex min-w-0 items-center gap-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-bg-1)] px-3 py-1.5 text-xs text-[var(--color-ink-2)]">
            <Cpu className="size-3.5" />
            <span className="chip-mono truncate">{system?.comfy.gpuName ?? '—'}</span>
            {system?.comfy.vramFreeMB !== undefined && system?.comfy.vramTotalMB !== undefined && (
              <span className="chip-mono hidden text-[var(--color-ink-3)] sm:inline">
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

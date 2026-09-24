import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCw, UserPlus, X } from 'lucide-react';
import { api } from '../../lib/api';
import type { Character, CharacterMark, Location, Scene } from '@shared/types';
import { Dialog, Button, IconButton } from '../ui';
import { MapGeometry, CharacterToken } from './MiniMap';
import { characterColor } from './utils';

export function BlockingDialog({
  open,
  onClose,
  scene,
  location,
  characters,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  scene: Scene & { shots: { characterIds: string[] }[] };
  location: Location | undefined;
  characters: Character[];
  projectId: string;
}) {
  const [blocking, setBlocking] = useState<CharacterMark[]>(scene.blocking);
  const [selected, setSelected] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<string | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (open) setBlocking(scene.blocking);
  }, [open, scene.blocking]);

  const save = useMutation({
    mutationFn: (b: CharacterMark[]) => api.updateScene(scene.id, { blocking: b }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId] }),
  });

  const castIds = useMemo(() => {
    const ids = new Set<string>();
    scene.shots.forEach((s) => s.characterIds.forEach((id) => ids.add(id)));
    blocking.forEach((m) => ids.add(m.characterId));
    return ids;
  }, [scene.shots, blocking]);

  const cast = characters.filter((c) => castIds.has(c.id));
  const map = location?.map;

  function toMeters(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg || !map) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.min(map.widthM, Math.max(0, ((clientX - rect.left) / rect.width) * map.widthM)),
      y: Math.min(map.heightM, Math.max(0, ((clientY - rect.top) / rect.height) * map.heightM)),
    };
  }

  function onPointerDown(id: string) {
    return (e: React.PointerEvent) => {
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      dragging.current = id;
      setSelected(id);
    };
  }

  function onMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const p = toMeters(e.clientX, e.clientY);
    setBlocking((prev) => prev.map((m) => (m.characterId === dragging.current ? { ...m, pos: p } : m)));
  }

  function onUp() {
    if (dragging.current) {
      dragging.current = null;
      save.mutate(blocking);
    }
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'r' && selected) {
        setBlocking((prev) => {
          const next = prev.map((m) => (m.characterId === selected ? { ...m, facingDeg: (m.facingDeg + 15) % 360 } : m));
          save.mutate(next);
          return next;
        });
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selected]);

  function addCharacter(id: string) {
    const next = [...blocking, { characterId: id, pos: map ? { x: map.widthM / 2, y: map.heightM / 2 } : { x: 0, y: 0 }, facingDeg: 0 }];
    setBlocking(next);
    save.mutate(next);
  }

  function removeCharacter(id: string) {
    const next = blocking.filter((m) => m.characterId !== id);
    setBlocking(next);
    save.mutate(next);
    if (selected === id) setSelected(null);
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Blocking · ${scene.title || 'Scene'}`} size="lg">
      <div className="flex flex-col gap-4">
        <p className="text-xs text-[var(--color-ink-2)]">
          Drag characters to place them. Select a token, then press <span className="chip-mono">R</span> to rotate its facing.
        </p>
        {!map ? (
          <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-[var(--color-hairline)] text-sm text-[var(--color-ink-2)]">
            Assign a location to this scene to block it.
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${map.widthM} ${map.heightM}`}
            className="w-full rounded-xl border border-[var(--color-hairline)]"
            style={{ touchAction: 'none', maxHeight: '55vh' }}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
            onClick={(e) => {
              if (e.target === e.currentTarget) setSelected(null);
            }}
          >
            <MapGeometry map={map} />
            {blocking.map((m, i) => {
              const c = characters.find((ch) => ch.id === m.characterId);
              return (
                <g key={m.characterId}>
                  <CharacterToken mark={m} character={c} index={i} onPointerDown={onPointerDown(m.characterId)} />
                  {selected === m.characterId && (
                    <circle cx={m.pos.x} cy={m.pos.y} r={0.42} fill="none" stroke="var(--color-amber-400)" strokeWidth={0.04} strokeDasharray="0.08,0.08" />
                  )}
                </g>
              );
            })}
          </svg>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {cast.map((c, i) => {
            const placed = blocking.some((m) => m.characterId === c.id);
            return (
              <span
                key={c.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-hairline)] bg-[var(--color-bg-2)] py-1 pl-1 pr-2 text-xs"
              >
                <span
                  className="flex size-5 items-center justify-center rounded-full text-[10px] font-bold text-black"
                  style={{ background: characterColor(c, i) }}
                >
                  {c.name.slice(0, 1).toUpperCase()}
                </span>
                {c.name}
                {placed ? (
                  <IconButton icon={<X className="size-3" />} label="Remove" size="sm" onClick={() => removeCharacter(c.id)} className="size-4" />
                ) : (
                  <IconButton icon={<UserPlus className="size-3" />} label="Place" size="sm" onClick={() => addCharacter(c.id)} className="size-4" />
                )}
              </span>
            );
          })}
          {cast.length === 0 && <span className="text-xs text-[var(--color-ink-3)]">No characters assigned to this scene's shots yet.</span>}
        </div>

        {selected && (
          <div className="flex items-center gap-2 text-xs text-[var(--color-ink-2)]">
            <RotateCw className="size-3.5" /> Editing facing for {characters.find((c) => c.id === selected)?.name ?? 'character'} — press R to rotate.
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

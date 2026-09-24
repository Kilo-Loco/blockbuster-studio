import { useRef, useState } from 'react';
import type { Character, CharacterMark, LocationMap, MapCamera, ShotSize, Vec2 } from '@shared/types';
import { fovFor } from '@shared/camera';
import { characterColor, initials } from './utils';

/** Read-only wall/prop geometry shared by MiniMap and BlockingDialog. */
export function MapGeometry({ map }: { map: LocationMap }) {
  return (
    <g>
      <rect x={0} y={0} width={map.widthM} height={map.heightM} fill="var(--color-bg-2)" />
      {map.elements.map((el) => {
        const stroke = el.color || 'rgb(255 255 255 / 0.35)';
        if (el.type === 'wall' || el.type === 'door' || el.type === 'window') {
          const [a, b] = el.points;
          if (!a || !b) return null;
          return (
            <line
              key={el.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={el.type === 'wall' ? stroke : el.type === 'door' ? '#f5a524' : '#5cc8ff'}
              strokeWidth={el.type === 'wall' ? 0.12 : 0.08}
              strokeDasharray={el.type === 'window' ? '0.2,0.15' : undefined}
              strokeLinecap="round"
            />
          );
        }
        if (el.type === 'rect' || el.type === 'zone') {
          const [a, b] = el.points;
          if (!a || !b) return null;
          const x = Math.min(a.x, b.x);
          const y = Math.min(a.y, b.y);
          return (
            <rect
              key={el.id}
              x={x}
              y={y}
              width={Math.abs(b.x - a.x)}
              height={Math.abs(b.y - a.y)}
              fill={el.type === 'zone' ? `${stroke}22` : 'var(--color-bg-3)'}
              stroke={stroke}
              strokeWidth={0.05}
              rx={0.1}
            />
          );
        }
        if (el.type === 'circle') {
          const [c, r] = el.points;
          if (!c) return null;
          const radius = r ? Math.hypot(r.x - c.x, r.y - c.y) : 0.3;
          return <circle key={el.id} cx={c.x} cy={c.y} r={radius} fill="var(--color-bg-3)" stroke={stroke} strokeWidth={0.05} />;
        }
        if (el.type === 'label') {
          const [p] = el.points;
          if (!p) return null;
          return (
            <text key={el.id} x={p.x} y={p.y} fontSize={0.35} fill="var(--color-ink-3)">
              {el.label}
            </text>
          );
        }
        return null;
      })}
    </g>
  );
}

export function CharacterToken({
  mark,
  character,
  index,
  radius = 0.3,
  onPointerDown,
}: {
  mark: CharacterMark;
  character?: Character;
  index: number;
  radius?: number;
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  const color = characterColor(character, index);
  const rad = (mark.facingDeg * Math.PI) / 180;
  const tipX = mark.pos.x + Math.sin(rad) * (radius + 0.35);
  const tipY = mark.pos.y - Math.cos(rad) * (radius + 0.35);
  return (
    <g onPointerDown={onPointerDown} className={onPointerDown ? 'cursor-grab active:cursor-grabbing' : undefined}>
      <line x1={mark.pos.x} y1={mark.pos.y} x2={tipX} y2={tipY} stroke={color} strokeWidth={0.06} strokeLinecap="round" />
      <circle cx={mark.pos.x} cy={mark.pos.y} r={radius} fill={color} stroke="rgb(0 0 0 / 0.4)" strokeWidth={0.03} />
      <text x={mark.pos.x} y={mark.pos.y} fontSize={radius} textAnchor="middle" dominantBaseline="central" fill="#000" fontWeight={700}>
        {character ? initials(character.name) : '?'}
      </text>
    </g>
  );
}

/** Camera + look-at target + FOV cone. Draggable when `onCameraChange` is provided. */
export function MiniMap({
  map,
  marks,
  characters,
  camera,
  shotSize,
  onCameraChange,
  interactive = true,
  className,
}: {
  map: LocationMap;
  marks: CharacterMark[];
  characters: Character[];
  camera: MapCamera;
  shotSize: ShotSize;
  onCameraChange?: (camera: MapCamera) => void;
  interactive?: boolean;
  className?: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<'pos' | 'target' | null>(null);
  const [live, setLive] = useState<MapCamera>(camera);

  const cam = dragging ? live : camera;
  const target = cam.target ?? map.subject;

  function toMeters(clientX: number, clientY: number): Vec2 {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const x = Math.min(map.widthM, Math.max(0, ((clientX - rect.left) / rect.width) * map.widthM));
    const y = Math.min(map.heightM, Math.max(0, ((clientY - rect.top) / rect.height) * map.heightM));
    return { x, y };
  }

  function startDrag(which: 'pos' | 'target') {
    return (e: React.PointerEvent) => {
      if (!interactive || !onCameraChange) return;
      e.stopPropagation();
      (e.target as Element).setPointerCapture(e.pointerId);
      setDragging(which);
      setLive(camera);
    };
  }

  function onMove(e: React.PointerEvent) {
    if (!dragging) return;
    const p = toMeters(e.clientX, e.clientY);
    setLive((prev) => (dragging === 'pos' ? { ...prev, pos: p } : { ...prev, target: p }));
  }

  function onUp() {
    if (!dragging) return;
    setDragging(null);
    onCameraChange?.(live);
  }

  const fov = fovFor(cam, shotSize);
  const dir = { x: target.x - cam.pos.x, y: target.y - cam.pos.y };
  const dist = Math.hypot(dir.x, dir.y) || 1;
  const ang = Math.atan2(dir.y, dir.x);
  const half = (fov / 2 / 180) * Math.PI;
  const reach = Math.max(dist * 1.3, 2);
  const coneA = { x: cam.pos.x + Math.cos(ang - half) * reach, y: cam.pos.y + Math.sin(ang - half) * reach };
  const coneB = { x: cam.pos.x + Math.cos(ang + half) * reach, y: cam.pos.y + Math.sin(ang + half) * reach };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${map.widthM} ${map.heightM}`}
      className={className}
      style={{ touchAction: 'none' }}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
    >
      <MapGeometry map={map} />
      <path
        d={`M ${cam.pos.x} ${cam.pos.y} L ${coneA.x} ${coneA.y} L ${coneB.x} ${coneB.y} Z`}
        fill="var(--color-amber-400)"
        fillOpacity={0.14}
        stroke="var(--color-amber-400)"
        strokeOpacity={0.3}
        strokeWidth={0.03}
      />
      {marks.map((m, i) => (
        <CharacterToken key={m.characterId} mark={m} character={characters.find((c) => c.id === m.characterId)} index={i} />
      ))}
      <line x1={cam.pos.x} y1={cam.pos.y} x2={target.x} y2={target.y} stroke="var(--color-amber-400)" strokeWidth={0.03} strokeDasharray="0.1,0.1" />
      <circle
        cx={target.x}
        cy={target.y}
        r={0.18}
        fill="none"
        stroke="var(--color-amber-300)"
        strokeWidth={0.05}
        onPointerDown={startDrag('target')}
        className={interactive ? 'cursor-grab active:cursor-grabbing' : undefined}
      />
      <g onPointerDown={startDrag('pos')} className={interactive ? 'cursor-grab active:cursor-grabbing' : undefined}>
        <circle cx={cam.pos.x} cy={cam.pos.y} r={0.28} fill="var(--color-amber-400)" stroke="#000" strokeWidth={0.03} />
        <path
          d={`M ${cam.pos.x - 0.1} ${cam.pos.y - 0.1} L ${cam.pos.x + 0.1} ${cam.pos.y - 0.1} L ${cam.pos.x} ${cam.pos.y + 0.12} Z`}
          fill="#000"
          transform={`rotate(${(ang * 180) / Math.PI + 90} ${cam.pos.x} ${cam.pos.y})`}
        />
      </g>
    </svg>
  );
}

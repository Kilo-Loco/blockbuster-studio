import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  MousePointer2,
  Minus,
  Square,
  Circle as CircleIcon,
  DoorOpen,
  RectangleHorizontal,
  Tag,
  Trash2,
  Undo2,
  Redo2,
  Upload,
  Star,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { api, mediaUrl } from '../../lib/api';
import { IconButton, Tooltip } from '../ui';
import type { ID, LocationMap, MapElement, MapElementType, Vec2 } from '@shared/types';

const PPM = 40; // pixels per meter at zoom 1
const FOV_DEG = 60;

type Tool = 'select' | MapElementType;

const TOOLS: { id: Tool; icon: typeof MousePointer2; label: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Select / move' },
  { id: 'wall', icon: Minus, label: 'Wall' },
  { id: 'door', icon: DoorOpen, label: 'Door' },
  { id: 'window', icon: RectangleHorizontal, label: 'Window' },
  { id: 'rect', icon: Square, label: 'Prop (rectangle)' },
  { id: 'circle', icon: CircleIcon, label: 'Prop (circle)' },
  { id: 'zone', icon: Square, label: 'Zone' },
  { id: 'label', icon: Tag, label: 'Label' },
];

const ELEMENT_COLORS: Record<MapElementType, string> = {
  wall: '#c9c9d1',
  door: '#f5a524',
  window: '#5cc8ff',
  rect: '#93939e',
  circle: '#93939e',
  zone: '#8b7bff',
  label: '#f5f5f7',
};

function newId(): ID {
  return Math.random().toString(36).slice(2, 10);
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}
function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

type Drag =
  | { kind: 'pan'; startClient: { x: number; y: number }; startPan: Vec2 }
  | { kind: 'element-move'; id: ID; startPointer: Vec2; startPoints: Vec2[] }
  | { kind: 'subject-move'; startPointer: Vec2; startPos: Vec2 }
  | { kind: 'camera-move'; startPointer: Vec2; startPos: Vec2 }
  | { kind: 'camera-target-move'; startPointer: Vec2; startPos: Vec2 }
  | { kind: 'rect-draw'; type: 'rect' | 'zone'; start: Vec2 }
  | { kind: 'circle-draw'; center: Vec2 };

export function MapEditor({
  locationId,
  initialMap,
  onSave,
}: {
  locationId: ID;
  initialMap: LocationMap;
  onSave: (map: LocationMap) => void;
}) {
  const [map, setMap] = useState<LocationMap>(initialMap);
  const [history, setHistory] = useState<LocationMap[]>([initialMap]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [tool, setTool] = useState<Tool>('select');
  const [selectedId, setSelectedId] = useState<ID | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Vec2>({ x: 0, y: 0 });
  const [drawPoints, setDrawPoints] = useState<Vec2[]>([]); // click-click wall/door/window
  const [drawPreview, setDrawPreview] = useState<Vec2 | null>(null);
  const [cursorPos, setCursorPos] = useState<Vec2 | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const spaceDownRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const vw = map.widthM * PPM;
  const vh = map.heightM * PPM;

  const { data: bgAsset } = useQuery({
    queryKey: ['asset', map.backgroundAssetId],
    queryFn: () => api.asset(map.backgroundAssetId!),
    enabled: !!map.backgroundAssetId,
  });

  const uploadBgMut = useMutation({
    mutationFn: (file: File) => api.upload(file),
    onSuccess: (asset) => commit({ ...map, backgroundAssetId: asset.id }),
  });

  const scheduleSave = useCallback(
    (next: LocationMap) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => onSave(next), 600);
    },
    [onSave],
  );

  const commit = useCallback(
    (next: LocationMap) => {
      setMap(next);
      setHistory((h) => [...h.slice(0, historyIndex + 1), next]);
      setHistoryIndex((i) => i + 1);
      scheduleSave(next);
    },
    [historyIndex, scheduleSave],
  );

  const undo = useCallback(() => {
    setHistoryIndex((i) => {
      const ni = Math.max(0, i - 1);
      const m = history[ni];
      if (m) {
        setMap(m);
        scheduleSave(m);
      }
      return ni;
    });
  }, [history, scheduleSave]);

  const redo = useCallback(() => {
    setHistoryIndex((i) => {
      const ni = Math.min(history.length - 1, i + 1);
      const m = history[ni];
      if (m) {
        setMap(m);
        scheduleSave(m);
      }
      return ni;
    });
  }, [history, scheduleSave]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space') spaceDownRef.current = true;
      const meta = e.metaKey || e.ctrlKey;
      const inField = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA';
      if (inField) return;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        commit({ ...map, elements: map.elements.filter((el) => el.id !== selectedId) });
        setSelectedId(null);
      } else if (e.key === 'Escape') {
        setDrawPoints([]);
        setSelectedId(null);
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') spaceDownRef.current = false;
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [map, selectedId, undo, redo, commit]);

  function toViewBox(clientX: number, clientY: number): Vec2 {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * vw, y: ((clientY - rect.top) / rect.height) * vh };
  }

  function toLocal(clientX: number, clientY: number): Vec2 {
    const v = toViewBox(clientX, clientY);
    return { x: (v.x - pan.x) / zoom / PPM, y: (v.y - pan.y) / zoom / PPM };
  }

  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const v = toViewBox(e.clientX, e.clientY);
    const cx = (v.x - pan.x) / zoom;
    const cy = (v.y - pan.y) / zoom;
    const nextZoom = Math.min(3, Math.max(0.4, zoom * (1 - e.deltaY * 0.0015)));
    setPan({ x: v.x - cx * nextZoom, y: v.y - cy * nextZoom });
    setZoom(nextZoom);
  }

  function onBackgroundPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || (tool === 'select' && spaceDownRef.current)) {
      dragRef.current = { kind: 'pan', startClient: { x: e.clientX, y: e.clientY }, startPan: pan };
      return;
    }
    const pt = toLocal(e.clientX, e.clientY);
    if (tool === 'select') {
      setSelectedId(null);
      return;
    }
    if (tool === 'wall' || tool === 'door' || tool === 'window') {
      if (drawPoints.length === 0) {
        setDrawPoints([pt]);
      } else {
        const el: MapElement = { id: newId(), type: tool, points: [drawPoints[0]!, pt], color: ELEMENT_COLORS[tool] };
        commit({ ...map, elements: [...map.elements, el] });
        setDrawPoints([]);
        setDrawPreview(null);
      }
      return;
    }
    if (tool === 'rect' || tool === 'zone') {
      dragRef.current = { kind: 'rect-draw', type: tool, start: pt };
      return;
    }
    if (tool === 'circle') {
      dragRef.current = { kind: 'circle-draw', center: pt };
      return;
    }
    if (tool === 'label') {
      const el: MapElement = { id: newId(), type: 'label', points: [pt], label: 'Label', color: ELEMENT_COLORS.label };
      commit({ ...map, elements: [...map.elements, el] });
      setSelectedId(el.id);
      setTool('select');
      return;
    }
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const pt = toLocal(e.clientX, e.clientY);
    setCursorPos(pt);
    if (drawPoints.length === 1) setDrawPreview(pt);

    const d = dragRef.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const dx = e.clientX - d.startClient.x;
      const dy = e.clientY - d.startClient.y;
      const rect = svgRef.current!.getBoundingClientRect();
      setPan({ x: d.startPan.x + (dx / rect.width) * vw, y: d.startPan.y + (dy / rect.height) * vh });
      return;
    }
    if (d.kind === 'element-move') {
      const delta = sub(pt, d.startPointer);
      setMap((m) => ({
        ...m,
        elements: m.elements.map((el) => (el.id === d.id ? { ...el, points: d.startPoints.map((p) => add(p, delta)) } : el)),
      }));
      return;
    }
    if (d.kind === 'subject-move') {
      const delta = sub(pt, d.startPointer);
      setMap((m) => ({ ...m, subject: add(d.startPos, delta) }));
      return;
    }
    if (d.kind === 'camera-move') {
      const delta = sub(pt, d.startPointer);
      setMap((m) => ({ ...m, referenceCamera: { ...m.referenceCamera, pos: add(d.startPos, delta) } }));
      return;
    }
    if (d.kind === 'camera-target-move') {
      const delta = sub(pt, d.startPointer);
      setMap((m) => ({ ...m, referenceCamera: { ...m.referenceCamera, target: add(d.startPos, delta) } }));
      return;
    }
    if (d.kind === 'rect-draw') {
      setDrawPreview(pt);
      return;
    }
    if (d.kind === 'circle-draw') {
      setDrawPreview(pt);
      return;
    }
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.kind === 'pan') return;
    const pt = toLocal(e.clientX, e.clientY);
    if (d.kind === 'element-move' || d.kind === 'subject-move' || d.kind === 'camera-move' || d.kind === 'camera-target-move') {
      commit(map);
      return;
    }
    if (d.kind === 'rect-draw') {
      setDrawPreview(null);
      if (Math.hypot(pt.x - d.start.x, pt.y - d.start.y) < 0.05) return;
      const el: MapElement = { id: newId(), type: d.type, points: [d.start, pt], color: ELEMENT_COLORS[d.type] };
      commit({ ...map, elements: [...map.elements, el] });
      return;
    }
    if (d.kind === 'circle-draw') {
      setDrawPreview(null);
      if (Math.hypot(pt.x - d.center.x, pt.y - d.center.y) < 0.05) return;
      const el: MapElement = { id: newId(), type: 'circle', points: [d.center, pt], color: ELEMENT_COLORS.circle };
      commit({ ...map, elements: [...map.elements, el] });
      return;
    }
  }

  function startElementDrag(e: React.PointerEvent, el: MapElement) {
    if (tool !== 'select') return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setSelectedId(el.id);
    dragRef.current = { kind: 'element-move', id: el.id, startPointer: toLocal(e.clientX, e.clientY), startPoints: el.points.map((p) => ({ ...p })) };
  }

  function startSubjectDrag(e: React.PointerEvent) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { kind: 'subject-move', startPointer: toLocal(e.clientX, e.clientY), startPos: { ...map.subject } };
  }
  function startCameraDrag(e: React.PointerEvent) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { kind: 'camera-move', startPointer: toLocal(e.clientX, e.clientY), startPos: { ...map.referenceCamera.pos } };
  }
  function startCameraTargetDrag(e: React.PointerEvent) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const target = map.referenceCamera.target ?? map.subject;
    dragRef.current = { kind: 'camera-target-move', startPointer: toLocal(e.clientX, e.clientY), startPos: { ...target } };
  }

  const selected = useMemo(() => map.elements.find((el) => el.id === selectedId) ?? null, [map.elements, selectedId]);

  function updateSelected(patch: Partial<MapElement>) {
    if (!selected) return;
    commit({ ...map, elements: map.elements.map((el) => (el.id === selected.id ? { ...el, ...patch } : el)) });
  }

  const camTarget = map.referenceCamera.target ?? map.subject;
  const camDir = Math.atan2(camTarget.y - map.referenceCamera.pos.y, camTarget.x - map.referenceCamera.pos.x);
  const coneLen = Math.max(1.5, Math.hypot(camTarget.x - map.referenceCamera.pos.x, camTarget.y - map.referenceCamera.pos.y) * 1.15);
  const half = (FOV_DEG / 2 / 180) * Math.PI;
  const coneA = { x: map.referenceCamera.pos.x + coneLen * Math.cos(camDir - half), y: map.referenceCamera.pos.y + coneLen * Math.sin(camDir - half) };
  const coneB = { x: map.referenceCamera.pos.x + coneLen * Math.cos(camDir + half), y: map.referenceCamera.pos.y + coneLen * Math.sin(camDir + half) };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const drag = dragRef.current;

  return (
    <div className="rounded-xl border border-[var(--color-hairline)] bg-[var(--color-bg-1)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-hairline)] px-3 py-2">
        <div className="flex items-center gap-0.5 rounded-lg bg-[var(--color-bg-2)] p-0.5">
          {TOOLS.map((t) => (
            <Tooltip key={t.id} label={t.label}>
              <IconButton
                icon={<t.icon className="size-4" />}
                label={t.label}
                size="sm"
                active={tool === t.id}
                onClick={() => {
                  setTool(t.id);
                  setDrawPoints([]);
                  setSelectedId(null);
                }}
              />
            </Tooltip>
          ))}
        </div>

        <div className="mx-1 h-5 w-px bg-[var(--color-hairline)]" />

        <Tooltip label="Undo (Cmd+Z)">
          <IconButton icon={<Undo2 className="size-4" />} label="Undo" size="sm" disabled={historyIndex === 0} onClick={undo} />
        </Tooltip>
        <Tooltip label="Redo (Cmd+Shift+Z)">
          <IconButton icon={<Redo2 className="size-4" />} label="Redo" size="sm" disabled={historyIndex >= history.length - 1} onClick={redo} />
        </Tooltip>

        <div className="mx-1 h-5 w-px bg-[var(--color-hairline)]" />

        <Tooltip label="Zoom out">
          <IconButton icon={<ZoomOut className="size-4" />} label="Zoom out" size="sm" onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))} />
        </Tooltip>
        <span className="chip-mono w-10 text-center text-xs text-[var(--color-ink-3)]">{Math.round(zoom * 100)}%</span>
        <Tooltip label="Zoom in">
          <IconButton icon={<ZoomIn className="size-4" />} label="Zoom in" size="sm" onClick={() => setZoom((z) => Math.min(3, z + 0.2))} />
        </Tooltip>

        <div className="mx-1 h-5 w-px bg-[var(--color-hairline)]" />

        <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-2)]">
          W
          <input
            type="number"
            min={1}
            value={map.widthM}
            onChange={(e) => commit({ ...map, widthM: Math.max(1, Number(e.target.value) || 1) })}
            className="w-14 rounded-md border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-1.5 py-1 text-xs text-[var(--color-ink-0)] outline-none"
          />
          m
        </label>
        <label className="flex items-center gap-1.5 text-xs text-[var(--color-ink-2)]">
          H
          <input
            type="number"
            min={1}
            value={map.heightM}
            onChange={(e) => commit({ ...map, heightM: Math.max(1, Number(e.target.value) || 1) })}
            className="w-14 rounded-md border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-1.5 py-1 text-xs text-[var(--color-ink-0)] outline-none"
          />
          m
        </label>

        <div className="mx-1 h-5 w-px bg-[var(--color-hairline)]" />

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadBgMut.mutate(f);
            e.target.value = '';
          }}
        />
        <Tooltip label="Upload floor plan background">
          <IconButton icon={<Upload className="size-4" />} label="Upload background" size="sm" onClick={() => fileInputRef.current?.click()} />
        </Tooltip>

        {selected && (
          <>
            <div className="mx-1 h-5 w-px bg-[var(--color-hairline)]" />
            <Tooltip label="Delete selected">
              <IconButton
                icon={<Trash2 className="size-4" />}
                label="Delete selected"
                size="sm"
                onClick={() => {
                  commit({ ...map, elements: map.elements.filter((el) => el.id !== selected.id) });
                  setSelectedId(null);
                }}
              />
            </Tooltip>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-b border-[var(--color-hairline)] px-3 py-2 text-xs text-[var(--color-ink-2)]">
        <Star className="size-3.5 shrink-0 text-[var(--color-amber-400)]" />
        <span>
          <strong className="text-[var(--color-ink-0)]">Establishing view.</strong> This is what the establishing image should see — align the reference camera and
          subject with your reference shot.
        </span>
      </div>

      <div ref={containerRef} className="relative w-full overflow-hidden" style={{ aspectRatio: `${map.widthM} / ${map.heightM}`, maxHeight: '60vh' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${vw} ${vh}`}
          className={clsx('block h-full w-full touch-none select-none bg-[var(--color-bg-0)]', tool === 'select' ? 'cursor-default' : 'cursor-crosshair')}
          onWheel={onWheel}
          onPointerDown={onBackgroundPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <defs>
            <pattern id="mgrid" width={PPM} height={PPM} patternUnits="userSpaceOnUse">
              <path d={`M ${PPM} 0 L 0 0 0 ${PPM}`} fill="none" stroke="rgb(255 255 255 / 0.06)" strokeWidth={1} />
            </pattern>
          </defs>

          <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
            {bgAsset && (
              <image href={mediaUrl(bgAsset.file)} x={0} y={0} width={vw} height={vh} preserveAspectRatio="none" opacity={0.65} />
            )}
            <rect x={0} y={0} width={vw} height={vh} fill="url(#mgrid)" />
            <rect x={0} y={0} width={vw} height={vh} fill="none" stroke="var(--color-hairline-strong)" strokeWidth={1.5} />

            {map.elements.map((el) => (
              <ElementShape key={el.id} el={el} selected={el.id === selectedId} onPointerDown={(e) => startElementDrag(e, el)} />
            ))}

            {/* in-progress draw preview */}
            {drawPoints.length === 1 && drawPreview && (
              <line
                x1={drawPoints[0]!.x * PPM}
                y1={drawPoints[0]!.y * PPM}
                x2={drawPreview.x * PPM}
                y2={drawPreview.y * PPM}
                stroke={ELEMENT_COLORS[tool as MapElementType] ?? '#fff'}
                strokeWidth={3}
                strokeDasharray="6 4"
              />
            )}
            {drag?.kind === 'rect-draw' && drawPreview && (
              <rect
                x={Math.min(drag.start.x, drawPreview.x) * PPM}
                y={Math.min(drag.start.y, drawPreview.y) * PPM}
                width={Math.abs(drawPreview.x - drag.start.x) * PPM}
                height={Math.abs(drawPreview.y - drag.start.y) * PPM}
                fill={drag.type === 'zone' ? 'rgb(139 123 255 / 0.2)' : 'rgb(255 255 255 / 0.08)'}
                stroke={ELEMENT_COLORS[drag.type]}
                strokeDasharray="4 3"
              />
            )}
            {drag?.kind === 'circle-draw' && drawPreview && (
              <circle
                cx={drag.center.x * PPM}
                cy={drag.center.y * PPM}
                r={Math.hypot(drawPreview.x - drag.center.x, drawPreview.y - drag.center.y) * PPM}
                fill="rgb(255 255 255 / 0.08)"
                stroke={ELEMENT_COLORS.circle}
                strokeDasharray="4 3"
              />
            )}

            {/* FOV cone */}
            <polygon
              points={`${map.referenceCamera.pos.x * PPM},${map.referenceCamera.pos.y * PPM} ${coneA.x * PPM},${coneA.y * PPM} ${coneB.x * PPM},${coneB.y * PPM}`}
              fill="rgb(245 165 36 / 0.14)"
              stroke="rgb(245 165 36 / 0.3)"
              strokeWidth={1}
            />

            {/* subject */}
            <g transform={`translate(${map.subject.x * PPM} ${map.subject.y * PPM})`} onPointerDown={startSubjectDrag} className="cursor-move">
              <circle r={14} fill="rgb(245 165 36 / 0.15)" />
              <path d="M0,-8 L2.3,-2.5 8,-2.5 3,1 4.9,7.5 0,3.8 -4.9,7.5 -3,1 -8,-2.5 -2.3,-2.5 Z" fill="var(--color-amber-400)" />
            </g>

            {/* reference camera target handle */}
            <line
              x1={map.referenceCamera.pos.x * PPM}
              y1={map.referenceCamera.pos.y * PPM}
              x2={camTarget.x * PPM}
              y2={camTarget.y * PPM}
              stroke="rgb(255 255 255 / 0.25)"
              strokeDasharray="3 3"
            />
            <g transform={`translate(${camTarget.x * PPM} ${camTarget.y * PPM})`} onPointerDown={startCameraTargetDrag} className="cursor-move">
              <circle r={5} fill="var(--color-bg-0)" stroke="rgb(255 255 255 / 0.5)" strokeWidth={1.5} />
            </g>

            {/* reference camera */}
            <g transform={`translate(${map.referenceCamera.pos.x * PPM} ${map.referenceCamera.pos.y * PPM})`} onPointerDown={startCameraDrag} className="cursor-move">
              <circle r={13} fill="rgb(92 200 255 / 0.15)" />
              <path d="M-7,-4 L-1,-4 0,-6 3,-6 4,-4 7,-4 7,5 -7,5 Z" fill="var(--color-blue-400, #5cc8ff)" />
              <circle cx={0} cy={0.5} r={2.3} fill="var(--color-bg-0)" />
            </g>
          </g>

          {/* scale bar (unscaled by pan, scaled by zoom only) */}
          <g transform={`translate(16 ${vh - 24})`}>
            <line x1={0} y1={0} x2={PPM * zoom} y2={0} stroke="var(--color-ink-1)" strokeWidth={2} />
            <line x1={0} y1={-4} x2={0} y2={4} stroke="var(--color-ink-1)" strokeWidth={2} />
            <line x1={PPM * zoom} y1={-4} x2={PPM * zoom} y2={4} stroke="var(--color-ink-1)" strokeWidth={2} />
            <text x={0} y={-8} fontSize={10} fill="var(--color-ink-2)">
              1 m
            </text>
          </g>
        </svg>

        {cursorPos && (
          <div className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/60 px-2 py-1 chip-mono text-[10px] text-[var(--color-ink-1)]">
            {cursorPos.x.toFixed(1)}, {cursorPos.y.toFixed(1)} m
          </div>
        )}
      </div>

      {selected && (
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-hairline)] px-3 py-2.5">
          <span className="text-xs text-[var(--color-ink-2)]">{selected.type}</span>
          <input
            value={selected.label ?? ''}
            onChange={(e) => updateSelected({ label: e.target.value })}
            placeholder="Label"
            className="min-w-0 flex-1 rounded-md border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-2.5 py-1.5 text-xs text-[var(--color-ink-0)] outline-none focus:border-[var(--color-amber-400)]/50"
          />
          <input
            type="color"
            value={selected.color ?? '#ffffff'}
            onChange={(e) => updateSelected({ color: e.target.value })}
            className="size-7 shrink-0 cursor-pointer rounded-md border border-[var(--color-hairline)] bg-transparent"
          />
          <IconButton
            icon={<Trash2 className="size-4" />}
            label="Delete element"
            size="sm"
            onClick={() => {
              commit({ ...map, elements: map.elements.filter((el) => el.id !== selected.id) });
              setSelectedId(null);
            }}
          />
        </div>
      )}
    </div>
  );
}

function ElementShape({ el, selected, onPointerDown }: { el: MapElement; selected: boolean; onPointerDown: (e: React.PointerEvent) => void }) {
  const color = el.color ?? '#93939e';
  const stroke = selected ? 'var(--color-amber-400)' : color;
  const p0 = el.points[0];
  if (!p0) return null;

  if (el.type === 'wall' || el.type === 'door' || el.type === 'window') {
    const p1 = el.points[1] ?? p0;
    return (
      <g onPointerDown={onPointerDown} className="cursor-move">
        <line
          x1={p0.x * PPM}
          y1={p0.y * PPM}
          x2={p1.x * PPM}
          y2={p1.y * PPM}
          stroke="transparent"
          strokeWidth={14}
        />
        <line
          x1={p0.x * PPM}
          y1={p0.y * PPM}
          x2={p1.x * PPM}
          y2={p1.y * PPM}
          stroke={stroke}
          strokeWidth={el.type === 'wall' ? 5 : 3.5}
          strokeDasharray={el.type === 'door' ? '2 4' : el.type === 'window' ? '8 4' : undefined}
          strokeLinecap="round"
        />
        {el.label && (
          <text x={((p0.x + p1.x) / 2) * PPM} y={((p0.y + p1.y) / 2) * PPM - 6} fontSize={10} textAnchor="middle" fill="var(--color-ink-1)">
            {el.label}
          </text>
        )}
      </g>
    );
  }
  if (el.type === 'rect' || el.type === 'zone') {
    const p1 = el.points[1] ?? p0;
    const x = Math.min(p0.x, p1.x) * PPM;
    const y = Math.min(p0.y, p1.y) * PPM;
    const w = Math.abs(p1.x - p0.x) * PPM;
    const h = Math.abs(p1.y - p0.y) * PPM;
    return (
      <g onPointerDown={onPointerDown} className="cursor-move">
        <rect x={x} y={y} width={w} height={h} fill={el.type === 'zone' ? `${color}33` : `${color}22`} stroke={stroke} strokeWidth={selected ? 2.5 : 1.5} />
        {el.label && (
          <text x={x + w / 2} y={y + h / 2} fontSize={10} textAnchor="middle" fill="var(--color-ink-1)">
            {el.label}
          </text>
        )}
      </g>
    );
  }
  if (el.type === 'circle') {
    const p1 = el.points[1] ?? p0;
    const r = Math.hypot(p1.x - p0.x, p1.y - p0.y) * PPM;
    return (
      <g onPointerDown={onPointerDown} className="cursor-move">
        <circle cx={p0.x * PPM} cy={p0.y * PPM} r={r} fill={`${color}22`} stroke={stroke} strokeWidth={selected ? 2.5 : 1.5} />
        {el.label && (
          <text x={p0.x * PPM} y={p0.y * PPM} fontSize={10} textAnchor="middle" fill="var(--color-ink-1)">
            {el.label}
          </text>
        )}
      </g>
    );
  }
  // label
  return (
    <g transform={`translate(${p0.x * PPM} ${p0.y * PPM})`} onPointerDown={onPointerDown} className="cursor-move">
      <circle r={3} fill={stroke} />
      <text x={8} y={4} fontSize={12} fill={selected ? 'var(--color-amber-400)' : 'var(--color-ink-0)'}>
        {el.label || 'Label'}
      </text>
    </g>
  );
}

import { AZIMUTHS, ELEVATIONS, DISTANCES, anglePrompt } from '@shared/camera';
import type { AngleSpec, Azimuth, Elevation, Distance } from '@shared/types';
import { Segmented } from '../ui';

const AZIMUTH_LABELS: Record<Azimuth, string> = {
  'front view': 'Front',
  'front-right quarter view': 'Front-right',
  'right side view': 'Right',
  'back-right quarter view': 'Back-right',
  'back view': 'Back',
  'back-left quarter view': 'Back-left',
  'left side view': 'Left',
  'front-left quarter view': 'Front-left',
};

const ELEVATION_LABELS: Record<Elevation, string> = {
  'low-angle shot': 'Low',
  'eye-level shot': 'Eye-level',
  'elevated shot': 'Elevated',
  'high-angle shot': 'High',
};

const DISTANCE_LABELS: Record<Distance, string> = {
  'close-up': 'Close-up',
  'medium shot': 'Medium',
  'wide shot': 'Wide',
};

/** Orbit dial: 8 dots around a circle, azimuth 0 = top (front), clockwise. */
export function AnglePicker({ value, onChange }: { value: AngleSpec; onChange: (v: AngleSpec) => void }) {
  const size = 160;
  const center = size / 2;
  const r = size / 2 - 20;

  return (
    <div className="space-y-3">
      <div className="flex justify-center">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={center} cy={center} r={r} fill="none" stroke="var(--color-hairline)" strokeWidth={1} />
          <circle cx={center} cy={center} r={3} fill="var(--color-ink-3)" />
          {AZIMUTHS.map((az, i) => {
            const deg = i * 45;
            const rad = ((deg - 90) * Math.PI) / 180;
            const x = center + r * Math.cos(rad);
            const y = center + r * Math.sin(rad);
            const active = value.azimuth === az;
            return (
              <g key={az} onClick={() => onChange({ ...value, azimuth: az })} className="cursor-pointer">
                <circle cx={x} cy={y} r={active ? 9 : 7} fill={active ? 'var(--color-amber-400)' : 'var(--color-bg-3)'} stroke="var(--color-hairline-strong)" strokeWidth={1} />
                <title>{AZIMUTH_LABELS[az]}</title>
              </g>
            );
          })}
          <text x={center} y={16} textAnchor="middle" fontSize={9} fill="var(--color-ink-3)">
            FRONT
          </text>
        </svg>
      </div>
      <div className="text-center text-xs text-[var(--color-ink-2)]">{AZIMUTH_LABELS[value.azimuth]}</div>

      <div>
        <div className="mb-1 text-xs font-medium text-[var(--color-ink-2)]">Elevation</div>
        <Segmented
          size="sm"
          options={ELEVATIONS.map((e) => ({ value: e, label: ELEVATION_LABELS[e] }))}
          value={value.elevation}
          onChange={(elevation) => onChange({ ...value, elevation })}
        />
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-[var(--color-ink-2)]">Distance</div>
        <Segmented
          size="sm"
          options={DISTANCES.map((d) => ({ value: d, label: DISTANCE_LABELS[d] }))}
          value={value.distance}
          onChange={(distance) => onChange({ ...value, distance })}
        />
      </div>

      <span className="chip-mono block truncate rounded-lg bg-[var(--color-bg-2)] px-2.5 py-1.5 text-[var(--color-ink-2)]">{anglePrompt(value)}</span>
    </div>
  );
}

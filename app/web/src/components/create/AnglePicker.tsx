import { clsx } from 'clsx';
import { Camera } from 'lucide-react';
import type { Azimuth, Distance, Elevation } from '@shared/types';
import { AZIMUTHS, DISTANCES, ELEVATIONS, anglePrompt } from '@shared/camera';
import { Segmented } from '../ui';

export interface AnglePickerValue {
  azimuth: string;
  elevation: string;
  distance: string;
}

export function AnglePicker({
  value,
  onChange,
}: {
  value: AnglePickerValue;
  onChange: (patch: Partial<AnglePickerValue>) => void;
}) {
  const size = 152;
  const center = size / 2;
  const r = size / 2 - 20;
  const dotSize = 22;

  return (
    <div className="flex flex-col items-center gap-3 py-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        <circle cx={center} cy={center} r={r} fill="none" stroke="var(--color-hairline)" strokeWidth={1} />
        <circle cx={center} cy={center} r={2.5} fill="var(--color-ink-3)" />
        {AZIMUTHS.map((az, i) => {
          const deg = -90 + i * 45;
          const rad = (deg * Math.PI) / 180;
          const x = center + r * Math.cos(rad);
          const y = center + r * Math.sin(rad);
          const active = az === value.azimuth;
          return (
            <foreignObject key={az} x={x - dotSize / 2} y={y - dotSize / 2} width={dotSize} height={dotSize}>
              <button
                type="button"
                title={az}
                onClick={() => onChange({ azimuth: az })}
                className={clsx(
                  'flex size-full items-center justify-center rounded-full border transition-colors',
                  active
                    ? 'border-[var(--color-amber-400)] bg-[var(--color-amber-400)] text-black'
                    : 'border-[var(--color-hairline-strong)] bg-[var(--color-bg-2)] text-[var(--color-ink-2)] hover:text-[var(--color-ink-0)]',
                )}
              >
                <Camera className="size-3" />
              </button>
            </foreignObject>
          );
        })}
      </svg>

      <Segmented
        size="sm"
        options={ELEVATIONS.map((e) => ({ value: e, label: shorten(e) }))}
        value={value.elevation}
        onChange={(v) => onChange({ elevation: v })}
      />
      <Segmented
        size="sm"
        options={DISTANCES.map((d) => ({ value: d, label: shorten(d) }))}
        value={value.distance}
        onChange={(v) => onChange({ distance: v })}
      />

      <span className="chip-mono max-w-full truncate rounded-full border border-[var(--color-hairline)] bg-[var(--color-bg-2)] px-2.5 py-1 text-[var(--color-ink-2)]">
        {anglePrompt({
          azimuth: value.azimuth as Azimuth,
          elevation: value.elevation as Elevation,
          distance: value.distance as Distance,
        })}
      </span>
    </div>
  );
}

function shorten(s: string) {
  return s.replace(' shot', '').replace('-angle', '').replace('view', '').trim() || s;
}

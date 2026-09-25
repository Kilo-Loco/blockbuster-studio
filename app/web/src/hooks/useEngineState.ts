// Reads engine availability from the same /api/system query used elsewhere (system info banner,
// composer readiness, etc.) and exposes small helpers so call sites don't re-derive engineState logic.
import { useQuery } from '@tanstack/react-query';
import type { EngineId, EngineState } from '@shared/types';
import { api } from '../lib/api';

const EMPTY_ENGINE_STATE = {} as Record<EngineId, EngineState>;

export function useEngineState() {
  const { data: system } = useQuery({ queryKey: ['system'], queryFn: api.system, refetchInterval: 10_000 });
  const engineState = system?.engineState ?? EMPTY_ENGINE_STATE;

  /** Not part of this pod's install preset — hide the feature entirely. Defaults to false until loaded. */
  function isOff(engine: EngineId): boolean {
    return engineState[engine] === 'off';
  }
  /** Fully usable. */
  function isReady(engine: EngineId): boolean {
    return engineState[engine] === 'ready';
  }
  /** In the install plan but model weights aren't fetched yet. */
  function isDownloading(engine: EngineId): boolean {
    return engineState[engine] === 'downloading';
  }
  /** True unless every given engine is 'off' (useful for features backed by more than one engine). */
  function anyEnabled(engines: EngineId[]): boolean {
    return engines.some((e) => !isOff(e));
  }

  return { system, engineState, isOff, isReady, isDownloading, anyEnabled };
}

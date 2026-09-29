// 'scene_reference_sheet' job: composites the scene's cast (characters + props) and location into one
// Ingredients reference sheet image (docs/research/2026-09-ltx-best-practices.md: "one composite reference
// sheet on black, no text, big panels"), and writes the two-part prompt's "Reference sheet: …" description.
// The layout/description logic is split into pure functions (layoutReferenceSheet / describeReferenceSheet) so
// it's testable without ffmpeg or a database.
import { registerRunner } from './queue';
import { assets as assetsRepo, characters as charactersRepo, locations as locationsRepo, scenes as scenesRepo, shots as shotsRepo } from '../db';
import { emit } from '../events';
import { assetDiskPath, composeReferenceSheetImage, saveAsset } from './media';
import type { Character, ID } from '../../shared/types';

export type SheetPanelKind = 'face' | 'turnaround' | 'prop' | 'location';

export interface SheetPanel {
  /** The character/prop id, or '__location__'. */
  ownerId: ID;
  kind: SheetPanelKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetRow {
  panels: SheetPanel[];
}

export interface ReferenceSheetLayout {
  rows: SheetRow[];
  panels: SheetPanel[];
}

/** Pure panel geometry: one full-width row per character (face + turnaround side by side, biggest panels on
 *  the sheet — "characters get the biggest panels"), then one shared bottom row for props and the location
 *  plate, smaller. A character with only one of face/turnaround gets that panel full width. */
export function layoutReferenceSheet(
  input: {
    characters: { id: ID; face: boolean; turnaround: boolean }[];
    props: { id: ID }[];
    location: boolean;
  },
  width: number,
  height: number,
): ReferenceSheetLayout {
  const rows: SheetRow[] = [];
  const chars = input.characters;
  const hasBottomRow = input.props.length > 0 || input.location;
  const bottomH = hasBottomRow ? Math.round(height * 0.28) : 0;
  const charAreaH = height - bottomH;
  const charRowH = chars.length ? Math.floor(charAreaH / chars.length) : 0;

  chars.forEach((c, i) => {
    const y = i * charRowH;
    const h = i === chars.length - 1 ? charAreaH - charRowH * (chars.length - 1) : charRowH;
    const panels: SheetPanel[] = [];
    if (c.face && c.turnaround) {
      const faceW = Math.round(width / 3);
      panels.push({ ownerId: c.id, kind: 'face', x: 0, y, w: faceW, h });
      panels.push({ ownerId: c.id, kind: 'turnaround', x: faceW, y, w: width - faceW, h });
    } else if (c.face) {
      panels.push({ ownerId: c.id, kind: 'face', x: 0, y, w: width, h });
    } else if (c.turnaround) {
      panels.push({ ownerId: c.id, kind: 'turnaround', x: 0, y, w: width, h });
    }
    if (panels.length) rows.push({ panels });
  });

  if (hasBottomRow) {
    const items: { ownerId: ID; kind: SheetPanelKind }[] = [
      ...input.props.map((p) => ({ ownerId: p.id, kind: 'prop' as const })),
      ...(input.location ? [{ ownerId: '__location__', kind: 'location' as const }] : []),
    ];
    const n = items.length;
    const colW = n ? Math.floor(width / n) : width;
    const panels = items.map((item, i) => ({
      ownerId: item.ownerId,
      kind: item.kind,
      x: i * colW,
      y: charAreaH,
      w: i === n - 1 ? width - colW * (n - 1) : colW,
      h: bottomH,
    }));
    rows.push({ panels });
  }

  return { rows, panels: rows.flatMap((r) => r.panels) };
}

const ROW_WORD = (index: number, total: number) => (total === 1 ? 'Top row' : index === 0 ? 'Top row' : index === total - 1 ? 'Bottom row' : `Row ${index + 1}`);
const COL_WORD = (index: number, total: number) => (total === 1 ? '' : total === 2 ? (index === 0 ? 'left' : 'right') : total === 3 ? ['left', 'middle', 'right'][index]! : `position ${index + 1}`);

/** "Top row left: … Top row middle: …" per panel, from a caller-supplied description per (ownerId, kind). */
export function describeReferenceSheet(layout: ReferenceSheetLayout, describe: (ownerId: ID, kind: SheetPanelKind) => string): string {
  return layout.rows
    .map((row, ri) => {
      const rowWord = ROW_WORD(ri, layout.rows.length);
      return row.panels
        .map((p, ci) => {
          const col = COL_WORD(ci, row.panels.length);
          const label = col ? `${rowWord} ${col}` : rowWord;
          return `${label}: ${describe(p.ownerId, p.kind)}.`;
        })
        .join(' ');
    })
    .join(' ');
}

function panelDescription(kind: SheetPanelKind, name: string, description: string): string {
  switch (kind) {
    case 'face':
      return `${name}, face close-up; ${description}`;
    case 'turnaround':
      return `${name}, four-view turnaround; ${description}`;
    case 'prop':
      return `${name}; ${description}`;
    case 'location':
      return `${name}, establishing plate; ${description}`;
  }
}

/** ~16:9 canvas size for the composite (matches the tested Coast Road sheet). */
export const SHEET_WIDTH = 1792;
export const SHEET_HEIGHT = 1008;

registerRunner('scene_reference_sheet', async (job, ctx) => {
  const params = job.params as { sceneId?: string };
  const sceneId = String(params.sceneId ?? '');
  const scene = scenesRepo.get(sceneId);
  if (!scene) throw new Error('Scene not found');
  const shots = shotsRepo.listByScene(sceneId);
  const castIds = [...new Set(shots.flatMap((s) => s.characterIds))];
  const cast = castIds.map((id) => charactersRepo.get(id)).filter((c): c is Character => Boolean(c));
  const people = cast.filter((c) => (c.kind ?? 'person') !== 'prop');
  const props = cast.filter((c) => (c.kind ?? 'person') === 'prop');
  const location = scene.locationId ? locationsRepo.get(scene.locationId) : undefined;

  const assetPathFor = (id: ID | undefined): string | undefined => {
    if (!id) return undefined;
    const a = assetsRepo.get(id);
    return a ? assetDiskPath(a) : undefined;
  };
  // Sheet-ready assets first; a character without one falls back to referenceAssetIds[0] (whatever exists).
  const facePathFor = (c: Character) => assetPathFor(c.sheetAssets?.face) ?? assetPathFor(c.referenceAssetIds[0]);
  const turnaroundPathFor = (c: Character) => assetPathFor(c.sheetAssets?.turnaround) ?? assetPathFor(c.referenceAssetIds[0]);

  const layout = layoutReferenceSheet(
    {
      characters: people.map((c) => ({ id: c.id, face: Boolean(facePathFor(c)), turnaround: Boolean(turnaroundPathFor(c)) })),
      props: props.map((c) => ({ id: c.id })),
      location: Boolean(assetPathFor(location?.establishingAssetId)),
    },
    SHEET_WIDTH,
    SHEET_HEIGHT,
  );

  const byId = new Map(cast.map((c) => [c.id, c]));
  const pathFor = (p: SheetPanel): string | undefined => {
    if (p.kind === 'location') return assetPathFor(location?.establishingAssetId);
    const c = byId.get(p.ownerId);
    if (!c) return undefined;
    return p.kind === 'face' ? facePathFor(c) : p.kind === 'turnaround' ? turnaroundPathFor(c) : assetPathFor(c.referenceAssetIds[0]);
  };

  ctx.setProgress(0.2, 'Compositing reference sheet');
  const bytes = await composeReferenceSheetImage(
    layout.panels.map((p) => ({ path: pathFor(p), x: p.x, y: p.y, w: p.w, h: p.h })),
    SHEET_WIDTH,
    SHEET_HEIGHT,
  );

  const describe = (ownerId: ID, kind: SheetPanelKind): string => {
    if (kind === 'location') return panelDescription('location', location?.name ?? 'the location', location?.description ?? '');
    const c = byId.get(ownerId);
    return panelDescription(kind, c?.name ?? 'unknown', c?.description ?? '');
  };
  const referenceSheetText = describeReferenceSheet(layout, describe);

  const asset = await saveAsset({ kind: 'image', origin: 'generated', ext: 'png', bytes, prompt: referenceSheetText, params: { sceneId }, jobId: job.id, projectId: scene.projectId });
  ctx.addOutput(asset.id);
  const updated = scenesRepo.update(sceneId, { referenceSheetAssetId: asset.id, referenceSheetText });
  if (updated) emit({ type: 'scene', scene: updated });
  ctx.setProgress(1, 'Done');
});

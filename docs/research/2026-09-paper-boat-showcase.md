# "Paper Boat": a 20-second showcase made with Blender previs + Blockbuster Studio (2026-09-27)

Goal: one 20 s film that shows the range of what the studio can generate (six visual mediums) while
telling one continuous story, made the way the previs workflow in `docs/plans/2026-09-blender-previs.md`
prescribes: structure locked in Blender, style chosen per shot, everything rendered on one pod.

## The film
Logline: on a rainy night a girl lets a red paper boat go in a gutter stream and chases it down the street;
each stretch of the chase is drawn by a different hand; she catches it at the storm drain.

| # | cut | medium | camera (from the blockout) | model, size |
|---|---|---|---|---|
| 1 | 3.5 s | live action, 35 mm anamorphic | gutter-level low angle, hold then push-in | H3, 1280×736, first frame only |
| 2 | 3 s | hand-drawn anime | tracking alongside the gutter | H3, first + last frame |
| 3 | 3 s | stop-motion claymation | locked off, tilt down over the drop | H3, first + last frame |
| 4 | 3 s | ink and watercolour | top-down quarter orbit, hand reaches in | H3, first + last frame |
| 5 | 3 s | toy-box CG | handheld pedestal up with her hands | H3, first + last frame |
| 6 | 4.5 s | live action (bookend) | medium close-up, slow pull-out to a wide | H3, first frame only |

Constants in every prompt: the same character paragraph (ten-year-old, black bob, yellow hooded raincoat,
red boots), the same prop (a palm-sized red paper boat), the same world (night, rain, sloping street,
stone gutter, sodium lamps), the same sound and music lines.

## Pipeline, as run
1. **Bible** (story, constants, shot table) → **Blender** `build.py` (headless, ~50 s): gray-box street,
   yellow mannequin with a baked run and per-shot poses, red boat on the water, six cameras with Track-To
   targets bound to timeline markers, 624 frames at 24 fps. Outputs: playblast, per-shot first/last
   frames, depth pass, contact sheet, `camera_log.json` (per-second camera + beat descriptions).
2. **Character reference sheet**: 4 Z-Image references from the description (`POST /api/characters/:id/references`).
3. **Keyframes**: each blockout first/last frame → Qwen-Image-Edit with the reference sheet as image 2
   and a "turn this gray blockout into <style>, keep the exact composition" prompt. 12 frames plus 3 rounds
   of fixes (see lessons). The Blender composition survived in every accepted frame.
4. **Clips**: shot pipeline (`POST /api/shots/:id/video`) with `quality: "hd"`, `videoModel: "minimax_h3"`,
   `endKeyframeAssetId` on shots 2–5, and an H3-structured motion prompt written from `camera_log.json`.
   RTX PRO 4500 Blackwell (32 GB): ~4 min per 4–5 s HD clip, 8 clips in all (2 retakes).
5. **Cut**: ffmpeg, hard video cuts at the bible lengths, each clip's own H3 audio overlapped 0.6 s across
   the cuts, loudness-matched, fade in/out. 20.0 s, 1280×720, AAC.

## What we learned
- **The blockout → Qwen-Edit restyle is the workhorse.** It held camera angle, lens, positions and sizes
  across all six mediums. Wording matters: "the yellow mannequin is Juno …" gives a real character;
  naming the figure literally keeps the cone hood and sphere head. Every gray shape needs a name or it
  becomes something random. Repeating the prop noun ("boat") three times, or adding "no other boats",
  produced ships and rowboats in the background; one mention plus "the street is empty apart from…" fixed it.
- **First + last frame on H3** locks moderate moves (tracking, tilt, orbit, pedestal) and the end
  composition. For a **big move** (push-in that ends on a different framing, pull-out to a wide) H3
  jumped between the two compositions at mid-clip and briefly doubled the boat; the same shots without the
  end frame gave a clean continuous move. Rule: end frame when the start and end framings share most of
  their content; otherwise first frame only and describe the move.
- **Identity across mediums** came from wardrobe, colour and prop, not from a face. The reference sheet
  still helped photoreal shots match each other.
- Timed beats in the prompt ("at 1.8 seconds the camera pushes in…", "at 2.5 seconds a lamp flickers")
  landed within about half a second in every H3 clip. The camera vocabulary
  ("with small amplitude at slow speed") was followed.
- Per-clip music differs even with an identical music line; overlapping audio across the cuts hides most
  of it. A single music bed under the whole film would be the proper fix.
- Studio gaps found and fixed on this branch: no way to set an end frame, no per-shot model choice, no
  per-shot HD. Still missing: a control-video path (depth from the blockout), see the plan doc.

## Files
- Skill and the complete build script: `.claude/skills/blender-previs/`.
- The cut and the previs playblast were delivered from the session; the studio project "Paper Boat" on
  the pod holds every keyframe, take and the reference sheet.

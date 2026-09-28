# "First Step": a 20-second sports-shoe ad in a Spider-Verse look, from a Blender previs (2026-09-28)

Third showcase. Brief: fast parkour ad, close-ups and run-bys, realistic handheld shake, the look of
*Spider-Man: Into the Spider-Verse*. Made with the recipe from `2026-09-quarter-mile-showcase.md`
("Second pass") plus the skill's new loop (`.claude/skills/blender-previs`), in one sitting.

## The film
Maya (original character) laces up on a rooftop ledge, sprints past the lens, vaults a rail, wall-runs,
leaps a gap between brownstones, lands, runs over the camera and skids to a stop; end card. Eight shots,
1.8–3.6 s each, 20.0 s, 1280×720, every clip's own MiniMax sound. Brand and character are fictional.

| # | shot | source of framing | grade at 768p |
|---|---|---|---|
| 1 | ECU shoe on the ledge, heel lifts | previs cam 1, 50 mm at 0.55 m | A |
| 2 | knee-height run-by, whip to her back | cam 2, strong noise | A- |
| 3 | vault over the rail toward the lens | cam 3, hip height | A |
| 4 | ECU sole on the brick, wall-run | cam 4, tilt up | A- |
| 5 | the gap, wide side-on (the one full-body shot) | cam 5, 85 mm | A- |
| 6 | shoes slam the ledge, knees absorb | cam 6, ledge height | A |
| 7 | worm's-eye: she runs over the camera | cam 7, lens 5 cm up, 20 mm | A- |
| 8 | skid stop, tilt to her face, push in to the shoe | cam 8 | A |

## Pipeline, as run (times are wall clock)
1. Bible (10 min). Six sheets with Z-Image, two candidates each: character sheet, action pose, shoe sheet,
   shoe worn, location plate, rooftop plate (5 min on the pod).
2. Blender previs by a build agent from `example_build.py`: set, capsule runner, baked parkour motion,
   eight cameras with f-curve noise on rotation (handheld), `continuity.json` (20 min, 41 s to render).
3. Round 1 at 480p (all eight, ~12 min): look right, cameras too wide (review), reference stills leaking
   in as cuts.
4. Re-camera (close-ups, full body only on the jump, worm's-eye sprint) + style-matched character sheet
   (Qwen-Image-Edit of the sheet with the location plate as the style reference) + "one continuous shot"
   line. Round 2 at 480p: all eight usable.
5. Simple-proxy A/B: same prompts and references against a capsule-only figure. Simple won (wall-run and
   gap read; no regressions). Round 3 = HD (768p, 4 s each, ~4 min per take).
6. Cut: each take trimmed to where its beat landed (1.8–3.6 s), native sound, end card overlay.

## What we learned
- **Close-ups are a previs decision.** The first cut had five wide shots; the review asked for close-ups
  and full body only on the jump. The fix is cameras, not prompts, and the render followed every one.
- **Simple proxies beat a jointed mannequin** for reference-to-video: capsules for body and legs plus the
  shoe blocks gave the same timing and better wall-run and gap shots. Detail on the proxy is copied.
- **Reference stills leak as cuts.** With six reference pictures the model opened on the location plate
  as a wide, cut to the shoe plate as a close-up, then played the action. "One single continuous shot with
  no cuts, at 0.00 s the frame is already <opening framing>; the reference pictures define appearance
  only" removed it from the head of the clip; the tail still follows the cut inside the 4 s window.
- **4 s minimum.** MiniMax H3 renders ≥ 4 s, so 2 s shots are 4 s windows trimmed in the edit; beats
  land 0.5–1 s later than the previs on fast moves, so trim to the take.
- **Style match comes from the sheets.** A clean cartoon character sheet against halftone plates gave a
  clean character on halftone backgrounds; redrawing the sheet in the plate's style (edit model, plate as
  the second input) made them one film.
- **Identity drift on hair** (afro without the bleached tips) in a third of takes; an explicit negative
  ("never a large afro") and "exactly one person" in the description fixed the HD round.

## Cost
Pod time (secure RTX PRO 4500, $0.72/h): 2.91 h ≈ $2.10 for 60 GB of models, 18 sheet candidates, 29
takes at 480p (including the two 8-shot rounds and the A/B), 8 at 768p. The stopped pod from the previous
film could not restart (its host had no free GPU), so a new one was created and terminated at the end.

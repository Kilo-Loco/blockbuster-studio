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

## Second pass: the Higgsfield flow on H3 (2026-09-28)
Same sheets, same story, re-made the way the Higgsfield + Blender video does it (their settings, read off
the video: Seedance 2.5, 1080p, one 30 s generation per sequence, one reference video plus three to eight
images, a Claude-written timestamped shot list). On H3 Ref2VA:

- **Previs:** the character became a monolith (front red, back black, sides green) on gray capsule legs,
  and the blockout got the creator's small touches: offset lagging aim targets, lens moves, speed ramps,
  gray-on-gray surface texture. Two sequence playblasts (11 s and 9 s) instead of eight shot windows.
- **Prompt:** one six-field prompt per sequence: references named after the proxy colours, `<Video 1>`
  defines "the entire camera path, every cut and its time", then `[Shot N] At 00:0x.xxx, the camera cuts
  to …` lines.
- **480p:** every shot landed at its previs time inside a single generation; identity, shoes and light
  carried across the internal cuts. One new fault: window-grid texture on the distant blocks rendered as
  literal gray buildings, and a prompt line did not fix it; removing the texture did.
- **768p:** 11 s and 9 s at HD with a reference video ran out of memory on the 32 GB card, so the HD pass
  was five chunks of 5 s or less, split at cuts. The chunk joins held continuity.
- **Speed:** from go-ahead to the first full 480p rough in about 45 minutes, most of it model download.
  One 480p round of the whole film is about 5 minutes (two generations) instead of about 12 (eight).

Cost: $4.37 of pod time, of which $2.55 was lost to two fresh hosts that could not pull the image from
GHCR (the second-pass recipe itself cost $1.82). Those hosts pulled the same layers for over an hour; the
image now also goes to Docker Hub, which Runpod pulls far better, and the templates point there.

### Review of v2 and what Higgsfield's published material changes
Faults in v2: smeary painterly motion blur in fast shots, and at 16 s an invented wide of the first
rooftop with the monolith rendered literally. Causes, both on our side: the last chunk's window opened on
an empty roof and its prompt had no opening-frame line; the style line asked for "motion smears" and the
previs used fast jitter for handheld.

Higgsfield's creator post on the Blender workflow publishes every blocking brief and full generation prompt
(five use cases). What we adopted (`reference/sequence_prompt_template.md`): reference definitions that
state what each input does and does not contribute, with location plates active only in their time
window and the previs as the sole authority for camera and timing; a technical block with an explicit
shutter or, for drawn looks, named graphic conventions instead of blur; numbered checkable rules with
counts and invariants; a per-shot timeline with END-state checkpoints; meanings for artefacts in the
source (dark dips, resets, grids, placeholder backgrounds); a closing hold list; acting tasks for
performances. On the blockout side: hero in frame on every frame, slow body-sway handheld instead of
jitter, camera/target/zoom changes strictly on the cut. From their other guides: grey four-view sheets,
full-body identity references for back and profile shots, hair described as geometry, camera negations
per move type, and "the variance comes from what the words left unspecified".
Their prompts are written for Seedance 2.5 (30 s, long prompts); how much of that length MiniMax H3 uses
is still to be measured.

### v3: the Higgsfield prompt structure on H3 (2026-09-29)
- **Inputs:** the grey four-view turnaround made by editing the approved sheet (a text-only redraw changed
  the character's age and gender), a grey four-view shoe sheet, the previs with the hero on every frame,
  slow body-sway handheld and clean cuts, and prompts in the new template.
- **Proxy leak:** gone from every shot except, at first, the worm's-eye sprint, where the small proxy seen
  from below rendered literally. One line inside that shot naming the proxy fixed it; the plain capsule
  proxy also fixed it but lost the worm's-eye framing.
- **Blur:** reduced (slow sway in the previs, "speed lines only, no photographic blur" in the prompt);
  some remains on the fastest run-by frames.
- **Memory:** 11 s at 768p with a reference video also ran out of memory on a 48 GB card (a MIG slice of
  a PRO 6000), so the HD pass was again five 5 s chunks. The slice renders about half as fast as a full
  32 GB card; for chunks, the full card is the better buy. Whole-sequence HD needs a 96 GB card.
- **Cost:** $1.78 (1.63 h on the 48 GB slice).

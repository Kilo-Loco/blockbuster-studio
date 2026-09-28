# "Quarter Mile": a 25-second drag race made from a Blender cut with video-to-video control (2026-09-28)

Second showcase, after "Paper Boat" (`2026-09-paper-boat-showcase.md`) showed that first/last-frame
guidance locks compositions but leaves each clip to animate on its own. Here the whole film was animated in
Blender first and the AI models were used as a renderer: the blockout's depth pass drove Wan 2.2
Fun-Control frame by frame (studio engine `wan_control`, added on this branch), with a photoreal reference
frame per shot for the look.

## The film
Midnight street race on an industrial road: a matte-black muscle car and a neon-green import roll to the
line, a flagger drops the flag, the green car gets the jump, the black car reels it in through the cockpit
shot and wins by a hood. Five shots of 5 s (81 frames at 16 fps each), one look (photoreal night).

| # | shot | control | reference | sound |
|---|---|---|---|---|
| 1 | roll-up, crane down | depth | blockout frame restyled (Qwen-Image-Edit) | MiniMax H3 I2V take |
| 2 | flagger close-up, whip, launch | depth blurred (σ 14) | restyled frame | H3 I2V take of the same shot |
| 3 | low tracking launch | depth | restyled frame, colour mapping spelled out | H3 take |
| 4 | cockpit | depth | Z-Image text-to-image (the edit model misread the cabin) | H3 take |
| 5 | finish, high side, pan | depth (near/far keyed per frame) | restyled frame, "foreground empty" | H3 take |

## Pipeline, as run
1. Bible → Blender `build.py`: 460 m road, two cars with rolling wheels and drivers, flagger with a flag,
   two crowds, parked cars, five cameras on one 600-frame timeline; per shot `clip16.mp4` and `depth16.mp4`
   (81 frames at 16 fps). Four passes: cameras (finish on a long lens, post-whip angle closer), car meshes
   (beveled bodies, pillars, arches, no hub marks), parked-car boxes replaced by dark car meshes.
2. Reference frames: Qwen-Image-Edit over each blockout first frame, naming every gray shape.
3. Clips: `POST /api/shots/:id/video` with `controlVideoAssetId` (depth), `controlPreprocess: "none"`,
   `quality: "hd"`; RTX PRO 4500 Blackwell (32 GB): ~5.5 min per 1280×720 clip.
4. Sound: H3 image-to-video takes from the same reference frames, audio only, laid under the Wan clips
   with 0.4 s overlaps; shot 2's H3 take had the flag drop and launch at the blocked time.
5. Cut: hard cuts at the shot boundaries (the Blender cut is the edit), 25.0 s.

## What we learned
- **Depth beats edges for a blockout.** Edge control (`canny`, the template default) copied the proxies
  literally: box cars, wheel hub marks. The Z pass gave real cars with the same motion.
- **Proxy silhouettes become the render.** Box cars rendered as slabs until the meshes had hoods, pillars
  and arches. Backgrounds can stay boxes; with a good reference they became warehouses every time.
- **The reference frame carries colour and identity, and leaks.** The first shot 3 reference had the
  car colours swapped and the clip followed it; the first cockpit reference had the rival on the wrong
  side; a cleanup prompt that said "purple and blue parked cars" repainted the hero cars purple and blue.
  Fix upstream (no saturated placeholders in the blockout; name lane and colour explicitly), not with a
  second edit pass.
- **Human close-ups need a softer control.** A capsule mannequin in depth rendered as a white statue.
  Blurring the depth pass (σ 14) kept the arm, flag and whip while letting the reference define the
  person; MiniMax image-to-video from the reference also worked but cannot do the whip.
- **Interiors:** the edit model turned the cockpit blockout into an exterior; a text-to-image reference
  with the rival "ahead and to the right" fixed both look and geography.
- **Sound:** Wan is silent. H3 takes from the same reference frames gave engine, crowd and launch sound that
  matched the picture's timing well enough to cut under it.

## Cost
Runpod pod time, secure RTX PRO 4500 at $0.72/h:
- control-video pass: 1.85 h ≈ $1.33 (29 GB control-model download, 14 keyframes, 15 clips incl. retakes and sound takes)
- reference-to-video pass: 1.71 h ≈ $1.23 (12 GB Ref2VA download, 24 sheet candidates, ~20 takes at 480p, 6 at 768p)
- this film in total ≈ $2.56; "Paper Boat" was $0.87.

## Second pass: reference-to-video (2026-09-28)

The control-video cut connected the motion but did not look real: the review verdict was "none of it
looks remotely real". Cross-checking Higgsfield's published workflows (Elements, the character-sheet
skill, omni-reference models) named what was missing: **reference sheets** of every recurring subject,
injected into a video model that takes references, with the blockout as a loose guide rather than a
frame-by-frame constraint. MiniMax H3 Ref2VA does exactly that on our stack (up to 9 reference images and
3 reference videos; studio engine `h3_ref`, model group `minimax_ref`, added on this branch).

### Recipe that graded A
1. **Sheets, not stills.** Z-Image Turbo, white seamless studio background, "photoreal unretouched skin,
   visible pores" (the Higgsfield character-sheet prompt discipline), one sheet per driver, per car
   (split view: three-quarter front + side profile) plus a night "on location" plate per car, a location
   plate and a crowd plate. Pick the best of two candidates each.
2. **References per shot** = the vehicle sheets + the location plate, plus the people sheets only when
   that person is in frame (4–5 images). Anything not referenced is free to drift, so reference it.
3. **The Blender playblast as `<Video 1>`** with retention `partially_preserved`: "camera position and
   path, framing, the cars' relative positions and timing are kept; its gray untextured look, box shapes
   and mannequins are replaced". As `weak_reference` the camera did not carry (shot 3 came back as a rear
   chase). A reference video that is itself a render (the control-pass take) copies that render's CG look.
4. **One explicit camera-geometry sentence** in `detailed_description` ("camera on the LEFT edge at 30 cm,
   looking BACK; the green car's side profile fills the left half; the black car is half a length BEHIND
   for the entire shot") on top of the video reference. Together they held the previs framing every take.
5. **Iterate at 480p / 4 s** (~85 s per take on an RTX PRO 4500), grade against a written checklist
   (identity, camera, geography, background, story beat), fix one thing per retake, then render the
   approved prompt at 768p / 5 s (~4 min, with H3's own sound).

### Iteration log (what each retake fixed)
| shot | takes | fix that mattered |
|---|---|---|
| 3 | 4 | playblast `partially_preserved` + camera sentence (was rear chase, wrong leader) |
| 4 | 2 | driver "pinned to the left third, foreground"; rival "ahead and to the right in the right lane" |
| 5 | 3 | crowd "below the camera, behind the fence"; crossing named at 3 s (was in foreground, pass at 1 s) |
| 2 | 2 | spectators after the whip `fully_preserved` from the crowd plate (gray capsules leaked from the previs) |
| 1 | 1 | none |

### What changed versus the control pass
- Cars have real paint, reflections and stance; people have skin; crowds are people. Same story, same
  Blender cut, same camera moves.
- The blockout still does the animation and the edit: every shot's framing, move and timing is the previs.
  It is just no longer a hard geometric constraint, so proxy silhouettes stop leaking into the picture.
- Depth control remains the right tool when a move must be matched to the frame (choreography against a
  plate); for look, reference-to-video wins.

### Review of the reference-to-video cut, and what changes next time
Verdict: more realistic and coherent; pacing too slow for the genre; a few state inconsistencies between
cuts (which car is where, background details). Diagnosis and the fixes now in the skill:
- **Pacing came from the previs.** The blockout raced 400 m in 14.75 s (top speed 35 m/s) in five 5 s
  shots, and `partially_preserved` faithfully kept that timing. Next time: real speeds, 2–3 s shots, a cut
  per beat, 7–9 shots for 20 s.
- **State came from camera side and labels.** Shot 3 looked from the left edge, shot 5 from the right,
  which reads as the cars swapping lanes; and the prompt never said which gray proxy in the playblast was
  which subject. Next time: keep the action axis in the previs, feed each shot's anchor sentence from the
  new `continuity.json`, name the proxies in `subject_definitions`, keep the reference order fixed across
  shots, and add a per-shot background plate made from that shot's own blockout frame.
- **Speed of the process.** The loop is now one script (`studio_takes.py`: upload, take, wait, sheet,
  cut) plus a checklist template, and the studio's own reference wrapper defaults to the measured retention
  levels, so the next film starts at the recipe instead of rediscovering it.

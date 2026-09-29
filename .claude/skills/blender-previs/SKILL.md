---
name: blender-previs
description: Optional previs workflow. Only when the user asks for Blender, a blockout, previs, or the same edit rendered in several visual styles. Builds a gray-box scene with one camera per shot, renders first/last frames and a playblast, then turns them into studio keyframes and timed motion prompts. Not a default; ordinary films use the studio's storyboard directly.
---

# Blender previs → Blockbuster Studio (optional)

This is one way to make a film with the studio, not the way. Use it when the user wants camera moves and
cuts locked before generation, or the same edit in several looks. For anything else, the studio's own
storyboard (location map, blocking, camera per shot) is the shorter path.

The idea comes from film previs: put geometry, blocking, camera path and timing in a 3D scene; let the
AI models decide only the look. Each prompt then has a *structural* half (first/last frame, camera move,
timing) that comes from Blender and a *style* half that can change per shot or per pitch.

## Requirements
- Blender 4.2+ run headless (`blender -b --python build.py`; on macOS the binary is inside Blender.app).
- ffmpeg on PATH.
- A studio pod with the **edit** model group (Qwen-Image-Edit) and a video model, and its API token.
  `docs/API.md` lists the routes; `/mcp` exposes the same as tools.

## Steps
1. **Shot list first.** Per shot: length, look, the camera move in plain words, the action. Decide what
   never changes (character wardrobe, key prop, world, sound). Identity that survives a change of medium
   comes from silhouette, colour and props more than from a face.
   **Pace the previs like the finished film, because the render keeps its timing.** With a reference or
   control video the model reproduces the blockout's speed and shot length, so a slow previs is a slow film.
   For action: real-world speeds in the animation (a car covering 400 m in 10–12 s, not 15), shots of 2–3 s
   with a cut on every beat (a 20 s chase is 7–9 shots, not 5), the camera moving with the subject, and
   the slow shots reserved for the establishing and the aftermath. Measured 2026-09-28: five 5 s shots at
   two thirds of real speed read as slow even though every take was graded A.
2. **Blockout.** Start from `reference/example_build.py` (a complete six-shot example) and change its
   CONFIG, SET, CHARACTER, ANIMATION and CAMERAS sections. Keep the set gray, give each character and key
   prop one saturated colour, one camera per shot bound to its frame range by timeline markers, each with a
   Track-To target. Bake motion one key per frame. Render with Workbench (fast, reliable headless).
   Outputs per shot: `first.png`, `last.png`, `clip.mp4`, `depth.mp4`; plus `playblast.mp4`, `contact.jpg`,
   `camera_log.json` (per second: camera, target, lens, a one-line beat) and `continuity.json` (per shot and
   subject: in frame or not, screen third, distance, order front to back, and one anchor sentence). Check
   the stills before rendering the clips.
   **Keep the proxies simple.** A character is a body block (the orientation-coded monolith of the
   reference-to-video flow below, or a capsule), a capsule per leg and a block per key prop (shoes, a bag),
   no head, arms, joints or faces. Measured on a parkour
   previs with reference-to-video (2026-09-28, same prompts and references): the capsule figure rendered a
   wall-run and a gap jump the jointed mannequin did not, with no loss elsewhere. Detail on the proxy is
   something for the model to copy; motion, position and timing are what it should take.
   **Keep the action axis.** Put every camera on one side of the line between the subjects unless a shot
   shows the camera crossing it; a previs that cuts from the left edge to the right side reads as the
   subjects swapping places, and the render will not fix that.
3. **Keyframes.** Upload the blockout frames and a character reference (`POST /api/uploads`), then
   `POST /api/generate` with `engine: "qwen_edit"`, `inputAssetIds: [blockoutFrame, characterReference]`:

   ```
   Turn this gray 3D blockout into <style>, keeping the exact composition, camera angle, lens and the
   position and size of every object. The <colour> mannequin is <name>, the person from image 2
   (<wardrobe>), <what they do in this frame>. The <colour> shape is <prop, named once>. The gray
   boxes are <set>. Apart from <name> and the <prop> the scene is empty.
   ```

   Observed: "the mannequin is <name>" gives a real character, naming the figure literally keeps the
   mannequin's head; unexplained shapes turn into random objects; repeating the prop noun or writing
   "no other <props>" adds extra props; ask for `count: 2` on shots that misbehave. Set the frame with
   `POST /api/shots/:id/select {keyframeAssetId}` and, when it helps, `{endKeyframeAssetId}`.
4. **Motion prompts** from `camera_log.json`: style clause first, the constant description, then the beats
   with times and the camera in the model's vocabulary (`reference/model-prompt-guides.md`). Set
   `motionPrompt`, `durationSec`, and if wanted `quality`, `videoModel`, then animate and review.
   End frames hold moderate moves (tracking, tilt, orbit, pedestal). A large move whose end framing shares
   little with the start (push-in to a detail, pull-out to a wide) did better on MiniMax H3 with the first
   frame only; the two-frame version jumped between compositions.
5. **Assemble** with `export_film`, or trim each take to its cut length with ffmpeg for a tighter edit.

## Control video: the whole blockout drives the render
When motion has to connect across the film (vehicles, chases, choreography), first/last frames are not
enough: give the shot a **control video** (`Shot.controlVideoAssetId`, engine `wan_control`, model group
`control`) and the clip follows the blockout frame by frame, with the keyframe as the reference for the look.
Measured on a drag-race blockout (2026-09-28):
- **Feed the depth pass, not the RGB playblast.** With edges extracted from the gray render (the
  default `canny`), Wan Fun-Control copied the proxies literally: box cars, wheel hub marks, cabin
  frames. The Blender Z pass with `controlPreprocess: "none"` gave real cars, the same camera and motion,
  and clean backgrounds. Render per shot 81 frames at 16 fps (`clip16`/`depth16`) and pick the depth
  near/far range per shot so vehicles and people have contrast.
- **Proxy shape becomes the final shape.** Whatever silhouette the depth pass carries is what the model
  builds on, so give hero objects real silhouettes (beveled bodies, cabins with pillars, wheel arches) and
  keep decals off the proxies. Backgrounds can stay boxes: with a photoreal reference frame and a prompt
  that names what each gray shape is, warehouses came out as warehouses.
- **Reference frame per shot.** Restyle the blockout's first frame with Qwen-Image-Edit (naming every
  gray shape); for interiors the edit model may misread the cabin, so generate the reference from text.
`reference/control-video-options.md` records why Fun-Control was chosen over VACE, LTX IC-LoRA and H3.

## Reference-to-video: one generation per sequence (the recommended flow)
This is the flow the Higgsfield + Blender video uses (Seedance 2.5 there), run on MiniMax H3 Ref2VA
(`h3_ref`, model group `minimax_ref`): reference sheets define the look, the playblast defines everything
structural, and **one generation covers a whole sequence with its cuts inside it**. Measured on a 20 s
parkour ad (2026-09-28): two generations (11 s + 9 s) replaced eight per-shot clips, a 480p round took
~5 min instead of ~12, nothing needed trimming, and identity and background held across the cuts.

1. **Sheets first, few of them.** One sheet per recurring character, vehicle and key prop on a neutral
   GREY background (Higgsfield found grey beats white and black), with front, side, back and a close-up
   (full body for people: posture carries identity from behind), plus one location plate and one surface
   plate (Z-Image, `count: 2`, pick one); 3 to 6 references in all. Describe hair as geometry, not just
   colour, and treat profile, back and wide shots as the cases that need the strongest sheet.
   Draw every sheet in the film's style: for a stylised look, redraw the character sheet with
   Qwen-Image-Edit using the location plate as the second input, or the character won't match the world.
2. **Proxies that say who and which way.** A character is a box ("monolith") from hips to head plus gray
   capsule legs; its FRONT face is red, BACK black, SIDES and TOP green, so the model reads orientation.
   Several characters: one solid colour each, and name each reference after its colour (`@char_red`).
   Key props are blocks in their real colour (orange shoe blocks). No heads, arms, joints or faces.
3. **The small cinematic touches go in the blockout**, not the prompt: handheld noise on the camera;
   the camera aims at an offset, lagging target rather than the subject's centre; animated focal length
   (punch-ins, creeps); speed ramps (slam in, hold, accelerate into the cut); light gray-on-gray texture on
   near surfaces (brick courses, slab joints, roof seams) so materials and scale read. Leave out what the
   model does better: dust, smoke, liquid, motion blur. **No window grids or other texture on distant
   blocks**: they rendered as literal gray buildings and a prompt line did not override them.
4. **Keep the action axis** and the proxy colours consistent across the whole film.
5. **Sequences of 8 to 15 s.** Split the film at natural cuts into sequences no longer than 15 s (H3's
   limit for a reference video and a clip). **GPU memory sets the HD length:** at `quality: "hd"` (768p)
   with a reference video, 5 s fits a 32 GB card and 9–11 s ran out of memory (the studio now refuses it
   up front). On a 32 GB card iterate whole sequences at `fast`, then render HD in chunks of 5 s or less
   split at cuts, each with its own window of the playblast and a re-timed prompt; continuity held across
   the chunk joins in the parkour test. 11 s at HD also ran out of memory on a 48 GB card; whole-sequence HD needs a 96 GB card (not yet measured). Render one playblast per sequence (`PREVIS_SEQUENCES`) plus
   `sequences.json` with each shot's start and end relative to the sequence and its anchor sentence.
6. **Claude writes the prompt from the playblast** with `reference/sequence_prompt_template.md`:
   reference definitions that say what each input does and does not contribute, a technical block,
   numbered checkable rules, a timeline with an END-state checkpoint per shot, and a closing hold list.
   In H3's six reference fields that means:
   - `subject_definitions`: each reference with what it is, which proxy it is in `<Video 1>` and what
     the proxy colours mean; `<Video 1>` "defines the entire camera path, every cut and its time, and
     each character's position and motion beat for beat"; the gray boxes are named ("rooftop structures,
     never people"), and the distant blocks are "the skyline of <Picture N>, never gray".
   - `retention_analysis`: sheets `fully_preserved`; plates and `<Video 1>` `partially_preserved`, with
     "the gray look and the proxies are replaced".
   - `detailed_description`: a style sentence, "exactly N people", "the reference pictures never appear
     as inserted stills; the only cuts are the ones listed", then one line per shot:
     `[Shot 2] At 00:02.000, the camera cuts to <framing, lens, shake>: <action>; <camera move in H3 terms>.`
     State what the model must not flip ("her BLACK side faces the camera: we see her back").
   `reference/model-prompt-guides.md` has the full worked prompt. Two faults this prevents, both seen on
   the parkour test: a clip whose window opened on an empty frame rendered the monolith literally inside
   an invented establishing shot (fix: hero on every frame in the previs, an opening-frame line, and a
   rule that the proxy never appears); and "motion smears" plus fast camera jitter gave painterly blur
   (fix: slow sway handheld in the previs, and for a drawn look "speed lines and impact frames only, no
   photographic motion blur").
7. **Iterate the whole sequence at `quality: "fast"`**, two takes per retake (`count: 2`), grade the
   half-second contact sheet against `reference/take_checklist_template.md`, fix one thing, then render
   the approved prompt at `"hd"` with the winning take's seed. `reference/studio_takes.py take
   --duration 11 --ref-video seqA.mp4` runs a sequence; `cut` joins them with each clip's own sound.

Per-shot generation (one reference window of at least 4 s per shot, trimmed in the edit) still works and
is the fallback for a single shot that needs its own retakes; it was slower and drifted more between cuts.
The studio wraps a plain prompt into the six fields (images `fully_preserved`, the video
`partially_preserved`, no inserted stills, and "no cuts" only when the description has a single shot);
a prompt that starts with `subject_definitions:` passes through.

## Files
- `reference/example_build.py`: the complete, commented example build (six shots, one street set; first/last-frame workflow). Also writes `continuity.json`: per-shot, per-subject (JUNO, BOAT) screen position/size/distance/speed at the first/mid/last frame plus camera height/side/lens and a plain-English anchor sentence.
- `reference/example_dragrace_build.py`: the control-video example (two animated cars with drivers, a flagger, crowds, five cameras; per-shot 81-frame 16 fps clips and depth passes with per-shot near/far ranges). Also writes `continuity.json`: per-shot, per-subject (both cars, REX, KAI, NOVA, FLAG) screen position/size/distance/speed at the first/mid/last frame plus camera height/side/lens and a plain-English anchor sentence.
- `reference/example_parkour_build.py`: the reference-to-video example (one runner, eight 2–4 s shots in two sequences): close-up cameras with slow body-sway handheld, offset lagging aim targets, lens moves and speed ramps, gray-on-gray surface texture, `PREVIS_PROXY=monolith` (orientation-coded box; also `simple`, `articulated`), `PREVIS_SEQUENCES` playblasts, 5 s chunks + `sequences.json`, `PREVIS_OUT`, and build checks that fail on any frame without the hero and on any blended cut.
- `reference/model-prompt-guides.md`: MiniMax H3 (I2V and Ref2VA), LTX-2.5 and Wan 2.2 prompt structure, with sources, and a worked Ref2VA shot prompt.
- `reference/control-video-options.md`: depth/canny/pose control on self-hosted models, September 2026.
- `reference/sequence_prompt_template.md`: the sequence prompt structure (reference definitions, technical block, rules, timeline with state checkpoints, hold list) and the blocking-brief checklist.
- `reference/studio_takes.py`: upload / take / wait / sheet / fetch / cut against the studio API, the iteration loop in one script.
- `reference/take_checklist_template.md`: the per-shot grading sheet to fill from the bible and `continuity.json`.

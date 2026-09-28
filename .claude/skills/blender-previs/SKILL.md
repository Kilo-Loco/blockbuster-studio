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
   **Keep the proxies simple.** A character is a capsule for the body, a capsule per leg and a block per
   key prop (shoes, a bag), one saturated colour each, no head, arms, joints or faces. Measured on a parkour
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

## Reference-to-video: the blockout guides, reference sheets define the look
When the result has to look real (not just move right), give the shot **reference images** and the
playblast as a **reference video** (`Shot.referenceAssetIds`, `Shot.referenceVideoAssetId`; engine
`h3_ref`, model group `minimax_ref`, MiniMax H3 Ref2VA). Measured on the same drag-race blockout after the
depth-control cut was judged not real enough (2026-09-28):
- **Make sheets first.** One studio-background sheet per recurring person, vehicle and prop (Z-Image,
  `count: 2`, pick one), a night plate per vehicle, a location plate and a crowd plate. Per shot pass the
  vehicle sheets + location plate, and each person's sheet only when they are in frame. Unreferenced
  things drift.
- **Playblast retention `partially_preserved`**, described as "camera path, framing, positions and timing
  are kept; the gray look, box shapes and mannequins are replaced". `weak_reference` lost the camera.
  Never pass a previous AI take as the reference video: its look is copied.
- **Say the camera geometry once in words** as well (which edge, height, looking which way, who fills
  which part of the frame, who is behind). The two together held the previs framing on every take. Take it
  from `continuity.json`'s anchor sentence rather than writing it by hand, and keep the reference order
  (which sheet is <Picture 1>, <Picture 2> …) identical in every shot of the film so the labels mean the
  same thing from cut to cut.
- **Anchor the background per shot.** One location plate keeps the setting but not the angle, so the
  background can drift between cuts. For each shot add a plate that matches its camera: restyle the shot's
  blockout `first.png` into the look (Qwen-Image-Edit, gray shapes named) with the subjects removed, and pass
  it as a `partially_preserved` `<Picture N>` for "the setting and the light" only, after the subject sheets.
- **Say it is one continuous shot.** With several reference pictures the model may open on a plate as a
  wide, cut to a sheet as a close-up, then start the action (seen on three of five takes, 2026-09-28).
  Start `detailed_description` with "one single continuous shot with no cuts and no establishing view: at
  0.00 seconds the frame is already <the opening framing>; the reference pictures define appearance only".
- **Name the placeholders in the playblast.** In `subject_definitions` say which proxy is which ("<Subject 1>
  is the green box car in <Video 1>") so the model maps the blockout's shapes onto the sheets instead of
  guessing which is which. Colour every subject's proxy with one saturated colour that matches its sheet.
- **Reference windows of at least 4 s.** MiniMax H3 renders 4 s minimum, so for a 2 s shot cut a 4 s
  window of the playblast starting at the shot and trim the take to the shot length in the edit. The
  model reproduces the cut inside the window as a cut; it lands in the trimmed tail. Trim to where the
  beat actually lands in the take (the model can run a beat 0.5–1 s late), not to the previs length.
- **Iterate with `reference/studio_takes.py`**: `upload` the sheets and per-shot playblasts, `take` at
  `--quality fast --duration 4` per shot, grade the contact sheet against `reference/take_checklist_template.md`,
  fix one line per retake, then `take --quality hd` with the approved prompt and `cut` the film from a spec
  that uses each clip's own sound. Submit several shots with `--no-wait` and `wait` them together.
- The studio wraps a plain prompt into H3's six-field reference format (images `fully_preserved`, the
  video `partially_preserved` for camera, framing, positions and timing); a prompt that already starts with
  `subject_definitions:` passes through, which is what you want once the retention lines are shot-specific
  (`reference/model-prompt-guides.md` has the worked prompt).

## Files
- `reference/example_build.py`: the complete, commented example build (six shots, one street set; first/last-frame workflow). Also writes `continuity.json`: per-shot, per-subject (JUNO, BOAT) screen position/size/distance/speed at the first/mid/last frame plus camera height/side/lens and a plain-English anchor sentence.
- `reference/example_dragrace_build.py`: the control-video example (two animated cars with drivers, a flagger, crowds, five cameras; per-shot 81-frame 16 fps clips and depth passes with per-shot near/far ranges). Also writes `continuity.json`: per-shot, per-subject (both cars, REX, KAI, NOVA, FLAG) screen position/size/distance/speed at the first/mid/last frame plus camera height/side/lens and a plain-English anchor sentence.
- `reference/example_parkour_build.py`: the reference-to-video example (one runner, eight 2–4 s shots, close-up cameras with f-curve handheld noise, `PREVIS_PROXY=simple` capsule proxies, `PREVIS_OUT`, per-shot framing checks that measure the named body part).
- `reference/model-prompt-guides.md`: MiniMax H3 (I2V and Ref2VA), LTX-2.5 and Wan 2.2 prompt structure, with sources, and a worked Ref2VA shot prompt.
- `reference/control-video-options.md`: depth/canny/pose control on self-hosted models, September 2026.
- `reference/studio_takes.py`: upload / take / wait / sheet / fetch / cut against the studio API, the iteration loop in one script.
- `reference/take_checklist_template.md`: the per-shot grading sheet to fill from the bible and `continuity.json`.

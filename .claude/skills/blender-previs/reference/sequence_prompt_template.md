# Sequence prompt templates

## LTX-2.5 with a reference sheet (default)
Per render window (at most ~5 s, cut on the previs's cuts), one paragraph block in two labelled parts:
```
Reference sheet: Top row left: <character close-up, the identity words>. Top row middle: <the same
character's turnaround>. Top row right: <location>. Bottom row: <prop views>.
Generated video: <style sentence incl. one colour-grade phrase>. <Shot 1 in 4-8 concrete sentences: framing,
who does what, camera move relative to the subject, sound woven in>. A hard cut transitions to <shot 2:
re-establish framing and light; the same identity words as shot 1; what the sound does across the cut>.
```
Rules (Lightricks' prompting guide and enhancer rules, measured on Coast Road): present tense, plain words,
no invented camera moves or dialogue, identity words identical in every shot and chunk, wardrobe described in
its held state, sound through the action not at the end, 2-4 shots per generation, and every sentence adding
concrete visual or sound detail (longer prompts that only restate or embellish hurt). The studio builds the
`Reference sheet:` half from the scene's sheet; write only the `Generated video:` half per shot.

## MiniMax H3 Ref2VA (alternative) and the Higgsfield structure it came from

Structure adapted from the published Higgsfield + Blender prompts (Seedance 2.5; higgsfield.ai, Aug 2026)
and mapped onto MiniMax H3 Ref2VA's six fields. Claude writes it from the playblast, `sequences.json`
and `continuity.json`. Everything in <angle brackets> is filled per film; keep the section order.

## subject_definitions — the reference definitions
One line per reference, each saying what it is, what it contributes, and what it does NOT contribute.
- Character sheet: `<Subject N> is <NAME>: <age, build, skin, hair described as the shape it has in the
  sheet ("soft black curls in a compact rounded shape close to the head, a few bleached tips"), wardrobe>;
  appearance only, 100% matching
  <Picture N>; pose, lighting and background not inherited. In <Video 1> <NAME> is <the proxy: "the
  monolith" / "the red box"> — the colour is the identity.`
- Prop sheet: same pattern; say which proxy block it is ("the orange blocks at the feet are the shoes").
- Location / surface plates: `design reference only — materials, palette, light, mood; the camera
  angle, framing and composition are NOT taken from it. Active <00:00–00:05.0> only.` (per-location
  windows when the sequence changes location).
- The playblast: `<Video 1> is the <N> s greybox previs of this sequence: the SOLE authority for camera
  and timing — trajectory, speed, easing, height, angle, framing, lens feel, every cut and its time, and
  the position, orientation and role of every figure. Do NOT take any material, texture, colour,
  lighting or set design from it. Where a picture and <Video 1> disagree about the camera, <Video 1>
  wins.`
- Proxy map, one clause per placeholder: what each coloured block is, what the gray masses are
  ("rooftop structures, never people"), what a flat background or a dark dip is ("a placeholder — the
  sky of <Picture N>"), what a grid is ("a tracking aid, never rendered").

## summary
One sentence: `<style> sequence of <subjects> <doing what>, re-dressed shot for shot from <Video 1>.`

## retention_analysis
Sheets `fully_preserved`; plates `partially_preserved` (design only); `<Video 1>` `partially_preserved`
("camera, cuts, timing and positions kept; gray look, proxies and placeholder colours replaced").

## detailed_description — technical block, rules, timeline, hold
1. **Technical block**: style and medium in one line (for a stylised look, name the graphic conventions
   and ban the photographic ones: "crisp inked outlines on every frame, fast motion shown ONLY with drawn
   speed lines and impact frames, no photographic motion blur, no smear"); for live action, film stock,
   grain, lens character and "natural 180-degree shutter; motion blur only where <Video 1> moves fast";
   white balance / grade locks ("WB 5200K", hex accents); aspect; "NO CGI" where it applies; the cut
   contract: "exactly the <N> cuts of <Video 1>, at their times; no added, merged or reordered shots;
   the reference pictures never appear as inserted stills".
2. **Rules**, numbered, each one checkable: counts ("exactly one person", "exactly one hero car, identical
   at every distance"), invariants ("left-hand drive, never mirrors"), who is where, what never appears
   ("the red/green/black box never appears as an object; if <NAME> is out of frame the frame shows only
   the rooftop"), source-artefact meanings ("a dark dip in <Video 1> is a cut to the NEXT shot, never back
   to a previous one"; "every frame belongs to exactly one location"; "stray objects at the frame edge
   are ignored"), and camera negations per move ("dead-level travel, no zoom, no drift" where the previz
   has none).
3. **Timeline**, one block per shot: `[Shot N] At 00:0x.xxx, the camera cuts to <framing, lens in mm and
   field of view, height in metres, shake character>: <action with physical detail — weight, contact
   shadows, nothing floats, what the hair and cloth do>; <camera move in H3 terms>. END <t>s: <state
   checkpoint — who is where, facing which way, what has happened, what count stands at>.`
   Open every sequence and every chunk with what frame 0 already shows. In any shot where the proxy is
   small, far, or seen from an unusual angle (worm's-eye, overhead, silhouette), name it inside that shot:
   "in <Video 1> this shot shows the red box on gray legs seen from below: that box IS <NAME>, never a box".
   Measured on the parkour worm's-eye shot: without the line the proxy rendered literally; with it, clean.
   Describe hair from the sheet, not from an idea of it: rewording it ("tight curls cropped close") changed
   the character's age and gender in the sheet generator; editing the approved sheet into a turnaround kept her.
   A plain capsule proxy also avoided the leak but lost the worm's-eye framing, so keep the monolith.
4. **Hold for the full timeline**: a three-to-five line recap of the non-negotiables (camera 1:1 with
   <Video 1>, counts, identity, the location in every frame, no text or watermarks).

## overall_soundscape / non_diegetic_music
Diegetic sound design first, then timed accents ("12s one body-fall impact · 20.5s a single foot
landing"); "SFX only, no music" when music is added in post.

## Acting tasks (optional, for performances)
Per character: motive, goal, obstacle, tactic, moment-to-moment beats tied to lines, and "gaze always
engaged, natural blink cadence, never a frozen stare".

## Blocking brief checklist (for the Blender side)
- The hero is in frame on every frame of every shot; no shot opens or closes on an empty frame.
- Handheld is slow: body sway in long waves (4–6 s) plus a tiny tremor; the aim target drifts and
  breathes; livelier on action, lazy on close-ups; never fast jitter.
- Cameras on rails with a separate aim target (offset, lagging); lens animated on its own route with
  accents on the pauses; speed ramps (snap in, sag, accelerate into the cut).
- Camera, target and zoom change strictly on the cut frame, no transition frames.
- Characters are colour-coded proxies (the colour is the identity) with an orientation code; key props
  are blocks in their real colour; gray textured near surfaces, no texture on distant masses.
- Leave out what the model does better (liquid, smoke, dust, blur): an empty gap or a black placeholder,
  described in the prompt.

## Seedance-style writing rules (from Higgsfield's Seedance prompt skill)
For Seedance, and as the default wording for any model until a test says otherwise:
- **Positive phrasing:** state the target ("the right seat stays empty", "clean unbadged bodywork")
  instead of prohibitions. This differs from Higgsfield's published Blender prompts, which use many
  "do NOT" lines; keep proxy-to-real mappings as positive statements ("the box becomes the woman").
- **Block order:** SCENE CONTEXT, ACTIVE REFERENCES, LOCATION MAP, FIRST FRAME / BLOCKING, FORMAT MODE,
  OPTICS, CAMERA, ACTION, PERFORMANCE, PHYSICS, LIGHTING, COLOR GRADE, WARDROBE, AUDIO, STYLE, OUTPUT
  SETTINGS, POSITIVE LOCKS. Descriptive style lives in its own block; format and grain at the end.
- **References:** `@image1..` / `@video1..` in load order unless named; a minimal appearance line per
  reference plus "100% matches the reference"; a tag appears only in shots where that subject is visible.
- **Numbers:** field of view in degrees from a fixed table (84° ≈ 24 mm, 63° ≈ 28–35 mm, 47° ≈ 40–50 mm,
  29° ≈ 85 mm, 18° ≈ 100–135 mm), speeds in km/h, haze in metres or percent, white balance in Kelvin.
- **No equipment names** (film stocks, lens or camera models): describe the look.
- **Colour** tied to material, light and role, not a list.
- **Cuts:** timecoded `HARD CUT` lines plus "cuts only at the specified points".
- **Whip pans:** a whip shorter than about 0.8 s may render as a hard cut without blur.

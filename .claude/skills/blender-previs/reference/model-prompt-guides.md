# Prompt guidance per model — research 2026-09-27 (primary sources cited)

## MiniMax H3
- Guide: https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md ;
  official skill: https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills/h3-prompt-writing
- Three ordered fields: `integrated_multimodal_description` (visuals, actions, shots, speakers, dialogue, diegetic
  audio along the timeline), `overall_soundscape` (ambience, action sounds, non-verbal human sounds),
  `non_diegetic_music` (score only the audience hears; "N/A" only for deliberate silence).
- Camera = motion type + amplitude + speed. Types: Zoom In/Out, Push In/Out, Pan L/R, Truck L/R, Tilt Up/Down,
  Pedestal Up/Down, Arc Shot, Tracking Shot, Static Shot, Shake Slightly/Strongly, POV, Roll CW/CCW.
  Amplitude: "with small amplitude" / "with large amplitude". Speed: "at slow speed" / "at fast speed".
  e.g. "The camera pushes in with small amplitude at slow speed toward the folded letter in her hands."
- Multi-shot inside one clip: first shot untagged, then "[Shot 2] At 00:03.500, the camera cuts to ..." (strictly
  increasing times; verbs: cuts to / transitions to / switches to).
- Dialogue: speaker id outside the tag, language inside: `(S1) says: <d>[English] ...</d>`. Voiceover: "says in an
  off-screen voiceover" + "his lips remain completely closed".
- Style is a leading descriptor: "Live-action, cinematic, a medium-wide shot frames ..." / "2D-animated" / "3D CG" /
  "claymation" / "watercolor" / "vintage film". Keep it identical shot to shot.
- Consistency: "Character identity, clothing, colors, key objects, and spatial relationships should remain consistent."
  Ref2VA mode has a 6-section format (subject_definitions, summary, retention_analysis, detailed_description,
  overall_soundscape, non_diegetic_music) for reference-driven identity.
- Ref2VA (guide: `docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md` in the same repo; ComfyUI node
  `MiniMaxH3ReferenceToVideo`, up to 9 images + 3 videos, 4-step turbo LoRA): labels are `<Subject N>` (an
  entity whose appearance comes from `<Picture N>`), `<Picture N>` for a plain plate, `<Video N>` for a
  reference clip. Retention levels: `fully_preserved` (identity, wardrobe, bodywork kept exactly),
  `partially_preserved` (some attributes kept, the rest replaced; say which), `attribute_transfer`,
  `weak_reference` (style or rhythm only). A Blender playblast needs `partially_preserved` for its camera
  and positions to carry; `weak_reference` did not hold the framing (measured 2026-09-28). Worked shot
  prompt, the take that graded A:

  ```
  subject_definitions:
  <Subject 1> is the neon-green import with a big rear wing and green underglow, whose appearance comes from <Picture 1>.
  <Subject 2> is the matte-black 1970s muscle car with a chrome supercharger scoop, whose appearance comes from <Picture 2>.
  <Picture 3> is the location: a wet two-lane industrial road at night between corrugated warehouses, chain-link fences and sodium street lamps.
  <Video 1> is a gray 3D previs of this shot; it provides only the camera movement, framing, the cars' positions and the timing.
  summary: The target video is a live-action night street-race shot of <Subject 1> and <Subject 2> launching side by side down the road of <Picture 3>, filmed by the camera of <Video 1>.
  retention_analysis:
  <Subject 1> (appears in [Shot 1]): fully_preserved - body shape, wing, paint and underglow kept exactly as in <Picture 1>.
  <Subject 2> (appears in [Shot 1]): fully_preserved - body shape, scoop, chrome and matte paint kept exactly as in <Picture 2>.
  <Picture 3> ([Shot 1] environment): partially_preserved - road, warehouses, fences and sodium lighting kept; the framing follows <Video 1>.
  <Video 1> (camera, framing and car positions): partially_preserved - camera position and path, the framing of both cars and their relative positions and timing are kept; its gray untextured look, box shapes and mannequins are replaced by the real cars and road.
  detailed_description: [Shot 1] Live-action, cinematic, photoreal night street race. The camera rides on the LEFT edge of the road at 30 cm height, moving at the cars' speed, looking BACK across the lanes: <Subject 1>'s side profile fills the left half of the frame, <Subject 2> is three-quarter front behind it and to the right, half a car length BEHIND for the entire shot. ... Tracking shot with large amplitude at fast speed.
  overall_soundscape: Two engines at full throttle, a supercharged V8 and a high-revving turbo four, tyres shrieking on launch, wind rush, the crowd's roar sweeping past.
  non_diegetic_music: No music.
  ```
- Avoid: plot summaries (describe filmable specifics), unused labels, timing that doesn't fit the 4–15 s clip.
  "Use concrete visual/audio details over abstract terminology."
- Community timing advice (Atlabs): direct every second; name what differs at s12 vs s2.

### H3 Ref2VA sequence prompt (one generation, several shots), worked example
Written from an 11 s monolith playblast (`PREVIS_PROXY=monolith`, shots 1–5 of the parkour example),
five references in a fixed order: character sheet, shoe sheet, shoe close-up, location plate, surface
plate. Graded A at 480p after two fixes: distant window-grid texture removed from the blockout, and the
hair described from behind as well.

```
subject_definitions:
<Subject 1> is MAYA, a 19-year-old parkour runner: medium-brown skin, short curly black hair cropped close at the sides with bleached blond tips, the same short cut from behind (never a large round afro), black sleeveless compression top, charcoal joggers cuffed at the ankle, thin silver chain; her appearance comes from <Picture 1>. In <Video 1> she is the MONOLITH: the upright box with two gray capsule legs. Its RED face is the direction she faces, its BLACK face is her back, its GREEN faces are her sides and the top of her head. The monolith is only her position and orientation; nothing of its shape or colours is inherited.
<Subject 2> is the the running shoe she wears on both feet: neon-orange knit upper, chunky white sole with a black zig-zag tread, black laces, a white lightning-bolt mark on the heel; its appearance comes from <Picture 2> and <Picture 3>. In <Video 1> the shoes are the ORANGE blocks at the ends of the legs.
<Picture 4> is the world: brownstone rooftops at golden hour in a comic-book city, chimneys, a wooden water tank, AC units, metal railings, a blocky teal-and-blue skyline, a pink-orange sky, the sun low on the left.
<Picture 5> is the rooftop surface: tar paper, raised concrete ledges, a brick bulkhead wall with a metal door.
<Video 1> is the gray 3D previs of this sequence: it defines the ENTIRE camera path (position, framing, lens feel, handheld shake, whip pans), every cut and its time, and Maya's position and motion beat for beat. The gray boxes in it are rooftop structures (ledges, walls, chimneys, AC units, water tanks), never people or vehicles. The gray blocks with window grids in the distance are the colourful comic-book skyline of <Picture 4>: teal, blue and brick-red towers under the pink-orange sky, never gray. Every surface is re-coloured from <Picture 4> and <Picture 5>; nothing gray from <Video 1> survives.
summary: The target video is one Spider-Verse style comic-book animation sequence of <Subject 1> wearing <Subject 2>, doing parkour across the rooftops of <Picture 4>, cut and filmed exactly as <Video 1>.
retention_analysis:
<Subject 1> (appears in every shot): fully_preserved - face, hair, skin tone, wardrobe and the comic-book rendering exactly as in <Picture 1>.
<Subject 2> (appears in every shot): fully_preserved - shape, orange knit, white sole, tread and heel mark exactly as in <Picture 2> and <Picture 3>.
<Picture 4> (environment of every shot): partially_preserved - the rooftops, skyline, colours and golden-hour light are kept; the framing follows <Video 1>.
<Picture 5> (surfaces in every shot): partially_preserved - tar paper, concrete, brick and metal are kept; the layout follows <Video 1>.
<Video 1> (camera, cuts, timing, positions): partially_preserved - the camera path and shake, every cut at its exact time, the framing of each shot and Maya's position, orientation and timing are kept; its gray untextured look, the monolith and the capsule legs are replaced by the real character, shoes and rooftops in the comic-book style.
detailed_description: Spider-Verse style comic-book animation throughout, 2D/3D hybrid, cel shading with hard-edged shadows, coarse halftone dots in the shadows and the sky, cyan and magenta print misregistration on edges, thick tapered ink outlines, the character animated on twos with motion smears and speed lines on fast moves, golden hour, sun low on the left, long hard shadows. Exactly one person in the whole sequence. The reference pictures define appearance only and never appear as inserted stills; the only cuts are the ones listed below, at their times.
[Shot 1] 0.0-2.0s: extreme close-up at ledge height, 50 mm, subtle handheld shake: <Subject 1>'s right foot in <Subject 2> fills the frame side-on on a concrete rooftop ledge; the toe flexes, the heel lifts, the knit creases, the sole grips the edge; the city far below soft behind.
[Shot 2] At 00:02.000, the camera cuts to a knee-height close-up at the roof edge, 35 mm, strong handheld shake: <Subject 1>'s legs and <Subject 2> shoes pound past the lens left to right in a fraction of a second with a motion smear; the camera whip-pans right with large amplitude at fast speed with a quick zoom punch-in, then eases into chasing her back, waist up, as she sprints away toward a metal railing. Her BLACK side faces the camera: we see her back.
[Shot 3] At 00:04.500, the camera cuts to a hip-height medium close-up just past the waist-high railing, 35 mm: the rail fills the lower frame, she enters from the left at full sprint facing the camera, slaps her hand on the rail and swings both legs over it toward the lens in one continuous vault, landing close, torso and shoes filling the frame.
[Shot 4] At 00:06.500, the camera cuts to an extreme close-up at the foot of a brick bulkhead wall: a <Subject 2> sole slams flat onto the brick, the tread bites, a second step higher; the camera starts slow and snaps up with large amplitude at fast speed as she runs up the wall and over its top, ending on her back and legs pushing off across the next roof.
[Shot 5] At 00:08.500, the camera cuts to the one wide full-body shot, 85 mm, side-on from across the street, pink-orange sky behind: <Subject 1> sprints along the roof, leaps the 3 metre gap to the next rooftop with legs tucked then reaching, speed lines across the sky, the street far below; the camera pans right with large amplitude at fast speed through the whole jump while the lens creeps in slowly; she lands on the far ledge.
overall_soundscape: A breath and creaking knit, then pounding foot strikes on tar paper, a whoosh past the lens, a hand slap on the metal rail, two hard sole strikes on brick, wind in the jump, a heavy landing.
non_diegetic_music: A driving drum-and-bass beat with a hit on every impact.
```

## LTX-2.5
- Model card https://huggingface.co/Lightricks/LTX-2.5 ; guide https://docs.ltx.video/open-source-model/usage-guides/prompting-guide ;
  Comfy templates https://docs.comfy.org/tutorials/video/ltx/ltx-2-5
- One flowing paragraph, present tense, ≤ ~200 words: shot, scene, action, character, camera movement, audio.
  Spoken lines in quotation marks. No weight brackets, no quality-tag tail. Motion instructions first are followed
  more reliably. "Think like a cinematographer."
- i2v: describe what happens next, don't re-describe the start frame. flf2v: "describe the transition" between the
  two frames incl. camera and audio; keep the two frames' aspect identical.
- Style: front-load as the first clause (inferred from pattern, not quoted).

## Wan 2.2
- Formula: Subject + Scene + Motion + Camera Language + Atmosphere + Styling; the start of the prompt is weighted
  more, so subject → motion → camera → scene. Styles are whole-clip modifiers (e.g. "Line Art Animation",
  "Felt Style", "Pixel Game"). Be precise about what matters, leave the rest open.
  https://wan2-1.com/blogs/wan-2-2-prompting-guide

## Consistency across clips (community)
- Anchor on one high-res reference + a multi-angle sheet; lock a keyframe; attach references to every prompt instead of
  re-describing; chain last frame → next reference for long sequences. https://artlist.io/blog/consistent-character-ai/
- Timestamp prompting: 5 s blocks, one action + one camera move per block. https://artlist.io/blog/timestamp-prompting/

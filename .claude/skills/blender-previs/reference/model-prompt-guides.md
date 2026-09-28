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

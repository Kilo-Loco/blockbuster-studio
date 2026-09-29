# Per-shot take checklist (template)

Copy this next to the film's bible, fill it from the bible and `continuity.json`, and grade every take's
contact sheet against it *before* editing a prompt. One fix per retake. A = every line holds, B = one miss,
F = wrong subject, colour or geography. Only B and F change the prompt; write down which line failed.

## Common to every shot
- Look: photoreal (no CG, plastic or render look); skin, paint and asphalt have texture.
- Cast: exactly the subjects in `continuity.json` for this shot, nothing extra (no duplicate vehicles, no extra people).
- Identity: each subject matches its sheet (wardrobe, colour, bodywork, props).
- Geography: subjects on the side and in the third the anchor sentence names; the lead/trail order holds.
- Background: the location plate's setting, same side of the action axis as the previs; no walls, rooms or
  streets that were not in the blockout.
- Timing: the beat lands within ±0.5 s of the previs (`camera_log.json` beat time).
- Pacing: motion reads at the previs speed; nothing floats or drifts in slow motion.
- Text: none.

## Per shot
S<n> <name>: <anchor sentence from continuity.json>. Beat: <what happens, at t=…>. Ends on: <last-frame state>.

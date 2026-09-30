# "Outrun": the 15-second Blockbuster Studio promo (2026-09-30)

The first promo for the studio itself, made from scratch on a fresh template pod with the default stack.
The default stack: LTX-2.5 with the Ingredients reference sheet and the Blender previs depth pass, then the
studio's own 4K export. The work went through the agent path (studio API).
Kyle approved it as the promo. The bible, previs, assets and master are in
`~/Movies/blockbuster/promo_2026-09-30/` on Kyle's machine. `pod_backup/manifest.json` there holds every
asset's prompt, seed and parameters.

## The film
A rider on a bottle-green 1970s scrambler outruns a sunlit dust storm across a salt flat at golden hour.
The film opens on the gray previs, which wipes into the finished shot with the same camera. Four fast shots
follow, and the bike blows past the lens. An end card closes it: the clapperboard logo snaps shut on a clap
and opens back to its resting angle, then "Your own AI film studio. One GPU. One click." and
blockbuster.studio. 3840×2160, 24 fps, 2.39:1 letterbox, 15.0 s, −14 LUFS.

| # | shot | length | camera | take |
|---|---|---|---|---|
| 1 | REVEAL | 3.0 s | low 3/4 tracking at 0.6 m, 28 mm; previs → film wipe 0.9–1.7 s | r1, graded A |
| 2 | THROTTLE | 1.5 s | ECU on the right grip, rigged to the bike | r5 HD with a pinned keyframe |
| 3 | RIDER | 2.0 s | chest height looking up, push-in, storm behind | r1, graded A- |
| 4 | STORM | 2.5 s | 100 mm from 60 m, pan; tiny rider under the storm wall | r1, graded A |
| 5 | PASS | 1.6 s | lens on the salt; the bike passes 1.2 m right of it at 10.4 s, cut on the spray | r1, graded B+ at Fast, better at HD |

Why this concept:
- **The reveal.** The previs → film wipe is the format people share from Higgsfield's Blender posts, and it
  proves the main claim in a second: the camera, cut and timing are yours.
- **Staying inside what LTX has proven.** One character plus one vehicle, no dialogue, and no shot over 3 s.
  The face stays behind goggles and a bandana, where LTX identity is weakest.

## Pipeline as run
1. **Bible first** (`BIBLE.md`). It set the identity words, the action axis (always left to right,
   storm behind), the sun direction, the shot list with beat times, and a take checklist. Each stage's gate
   was written before the stage ran.
2. **Previs** (local Blender 5.2, about 1 minute per build).
   - The build agent started from `example_coast_build.py`. It gave the bike and rider real silhouettes
     (depth shape becomes final shape), kept the hero in the 2.39 safe area on every frame, and used real
     speed (about 25 m/s).
   - It rendered a separate 3840×2160 playblast of shot 1 for the wipe.
   - Review caught two framing faults before any render: shot 1 read head-on instead of 3/4, and shot 3
     looked down on the helmet.
3. **Sheets** (Z-Image, two candidates each, graded).
   - Both bike turnarounds had made-up lettering on the tank. Qwen-Image-Edit removed it from the whole
     sheet; editing a cropped half of it was a mistake.
   - Then the bike description was changed to match the sheet (spoked wheels, low brass exhaust), so the
     prompt and the sheet agree.
4. **Reference sheet.**
   - This exposed a product bug: prop panels ignored the prop's sheet slot and were a quarter-width strip.
   - Fixed in PR #19, then deployed to the pod: props use their sheet, and get a 40% bottom row and twice
     the location's width.
5. **Fast rounds.**
   - Round 1: two takes per shot, graded on the contact sheet and then on a frame strip of the shot's own
     window. Shots 1, 3 and 4 passed.
   - Shot 2 failed on bare hands, twice. Shot 5 passed at B+.
   - Shot 2 was fixed with a pinned Qwen-Edit keyframe (the previs frame plus the face sheet, which shows
     gloves and sleeves).
6. **HD** with the winning seeds (about 2.5 min per shot). HD takes differ from the Fast ones but kept every
   checklist line.
7. **Kyle's review of the 1080p preview** found two faults:
   - **Shot 2's background was static, "clearly AI".** Fix: 12–15 cm salt-crust ridges in the previs plus a
     shot-2-only depth remap (ground 2.6–25 m to the full range), and the motion written into the prompt.
   - **The storm was missing from shot 2.** Fix: the keyframe was edited with the location plate as the
     second input.
   - He also asked for the clapper to close fully, then reopen to the logo pose.
8. **4K**: the studio export with SeedVR2 (about 12 s per frame, one shot at a time), then a local finish.
   The finish is `edit.py`: the wipe with an amber line, labels in the letterbox bars, the end card rendered
   from HTML with the site's fonts, and a sound mix.

## What we learned
- **Close-ups are where the depth proxy beats the sheet.** At ECU the render followed the proxy's bare hand
  and forearm and ignored the sheet's gloves, and prompt wording did not fix it. A pinned keyframe from the
  previs frame plus the character sheet did. That keyframe needs the framing stated ("extreme close-up… do
  not zoom out"), otherwise the edit model widens the shot.
- **A flat ground gives the depth pass no motion.** With the camera rigged to the vehicle, a flat plane
  looks identical in depth every frame, and the render's background stood still.
  - A 6 cm ridge changed depth by about 5% from 1.1 m and was invisible.
  - 12–15 cm ridges plus remapping that shot's depth window made the ground stream past.
  - Rule: give ground and near surfaces real relief in any shot with a vehicle-mounted camera.
- **The world belongs in every shot.** Kyle asked for the storm behind the insert shot too. Plan the
  background of every shot in the bible, including close-ups, and put it in the keyframe when one is pinned.
- **The sheet and the description have to agree.** Once the sheet was fixed, the bike held its
  bottle-green tank and cream stripe in every shot. The earlier timed test's car had turned silver.
- **A shot's seed is read when the job runs, not when it's queued.** Queuing two renders of one shot with
  different seeds gives both the last value.
- **SeedVR2 over-sharpens tiny distant figures.** In shot 4 the rider (about 5% of frame height) gets a
  crinkled, plastic look at 100%, but reads fine at normal size. Close-ups and the storm upscale very well.
- **The export progress bar doesn't track SeedVR2.** It showed 25–39% while the job was near the end, and
  a stale export was cancelled late because of it.
- **LTX takes can hide a second subject after the window.** Fast takes render at least about 4 s, so the
  frames after a short shot's window can show another rider. Grade only the shot's own window, and cut there.

## Cost
Pod time was 8.6 h on a secure RTX PRO 4500 ($0.72/h), about **$6.19**. There were no API calls.
- **GPU work for the final film:** about $2.60 (sheets, 18 Fast and 9 HD takes, keyframes, the 4K export).
- **Avoidable:** about $3.60.
  - Waiting between stages for reviews and decisions: about 2.8 h.
  - The cancelled first 4K export, started before shot 2 was locked: about 0.8 h.
  - Idle after delivery, before the terminate went through: about 0.7 h.
  - Next time, lock every shot before the 4K export, stop the pod during long reviews, and check
    list-pods after a terminate.

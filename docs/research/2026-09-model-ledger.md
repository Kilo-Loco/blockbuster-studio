# Model ledger (showcase films, Sept 2026)

Every model used to make a showcase film, which job it did, and whether it made the final cut. This is the
input for choosing the definitive template stack: a model goes into a template only if a film here shows it
earned its place. Add a row whenever a film uses a model, including tests that lost.

Licence notes: MiniMax H3 excludes use in the US, EU, UK and South Korea (fine for the Japan launch; blocks
those markets). LTX-2.x is free under $10M annual revenue. Seedance is a paid API (fal), not self-hosted.

## Models

| Model | Studio engine / group | Licence | Job | Download |
|---|---|---|---|---|
| Z-Image Turbo | `zimage` / `image` | Apache 2.0 | sheets, plates, text-to-image keyframes | 20.7 GB |
| Qwen-Image-Edit 2511 | `qwen_edit` / `edit` | Apache 2.0 | blockout restyle, sheet edits into turnarounds | 31.3 GB |
| Wan 2.2 Fun-Control 14B | `wan_control` / `control` | Apache 2.0 | depth-driven control video | 38.0 GB |
| MiniMax H3 image-to-video | shot pipeline / `minimax` | MiniMax Community | first/last-frame clips with sound | 42.0 GB |
| MiniMax H3 Ref2VA | `h3_ref` / `minimax_ref` | MiniMax Community | sheets + previs to clip with sound | 42.1 GB |
| Wan 2.2 VACE-Fun A14B (fp8, Comfy-Org repack) | `wan_vace` / `wan_vace` | Apache 2.0 | sheet composite + previs (canny) to 5 s clip, silent | 44.1 GB (34.7 GB new; shares umt5, VAE, lightx2v LoRAs) |
| LTX-2.5 + LTX-2.3 IC-LoRA Union Control | `ltx_ic` / `ltx` + `ltx_ic` | LTX-2.x Community | previs (canny) + reference to clip with sound | 39.7 GB (gated, HF token) + 0.65 GB |
| LTX-2.5 Ingredients IC-LoRA | `ltx_ic` sheet mode / `ltx_ingredients` | LTX-2.x Community | reference-sheet identity for LTX | 1.3 GB (gated) |
| Seedance 2.5 reference-to-video | fal API (no engine yet) | paid API, $0.0214/1k tokens (480p/720p) | sheets + previs to 10 s clip with sound | none |

The IC-LoRA is published for LTX-2.3; Lightricks' own 2.5 example workflow pairs it with the LTX-2.5 distilled model.

## Per film

| Film | Sheets / keyframes | Video | Sound | Verdict |
|---|---|---|---|---|
| Paper Boat | Z-Image, Qwen-Image-Edit | MiniMax H3 I2V (first/last frame) | H3 | shipped |
| Quarter Mile (control pass) | Qwen-Image-Edit, Z-Image | Wan 2.2 Fun-Control | H3 I2V takes | shipped, CG look |
| Quarter Mile (Ref2VA pass) | Z-Image sheets | MiniMax H3 Ref2VA | H3 | better identity |
| First Step v1-v3 | Z-Image, Qwen-Image-Edit | MiniMax H3 Ref2VA | H3 | v3 closest to the bar |
| Coast Road (bake-off) | Z-Image, Qwen-Image-Edit | Seedance 2.5 (best, $2.47 per 480p run), H3 Ref2VA HD, LTX-2.5 + Ingredients + depth, Wan VACE-Fun (lost: proxy leaks, silent) | per model | LTX + Ingredients chosen as default (2026-09-29) |
| Outrun (studio promo) | Z-Image sheets, Qwen-Image-Edit (sheet clean-up, pinned keyframe) | LTX-2.5 + Ingredients + depth 0.7, SeedVR2 4K export | LTX | shipped as the promo (2026-09-30); see 2026-09-outrun-promo-showcase.md |

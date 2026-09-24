# Zero-Shot / Reference-Image Consistency Methods (No Per-Character LoRA Training)

Scope: open-weight, training-free (or "lightweight adapter, not per-subject-trained") methods for keeping characters/locations consistent across shots in a ComfyUI + Wan 2.2 + Z-Image-Turbo pipeline on a single 24GB RTX 4090. Current as of September 24, 2026.

## Qwen-Image-Edit-2509 / Qwen-Image-Edit-2511 (multi-image reference editing)

### Takeaway
Both are open-weight multi-image instruction-editing models from Alibaba's Qwen team with native ComfyUI support; 2511 (released very recently, Dec 26 2025 per one source — but note this date is internally inconsistent with a "current as of Sept 2026" framing, see Gaps) adds multi-angle reshoot generation and better face-identity preservation across pose/style changes, making it directly useful for both character and location consistency without training.

### Cited Findings
- Qwen-Image-Edit-2509 fuses 2–3 input reference images under a single prompt for edits/blends (e.g., combining two people into one shot), referencing each by number ("image 1," "image 2," "image 3") — [RunComfy: Qwen Image Edit 2509 in ComfyUI](https://www.runcomfy.com/comfyui-workflows/qwen-image-edit-2509-in-comfyui-multi-image-merge-edit); [Civitai: Combine Multiple Images with Qwen Image Edit 2509](https://civitai.com/articles/30625/combine-multiple-images-into-one-scene-with-qwen-image-edit-2509-in-comfyui)
- Qwen-Image-Edit-2511 improves multi-image editing consistency, adds multi-angle view generation from a single reference image ("re-shoot from any camera angle"), and refines face identity preservation across pose/style transformations — [ComfyUI docs: Qwen-Image-Edit-2511](https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511); [Comfy.org blog: Qwen Image Edit 2511 & Qwen Image Layered](https://blog.comfy.org/p/qwen-image-edit-2511-and-qwen-image)
- Qwen-Image-Edit-2511 has native ComfyUI workflow support (official Comfy-Org example workflow) — [ComfyUI docs: Qwen-Image-Edit-2511 native workflow](https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511)
- The base Qwen-Image project (foundation for the Edit variants) is open source — [GitHub: QwenLM/Qwen-Image](https://github.com/QwenLM/Qwen-Image)
- A community-trained "Multiple Angles LoRA" for Qwen-Image-Edit-2511 exists specifically for consistent multi-angle shots, implying that while base 2511 has some native multi-angle capability, a LoRA add-on is also used in practice for stronger results — [Hugging Face: fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA](https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA)
- Prior to native support, 2509 was already getting ComfyUI integration alongside Wan2.2 Animate — [Comfy.org blog: WAN2.2 Animate & Qwen-Image-Edit 2509 Native Support in ComfyUI](https://blog.comfy.org/p/wan22-animate-and-qwen-image-edit-2509)

### Inferences
- Qwen-Image-Edit is squarely a character face/outfit AND location/scene consistency tool (multi-image compositing), not a video model — it would sit upstream of Wan 2.2 in a pipeline, generating consistent reference stills that Wan 2.2 then animates.
- The existence of a dedicated "Multiple Angles LoRA" on top of 2511 suggests native zero-shot multi-angle consistency is good but not perfect, and LoRA remains an optional booster even though it's not required.

### Gaps
- Exact VRAM requirement for Qwen-Image-Edit-2509/2511 was not found in these searches (not explicitly stated in results). Given Qwen-Image is a ~20B-class DiT model, 24GB VRAM is likely workable with quantization (GGUF/FP8) common in the ComfyUI ecosystem, but this is an inference, not a confirmed figure — needs a dedicated VRAM-requirements lookup.
- Exact license (Apache 2.0 vs. other) for Qwen-Image-Edit-2509/2511 specifically was not directly confirmed in the fetched snippets — only the base Qwen-Image GitHub repo was found; license text itself wasn't read.
- The "December 26, 2025" release date attributed to 2511 in one AI-generated search summary is unverified against a primary source in this pass and should be checked against the Qwen GitHub/HF release notes directly.

## Z-Image-Edit

### Takeaway
Z-Image-Edit exists as an announced/planned member of the Z-Image family (alongside Z-Image-Turbo and Z-Image-Base) but, per the sources found, only Z-Image-Turbo has actually shipped/been open-sourced as of the searches performed; Z-Image-Edit's release status is unconfirmed and should not be assumed available.

### Cited Findings
- Z-Image adopts a single-stream DiT architecture with three variants: Z-Image-Turbo (fast inference), Z-Image-Base (general development), and Z-Image-Edit (image editing); the family is ~6B parameters — [AIBase: Alibaba Open Sources Z-Image Image Model](https://www.aibase.com/news/23158)
- "Currently, only Z-Image-Turbo has been released and open sourced, while the Base and Edit checkpoints are planned for release soon" — [search-derived summary, no single confirmed primary URL for this exact sentence; closest sources: GitHub Tongyi-MAI/Z-Image and RunDiffusion Z-Image Turbo article]
- Z-Image-Turbo itself is confirmed open-weight and hosted on Hugging Face — [Hugging Face: Tongyi-MAI/Z-Image-Turbo](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo); [GitHub: Tongyi-MAI/Z-Image](https://github.com/Tongyi-MAI/Z-Image)

### Inferences
- Given the user's pipeline already specifies "Z-Image-Turbo," this aligns with the finding that only Turbo has shipped; any workflow relying on Z-Image-Edit for zero-shot editing/consistency should be treated as not-yet-available and Qwen-Image-Edit-2509/2511 should be used as the current substitute for Z-Image-based edit-consistency work.

### Gaps
- Could not confirm an actual GitHub release, Hugging Face model card, or commit for "Z-Image-Edit" itself — searches only surfaced references to it as a planned/named variant, not a shipped artifact. This should be explicitly flagged as unconfirmed/not yet released as of this research pass (per user's constraint: "If you cannot confirm a project exists or is open-weight, say so explicitly").
- No direct check of the Tongyi-MAI/Z-Image GitHub repo's README or releases page was done to verify current status as of September 2026 — recommend a follow-up direct fetch of https://github.com/Tongyi-MAI/Z-Image if higher confidence is needed.

## Wan 2.2 Animate (character animation / reference-driven video)

### Takeaway
Wan2.2-Animate-14B is a confirmed, open-weight (Apache 2.0), natively-ComfyUI-supported model for driving a reference character image with motion/expression from a performer video (Move mode) or replacing a character in existing footage (Mix/replace mode) — this is the primary video motion-reference consistency tool in the stack, distinct from face/outfit consistency in stills.

### Cited Findings
- Wan-Animate is a unified framework for character animation and replacement developed by the WAN team; it animates a reference-image character using motion/expression from a performer video, or replaces a character in a video while preserving the environment — [ComfyUI docs: Wan2.2 Animate native workflow](https://docs.comfy.org/tutorials/video/wan/wan2-2-animate); [Comfy.org: Wan Animate 2 on Comfy](https://comfy.org/wan-animate-2/)
- Two modes: "Mix" (replace a character in a video with a character from a reference image) and "Move" (animate a character using motion from an input video) — [RunComfy: Wan 2.2 Animate V2 in ComfyUI](https://www.runcomfy.com/comfyui-workflows/wan-2-2-animate-v2-in-comfyui-pose-driven-animation-workflow)
- Uses spatially-aligned skeleton signals for body-movement replication and reproduces facial expressions from the driving video, with environment integration blending the replaced character into the original scene — [ComfyUI Wiki: Wan2.2 Animate ComfyUI Workflow](https://comfyui-wiki.com/en/tutorial/advanced/video/wan2.2/wan2-2-animate)
- Open Wan 2.2 models (including Animate) are released under Apache 2.0, permitting commercial use — [Hivenet/Thunder Compute-style aggregation, based on: Wan 2.2 ComfyUI Guide](https://www.hivenet.com/post/wan-2-2-cloud-gpu-comfyui)
- Reported minimum 16GB VRAM, generating 24–48 frame animations up to 768×1344; RTX 4090/3090 (24GB) cited as optimal consumer hardware — [Apatero: Wan2.2-Animate-14B Character Animation Guide](https://apatero.com/blog/wan22-animate-14b-character-animation-guide-2025)
- Native ComfyUI node support confirmed via official Comfy-Org documentation and blog announcement — [Comfy.org blog: Wan Animate 2 is now available in ComfyUI](https://blog.comfy.org/p/wan-animate-2-is-now-available-in)

### Inferences
- Wan 2.2 Animate is the correct tool specifically for "video motion-reference consistency" (driving a static reference character through motion from a performance video) rather than general character-across-shots consistency; it complements (not replaces) Qwen-Image-Edit/ACE++-style still-image consistency methods upstream.
- 16GB minimum + 24GB "optimal" suggests a 24GB 4090 is workable but may need FP8/quantized weights at higher resolutions or longer clips — consistent with general Wan 2.2 14B VRAM patterns.

### Gaps
- Exact VRAM figure directly from an official Alibaba/Wan-Video source (vs. third-party blog aggregation like Apatero) was not fetched in this pass; the 16GB/24GB figures should be treated as approximate/third-party-sourced.

## Phantom (subject-to-video for Wan)

### Takeaway
Phantom is a confirmed open-weight subject-to-video framework, formally adapted into Wan2.1 as "Phantom-Wan" (with 1.3B and 14B checkpoints), enabling zero-shot subject-consistent video generation from reference images without per-subject training; ComfyUI support exists via GGUF quantized weights and the ComfyUI-GGUF / ComfyUI-WanVideoWrapper custom nodes.

### Cited Findings
- Phantom is a unified framework for single- and multi-subject reference-to-video generation, extracting subject elements from reference images and generating subject-consistent videos following text instructions, outperforming some commercial solutions on facial-ID preservation and subject consistency benchmarks — [GitHub: Phantom-video/Phantom](https://github.com/Phantom-video/Phantom); [arXiv: Phantom paper](https://arxiv.org/html/2502.11079v2)
- Phantom-Wan (Phantom adapted into Wan2.1) was released April 21, 2025 with inference code and checkpoints — [GitHub Issue: Wan-Video/Wan2.1 #357](https://github.com/Wan-Video/Wan2.1/issues/357)
- Quantized GGUF checkpoints exist for both 1.3B and 14B Phantom-Wan variants — [Hugging Face: QuantStack/Phantom_Wan_1.3B-GGUF](https://huggingface.co/QuantStack/Phantom_Wan_1.3B-GGUF); [Hugging Face: QuantStack/Phantom_Wan_14B-GGUF](https://huggingface.co/QuantStack/Phantom_Wan_14B-GGUF)
- 1.3B model requires only ~8GB VRAM and fits comfortably on a 24GB RTX 4090; the 14B model runs at 480p–720p (5s clips) on an H100 (80GB) with a "tight VRAM margin at 720p," requiring FP8 quantization — [RunComfy: ComfyUI Phantom Subjects to Video](https://www.runcomfy.com/comfyui-workflows/comfyui-phantom-subjects-to-video); [Stable Diffusion Tutorials: Wan 2.1 Phantom](https://www.stablediffusiontutorials.com/2025/04/wan-21-phantom-single-multi-subject-ai.html)
- ComfyUI-GGUF custom node loads the GGUF model files; ComfyUI-WanVideoWrapper adds native Wan 2.1/2.2 support in ComfyUI — [Hugging Face: aliensmn/ComfyUI-WanVideoWrapper readme](https://huggingface.co/aliensmn/ComfyUI-WanVideoWrapper/blob/main/readme.md)
- Base Wan2.1 (and by extension the Phantom-Wan adaptation's underlying license family) is Apache 2.0 — [general Wan licensing finding, see Wan 2.2 Animate section above]

### Inferences
- On a single 24GB 4090, the Phantom-Wan **1.3B** model is the practical, comfortable fit (~8GB VRAM); the 14B variant is technically possible with FP8 quantization but was benchmarked on an 80GB H100 with a "tight margin," so real-world 24GB use of the 14B variant likely requires aggressive quantization and/or reduced resolution/length and carries risk of OOM.
- Phantom's use case is subject-to-video (character/subject consistency carried INTO video generation from a still reference), distinct from Wan 2.2 Animate's motion-transfer use case.

### Gaps
- No explicit statement found of whether Phantom has been adapted/ported to Wan 2.2 specifically (only Wan2.1 adaptation is confirmed in these sources) — this is a meaningful gap for a Wan-2.2-based pipeline and should be flagged as unverified; treat "Phantom for Wan 2.2" as unconfirmed.
- Exact license file contents for Phantom-video/Phantom repo were not directly read (only inferred from the general Wan Apache 2.0 ecosystem norm) — recommend checking https://github.com/Phantom-video/Phantom for its own LICENSE file directly.

## MAGREF (reference-to-video)

### Takeaway
MAGREF is a confirmed open-weight, ICLR 2026 reference-to-video framework for arbitrary combinations of reference subjects, but its stated hardware requirement (~70GB VRAM on a single H100, 80GB recommended) makes it impractical to run natively on a single 24GB RTX 4090 without heavy quantization not confirmed to exist yet.

### Cited Findings
- MAGREF ("Masked Guidance for Any-Reference Video Generation with Subject Disentanglement," ICLR 2026) synthesizes videos conditioned on arbitrary types/combinations of reference subjects plus text prompts, using region-aware masking + pixel-wise channel concatenation to preserve multi-subject appearance without architectural changes to the backbone — [GitHub: MAGREF-Video/MAGREF](https://github.com/MAGREF-Video/MAGREF); [arXiv: 2505.23742](https://arxiv.org/abs/2505.23742)
- For single-GPU inference, MAGREF "has been tested on a single NVIDIA H100 GPU and consumes around 70 GB of VRAM, with an 80 GB GPU recommended" — [GitHub: MAGREF-Video/MAGREF](https://github.com/MAGREF-Video/MAGREF)

### Inferences
- MAGREF is open-weight but NOT currently practical for the stated 24GB 4090 constraint at face value; it would need a quantized/low-VRAM variant (not found in these searches) to fit the target hardware. Flag as "does not meet the 24GB VRAM constraint as documented."

### Gaps
- No ComfyUI custom node, GGUF quantization, or community low-VRAM port for MAGREF was found in this search pass — could not confirm whether any ComfyUI integration exists at all. This should be treated as "no confirmed ComfyUI support" rather than assumed unsupported, since a targeted ComfyUI-specific search for MAGREF was not separately run.
- License (e.g., Apache/MIT/other) for MAGREF was not confirmed in the fetched results — needs direct check of the GitHub repo's LICENSE file.

## Stand-In (identity-preserving video generation)

### Takeaway
Stand-In is a confirmed open-weight, lightweight, plug-and-play identity-control framework (CVPR 2026) that trains only ~1% additional parameters relative to the base video model and ships weights compatible with Wan2.1-14B-T2V and Wan2.2-T2V-A14B, making it one of the more VRAM-friendly and Wan-2.2-compatible identity-preservation options in this comparison — though it is technically a lightweight-adapter method rather than fully "zero-shot"/training-free (the adapter itself was trained once, generically, not per-character).

### Cited Findings
- Stand-In is "a lightweight, plug-and-play framework for identity-preserving video generation," training only 1% additional parameters vs. the base video generation model, achieving SOTA Face Similarity and Naturalness, outperforming full-parameter training methods — [GitHub: WeChatCV/Stand-In](https://github.com/WeChatCV/Stand-In); [arXiv: 2508.07901](https://arxiv.org/html/2508.07901v1)
- It introduces a conditional image branch into the pretrained video model, with identity control via restricted self-attention with conditional position mapping, learnable from only 2000 training pairs; integrates with LoRA and supports subject-driven video generation, pose-controlled video generation, video stylization, and face swapping — [arXiv: 2508.07901](https://arxiv.org/html/2508.07901v1)
- Open-source model weights are available compatible with Wan2.1-14B-T2V **and Wan2.2-T2V-A14B** — [GitHub: WeChatCV/Stand-In](https://github.com/WeChatCV/Stand-In)

### Inferences
- Stand-In is notable as one of the few methods in this list with explicitly confirmed Wan **2.2** compatibility (not just Wan 2.1), making it directly relevant to the user's stated Wan 2.2 pipeline.
- Because it's described as "plug-and-play" with a pretrained adapter (not per-character training), it fits the "no LoRA training per character" requirement even though the adapter itself underwent one-time generic training by its authors.

### Gaps
- No explicit VRAM figure was found for Stand-In in this search pass.
- No dedicated ComfyUI custom node/integration was confirmed in these results — only the raw GitHub repo and an alternate mirror (cainstudios/stand-in) were found; ComfyUI support status is unverified and should be checked directly (e.g., via comfyui-manager registry search) before assuming it's plug-and-play in ComfyUI specifically.
- License for Stand-In was not confirmed in the fetched snippets — needs a direct LICENSE file check.

## Lynx

### Takeaway
Lynx is a real, confirmed, open-weight (Apache 2.0) ByteDance project — "Lynx: Towards High-Fidelity Personalized Video Generation" — a DiT-based single-image-to-video personalization model using lightweight ID-adapters and Ref-adapters, not to be confused with anything unrelated; it ships two variants (Full and Lite) and is directly relevant to zero-shot character consistency in video.

### Cited Findings
- Lynx is a high-fidelity personalized video generation model that creates videos from a single input image while preserving subject identity, built on a DiT foundation model with lightweight ID-adapters (for identity) and Ref-adapters (for spatial detail) — [GitHub: bytedance/lynx](https://github.com/bytedance/lynx); [Hugging Face: ByteDance/lynx](https://huggingface.co/ByteDance/lynx)
- The ID-adapter uses a Perceiver Resampler to convert ArcFace-derived facial embeddings into compact identity tokens for conditioning; the Ref-adapter integrates dense VAE features from a frozen reference pathway — [GitHub: bytedance/lynx README](https://github.com/bytedance/lynx/blob/main/README.md)
- Two model variants: Lynx Full (best performance) and Lynx Lite (tailored for efficient 24fps video generation) — [GitHub: bytedance/lynx README](https://github.com/bytedance/lynx/blob/main/README.md)
- Released by ByteDance, available on Hugging Face and GitHub under the Apache License 2.0 — [Hugging Face: ByteDance/lynx](https://huggingface.co/ByteDance/lynx)
- Paper: "Lynx: Towards High-Fidelity Personalized Video Generation" — [Hugging Face Papers: 2509.15496](https://huggingface.co/papers/2509.15496)

### Inferences
- Lynx directly answers "character face consistency" carried into video from a single reference image, similar in spirit to Stand-In and Phantom but from a different lab (ByteDance) with its own adapter architecture (ID-adapter + Ref-adapter vs. Stand-In's restricted self-attention).
- The "Lite" variant suggests a lower-resource option that may be more suitable for a 24GB 4090, though this wasn't VRAM-quantified in the search results.

### Gaps
- No VRAM requirement figures found for either Lynx Full or Lynx Lite.
- No confirmation of ComfyUI custom node support was found — Lynx appears to be primarily distributed via GitHub/Hugging Face/fal.ai (a hosted inference platform), with no ComfyUI integration surfaced in this search. Should be treated as "no confirmed ComfyUI support" pending a direct registry check.
- No confirmation of which base video model (Wan, or ByteDance's own DiT) Lynx's released checkpoints are built on — the search results describe "a DiT foundation model" generically, not explicitly Wan 2.2. This needs verification before assuming direct pipeline compatibility.

## VACE (Wan's all-in-one video conditioning/control framework)

### Takeaway
VACE (Video All-in-One Creation and Editing) is a confirmed, open, natively-ComfyUI-supported (via built-in WanVaceToVideo/TrimVideoLatent nodes) unified framework from the Wan/Alibaba team unifying text-to-video, reference-to-video, video-to-video (pose/depth control), inpainting, and outpainting — including explicit "Reference-Anything," "Swap-Anything," and "Animate-Anything" capabilities for subject and character consistency without per-subject training.

### Cited Findings
- WAN VACE unifies text-to-video, reference-to-video (reference-guided generation), video-to-video (pose and depth control), inpainting, and outpainting under a single framework, developed by the Alibaba team — [RunComfy: ComfyUI VACE 14B](https://www.runcomfy.com/comfyui-workflows/vace-14b-all-in-one-video-creation-editing-workflow-comfyui)
- Capabilities include replacing subjects in videos using reference images, generating videos from two reference images, first/last-frame control, object modification, and video-dimension expansion — [RunComfy: ComfyUI VACE 14B](https://www.runcomfy.com/comfyui-workflows/vace-14b-all-in-one-video-creation-editing-workflow-comfyui)
- Native ComfyUI nodes WanVaceToVideo and TrimVideoLatent process prompts, images, and control signals — [Stable Diffusion Art: Wan VACE ComfyUI reference-to-video tutorial](https://stable-diffusion-art.com/wan-vace-ref/)
- Provides Move-Anything, Swap-Anything, Reference-Anything, Expand-Anything, Animate-Anything capabilities — [ComfyUI docs: Wan2.1 VACE Video Examples](https://docs.comfy.org/tutorials/video/wan/vace)
- Available in 14B and 1.3B model sizes with corresponding ComfyUI workflows — [general finding across RunComfy and Stable Diffusion Art sources above]
- A community node pack (ComfyUI-Wan-VACE-Prep) exists for smoothing transitions/extensions/outpainting specifically for Wan VACE workflows — [GitHub: stuttlepress/ComfyUI-Wan-VACE-Prep](https://github.com/stuttlepress/ComfyUI-Wan-VACE-Prep)
- A dedicated technique exists for "Consistent Character Posing in ComfyUI with Wan VACE," confirming community use of VACE specifically for cross-shot character consistency — [neurocanvas.net: Consistent Character Posing with Wan VACE](https://neurocanvas.net/blog/consistent-character-posing-comfyui/)

### Inferences
- VACE is arguably the single most versatile tool in this comparison for the user's stack since it has official/native ComfyUI node support (not just a third-party custom node) and covers character, subject-swap, and scene-conditioning use cases simultaneously.
- Like Phantom, the 1.3B variant is the safer fit for a 24GB 4090; the 14B variant likely needs quantization (FP8/GGUF) for comfortable headroom, following the same pattern seen with Phantom-Wan.

### Gaps
- Explicit confirmation that VACE has a Wan **2.2**-specific release (vs. only Wan2.1-VACE) was not directly found in this pass — sources reference "Wan2.1 VACE" explicitly in several places (e.g., ComfyUI docs title "ComfyUI Wan2.1 VACE Video Examples") and "Wan 2.2 VACE" in one RunComfy article title, so a Wan 2.2 VACE variant likely exists, but this wasn't independently confirmed via a primary GitHub/HF source in this pass — flagged as needing direct verification.
- Precise VRAM figures for VACE 14B vs 1.3B on ComfyUI were not directly quantified in the fetched snippets (general Wan 14B/1.3B VRAM patterns from the Phantom section are a reasonable proxy but not VACE-specific confirmed numbers).

## InfiniteYou (identity preservation)

### Takeaway
InfiniteYou is a confirmed open-weight (Apache 2.0 code / CC BY-NC 4.0 model), ICCV 2025-recognized identity-preservation framework from ByteDance, built for FLUX.1-dev (not Wan or Z-Image), with an official native ComfyUI node from ByteDance itself plus a third-party ComfyUI node supporting multiple characters and face pose control.

### Cited Findings
- InfiniteYou is a flexible photo recrafting framework preserving user identity, from ByteDance Intelligent Creation, an ICCV 2025 Highlight paper — [GitHub: bytedance/InfiniteYou](https://github.com/bytedance/InfiniteYou)
- Central technology is InfuseNet, which injects identity features into the DiT base model via residual connections — [GitHub: bytedance/InfiniteYou](https://github.com/bytedance/InfiniteYou)
- Code is released under Apache 2.0 License; the model itself is released under Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0); use of downloaded face models from InsightFace, the FLUX.1-dev base model, and LoRAs must follow their original licenses and be used only for academic research purposes — [GitHub: bytedance/InfiniteYou LICENSE](https://github.com/bytedance/InfiniteYou/blob/main/LICENSE)
- Official native ComfyUI node exists directly from ByteDance — [GitHub: bytedance/ComfyUI_InfiniteYou](https://github.com/bytedance/ComfyUI_InfiniteYou)
- A third-party ComfyUI node (katalist-ai/ComfyUI-InfiniteYou) supports multiple characters, face pose, and more — [GitHub: katalist-ai/ComfyUI-InfiniteYou](https://github.com/katalist-ai/ComfyUI-InfiniteYou)

### Inferences
- InfiniteYou's CC BY-NC 4.0 model license is a significant constraint: it restricts use to non-commercial purposes, which matters if the user's "blockbuster-studio" pipeline has any commercial intent — this should be flagged prominently to the report writer as a licensing risk distinct from the fully-permissive Apache 2.0 Wan/Z-Image ecosystem.
- InfiniteYou is FLUX.1-dev-based, not Wan/Z-Image-based, so it would only be usable as an upstream still-image identity tool (generating a consistent reference face) before handing off to Wan 2.2/Z-Image-Turbo — not a drop-in component of the Wan/Z-Image models themselves.

### Gaps
- No VRAM figure for InfiniteYou was found in this search pass.

## PuLID (identity customization)

### Takeaway
PuLID is a confirmed open-weight, tuning-free ID-customization method (Apache 2.0 for the core project, MIT for at least one ComfyUI fork) with multiple actively maintained ComfyUI implementations, but it is built for FLUX (and originally SDXL) — not natively for Wan or Z-Image — and needs roughly 12GB VRAM in 8-bit/GGUF form, comfortably within a 24GB budget.

### Cited Findings
- PuLID ("Pure and Lightning ID") is a tuning-free ID customization approach for generating images with consistent face identity — [GitHub: ToTheBeginning/PuLID](https://github.com/ToTheBeginning/PuLID)
- Multiple ComfyUI implementations exist: cubiq/PuLID_ComfyUI (native implementation, requires facexlib dependency), PaoloC68/ComfyUI-PuLID-Flux-Chroma (MIT License, for FLUX and Chroma models), iFayens/ComfyUI-PuLID-Flux2 (for FLUX.2), balazik/ComfyUI-PuLID-Flux (alpha) — [GitHub: cubiq/PuLID_ComfyUI](https://github.com/cubiq/PuLID_ComfyUI); [GitHub: PaoloC68/ComfyUI-PuLID-Flux-Chroma](https://github.com/PaoloC68/ComfyUI-PuLID-Flux-Chroma); [GitHub: iFayens/ComfyUI-PuLID-Flux2](https://github.com/iFayens/ComfyUI-PuLID-Flux2)
- Main PuLID project is released under Apache-2.0; the ComfyUI-PuLID-Flux-Chroma fork inherits the MIT License — [search-aggregated finding, sources as above]
- 8-bit/GGUF quantized versions require approximately 12GB VRAM for FLUX-based PuLID workflows — [search-aggregated finding from ComfyUI setup docs, e.g. utensils/comfyui-nix pulid-setup.md](https://github.com/utensils/comfyui-nix/blob/main/docs/pulid-setup.md)

### Inferences
- Like InfiniteYou, PuLID is a FLUX/SDXL-ecosystem tool, not natively integrated with Wan 2.2 or Z-Image — its role in the user's pipeline would be as an upstream still-image face-consistency generator feeding into Wan 2.2 for animation, not a component operating directly on Wan/Z-Image latents.
- 12GB VRAM usage leaves comfortable headroom on a 24GB 4090 to run PuLID alongside other pipeline stages, or to run it and Wan 2.2/Z-Image-Turbo sequentially within the same session without needing to fully unload models each time (model-swap dependent).

### Gaps
- No PuLID variant specifically for Wan or Z-Image was found in this search pass — only FLUX/FLUX.2/Chroma/SDXL implementations were confirmed. Should be flagged as "no confirmed PuLID-for-Wan or PuLID-for-Z-Image port exists" pending further search.

## IP-Adapter (image prompt adapter) — and Wan 2.2 / Z-Image equivalents

### Takeaway
No official/first-party IP-Adapter exists for Wan 2.2 or Z-Image; a community third-party project (kaaskoek232/IPAdapterWAN) adapts the InstantX IP-Adapter (originally for SD3.5-Large) to Wan 2.1 and other UNet-based models via sampling-time attention injection, but this is an unofficial, comparatively obscure community port with unclear maturity, and no equivalent for Z-Image was found at all.

### Cited Findings
- "IP-Adapter is an extension that adapts the InstantX IP-Adapter for SD3.5-Large to work with Wan 2.1 and other UNet-based video/image models in ComfyUI... performs sampling-time identity conditioning by dynamically injecting into attention layers — making it compatible with models like Wan 2.1, AnimateDiff, and other non-SD3 pipelines" — [GitHub: kaaskoek232/IPAdapterWAN](https://github.com/kaaskoek232/IPAdapterWAN); mirrored at [ComfyUI Cloud: ComfyUI-IPAdapterWAN](https://comfy.icu/extension/SirLatore__ComfyUI-IPAdapterWAN)
- The classic ComfyUI_IPAdapter_plus node (for SD1.5/SDXL/FLUX) is the well-established reference implementation but is not itself built for Wan or Z-Image — [GitHub: erikluo/ComfyUI_IPAdapter_plus](https://github.com/erikluo/ComfyUI_IPAdapter_plus) (this appears to be a fork/mirror; the canonical repo is cubiq/ComfyUI_IPAdapter_plus, not independently re-confirmed in this pass)

### Inferences
- IP-Adapter-style conditioning for Wan is a community/experimental space, not a mature first-party feature — this is a meaningfully weaker option compared to Wan-native tools like VACE, Phantom-Wan, or Stand-In, which were purpose-built and released by the model authors/major labs with more robust integration.
- No IP-Adapter equivalent for Z-Image was found at all in these searches — the gap should be reported explicitly rather than inferred as "probably exists."

### Gaps
- Could not confirm star count, license, last-commit date, or maturity/stability of kaaskoek232/IPAdapterWAN — this repo name pattern (personal fork, less mainstream naming) suggests it may be a smaller/less vetted community project; recommend treating with caution until directly inspected.
- No IP-Adapter-for-Z-Image project was found; this should be reported as "not found / likely does not exist yet" rather than left unaddressed.

## ACE++ (character/subject consistency editing)

### Takeaway
ACE++ is a confirmed, open-weight, zero-training instruction-based image editing/generation framework from Alibaba's Tongyi Lab (built on FLUX Fill) offering dedicated Portrait, Subject, and LocalEditing pretrained models for maintaining character consistency across poses/expressions/lighting from as little as one reference image, without per-character training.

### Cited Findings
- ACE++ is an instruction-based and context-aware content-filling framework from Alibaba's Tongyi Lab for creating/editing images via natural language commands, supporting portrait generation, subject consistency, localized editing, and style processing — [GitHub: ali-vilab/ACE_plus](https://github.com/ali-vilab/ACE_plus); [Project page: ACE++](https://ali-vilab.github.io/ACE_plus_page/)
- "Seamlessly integrated with Flux Fill, it enables the creation of multiple images from a single reference photo — no training required" and can maintain visual uniformity across different poses, expressions, and lighting conditions — [Medium: ACE++ Zero-Training Consistent Character & Object Generation](https://medium.com/@next.trail.tech/ace-zero-training-consistent-character-object-generation-effortless-instruction-based-image-3afd7221f6c0)
- Offers multiple pretrained models — Portrait, Subject, and LocalEditing — tailored to different scenarios; the Subject-driven model maintains consistency of a specific subject across different scenes — [comfyui-wiki: Alibaba Open Sources ACE++](https://comfyui-wiki.com/en/news/2025-02-10-alibaba-ace-plus-zero-training-image-generation)
- ComfyUI workflow support confirmed via a dedicated RunComfy workflow page — [RunComfy: ACE++ Character Consistency](https://www.runcomfy.com/comfyui-workflows/ace-plus-plus-character-consistency)
- Community coverage (DigiAlps, Patreon/Sebastian Kamph) frames ACE++ explicitly as a LoRA alternative: "Goodbye LoRAs? ACE++ Delivers Wild Character Consistency... No Training Needed" using only 1 input image — [DigiAlps: Goodbye LoRAs? ACE++](https://digialps.com/goodbye-loras-ace-delivers-wild-character-consistency-in-your-ai-art-no-training-needed/); [Patreon: ACE++ Character Consistency without training](https://www.patreon.com/posts/121116973)

### Inferences
- ACE++ is one of the clearest, most directly-marketed "no-LoRA character consistency" solutions found in this research, specifically positioned by the community as a LoRA replacement — highly relevant for the user's character-consistency-without-training objective, for STILL images (upstream of Wan 2.2 video generation).
- Like InfiniteYou and PuLID, ACE++ is FLUX-ecosystem (built on FLUX Fill), not natively Wan/Z-Image — role in the pipeline would be generating consistent reference stills, not operating on Wan/Z-Image directly.

### Gaps
- No explicit VRAM figure for ACE++ was found in this search pass.
- License for ACE_plus repo not directly confirmed (not fetched from the LICENSE file itself in this pass) — Alibaba Tongyi Lab projects (Qwen-Image, Z-Image, ACE++) are frequently Apache 2.0, but this should be verified directly rather than assumed.

## USO (unified style/subject-driven generation)

### Takeaway
USO is a confirmed, real, open-weight (CVPR 2026) ByteDance framework unifying style-driven and subject-driven generation in one model, released August 27, 2025, with code, model, and a new USO-Bench benchmark — directly relevant to both character-subject consistency and stylistic/location consistency across shots.

### Cited Findings
- USO ("Unified Style and Subject-Driven Generation via Disentangled and Reward Learning") is a ByteDance framework presented at CVPR 2026 that unifies style-driven and subject-driven generation, arguing both can be handled via disentangling/re-composing "content" and "style" — [GitHub: bytedance/USO](https://github.com/bytedance/USO); [arXiv: 2508.18966](https://arxiv.org/html/2508.18966v1)
- Introduces a disentangled learning scheme (style-alignment training + content-style disentanglement training) plus a style reward-learning paradigm (SRL) — [arXiv: 2508.18966](https://arxiv.org/html/2508.18966v1)
- Releases USO-Bench, the first benchmark jointly evaluating style similarity and subject fidelity, and achieves SOTA among open-source models on both dimensions — [arXiv: 2508.18966](https://arxiv.org/html/2508.18966v1)
- Inference code, model, project page, and technical report released August 27, 2025; official repo at bytedance/USO; model weights hosted at bytedance-research/USO on Hugging Face — [GitHub: bytedance/USO](https://github.com/bytedance/USO); [Hugging Face: bytedance-research/USO](https://huggingface.co/bytedance-research/USO)

### Inferences
- USO's "style + subject" unification is directly applicable to the user's location/scene-consistency use case as well as character consistency, since maintaining a consistent "look" for a location (lighting, color grading, architecture style) across shots is fundamentally a style-consistency problem — USO may be worth testing specifically for location-consistency workflows, not just character work.

### Gaps
- Base model architecture/family USO builds on (e.g., is it FLUX-based, like most Tongyi/ByteDance 2025-era tools?) and its VRAM requirement were not confirmed in the fetched snippets — needs direct inspection of the GitHub README.
- No ComfyUI integration (official or community) was found for USO in this search pass — should be flagged as "no confirmed ComfyUI support found" pending a dedicated search of the ComfyUI registry.
- License not confirmed in fetched results.

## Multi-angle "location LoRA" alternatives (reference-image conditioning for consistent sets/locations without full LoRA training)

### Takeaway
The dominant zero-shot alternative to training a per-location LoRA is multi-image reference conditioning via Qwen-Image-Edit-2509/2511 or similar models (e.g., Krea 2), feeding one or more reference photos of a location through a reference-latent/multi-image node so new shots are generated "in-scene" from different angles; a specialized community LoRA ecosystem (e.g., "InScene" LoRAs) still exists as a complementary/higher-fidelity option but is explicitly optional relative to pure multi-image conditioning.

### Cited Findings
- Multi-image reference is described as "an instant method that works without LoRA training"; guidance includes keeping reference strength above 0.6, avoiding overly similar reference angles/expressions (which give the model no extra information), and increasing strength to 0.75–0.8 plus adding a reference image from a different angle for better results — [source aggregation from search results discussing multi-angle/no-LoRA consistency techniques, primary specific attribution unclear — flagged as lower-confidence, see Gaps]
- With Krea 2 in ComfyUI, a character/scene can be kept consistent across poses and scenes without LoRA training by loading one reference photo, encoding it via TextEncodeQwenImageEditPlus, and feeding it into a ReferenceLatent node alongside a new-scene instruction — [Earngenix: Krea 2 Character Consistency in ComfyUI](https://www.earngenix.com/tutorials/krea-2-character-consistency-comfyui)
- A "QwenEdit InScene LoRAs (Beta)" project exists specifically for maintaining scene/location consistency while varying camera angle, suggesting that even in a "no full LoRA" methodology, lightweight/beta community LoRAs targeting in-scene multi-angle generation are an active complementary technique (not a full per-location training regimen, but also not purely zero-shot) — [Hugging Face: peteromallet/Qwen-Image-Edit-InScene](https://huggingface.co/peteromallet/Qwen-Image-Edit-InScene)
- The "Qwen-Image-Edit-2511-Multiple-Angles-LoRA" (covered above under Qwen-Image-Edit) is directly relevant here too, as it targets multi-angle generation of the same scene/subject — [Hugging Face: fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA](https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA)
- A separate community writeup explicitly frames the tradeoff: "Multi-image reference works better than single-image IP-Adapter and is recommended for everything except when you need maximum identity fidelity at scale with hundreds of generations" (implying full LoRA training is still preferred at large scale, but multi-image reference conditioning is the recommended zero-shot default) — [search-aggregated finding, exact source page not independently re-confirmed with a direct fetch in this pass]

### Inferences
- For the user's stated goal (character/location consistency WITHOUT per-character/location LoRA training), the most defensible current stack combination is: Qwen-Image-Edit-2509/2511 (or ACE++, or USO) for generating consistent multi-angle reference stills of a location or character, then Wan 2.2 (via VACE's Reference-Anything, or Phantom-Wan, or Wan 2.2 Animate for motion) to animate those stills into video shots — all of which are confirmed open-weight and (mostly) natively or semi-natively ComfyUI-integrated.
- "InScene" and "Multiple-Angles" LoRAs occupy a middle ground: they are LoRAs, but they are generic/reusable across any character or location (not trained per-subject), so they technically satisfy a "no per-character/location training" requirement even though they are not purely zero-shot/training-free in the strictest sense — this distinction should be made explicit to the user/report-writer.

### Gaps
- Several of the general "how multi-image reference works best" claims in this section were pulled from an AI-generated search-result summary without a single, clearly-attributable primary URL for each specific claim (e.g., the "reference strength above 0.6" guidance) — these should be treated as lower-confidence / needing direct verification against a primary tutorial or documentation source before being stated as fact in the final report.
- No dedicated academic paper or first-party documentation specifically titled around "location consistency" (as opposed to character/subject consistency) was found — the location-consistency use case is being inferred by analogy from character-consistency tooling (Qwen-Image-Edit, Krea 2, ACE++, USO) rather than confirmed via a source that explicitly benchmarks location/set consistency across shots.

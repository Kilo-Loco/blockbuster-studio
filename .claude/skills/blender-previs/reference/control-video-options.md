# Control video (Blender greybox → AI video) on our stack — research 2026-09-27

Ranked for a 24 GB 4090 running ComfyUI with Wan 2.2 A14B I2V, LTX-2.5 and MiniMax H3 installed:

1. **Wan 2.2 Fun-Control (or VACE-Fun)** — native ComfyUI node `Wan22FunControlToVideo`, ready template
   `Comfy-Org/workflow_templates/templates/video_wan2_2_14B_fun_control.json`, fp8-scaled files
   `wan2.2_fun_control_{high,low}_noise_14B_fp8_scaled.safetensors` in `Comfy-Org/Wan_2.2_ComfyUI_Repackaged`
   (+ `wan_2.1_vae.safetensors`, `umt5_xxl_fp8_e4m3fn_scaled.safetensors`). Controls: canny, depth, pose, MLSD,
   trajectory; takes a reference image. RTX 4090D 640×640×81 frames: ~79–138 s with the lightx2v 4-step LoRAs
   at ~89 % VRAM. Apache-2.0. Community: VACE-Fun holds identity from the reference better; Fun-Control follows
   the control video better but identity/outfit drift; works best when the reference image's composition matches
   the first control frame; Depth Anything V2 maps beat raw Z-depth in one test. Integration effort: low.
   - https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-Control
   - https://huggingface.co/alibaba-pai/Wan2.2-VACE-Fun-A14B
   - https://docs.comfy.org/tutorials/video/wan/wan2-2-fun-control
   - https://comfyui-wiki.com/en/comfyui-nodes/conditioning/video-models/wan-fun-control-to-video
2. **MiniMax H3 Fun ControlNet-Union 2.0** — `MiniMax-H3-Fun-Controlnet-Union-2.0.safetensors` (~13.5 GB) + yaml;
   canny/depth/HED/MLSD/pose/sketch/bbox/luminance; 10 injection points (tightest adherence, most likely to copy
   box shapes). ComfyUI native support merged ~2026-09-22 (Comfy-Org/ComfyUI#16471) but fresh and buggy, no
   example workflow; +13.5 GB on top of int8 H3 is an OOM risk on 24 GB. MiniMax community license. Effort: medium-high.
   - https://huggingface.co/alibaba-pai/MiniMax-H3-Fun-Controlnet-Union-2.0
3. **LTX IC-LoRA Union Control** — `Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control` (canny+depth+pose),
   node `LTXAddVideoICLoRAGuide` in Lightricks/ComfyUI-LTXVideo, example workflows under `example_workflows/2.3/`.
   Documented against LTX-2.3, not 2.5; docs cite 32 GB+ VRAM. Effort: high / unverified. Hold.
   - https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Union-Control
   - https://github.com/Lightricks/ComfyUI-LTXVideo

Depth source: render Blender's Z / Mist pass directly (ground truth, no flicker) and normalise it; use
`DepthAnythingV2Preprocessor` (Fannovel16/comfyui_controlnet_aux) only for footage without a Blender source.

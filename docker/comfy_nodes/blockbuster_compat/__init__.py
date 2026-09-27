# Blockbuster Studio compatibility shims for ComfyUI. No nodes; runs once at import.
#
# comfy-kitchen's prebuilt CUDA extension is compiled with CUDA 13 and needs NVIDIA driver r580+.
# ComfyUI turns off kitchen's CUDA *backend* when torch is older than cu130 (ours is cu128), but
# MiniMax H3 calls kitchen's INT8 attention kernel directly after a GPU-generation check that
# ignores the driver: the DiT through ComfyAttention ("comfy_kitchen_int8" in the checkpoint) and
# the video VAE through `comfy.quant_ops.ck.int8_attention`. On an older Runpod host that fails
# mid-generation with "detect_k_anchor kernel launch failed: CUDA driver version is insufficient
# for CUDA runtime version". Below CUDA 13, route all of it to PyTorch attention instead.
import ctypes
import logging
import sys

NODE_CLASS_MAPPINGS = {}
MIN_DRIVER_CUDA = 13000  # cuDriverGetVersion encoding: 1000 * major + 10 * minor
FLAG = 'COMFY_KITCHEN_INT8_ATTENTION_IS_AVAILABLE'


def _driver_cuda_version():
    try:
        version = ctypes.c_int()
        if ctypes.CDLL("libcuda.so.1").cuDriverGetVersion(ctypes.byref(version)) == 0:
            return version.value
    except OSError:
        pass
    return None


def _use_pytorch_attention():
    import torch.nn.functional as F
    import comfy_kitchen

    def sdpa(q, k, v, *, scale=None, attn_mask=None):
        # Same [batch, heads, sequence, head_dim] contract as comfy_kitchen.int8_attention.
        return F.scaled_dot_product_attention(q, k, v, attn_mask=attn_mask, scale=scale, enable_gqa=q.shape[1] != k.shape[1])

    comfy_kitchen.int8_attention = sdpa
    comfy_kitchen.int8_attention_is_available = lambda *args, **kwargs: False
    # Modules imported before this shim copied the flag (e.g. comfy.ldm.minimax.vae).
    for module in list(sys.modules.values()):
        if getattr(module, FLAG, None) is True:
            setattr(module, FLAG, False)


driver = _driver_cuda_version()
if driver is not None and driver < MIN_DRIVER_CUDA:
    try:
        _use_pytorch_attention()
        logging.warning(
            "[blockbuster] host driver supports CUDA %d.%d (< 13.0): using PyTorch attention instead of comfy-kitchen int8 attention",
            driver // 1000, (driver % 1000) // 10,
        )
    except Exception as e:  # never block ComfyUI startup over a shim
        logging.warning("[blockbuster] could not apply the int8-attention driver fallback: %s", e)

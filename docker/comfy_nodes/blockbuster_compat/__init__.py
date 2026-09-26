# Blockbuster Studio compatibility shims for ComfyUI. No nodes; runs once at import.
#
# comfy-kitchen's prebuilt CUDA extension is compiled with CUDA 13 and needs NVIDIA driver r580+.
# ComfyUI turns off kitchen's CUDA *backend* when torch is older than cu130 (ours is cu128), but
# checkpoints that request "comfy_kitchen_int8" attention (MiniMax H3's int8_convrot DiT) call the
# kernel directly after a GPU-generation check that ignores the driver. On an older Runpod host that
# fails mid-generation with "detect_k_anchor kernel launch failed: CUDA driver version is
# insufficient for CUDA runtime version". Below CUDA 13, fall back to PyTorch attention instead.
import ctypes
import logging

NODE_CLASS_MAPPINGS = {}
MIN_DRIVER_CUDA = 13000  # cuDriverGetVersion encoding: 1000 * major + 10 * minor


def _driver_cuda_version():
    try:
        version = ctypes.c_int()
        if ctypes.CDLL("libcuda.so.1").cuDriverGetVersion(ctypes.byref(version)) == 0:
            return version.value
    except OSError:
        pass
    return None


driver = _driver_cuda_version()
if driver is not None and driver < MIN_DRIVER_CUDA:
    try:
        import comfy.ldm.modules.attention as attention

        attention.COMFY_KITCHEN_INT8_ATTENTION_IS_AVAILABLE = False
        logging.warning(
            "[blockbuster] host driver supports CUDA %d.%d (< 13.0): using PyTorch attention instead of comfy-kitchen int8 attention",
            driver // 1000, (driver % 1000) // 10,
        )
    except Exception as e:  # never block ComfyUI startup over a shim
        logging.warning("[blockbuster] could not apply the int8-attention driver fallback: %s", e)

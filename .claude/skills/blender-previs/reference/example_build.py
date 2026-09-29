"""
PAPER BOAT -- greybox previs, built entirely from code.

Run (from anywhere):
    /Applications/Blender.app/Contents/MacOS/Blender -b --python build.py

Environment switches (optional):
    PREVIS_MODE=stills   only render each shot's first/last frame (+ depth) and the
                         contact sheet -- fast loop for checking framing (~2 s)
    PREVIS_MODE=full     (default) everything: stills, per-shot clips, depth clips,
                         playblast, contact sheet, camera log, .blend (~50 s)
    PREVIS_KEEP_FRAMES=1 keep the intermediate PNG sequences in out/_frames

Outputs (next to this script, in out/):
    playblast.mp4, contact.jpg, camera_log.json, continuity.json, shotN/{first,last,depth_first}.png,
    shotN/{clip,depth}.mp4 ; and paperboat.blend next to this script.

How this file is organised (so it can be turned into a template):
    1. CONFIG      -- timeline, shot table, colours, street dimensions
    2. HELPERS     -- maths, materials, mesh/primitive builders, keyframing
    3. SET         -- street, kerbs, gutter, waterfall, basin, grate, lamps, walls
    4. CHARACTER   -- JUNO mannequin rig (empties + primitives)
    5. ANIMATION   -- per-shot pose / boat / camera functions of the frame number,
                      baked to one key per frame (cuts are therefore hard, no bleed)
    6. CAMERAS     -- Cam1..Cam6 with Track-To targets, markers bind them to ranges
    7. RENDER      -- Workbench + compositor depth pass, per shot, then ffmpeg
    8. REPORTS     -- camera_log.json, continuity.json, contact sheet (VSE), playblast

Units: metres, Z up. The street runs DOWNHILL along +Y. "Left" = -X (the left kerb
when you look downhill), which is where the gutter / water runs.
"""

import bpy
import math
import os
import json
import glob
import shutil
import subprocess
import time
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

T0 = time.time()

# =============================================================================
# 1. CONFIG
# =============================================================================
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()
OUT = os.path.join(HERE, "out")
WORK = os.path.join(OUT, "_frames")          # intermediate PNG sequences
BLEND_PATH = os.path.join(HERE, "paperboat.blend")
MODE = os.environ.get("PREVIS_MODE", "full")
KEEP_FRAMES = os.environ.get("PREVIS_KEEP_FRAMES") == "1"

FPS = 24
RES_X, RES_Y = 1280, 720

# Shot table. start/end are timeline frames (inclusive). 'cut' is the length the
# bible actually uses in the edit; the rendered range is longer to give handles.
# near/far = depth range (metres) mapped to white/black in that shot's depth pass.
SHOTS = [
    dict(n=1, start=1,   end=120, cut=4.0, near=0.3, far=6.0,
         name="Launch",   bible_camera="Low angle at gutter level, static then slow push-in"),
    dict(n=2, start=121, end=216, cut=3.0, near=0.4, far=9.0,
         name="Race",     bible_camera="Tracking shot alongside the gutter, camera left of the boat moving with it"),
    dict(n=3, start=217, end=312, cut=3.0, near=0.8, far=9.0,
         name="Drop",     bible_camera="Tilt-down following the boat over the drop"),
    dict(n=4, start=313, end=408, cut=3.0, near=1.6, far=3.6,
         name="Eddy",     bible_camera="Top-down, slow orbit above the whirlpool"),
    dict(n=5, start=409, end=504, cut=3.0, near=0.5, far=2.5,
         name="Scoop",    bible_camera="Handheld close-up rising with her hands (pedestal up)"),
    dict(n=6, start=505, end=624, cut=4.0, near=0.6, far=11.0,
         name="Bookend",  bible_camera="Medium close-up, slow pull-out to a wide"),
]
FRAME_START, FRAME_END = SHOTS[0]["start"], SHOTS[-1]["end"]

# Street geometry
SLOPE = 0.03            # road falls 3 cm per metre along +Y
DROP_Y = 20.0           # where the gutter (and the whole street) steps down
DROP_H = 0.60           # height of that step / little waterfall
STREET_Y0, STREET_Y1 = -8.0, 36.0
ROAD_X0, ROAD_X1 = -2.0, 2.0          # the 4 m roadway (gutter included on the left)
GUT_X0, GUT_X1 = -1.98, -1.68         # stone gutter channel along the left kerb
GX = (GUT_X0 + GUT_X1) / 2            # gutter centre line (x = -1.83)
KERB_H = 0.15                         # sidewalk height above road
WALL_X = 3.2                          # building faces at x = +-3.2
BASIN_Y0, BASIN_Y1, BASIN_X1 = 26.4, 28.0, -1.20   # widened pool in front of the grate
GRATE_Y0, GRATE_Y1 = 28.0, 28.6                    # storm drain
WATER_DOWN = 0.03       # water surface sits 3 cm below road level

# Colours (linear RGBA). Workbench shows material "viewport display" colour.
C = dict(
    road=(0.20, 0.20, 0.21, 1), side=(0.34, 0.34, 0.35, 1), kerb=(0.50, 0.50, 0.50, 1),
    gutter=(0.28, 0.28, 0.29, 1), water=(0.22, 0.30, 0.45, 1), fall=(0.40, 0.52, 0.72, 1),
    wall_a=(0.30, 0.29, 0.28, 1), wall_b=(0.38, 0.36, 0.34, 1), wall_c=(0.25, 0.26, 0.28, 1),
    grate_pit=(0.01, 0.01, 0.01, 1), grate_bar=(0.07, 0.07, 0.08, 1),
    pole=(0.10, 0.10, 0.11, 1), lamp=(1.0, 0.55, 0.15, 1),
    juno=(1.0, 0.78, 0.0, 1), boots=(0.75, 0.02, 0.02, 1), skin=(0.80, 0.55, 0.40, 1),
    hair=(0.02, 0.02, 0.02, 1), boat=(0.95, 0.04, 0.02, 1),
    sky=(0.004, 0.008, 0.035),
)

# =============================================================================
# 2. HELPERS
# =============================================================================
def lerp(a, b, t):
    return a + (b - a) * t

def clamp01(t):
    return max(0.0, min(1.0, t))

def ease(t):
    """Smoothstep ease-in-out on [0,1] (clamped)."""
    t = clamp01(t)
    return t * t * (3 - 2 * t)

def seg(t, t0, t1):
    """Eased 0..1 progress of t across [t0, t1]."""
    return ease((t - t0) / (t1 - t0)) if t1 > t0 else float(t >= t1)

def vlerp(a, b, t):
    return Vector(a).lerp(Vector(b), t)

def road_z(y, lower=None):
    """Road surface height at y. lower=None -> pick the level from y."""
    if lower is None:
        lower = y >= DROP_Y
    return -SLOPE * y - (DROP_H if lower else 0.0)

def side_z(y):
    return road_z(y) + KERB_H

def water_z(y, lower=None):
    return road_z(y, lower) - WATER_DOWN

def shot(n):
    return SHOTS[n - 1]

def shot_of_frame(f):
    for s in SHOTS:
        if s["start"] <= f <= s["end"]:
            return s
    return None

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.name = "PaperBoat"
    return sc

MATS = {}
def mat(key, color=None, name=None):
    """Flat material; Workbench (color_type=MATERIAL) renders diffuse_color."""
    name = name or key
    if name in MATS:
        return MATS[name]
    rgba = color or C[key]
    m = bpy.data.materials.new(name)
    m.diffuse_color = rgba
    m.roughness = 0.9
    # Keep a node setup too so the file also works in EEVEE/Cycles later.
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = 0.9
        if key == "lamp":
            bsdf.inputs["Emission Color"].default_value = rgba
            bsdf.inputs["Emission Strength"].default_value = 8.0
    MATS[name] = m
    return m

def link(ob, coll):
    coll.objects.link(ob)
    return ob

def new_collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c

def slab(name, coll, x0, x1, y0, y1, top_off, lower, material, bottom=-4.0, top_abs=None):
    """A box whose top follows the sloping road (road_z + top_off) from y0 to y1.
    The bottom is flat and deep, so steps between levels get solid vertical faces."""
    if top_abs is not None:
        zt0 = zt1 = top_abs
    else:
        zt0, zt1 = road_z(y0, lower) + top_off, road_z(y1, lower) + top_off
    v = [(x0, y0, bottom), (x1, y0, bottom), (x1, y1, bottom), (x0, y1, bottom),
         (x0, y0, zt0), (x1, y0, zt0), (x1, y1, zt1), (x0, y1, zt1)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(v, [], f)
    me.update()
    ob = bpy.data.objects.new(name, me)
    me.materials.append(material)
    return link(ob, coll)

def _adopt(ob, coll, material, parent=None, loc=None):
    """Move a freshly created primitive into our collection, set material/parent."""
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    coll.objects.link(ob)
    if material is not None:
        ob.data.materials.append(material)
    if parent is not None:
        ob.parent = parent
    if loc is not None:
        ob.location = loc
    return ob

def cube(name, coll, center, size, material, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    return _adopt(ob, coll, material, parent, center)

def cylinder(name, coll, r, depth, loc, material, parent=None, verts=16):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts)
    ob = bpy.context.active_object
    ob.name = name
    return _adopt(ob, coll, material, parent, loc)

def cone(name, coll, r1, r2, depth, loc, material, parent=None):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth, vertices=20)
    ob = bpy.context.active_object
    ob.name = name
    return _adopt(ob, coll, material, parent, loc)

def sphere(name, coll, r, loc, material, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=20, ring_count=10)
    ob = bpy.context.active_object
    ob.name = name
    bpy.ops.object.shade_smooth()
    return _adopt(ob, coll, material, parent, loc)

def empty(name, coll, loc=(0, 0, 0), parent=None, size=0.1, kind="PLAIN_AXES"):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = kind
    ob.empty_display_size = size
    link(ob, coll)
    if parent is not None:
        ob.parent = parent
    ob.location = loc
    return ob

def fcurves_of(ob, data=False):
    """F-curves of an object's (or its data's) action -- works with Blender 5's
    slotted/layered actions and with the legacy API."""
    idb = ob.data if data else ob
    ad = idb.animation_data
    if ad is None or ad.action is None:
        return []
    try:
        from bpy_extras import anim_utils
        cb = anim_utils.action_get_channelbag_for_slot(ad.action, ad.action_slot)
        if cb is not None:
            return list(cb.fcurves)
    except Exception:
        pass
    return list(getattr(ad.action, "fcurves", []))

# =============================================================================
# 3. SET -- the street
# =============================================================================
sc = reset_scene()
bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
bpy.context.preferences.filepaths.save_version = 0   # no paperboat.blend1 backups
SET = new_collection("SET")

M = {k: mat(k) for k in ("road", "side", "kerb", "gutter", "water", "fall", "wall_a",
                         "wall_b", "wall_c", "grate_pit", "grate_bar", "pole")}

def build_level(lower, y0, y1):
    """One level of the street (upper: y0..20, lower: 20..y1)."""
    tag = "Low" if lower else "Up"
    # sidewalks + kerbs on both sides
    slab(f"Sidewalk_L_{tag}", SET, -WALL_X, -2.10, y0, y1, KERB_H, lower, M["side"])
    slab(f"Kerb_L_{tag}", SET, -2.10, GUT_X0, y0, y1, KERB_H + 0.02, lower, M["kerb"])
    slab(f"Kerb_R_{tag}", SET, ROAD_X1, 2.12, y0, y1, KERB_H + 0.02, lower, M["kerb"])
    slab(f"Sidewalk_R_{tag}", SET, 2.12, WALL_X, y0, y1, KERB_H, lower, M["side"])
    if not lower:
        slab("Road_Up", SET, GUT_X1, ROAD_X1, y0, y1, 0.0, lower, M["road"])
        slab("Gutter_Up", SET, GUT_X0, GUT_X1, y0, y1, -0.08, lower, M["gutter"])
        slab("Water_Up", SET, GUT_X0 + 0.02, GUT_X1 - 0.02, y0, y1, -WATER_DOWN, lower,
             M["water"], bottom=None or road_z(y1, lower) - 0.2)
    else:
        # lower channel, then the widened basin, then the grate, then plain road
        slab("Road_Low_A", SET, GUT_X1, ROAD_X1, y0, BASIN_Y0, 0.0, lower, M["road"])
        slab("Road_Low_B", SET, BASIN_X1, ROAD_X1, BASIN_Y0, GRATE_Y1, 0.0, lower, M["road"])
        slab("Road_Low_C", SET, GUT_X0, ROAD_X1, GRATE_Y1, y1, 0.0, lower, M["road"])
        slab("Gutter_Low", SET, GUT_X0, GUT_X1, y0, BASIN_Y0, -0.08, lower, M["gutter"])
        slab("Basin_Floor", SET, GUT_X0, BASIN_X1, BASIN_Y0, BASIN_Y1, -0.10, lower, M["gutter"])
        slab("Water_Low", SET, GUT_X0 + 0.02, GUT_X1 - 0.02, y0, BASIN_Y0 + 0.01, -WATER_DOWN,
             lower, M["water"], bottom=road_z(BASIN_Y0) - 0.2)
        slab("Water_Basin", SET, GUT_X0 + 0.02, BASIN_X1 - 0.02, BASIN_Y0, BASIN_Y1, -WATER_DOWN,
             lower, M["water"], bottom=road_z(BASIN_Y1) - 0.2)
        # Storm drain: a dark pit with slotted bars across it
        slab("Grate_Pit", SET, GUT_X0, BASIN_X1, GRATE_Y0, GRATE_Y1, -0.15, lower, M["grate_pit"])
        n_bars = 7
        for i in range(n_bars):
            x = lerp(GUT_X0 + 0.04, BASIN_X1 - 0.04, i / (n_bars - 1))
            slab(f"Grate_Bar_{i}", SET, x - 0.022, x + 0.022, GRATE_Y0, GRATE_Y1, -0.015, lower,
                 M["grate_bar"], bottom=road_z(GRATE_Y1) - 0.15)
        for yy in (GRATE_Y0, GRATE_Y1 - 0.04):
            slab(f"Grate_Frame_{yy:.1f}", SET, GUT_X0, BASIN_X1, yy, yy + 0.04, -0.015, lower,
                 M["grate_bar"], bottom=road_z(GRATE_Y1) - 0.15)

build_level(False, STREET_Y0, DROP_Y)
build_level(True, DROP_Y, STREET_Y1)

# The little waterfall: a thin bright sheet down the face of the step.
zt, zb = water_z(DROP_Y, False), water_z(DROP_Y, True)
slab("Waterfall", SET, GUT_X0 + 0.02, GUT_X1 - 0.02, DROP_Y, DROP_Y + 0.05, 0, True,
     M["fall"], bottom=zb, top_abs=zt)
# Pedestrian steps down the step on the right half of the road (so Juno can get down)
for k, depth in enumerate((0.9, 0.6, 0.3)):
    slab(f"Step_{k}", SET, 0.6, ROAD_X1, DROP_Y, DROP_Y + depth, 0.15 * (k + 1), True, M["side"])

# Buildings: tall boxes on both sides, varying heights and slight set-backs.
import random
rnd = random.Random(7)
for side_sign in (-1, 1):
    y = STREET_Y0
    i = 0
    while y < STREET_Y1:
        w = rnd.uniform(4.5, 7.5)
        h = rnd.uniform(7.0, 12.0)
        inset = rnd.uniform(0.0, 0.25)
        y1 = min(y + w, STREET_Y1)
        x_in = side_sign * (WALL_X + inset)
        x_out = side_sign * (WALL_X + 1.5)
        mid = (y + y1) / 2
        zt = road_z(mid) + h
        slab(f"Building_{'L' if side_sign < 0 else 'R'}{i}", SET, min(x_in, x_out), max(x_in, x_out),
             y, y1, 0, None, M[("wall_a", "wall_b", "wall_c")[i % 3]], bottom=-6.0, top_abs=zt)
        y = y1
        i += 1
# Buildings closing both ends of the street
slab("Building_End_Down", SET, -WALL_X - 1.5, WALL_X + 1.5, STREET_Y1, STREET_Y1 + 2, 0, True,
     M["wall_b"], bottom=-6.0, top_abs=road_z(STREET_Y1) + 10)
slab("Building_End_Up", SET, -WALL_X - 1.5, WALL_X + 1.5, STREET_Y0 - 2, STREET_Y0, 0, False,
     M["wall_a"], bottom=-6.0, top_abs=road_z(STREET_Y0) + 12)

# Street lamps: pole + glowing globe every 8 m, alternating sides.
LAMPS = {}
for i, (lx, ly) in enumerate([(2.85, 2.0), (-2.90, 10.0), (2.85, 18.0), (-2.90, 26.0), (2.85, 34.0)]):
    gz = side_z(ly)
    cylinder(f"Lamp{i}_Pole", SET, 0.05, 4.2, (lx, ly, gz + 2.1), M["pole"], verts=10)
    # each globe gets its own material so it can flicker independently
    LAMPS[i] = sphere(f"Lamp{i}_Globe", SET, 0.16, (lx, ly, gz + 4.3), mat("lamp", name=f"lamp_{i}"))

# World: dark blue night sky
world = bpy.data.worlds.new("NightSky")
world.color = C["sky"]
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
if bg:
    bg.inputs["Color"].default_value = (*C["sky"], 1)
    bg.inputs["Strength"].default_value = 1.0
sc.world = world

# =============================================================================
# 4. CHARACTER -- JUNO (mannequin, ~1.35 m)
# =============================================================================
# Hierarchy (front of the rig = local +Y, right = local +X):
#   Juno (root, on the ground; animated location + heading)
#     Juno_Hips (animated height: bob / crouch)
#       Juno_Torso (animated forward lean)  -> coat, neck/head/hood, shoulders/arms
#       Juno_Leg_L/R pivots (animated swing) -> leg + red boot
CHAR = new_collection("JUNO")
MJ, MB, MS, MH = mat("juno"), mat("boots"), mat("skin"), mat("hair")
HIP_H = 0.60           # hip pivot height when standing (leg + boot = 0.60)
ARM_LEN = 0.50         # shoulder -> hand centre
THIGH, SHIN = 0.29, 0.31   # hip->knee, knee->sole (sum = HIP_H)

J = {}
J["root"] = empty("Juno", CHAR, size=0.3, kind="ARROWS")
J["hips"] = empty("Juno_Hips", CHAR, (0, 0, HIP_H), J["root"])
J["torso"] = empty("Juno_Torso", CHAR, (0, 0, 0), J["hips"])
cone("Juno_Coat", CHAR, 0.19, 0.11, 0.60, (0, 0, 0.18), MJ, J["torso"])       # raincoat body
J["neck"] = empty("Juno_Neck", CHAR, (0, 0, 0.46), J["torso"])
sphere("Juno_Head", CHAR, 0.105, (0, 0.0, 0.12), MS, J["neck"])
sphere("Juno_Hair", CHAR, 0.10, (0, -0.045, 0.125), MH, J["neck"])            # black bob (back)
cone("Juno_Hood", CHAR, 0.145, 0.02, 0.20, (0, 0, 0.24), MJ, J["neck"])  # pointed hood
for side, sx in (("L", -1), ("R", 1)):
    sh = empty(f"Juno_Shoulder_{side}", CHAR, (sx * 0.16, 0, 0.40), J["torso"])
    sh.rotation_mode = "XYZ"
    cylinder(f"Juno_Arm_{side}", CHAR, 0.037, ARM_LEN - 0.04, (0, 0, -(ARM_LEN - 0.04) / 2), MJ, sh)
    J[f"hand_{side}"] = sphere(f"Juno_Hand_{side}", CHAR, 0.045, (0, 0, -ARM_LEN), MS, sh)
    J[f"sh_{side}"] = sh
    # two-segment leg: hip pivot -> thigh -> knee pivot -> shin + red boot
    lp = empty(f"Juno_Leg_{side}", CHAR, (sx * 0.085, 0, 0), J["hips"])
    cylinder(f"Juno_Thigh_{side}", CHAR, 0.058, THIGH, (0, 0, -THIGH / 2), MJ, lp)
    kn = empty(f"Juno_Knee_{side}", CHAR, (0, 0, -THIGH), lp)
    cylinder(f"Juno_Shin_{side}", CHAR, 0.05, SHIN - 0.14, (0, 0, -(SHIN - 0.14) / 2), MJ, kn)
    cylinder(f"Juno_Boot_{side}", CHAR, 0.066, 0.16, (0, 0.01, -(SHIN - 0.08)), MB, kn)
    lp.rotation_mode = "XYZ"
    J[f"leg_{side}"] = lp
    J[f"knee_{side}"] = kn

# THE BOAT: palm-sized red paper boat, ~12 cm long. Origin = bottom centre.
PROPS = new_collection("PROPS")
def build_boat():
    L_top, L_bot, W, Hh, Hs = 0.12, 0.07, 0.05, 0.032, 0.085
    v = [(-W / 2, -L_bot / 2, 0), (W / 2, -L_bot / 2, 0), (W / 2, L_bot / 2, 0), (-W / 2, L_bot / 2, 0),
         (-W / 2, -L_top / 2, Hh), (W / 2, -L_top / 2, Hh), (W / 2, L_top / 2, Hh), (-W / 2, L_top / 2, Hh),
         # sail: a thin triangular prism along the boat axis
         (-0.006, -0.035, Hh), (0.006, -0.035, Hh), (0.006, 0.035, Hh), (-0.006, 0.035, Hh),
         (-0.006, 0.0, Hs), (0.006, 0.0, Hs)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
         (8, 11, 12), (9, 13, 10), (8, 12, 13, 9), (11, 10, 13, 12)]
    me = bpy.data.meshes.new("Boat")
    me.from_pydata(v, [], f)
    me.update()
    ob = bpy.data.objects.new("Boat", me)
    me.materials.append(mat("boat"))
    return link(ob, PROPS)
BOAT = build_boat()
BOAT.rotation_mode = "XYZ"

# =============================================================================
# 5. ANIMATION -- everything is a pure function of the frame number
# =============================================================================
def t_in(f, n):
    """Seconds since the start of shot n."""
    return (f - shot(n)["start"]) / FPS

def run_cycle(t, freq=2.6, amp=1.0):
    """Leg/arm swing and hip bob for a run. Returns (legL, legR, armL, armR, bob)."""
    ph = 2 * math.pi * freq * t
    s = math.sin(ph)
    return (38 * s * amp, -38 * s * amp, -40 * s * amp, 40 * s * amp, 0.03 * abs(s) * amp)

def run_knees(t, freq=2.6, amp=1.0):
    """Knee bend for the run: the trailing leg folds up behind."""
    ph = 2 * math.pi * freq * t
    return (-(15 + 55 * max(0.0, -math.sin(ph))) * amp, -(15 + 55 * max(0.0, math.sin(ph))) * amp)

def base_pose():
    # legX = thigh swing (deg, + forward), kneeX = knee bend (deg, - folds the shin
    # back), splay = knees out; hip height is derived from the legs (+ 'bob').
    return dict(x=0.0, y=0.0, z=0.0, heading=0.0, bob=0.0, lean=5.0, head=0.0, head_yaw=0.0,
                legL=0.0, legR=0.0, kneeL=0.0, kneeR=0.0, splay=0.0,
                armL=-5.0, armR=-5.0, inL=0.0, inR=0.0)

CROUCH = dict(legL=95, legR=95, kneeL=-130, kneeR=-130, splay=28)   # deep squat

# Boat trajectory constants
S3_Y0, S3_V = 19.2, 3.0                    # shot 3: start y, speed on the upper channel
S3_T_EDGE = (DROP_Y - S3_Y0) / S3_V        # time it reaches the lip
S3_T_FALL = math.sqrt(2 * (DROP_H) / 9.81)
S3_VX_FALL = 1.8
S3_Y_LAND = DROP_Y + S3_VX_FALL * S3_T_FALL
EDDY = Vector((-1.56, 27.30))              # eddy centre in front of the grate
EDDY_R = 0.13

def juno_pose(f):
    p = base_pose()
    s = shot_of_frame(f)["n"]
    t = t_in(f, s)
    if s == 1:
        # Kneels on the left sidewalk facing the gutter (+X), sets the boat down,
        # lets go at 1.5 s, sits back a little and turns her head to watch it go.
        u = seg(t, 1.5, 2.6)
        p.update(x=-2.24, y=1.95, z=side_z(1.95), heading=-90 + 15 * seg(t, 2.0, 4.5),
                 lean=lerp(55, 30, u), head=lerp(-15, 5, u), head_yaw=30 * seg(t, 2.0, 4.0),
                 armL=lerp(5, -10, u), armR=lerp(5, -10, u), inL=lerp(6, 0, u), inR=lerp(6, 0, u))
        p.update(CROUCH)
    elif s == 2:
        # Runs down the road just right of the gutter, ~2.3 m behind the boat.
        yb = boat_state(f)[0].y
        lL, lR, aL, aR, bob = run_cycle(t)
        kL, kR = run_knees(t)
        p.update(x=-1.30, y=yb - 2.3, z=road_z(yb - 2.3), heading=0, bob=bob,
                 lean=14, head=5, legL=lL, legR=lR, kneeL=kL, kneeR=kR, armL=aL, armR=aR)
    elif s == 3:
        # Runs in, skids to a stop with her boots at the lip, then peers down.
        T = 1.3
        u = clamp01(t / T)
        y = 17.35 + 2.2 * (1 - (1 - u) ** 2)
        amp = clamp01(1.3 - u * 1.3)
        lL, lR, aL, aR, bob = run_cycle(t, amp=amp)
        skid = seg(t, 0.8, 1.2) * (1 - seg(t, 1.5, 2.0))
        peer = seg(t, 1.6, 2.4)
        p.update(x=-1.35, y=y, z=road_z(y, False), heading=-8 * peer,
                 bob=bob, kneeL=run_knees(t, amp=amp)[0], kneeR=run_knees(t, amp=amp)[1] - 20 * skid,
                 lean=lerp(14, -12, skid) + 30 * peer, head=lerp(5, 0, skid) - 30 * peer,
                 legL=lL + 25 * skid, legR=lR - 15 * skid,
                 armL=aL * (1 - skid) - 30 * skid * (1 - peer) + 10 * peer,
                 armR=aR * (1 - skid) - 30 * skid * (1 - peer) + 10 * peer,
                 inL=-25 * skid, inR=-25 * skid)
    elif s == 4:
        # On the lower level beside the basin, facing it (-X), bends and reaches one
        # arm down over the eddy -- her hand enters the top-down frame from the top.
        u = seg(t, 0.2, 1.8)
        wob = 4 * math.sin(2 * math.pi * 0.7 * t) * u
        p.update(x=-1.02, y=27.35, z=road_z(27.35), heading=90,
                 legL=22, legR=-22, kneeL=-10 * u, kneeR=-10 * u,
                 lean=lerp(25, 55, u), head=-20 * u,
                 armR=lerp(-10, 38, u) + wob, inR=lerp(0, 10, u), armL=lerp(-5, 10, u))
    elif s == 5:
        # Kneels with both hands in the water, scoops at ~0.9 s, rises and lifts the
        # boat to her face.
        u = seg(t, 1.0, 3.3)
        dip = seg(t, 0.0, 0.8)
        p.update(x=-1.08, y=27.50, z=road_z(27.5), heading=90,
                 legL=lerp(95, 0, u), legR=lerp(95, 0, u), kneeL=lerp(-130, 0, u),
                 kneeR=lerp(-130, 0, u), splay=lerp(28, 0, u),
                 lean=lerp(55, 5, u), head=lerp(-25, 5, u),
                 armL=lerp(lerp(30, 12, dip), 92, u), armR=lerp(lerp(30, 12, dip), 92, u),
                 inL=16, inR=16)
    elif s == 6:
        # Stands facing uphill (-Y) holding the boat at chest height; looks up at
        # the sky (rain stops) around 1.5-2.5 s, then back down with a smile.
        up = seg(t, 1.3, 2.3) * (1 - seg(t, 3.4, 4.4))
        p.update(x=-1.0, y=26.8, z=road_z(26.8), heading=180, lean=3,
                 head=lerp(-15, 30, up) + 10 * seg(t, 3.4, 4.4),
                 armL=80, armR=80, inL=18, inR=18)
    return p

def apply_pose(p, f):
    r = J["root"]
    r.location = (p["x"], p["y"], p["z"])
    r.rotation_euler = (0, 0, math.radians(p["heading"]))
    # hip height = the taller leg's vertical reach, so boots stay on the ground
    def reach(th, kn):
        return THIGH * math.cos(math.radians(th)) + SHIN * math.cos(math.radians(th + kn))
    J["hips"].location = (0, 0, max(reach(p["legL"], p["kneeL"]), reach(p["legR"], p["kneeR"])) + p["bob"])
    J["torso"].rotation_euler = (math.radians(-p["lean"]), 0, 0)
    J["neck"].rotation_euler = (math.radians(p["head"]), 0, math.radians(p["head_yaw"]))
    # Arm angles are given relative to straight DOWN in the hips frame (so a lean
    # does not swing the arms); compensate for the torso lean here.
    J["sh_L"].rotation_euler = (math.radians(p["armL"] + p["lean"]), 0, math.radians(-p["inL"]))
    J["sh_R"].rotation_euler = (math.radians(p["armR"] + p["lean"]), 0, math.radians(p["inR"]))
    J["leg_L"].rotation_euler = (math.radians(p["legL"]), 0, math.radians(p["splay"]))
    J["leg_R"].rotation_euler = (math.radians(p["legR"]), 0, math.radians(-p["splay"]))
    J["knee_L"].rotation_euler = (math.radians(p["kneeL"]), 0, 0)
    J["knee_R"].rotation_euler = (math.radians(p["kneeR"]), 0, 0)
    for key, path in (("root", "location"), ("root", "rotation_euler"), ("hips", "location"),
                      ("torso", "rotation_euler"), ("neck", "rotation_euler"),
                      ("sh_L", "rotation_euler"), ("sh_R", "rotation_euler"),
                      ("leg_L", "rotation_euler"), ("leg_R", "rotation_euler"),
                      ("knee_L", "rotation_euler"), ("knee_R", "rotation_euler")):
        J[key].keyframe_insert(path, frame=f)

HANDS = {}   # frame -> world midpoint of Juno's hands (filled after Juno is baked)

def boat_state(f):
    """Returns (location Vector, (rx, ry, rz) radians). z = boat bottom."""
    s = shot_of_frame(f)["n"]
    t = t_in(f, s)
    rot = [0.0, 0.0, 0.0]
    if s == 1:
        y = 2.0 + 0.30 * max(0.0, t - 1.5) ** 1.1
        x = lerp(-1.88, GX, seg(t, 1.5, 4.0))
        rot[2] = math.radians(8 * math.sin(2.1 * t) * seg(t, 1.5, 2.5))
        loc = Vector((x, y, water_z(y) - 0.008))
    elif s == 2:
        y = 4.0 + 3.4 * t
        x = GX + 0.03 * math.sin(3 * t)
        rot = [math.radians(3 * math.sin(9 * t)), math.radians(4 * math.sin(7 * t)),
               math.radians(6 * math.sin(5 * t))]
        loc = Vector((x, y, water_z(y) - 0.008))
    elif s == 3:
        if t <= S3_T_EDGE:                                   # racing to the lip
            y = S3_Y0 + S3_V * t
            loc = Vector((GX, y, water_z(y, False) - 0.008))
        elif t <= S3_T_EDGE + S3_T_FALL:                     # falling
            tau = t - S3_T_EDGE
            y = DROP_Y + S3_VX_FALL * tau
            z = water_z(DROP_Y, False) - 0.008 - 0.5 * 9.81 * tau * tau
            loc = Vector((GX, y, z))
            rot[0] = math.radians(-40 * tau / S3_T_FALL)
        else:                                                # landed, drifting on
            tau = t - S3_T_EDGE - S3_T_FALL
            y = S3_Y_LAND + 0.5 * (1 - math.exp(-1.5 * tau))
            bounce = 0.02 * math.exp(-5 * tau) * math.sin(14 * tau)
            loc = Vector((GX, y, water_z(y, True) - 0.008 - bounce))
            rot[0] = math.radians(-40 * math.exp(-6 * tau))
            rot[2] = math.radians(20 * (1 - math.exp(-2 * tau)))
    elif s in (4, 5):
        tt = t if s == 4 else t + 4.0                        # the eddy keeps turning
        ang = 0.8 + 2 * math.pi * 0.14 * tt
        c = EDDY + Vector((0, 0.04 * max(0.0, tt - 4.0)))    # creeping toward the grate
        x, y = c.x + EDDY_R * math.cos(ang), c.y + EDDY_R * math.sin(ang)
        loc = Vector((x, y, water_z(y, True) - 0.008))
        rot[2] = math.radians(270 * tt)                      # spinning
        if s == 5 and f in HANDS:
            # hands arrive under the boat 0.6-0.9 s, then it rides on the hands
            k = seg(t, 0.55, 0.9)
            held = HANDS[f] + Vector((0, 0, 0.035))
            loc = loc.lerp(held, k)
            rot[2] = lerp(rot[2], math.radians(270 * 4.9), k) if k < 1 else math.radians(270 * 4.9)
    elif s == 6:
        loc = (HANDS.get(f, Vector((-1.0, 26.35, road_z(26.35) + 0.85))) + Vector((0, 0, 0.035)))
        rot[2] = math.radians(90)
    return loc, tuple(rot)

def bake_juno():
    for f in range(FRAME_START, FRAME_END + 1):
        apply_pose(juno_pose(f), f)

def bake_hands():
    """Read back where Juno's hands are (after baking) for the hand-held boat."""
    for f in list(range(shot(5)["start"], shot(6)["end"] + 1)):
        sc.frame_set(f)
        HANDS[f] = (J["hand_L"].matrix_world.translation + J["hand_R"].matrix_world.translation) / 2

def bake_boat():
    for f in range(FRAME_START, FRAME_END + 1):
        loc, rot = boat_state(f)
        BOAT.location = loc
        BOAT.rotation_euler = rot
        BOAT.keyframe_insert("location", frame=f)
        BOAT.keyframe_insert("rotation_euler", frame=f)

def bake_lamp_flicker():
    """Shot 6: the lamp nearest Juno (Lamp3) flickers around 2.6-3.4 s."""
    m = LAMPS[3].data.materials[0]
    s6 = shot(6)
    pattern = {0: 1, 2: 0.15, 4: 1, 5: 0.1, 8: 0.2, 10: 1, 13: 0.3, 15: 1}
    for f in range(FRAME_START, FRAME_END + 1):
        k = 1.0
        if s6["start"] <= f <= s6["end"]:
            i = f - (s6["start"] + int(2.6 * FPS))
            if 0 <= i <= 16:
                k = [pattern[j] for j in sorted(pattern) if j <= i][-1]
        m.diffuse_color = tuple(c * k if n < 3 else c for n, c in enumerate(C["lamp"]))
        m.keyframe_insert("diffuse_color", frame=f)

# =============================================================================
# 6. CAMERAS -- one per shot, each tracking its own target empty
# =============================================================================
CAMS = new_collection("CAMERAS")

def smooth(seq, radius):
    out = []
    for i in range(len(seq)):
        a, b = max(0, i - radius), min(len(seq), i + radius + 1)
        acc = Vector((0, 0, 0))
        for v in seq[a:b]:
            acc += v
        out.append(acc / (b - a))
    return out

def cam_state(n, f):
    """(camera location, target location, lens mm) for shot n at frame f."""
    t = t_in(f, n)
    if n == 1:
        # Low at gutter level on the road, looking across the gutter at Juno on the
        # kerb. Static for 1.8 s, then a slow push-in; boat exits frame right (+Y).
        u = seg(t, 1.8, 5.0)
        cam = vlerp((-1.02, 0.30, road_z(0.30) + 0.16), (-1.12, 0.70, road_z(0.70) + 0.14), u)
        tgt = vlerp((-2.05, 2.10, road_z(2.10) + 0.40), (-2.00, 2.50, road_z(2.50) + 0.52), u)
        return cam, tgt, 24.0
    if n == 2:
        # On the left sidewalk (camera LEFT of the boat), travelling with it just
        # ahead, looking back across it so Juno running behind stays in frame.
        yb = boat_state(f)[0].y
        cam = Vector((-2.25, yb + 1.2, road_z(yb + 1.2) + 0.60))
        tgt = Vector((-1.55, yb - 1.2, road_z(yb - 1.2) + 0.12))
        return cam, tgt, 24.0
    if n == 3:
        # Locked-off on the lower level, eye just above the upper street; the camera
        # only tilts (and pans a touch) to follow the boat over the lip and down.
        cam = Vector((-0.95, 23.0, road_z(23.0) + 1.30))
        b = boat_state(f)[0]
        boots = Vector((-1.35, 19.6, road_z(19.6, False)))
        return cam, b.lerp(boots + Vector((0, 0, 0.7)), 0.5), 22.0
    if n == 4:
        # High above the eddy looking (almost) straight down, slow 40-degree orbit.
        az = math.radians(lerp(195, 155, t / 4.0))
        c = Vector((EDDY.x + 0.12, EDDY.y, water_z(EDDY.y)))
        cam = c + Vector((0.5 * math.cos(az), 0.5 * math.sin(az), 2.3))
        return cam, c, 35.0
    if n == 5:
        # Across the basin from Juno, rising with her hands (pedestal up). Hand-held
        # noise is added afterwards as an F-curve modifier.
        h = CAM5_SMOOTH[f]
        u = seg(t, 1.0, 3.5)
        cam = Vector((-2.62, 27.30, max(h.z + 0.12, side_z(27.3) + 0.70)))
        tgt = h + Vector((0, 0, 0.12 * u))
        return cam, tgt, 50.0
    if n == 6:
        # Medium close-up, then a slow pull-out (dolly back + zoom out) to a wide.
        u = seg(t, 0.4, 5.0)
        cam = vlerp((-1.0, 25.2, road_z(25.2) + 1.05), (-0.35, 21.3, road_z(21.3) + 1.70), u)
        tgt = vlerp((-1.0, 26.8, road_z(26.8) + 1.10), (-1.0, 26.8, road_z(26.8) + 0.80), u)
        return cam, tgt, lerp(40.0, 30.0, u)

CAM5_SMOOTH = {}

def build_cameras():
    cams = {}
    for s in SHOTS:
        n = s["n"]
        cd = bpy.data.cameras.new(f"Cam{n}")
        cd.sensor_width = 36.0
        cd.sensor_fit = "HORIZONTAL"
        cd.clip_start = 0.05
        cd.clip_end = 200.0
        cam = bpy.data.objects.new(f"Cam{n}", cd)
        link(cam, CAMS)
        tgt = empty(f"Cam{n}_Target", CAMS, size=0.15, kind="SPHERE")
        con = cam.constraints.new("TRACK_TO")
        con.target = tgt
        con.track_axis = "TRACK_NEGATIVE_Z"
        con.up_axis = "UP_Y"
        cams[n] = (cam, tgt)
        # keyframes only inside the shot's own range (+1 frame either side)
        for f in range(max(FRAME_START, s["start"] - 1), min(FRAME_END, s["end"] + 1) + 1):
            ff = min(max(f, s["start"]), s["end"])
            c, g, lens = cam_state(n, ff)
            cam.location = c
            tgt.location = g
            cd.lens = lens
            cam.keyframe_insert("location", frame=f)
            tgt.keyframe_insert("location", frame=f)
            cd.keyframe_insert("lens", frame=f)
        # Timeline marker binds the camera to its range -> one render switches cameras.
        m = sc.timeline_markers.new(f"S{n}_{s['name']}", frame=s["start"])
        m.camera = cam
    # Hand-held feel on shot 5 only: noise on the camera and (less) on its target.
    s5 = shot(5)
    cam5, tgt5 = cams[5]
    for ob, strength, scale in ((cam5, 0.012, 7.0), (tgt5, 0.008, 9.0)):
        for fc in fcurves_of(ob):
            if fc.data_path != "location":
                continue
            mod = fc.modifiers.new("NOISE")
            mod.scale = scale
            mod.strength = strength
            mod.phase = 13.7 * (fc.array_index + 1) + (0 if ob is cam5 else 5)
            mod.use_restricted_range = True
            mod.frame_start = s5["start"]
            mod.frame_end = s5["end"]
    return cams

# ---- bake everything --------------------------------------------------------
bake_juno()
bake_hands()
bake_boat()
bake_lamp_flicker()
_s5 = shot(5)
_frames5 = list(range(_s5["start"], _s5["end"] + 1))
_h5 = []
for f in _frames5:
    if f in HANDS:
        _h5.append(HANDS[f])
_h5 = smooth(_h5, 5)
CAM5_SMOOTH.update(dict(zip(_frames5, _h5)))
CAMS_BY_SHOT = build_cameras()
sc.camera = CAMS_BY_SHOT[1][0]

# Sanity check: cameras never below the ground or inside the building walls.
for s in SHOTS:
    cam = CAMS_BY_SHOT[s["n"]][0]
    for f in (s["start"], (s["start"] + s["end"]) // 2, s["end"]):
        sc.frame_set(f)
        p = cam.matrix_world.translation
        ground = side_z(p.y) if abs(p.x) > 2.1 else road_z(p.y)
        if p.z < ground + 0.05 or abs(p.x) > WALL_X - 0.1:
            print(f"WARNING: Cam{s['n']} at frame {f} may be inside geometry: {tuple(p)}")

# =============================================================================
# 7. RENDER SETTINGS -- Workbench (fast, reliable headless) + depth compositor
# =============================================================================
sc.frame_start, sc.frame_end = FRAME_START, FRAME_END
sc.render.fps = FPS
sc.render.resolution_x, sc.render.resolution_y = RES_X, RES_Y
sc.render.resolution_percentage = 100
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.render_aa = "8"
sh = sc.display.shading
sh.light = os.environ.get("PREVIS_LIGHT", "STUDIO")
sh.color_type = "MATERIAL"
sh.background_type = "WORLD"
sh.show_shadows = True
sh.shadow_intensity = 0.4
sh.show_cavity = True
sh.cavity_type = "WORLD"
sc.display.light_direction = (0.35, -0.45, 0.82)
sc.view_settings.view_transform = "Standard"
sc.view_settings.look = "None"
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGB"
sc.render.image_settings.color_depth = "8"
sc.render.use_compositing = True
sc.view_layers[0].use_pass_z = True

# Compositor: Image -> output ; Depth -> MapRange(near..far -> 1..0, clamped) -> PNG
comp = bpy.data.node_groups.new("PrevisComp", "CompositorNodeTree")
sc.compositing_node_group = comp
rl = comp.nodes.new("CompositorNodeRLayers")
comp.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
gout = comp.nodes.new("NodeGroupOutput")
comp.links.new(rl.outputs["Image"], gout.inputs[0])
DEPTH_MAP = comp.nodes.new("ShaderNodeMapRange")
DEPTH_MAP.clamp = True
DEPTH_MAP.inputs["To Min"].default_value = 1.0     # near -> white
DEPTH_MAP.inputs["To Max"].default_value = 0.0     # far  -> black
comp.links.new(rl.outputs["Depth"], DEPTH_MAP.inputs["Value"])
DEPTH_OUT = comp.nodes.new("CompositorNodeOutputFile")
DEPTH_OUT.file_output_items.new("FLOAT", "depth")
if hasattr(DEPTH_OUT.format, "media_type"):
    DEPTH_OUT.format.media_type = "IMAGE"          # Blender 5.x: pick image vs multilayer first
DEPTH_OUT.format.file_format = "PNG"
DEPTH_OUT.format.color_mode = "BW"
DEPTH_OUT.format.color_depth = "8"
DEPTH_OUT.save_as_render = False
comp.links.new(DEPTH_MAP.outputs["Result"], DEPTH_OUT.inputs[0])

def set_depth_range(s):
    DEPTH_MAP.inputs["From Min"].default_value = s["near"]
    DEPTH_MAP.inputs["From Max"].default_value = s["far"]

os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
print(f"[previs] scene built + saved in {time.time() - T0:.1f}s -> {BLEND_PATH}")

# =============================================================================
# 7b. RENDER
# =============================================================================
def ffmpeg(*args):
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args]
    subprocess.run(cmd, check=True)

def find_depth_file(d, frame):
    hits = [p for p in glob.glob(os.path.join(d, "*.png")) if p.endswith(f"{frame:04d}.png")]
    return hits[0] if hits else None

def grab_single_depth(d, frame):
    """A single-frame (write_still) render names the depth file without a frame
    number; rename it so stills and animations use the same scheme."""
    p = os.path.join(d, "d_depth.png")
    if os.path.exists(p):
        os.replace(p, os.path.join(d, f"d_depth{frame:04d}.png"))

RENDER_TIMES = {}
for s in SHOTS:
    n = s["n"]
    sdir = os.path.join(OUT, f"shot{n}")
    fdir = os.path.join(WORK, f"shot{n}", "beauty")
    ddir = os.path.join(WORK, f"shot{n}", "depth")
    for d in (sdir, fdir, ddir):
        os.makedirs(d, exist_ok=True)
    set_depth_range(s)
    DEPTH_OUT.directory = ddir + os.sep
    DEPTH_OUT.file_name = "d_"
    t_start = time.time()
    if MODE == "stills":
        for f in (s["start"], s["end"]):
            sc.frame_set(f)
            sc.render.filepath = os.path.join(fdir, f"f_{f:04d}.png")
            bpy.ops.render.render(write_still=True)
            grab_single_depth(ddir, f)
    else:
        sc.frame_start, sc.frame_end = s["start"], s["end"]
        sc.render.filepath = os.path.join(fdir, "f_")
        bpy.ops.render.render(animation=True)
    RENDER_TIMES[n] = round(time.time() - t_start, 1)
    # stills
    shutil.copy(os.path.join(fdir, f"f_{s['start']:04d}.png"), os.path.join(sdir, "first.png"))
    shutil.copy(os.path.join(fdir, f"f_{s['end']:04d}.png"), os.path.join(sdir, "last.png"))
    dfirst = find_depth_file(ddir, s["start"])
    if dfirst:
        shutil.copy(dfirst, os.path.join(sdir, "depth_first.png"))
    if MODE != "stills":
        # clips: normalise the depth file names to a clean sequence for ffmpeg
        for p in glob.glob(os.path.join(ddir, "*.png")):
            fr = int(os.path.basename(p)[-8:-4])
            os.replace(p, os.path.join(ddir, f"z_{fr:04d}.png"))
        common = ["-framerate", str(FPS), "-start_number", str(s["start"])]
        enc = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-r", str(FPS)]
        ffmpeg(*common, "-i", os.path.join(fdir, "f_%04d.png"), *enc, os.path.join(sdir, "clip.mp4"))
        ffmpeg(*common, "-i", os.path.join(ddir, "z_%04d.png"), *enc, os.path.join(sdir, "depth.mp4"))
    print(f"[previs] shot {n} rendered in {RENDER_TIMES[n]}s")

sc.frame_start, sc.frame_end = FRAME_START, FRAME_END

# Playblast = the six clips back to back (same encoder settings -> stream copy).
if MODE != "stills":
    lst = os.path.join(WORK, "concat.txt")
    with open(lst, "w") as fh:
        for s in SHOTS:
            fh.write(f"file '{os.path.join(OUT, 'shot%d' % s['n'], 'clip.mp4')}'\n")
    ffmpeg("-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", os.path.join(OUT, "playblast.mp4"))

# =============================================================================
# 8. REPORTS
# =============================================================================
# ---- camera_log.json --------------------------------------------------------
DESCRIPTIONS = {
    1: dict(move="Low angle at gutter level: the camera sits just above the road surface looking across "
                 "the gutter at Juno kneeling on the kerb; it holds still, then pushes in slowly toward "
                 "the boat as it drifts off to the right.",
            beats=["the camera is locked off at gutter level, a few centimetres above the wet road, looking across the water at Juno kneeling on the kerb with the boat in her hands",
                   "the camera holds still at gutter level as she sets the boat on the water and lets go",
                   "the camera begins a slow push-in from gutter level toward the boat",
                   "the camera keeps pushing in slowly at gutter level as the boat drifts to the right of frame",
                   "the camera ends close on the water, the boat at frame right, Juno watching from the kerb"]),
    2: dict(move="Tracking shot: the camera travels down the street on the left of the gutter at knee "
                 "height, keeping pace with the boat, looking back across it at Juno running behind.",
            beats=["the camera tracks alongside the gutter at knee height, just left of and ahead of the racing boat, Juno running behind it",
                   "the camera keeps pace with the boat, moving downhill with it at running speed",
                   "the camera continues tracking with the boat, Juno chasing a few steps behind",
                   "the camera and boat race on together down the gutter, the street streaming past",
                   "the camera is still tracking level with the boat as the shot ends"]),
    3: dict(move="Locked-off camera below the step: it tilts down to follow the boat as it shoots over "
                 "the kerb edge and drops into the lower channel, Juno skidding to a stop at the edge above.",
            beats=["the camera looks up the street from below the step at the boat racing toward the edge",
                   "the camera tilts down, following the boat as it shoots off the edge and drops down the little waterfall",
                   "the camera settles tilted down on the boat bobbing in the lower channel, Juno's boots skidding to a stop at the edge above",
                   "the camera holds, the boat drifting in the lower channel, Juno peering down from the edge",
                   "the camera holds on the boat below and Juno above"]),
    4: dict(move="Top-down: the camera looks straight down on the eddy in front of the storm-drain grate "
                 "and orbits slowly around it while the boat spins; Juno's hand reaches in from the top of frame.",
            beats=["the camera looks straight down on the boat spinning in the eddy in front of the storm drain, beginning a slow orbit",
                   "the camera orbits slowly overhead as Juno's hand enters from the top of frame",
                   "the camera keeps orbiting slowly above the whirlpool, her hand reaching toward the boat",
                   "the camera continues its slow overhead orbit, the grate at the edge of frame",
                   "the camera completes a quarter-turn orbit above the spinning boat"]),
    5: dict(move="Handheld close-up: the camera, slightly shaky, rises with Juno's hands (pedestal up) "
                 "as she scoops the boat out of the water and lifts it up to her face.",
            beats=["handheld close-up low over the water on Juno's hands closing around the spinning boat",
                   "the handheld camera starts to rise with her hands as she scoops the boat out of the water",
                   "the camera pedestals up with her hands, water dripping from the boat",
                   "the camera arrives at face height as she lifts the boat to her face",
                   "handheld close-up holds on her face and the boat in her hands"]),
    6: dict(move="Medium close-up on Juno holding the boat, then a slow pull-out (dolly back and zoom out) "
                 "to a wide of the rainy street and the storm drain.",
            beats=["medium close-up on Juno holding the dripping boat at her chest",
                   "the camera begins a slow pull-out as she looks up at the sky",
                   "the camera keeps pulling back and widening, the street and a flickering lamp coming into view",
                   "the camera continues its slow pull-out, Juno smaller in frame, smiling",
                   "the camera settles into a wide of the street, Juno small by the storm drain"]),
}
log = dict(film="PAPER BOAT", fps=FPS, resolution=[RES_X, RES_Y], units="metres, Z up; street runs downhill along +Y",
           shots=[])
for s in SHOTS:
    n = s["n"]
    cam, tgt = CAMS_BY_SHOT[n]
    samples = []
    for sec in range(5):
        f = s["start"] + sec * FPS
        sc.frame_set(f)
        samples.append(dict(
            t=sec, frame=f,
            camera=[round(v, 3) for v in cam.matrix_world.translation],
            target=[round(v, 3) for v in tgt.matrix_world.translation],
            lens_mm=round(cam.data.lens, 1),
            description=DESCRIPTIONS[n]["beats"][sec]))
    log["shots"].append(dict(
        shot=n, name=s["name"], camera_object=cam.name,
        frame_range=[s["start"], s["end"]],
        duration_s=round((s["end"] - s["start"] + 1) / FPS, 3),
        bible_cut_length_s=s["cut"], bible_camera=s["bible_camera"],
        move=DESCRIPTIONS[n]["move"], depth_range_m=[s["near"], s["far"]],
        per_second=samples))
with open(os.path.join(OUT, "camera_log.json"), "w") as fh:
    json.dump(log, fh, indent=2)

# ---- continuity.json: per-shot anchor numbers for every named subject --------------
# Where each named subject sits on screen, how big it reads and how fast it moves, at
# the first/middle/last frame of every shot, plus the camera's own height/side/lens --
# so a video-generation prompt can be written from these numbers instead of guessing.
def write_continuity(shots, subjects, cam_for_shot, out_path, fps=FPS, ground_z=lambda x, y: 0.0,
                      forward=Vector((0.0, 1.0, 0.0))):
    """subjects: [{"name": <label>, "ob": <bpy object used for its bounding-box centre>}].
    cam_for_shot(n): the bpy camera driving shot n -- call AFTER sc.frame_set(f) so any
    Track-To target / parenting is already evaluated into its matrix_world.
    forward: the world axis treated as "ahead" for every subject (the street runs
    downhill along +Y, so one shared axis is enough -- see module docstring)."""
    right = Vector((forward.y, -forward.x, 0.0))   # subject's right-hand side
    frame_lo = shots[0]["start"]

    def bbox_center(ob):
        local = sum((Vector(c) for c in ob.bound_box), Vector((0.0, 0.0, 0.0))) / 8
        return ob.matrix_world @ local

    def size_word(d):
        return "near" if d < 6.0 else "mid" if d < 25.0 else "far"

    def sample(cam, cam_pos, ob, pos_prev, dt):
        pos = bbox_center(ob)
        co = world_to_camera_view(sc, cam, pos)
        in_frame = 0.0 <= co.x <= 1.0 and 0.0 <= co.y <= 1.0 and co.z > 0.0
        h = "left" if co.x < 1 / 3 else "right" if co.x > 2 / 3 else "centre"
        v = "bottom" if co.y < 1 / 3 else "top" if co.y > 2 / 3 else "middle"
        dist = (cam_pos - pos).length
        speed = (pos - pos_prev).length / dt if pos_prev is not None else 0.0
        return dict(in_frame=in_frame, screen_x=round(co.x, 2), screen_y=round(co.y, 2),
                    words=f"{h} {v}", distance_m=round(dist, 1), size=size_word(dist),
                    speed_mps=round(speed, 1))

    report = {"shots": []}
    for s in shots:
        n, f0, f1 = s["n"], s["start"], s["end"]
        fm = (f0 + f1) // 2
        entry = dict(shot=n, name=s.get("name"), frame_range=[f0, f1],
                     length_s=round((f1 - f0 + 1) / fps, 2), samples={})
        mid = None
        for label, f in (("first", f0), ("mid", fm), ("last", f1)):
            # speed from a neighbour frame INSIDE the shot (f-1 at a cut is another shot's pose)
            sc.frame_set(f + 1 if label == "first" else f - 1)
            prev_pos = {sub["name"]: bbox_center(sub["ob"]) for sub in subjects}
            sc.frame_set(f)
            cam = cam_for_shot(n)
            cam_pos = cam.matrix_world.translation.copy()
            subs = {sub["name"]: sample(cam, cam_pos, sub["ob"], prev_pos[sub["name"]], 1.0 / fps)
                    for sub in subjects}
            entry["samples"][label] = subs
            if label == "mid":
                mid = dict(cam=cam, cam_pos=cam_pos, subs=subs)
        # ---- shot-level camera facts + anchor sentence, all from the mid frame ----
        cam, cam_pos, subs = mid["cam"], mid["cam_pos"], mid["subs"]
        sc.frame_set(fm)    # subject positions at the MID frame too (the loop left the scene on the last frame)
        order = sorted((nm for nm in subs if subs[nm]["in_frame"]), key=lambda nm: subs[nm]["distance_m"])
        by_name = {sub["name"]: sub["ob"] for sub in subjects}
        ground = ground_z(cam_pos.x, cam_pos.y)
        primary = order[0] if order else subjects[0]["name"]
        primary_pos = bbox_center(by_name[primary])
        d = cam_pos - primary_pos
        a, c = d.dot(forward), d.dot(right)
        side = ("ahead" if a > 0 else "behind") if abs(a) >= abs(c) else ("right" if c > 0 else "left")
        cam_forward = cam.matrix_world.to_quaternion() @ Vector((0.0, 0.0, -1.0))
        looking = "forward" if cam_forward.dot(forward) >= 0 else "back"
        # each in-frame subject's ahead/behind: relative to the visible group's mean along-track position
        alongs = {nm: forward.dot(bbox_center(by_name[nm])) for nm in order}
        mean_along = sum(alongs.values()) / len(alongs) if alongs else 0.0
        entry.update(order_front_to_back=order, camera_height_m=round(cam_pos.z - ground, 2),
                     camera_side=side, lens_mm=round(cam.data.lens, 1), primary_subject=primary,
                     looking=looking)
        lead = f"Camera {'on the ' + side + ' side of' if side in ('left', 'right') else side} {primary}"
        parts = [f"{lead}, {entry['camera_height_m']:.1f} m high, {entry['lens_mm']:.0f} mm lens, "
                 f"looking {looking}"]
        for i, nm in enumerate(order):
            rec = subs[nm]
            horiz = rec["words"].split()[0]
            ab = "ahead" if alongs[nm] >= mean_along else "behind"
            phrase = f"{nm} fills the {horiz} third, {rec['size']}, {ab}" if i == 0 \
                else f"{nm} {horiz} third, {rec['size']}, {ab}"
            parts.append(phrase)
        entry["anchor_sentence"] = "; ".join(parts)
        report["shots"].append(entry)
    sc.frame_set(frame_lo)
    with open(out_path, "w") as fh:
        json.dump(report, fh, indent=2)
    return report

CONTINUITY_SUBJECTS = [
    dict(name="JUNO", ob=bpy.data.objects["Juno_Coat"]),
    dict(name="BOAT", ob=BOAT),
]
write_continuity(SHOTS, CONTINUITY_SUBJECTS, lambda n: CAMS_BY_SHOT[n][0],
                  os.path.join(OUT, "continuity.json"), fps=FPS, ground_z=lambda x, y: road_z(y),
                  forward=Vector((0.0, 1.0, 0.0)))

# ---- contact sheet (Video Sequence Editor: image strips + text strips) ------
def make_contact_sheet():
    TW, TH, GAP, LAB, TOP = 624, 351, 10, 34, 56
    W = 2 * TW + 3 * GAP + 2                     # 1280
    H = TOP + len(SHOTS) * (LAB + TH + GAP) + GAP
    H += H % 2
    # Re-use the main scene (already saved to the .blend) as a sequencer canvas:
    # rendering a second scene via render(scene=...) comes out black headless.
    cs = sc
    cs.render.use_compositing = False
    cs.render.resolution_x, cs.render.resolution_y = W, H
    cs.render.resolution_percentage = 100
    cs.render.image_settings.file_format = "JPEG"
    cs.render.image_settings.quality = 92
    cs.view_settings.view_transform = "Standard"
    cs.frame_start = cs.frame_end = 1
    cs.frame_set(1)
    cs.render.use_sequencer = True
    sed = cs.sequence_editor_create()
    ch = 1

    def text(label, x, y_top, size, bold=False):
        nonlocal ch
        tx = sed.strips.new_effect(name=label[:30], type="TEXT", channel=ch, frame_start=1, length=1)
        ch += 1
        tx.text = label
        tx.font_size = size
        tx.use_bold = bold
        tx.color = (1, 1, 1, 1)
        tx.anchor_x, tx.anchor_y = "LEFT", "TOP"
        tx.location = (x / W, 1 - y_top / H)

    text("PAPER BOAT - greybox previs - first / last frame of each shot", GAP, 12, 30, True)
    for r, s in enumerate(SHOTS):
        y_row = TOP + r * (LAB + TH + GAP)
        for c, (which, fr) in enumerate((("first", s["start"]), ("last", s["end"]))):
            x = GAP + c * (TW + GAP)
            path = os.path.join(OUT, f"shot{s['n']}", f"{which}.png")
            im = sed.strips.new_image(name=f"s{s['n']}{which}", filepath=path, channel=ch, frame_start=1,
                                      fit_method="ORIGINAL")
            ch += 1
            im.transform.scale_x = im.transform.scale_y = TW / RES_X
            cx, cy = x + TW / 2, y_row + LAB + TH / 2
            im.transform.offset_x = cx - W / 2
            im.transform.offset_y = H / 2 - cy
            text(f"SHOT {s['n']} {s['name'].upper()} - {which} - frame {fr} "
                 f"({'%.2f' % ((fr - s['start']) / FPS)} s)", x, y_row + 6, 22)
    cs.render.filepath = os.path.join(OUT, "contact.jpg")
    bpy.ops.render.render(write_still=True)

make_contact_sheet()

if not KEEP_FRAMES and MODE != "stills":
    shutil.rmtree(WORK, ignore_errors=True)

print("[previs] render times per shot (s):", RENDER_TIMES)
print(f"[previs] done in {time.time() - T0:.1f}s")

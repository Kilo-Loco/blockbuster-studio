"""
QUARTER MILE -- greybox previs of a 25 s street drag race, built entirely from code.

Run (from anywhere):
    /Applications/Blender.app/Contents/MacOS/Blender -b --python build.py

Environment switches (optional):
    PREVIS_MODE=stills   only render each shot's first/mid/last frame (+ depth) and the
                         contact sheet -- fast loop for checking framing
    PREVIS_MODE=full     (default) everything: stills, per-shot clips (24 fps + 81f@16 fps),
                         depth clips, final cut, contact sheet, camera log, .blend
    PREVIS_KEEP_FRAMES=1 keep the intermediate PNG sequences in out/_frames

Outputs (next to this script, in out/):
    final_cut.mp4, contact.jpg, camera_log.json, continuity.json,
    shotN/{clip,clip16,depth,depth16}.mp4, shotN/{first,mid,last,depth_first}.png
    and dragrace.blend next to this script.

Organisation (same template as the PAPER BOAT previs):
    1. CONFIG      -- timeline, shot table, colours, road dimensions, race timing
    2. HELPERS     -- maths, materials, mesh/primitive builders, keyframing
    3. SET         -- road, chalk, shoulders, fences, warehouses, lamps, parked cars
    4. CHARACTERS  -- the two cars (+ drivers), NOVA the flagger, the crowds
    5. ANIMATION   -- cars / Nova are pure functions of the frame, baked 1 key/frame;
                      crowd sway is F-curve noise
    6. CAMERAS     -- Cam1..Cam5 with Track-To targets, markers bind them to ranges
    7. RENDER      -- Workbench + compositor depth pass, per shot, then ffmpeg
    8. REPORTS     -- camera_log.json, continuity.json, contact sheet (VSE), final cut

Units: metres, Z up. The road runs along +Y. Start line y=0, finish line y=400.
"Left" = -X when looking down the road (+Y). BLACK CAR in the left lane (x=-1.5),
GREEN CAR in the right lane (x=+1.5).
"""

import bpy
import math
import os
import json
import glob
import shutil
import subprocess
import time
import random
from mathutils import Vector, Quaternion
from bpy_extras.object_utils import world_to_camera_view

T0 = time.time()

# =============================================================================
# 1. CONFIG
# =============================================================================
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()
OUT = os.path.join(HERE, "out")
WORK = os.path.join(OUT, "_frames")
BLEND_PATH = os.path.join(HERE, "dragrace.blend")
MODE = os.environ.get("PREVIS_MODE", "full")
KEEP_FRAMES = os.environ.get("PREVIS_KEEP_FRAMES") == "1"

FPS = 24
RES_X, RES_Y = 1280, 720
N16 = 81            # frames per shot for the video model (16 fps)

# near/far = depth range (metres) mapped to white/black in that shot's depth pass.
SHOTS = [
    dict(n=1, start=1,   end=120, near=3.0, far=45.0, name="Roll-up",
         bible_camera="Wide, low, at road level in front of the start line looking back up the road; slow crane down 2.5 m -> 0.4 m"),
    dict(n=2, start=121, end=240, near=1.0, far=30.0, name="Flag",
         bible_camera="Handheld MCU on NOVA between the hoods; at t=3.5 whip to a low angle behind the cars"),
    dict(n=3, start=241, end=360, near=1.0, far=22.0, name="Launch",
         bible_camera="Low tracking shot from the road edge at 30 cm, moving with the cars"),
    dict(n=4, start=361, end=480, near=0.3, far=16.0, name="Cockpit",
         bible_camera="Inside the black car over REX's right shoulder, static mount, windshield view"),
    dict(n=5, start=481, end=600, near=5.0, far=40.0, name="Finish",
         bible_camera="High side angle at the finish line, 4 m up; pans with the cars, holds on the finish crowd"),
]
FRAME_START, FRAME_END = SHOTS[0]["start"], SHOTS[-1]["end"]

def gt(f):
    """Global seconds of frame f (frame 1 = 0.0 s)."""
    return (f - 1) / FPS

# Road
ROAD_W = 8.0
ROAD_Y0, ROAD_Y1 = -40.0, 460.0     # 460 m from the start box to the run-off + 40 m approach
START_Y, FINISH_Y = 0.0, 400.0
LANE_X = {"black": -1.5, "green": 1.5}
CROWD_X = (5.0, 5.8)                # two rows each side
LAMP_X = 6.7
FENCE_X = 10.0
WARE_X = 13.0

# Race timing
F_DROP = SHOTS[1]["start"] + int(3.5 * FPS)      # 205: flag drops = launch
T_LAUNCH = gt(F_DROP)                            # 8.5 s
T_CROSS = 23.25                                  # black car's nose crosses the line (global s)
TAU_CROSS = T_CROSS - T_LAUNCH                   # 14.75 s of racing
K_ACC = 3.5                                      # speed time-constant (s)
# black car: d(tau) = V (tau - K (1 - e^-tau/K)) ; choose V so d(TAU_CROSS) = 400 m of nose travel
V_TOP = 400.05 / (TAU_CROSS - K_ACC * (1 - math.exp(-TAU_CROSS / K_ACC)))
BRAKE_T = TAU_CROSS + 0.35                       # lift + brake after the line
BRAKE_DEC = 6.5
# green's lead (nose-to-nose metres) over the black car vs tau: half-car jump, extends
# to ~9 m, black reels it in through shots 4-5 and wins by a hood (~1 m).
LEAD_KEYS = [(0.0, 0.0), (0.5, 0.45), (1.0, 1.5), (1.5, 2.5), (3.0, 5.4), (4.5, 7.8),
             (6.0, 9.1), (6.5, 9.2), (8.0, 8.6), (10.0, 6.6), (11.5, 5.0), (13.2, 1.6),
             (TAU_CROSS, -1.0), (16.5, -2.4)]

# Colours (linear RGBA). Workbench shows material "viewport display" colour.
C = dict(
    road=(0.17, 0.17, 0.175, 1), shoulder=(0.08, 0.075, 0.07, 1), chalk=(0.9, 0.9, 0.88, 1),
    dash=(0.55, 0.5, 0.3, 1),
    ware_a=(0.16, 0.16, 0.17, 1), ware_b=(0.22, 0.21, 0.2, 1), ware_c=(0.12, 0.13, 0.15, 1),
    fence=(0.35, 0.36, 0.38, 1), pole=(0.08, 0.08, 0.09, 1), lamp=(1.0, 0.55, 0.12, 1),
    black_car=(0.055, 0.055, 0.06, 1), green_car=(0.08, 0.85, 0.05, 1), chrome=(0.42, 0.42, 0.45, 1),
    tyre=(0.012, 0.012, 0.012, 1), hub=(0.55, 0.55, 0.55, 1), headlight=(1.0, 0.95, 0.75, 1),
    taillight=(0.9, 0.02, 0.02, 1), cabin_in=(0.02, 0.02, 0.02, 1),
    rex=(0.05, 0.05, 0.055, 1), rex_skin=(0.45, 0.28, 0.2, 1), kai=(1.0, 0.33, 0.02, 1),
    kai_hair=(0.95, 0.9, 0.6, 1),
    nova=(0.92, 0.92, 0.92, 1), nova_hair=(0.03, 0.02, 0.02, 1), flag=(0.9, 0.02, 0.02, 1),
    stick=(0.1, 0.1, 0.1, 1),
    crowd=(0.3, 0.3, 0.3, 1), crowd_head=(0.38, 0.38, 0.38, 1),
    parked_a=(0.035, 0.035, 0.04, 1), parked_b=(0.05, 0.06, 0.075, 1), parked_c=(0.2, 0.2, 0.21, 1),
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
    t = clamp01(t)
    return t * t * (3 - 2 * t)

def seg(t, t0, t1):
    return ease((t - t0) / (t1 - t0)) if t1 > t0 else float(t >= t1)

def vlerp(a, b, t):
    return Vector(a).lerp(Vector(b), t)

def shot(n):
    return SHOTS[n - 1]

def shot_of_frame(f):
    for s in SHOTS:
        if s["start"] <= f <= s["end"]:
            return s
    return SHOTS[-1] if f > FRAME_END else SHOTS[0]

def t_in(f, n):
    return (f - shot(n)["start"]) / FPS

def pchip_setup(keys):
    xs = [k[0] for k in keys]
    ys = [k[1] for k in keys]
    n = len(xs)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0.0
        else:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    m[0] = 0.0                     # start with zero lead rate (both cars at rest)
    m[-1] = d[-1]
    return xs, ys, m

def pchip(setup, x):
    xs, ys, m = setup
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1] + m[-1] * (x - xs[-1])
    i = max(j for j in range(len(xs) - 1) if xs[j] <= x)
    hh = xs[i + 1] - xs[i]
    t = (x - xs[i]) / hh
    h00, h10 = 2 * t ** 3 - 3 * t ** 2 + 1, t ** 3 - 2 * t ** 2 + t
    h01, h11 = -2 * t ** 3 + 3 * t ** 2, t ** 3 - t ** 2
    return h00 * ys[i] + h10 * hh * m[i] + h01 * ys[i + 1] + h11 * hh * m[i + 1]

LEAD = pchip_setup(LEAD_KEYS)

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.name = "QuarterMile"
    return sc

MATS = {}
def mat(key, color=None, name=None):
    name = name or key
    if name in MATS:
        return MATS[name]
    rgba = color or C[key]
    m = bpy.data.materials.new(name)
    m.diffuse_color = rgba
    m.roughness = 0.9
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = 0.9
        if key in ("lamp", "headlight", "taillight"):
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

def boxes(name, coll, specs, material):
    """Many axis-aligned boxes merged into ONE mesh object (fast for set dressing).
    specs: list of (x0, x1, y0, y1, z0, z1)."""
    v, f = [], []
    for (x0, x1, y0, y1, z0, z1) in specs:
        b = len(v)
        v += [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
              (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        f += [(b, b + 3, b + 2, b + 1), (b + 4, b + 5, b + 6, b + 7), (b, b + 1, b + 5, b + 4),
              (b + 1, b + 2, b + 6, b + 5), (b + 2, b + 3, b + 7, b + 6), (b + 3, b, b + 4, b + 7)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(v, [], f)
    me.update()
    ob = bpy.data.objects.new(name, me)
    me.materials.append(material)
    return link(ob, coll)

def box_c(cx, cy, cz, sx, sy, sz):
    """Centre/size -> boxes() spec."""
    return (cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2)

def _adopt(ob, coll, material, parent=None, loc=None):
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

def sphere(name, coll, r, loc, material, parent=None, seg_=16, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg_, ring_count=rings)
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

def inst(name, coll, mesh, loc, parent=None, scale=None, rot=None):
    """Object sharing an existing mesh datablock (cheap copies for crowds)."""
    ob = bpy.data.objects.new(name, mesh)
    link(ob, coll)
    if parent is not None:
        ob.parent = parent
    ob.location = loc
    if scale is not None:
        ob.scale = scale
    if rot is not None:
        ob.rotation_euler = rot
    return ob

def template_mesh(kind, material, **kw):
    """Create a primitive once, keep its mesh, delete the object."""
    if kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(radius=kw.get("r", 1), segments=12, ring_count=8)
        bpy.ops.object.shade_smooth()
    elif kind == "cyl":
        bpy.ops.mesh.primitive_cylinder_add(radius=kw.get("r", 1), depth=kw.get("depth", 1), vertices=10)
    ob = bpy.context.active_object
    me = ob.data
    me.materials.append(material)
    bpy.data.objects.remove(ob)
    return me

def fcurves_of(ob, data=False):
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

def add_noise(ob, path, strength, scale, phase, index=None, fstart=None, fend=None):
    for fc in fcurves_of(ob):
        if fc.data_path != path or (index is not None and fc.array_index != index):
            continue
        mod = fc.modifiers.new("NOISE")
        mod.scale = scale
        mod.strength = strength
        mod.phase = phase + 7.3 * fc.array_index
        if fstart is not None:
            mod.use_restricted_range = True
            mod.frame_start, mod.frame_end = fstart, fend
            mod.blend_in = mod.blend_out = 2

def aim_quat(src, dst):
    """Quaternion that points local -Z from src toward dst (for limb cylinders)."""
    d = Vector(dst) - Vector(src)
    return d.to_track_quat("-Z", "Y"), d.length

# =============================================================================
# 3. SET -- the road
# =============================================================================
sc = reset_scene()
bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
bpy.context.preferences.filepaths.save_version = 0
SET = new_collection("SET")
rnd = random.Random(11)

hw = ROAD_W / 2
boxes("Road", SET, [(-hw, hw, ROAD_Y0, ROAD_Y1, -0.3, 0.0)], mat("road"))
boxes("Shoulders", SET, [(-FENCE_X - 3, -hw, ROAD_Y0, ROAD_Y1, -0.3, -0.02),
                         (hw, FENCE_X + 3, ROAD_Y0, ROAD_Y1, -0.3, -0.02)], mat("shoulder"))
# Chalk: start box (start line y=0, back line y=-5.6, lane lines), finish line y=400
chalk = [(-hw, hw, START_Y - 0.12, START_Y + 0.12, 0, 0.006),
         (-hw, hw, START_Y - 5.7, START_Y - 5.5, 0, 0.006)]
for x in (-3.0, 0.0, 3.0):
    chalk.append((x - 0.06, x + 0.06, START_Y - 5.7, START_Y, 0, 0.006))
chalk.append((-hw, hw, FINISH_Y - 0.2, FINISH_Y + 0.2, 0, 0.006))
# finish-line checker blocks painted each side of the line
for i in range(8):
    x = -hw + i + 0.5
    chalk.append((x - 0.25, x + 0.25, FINISH_Y + 0.25, FINISH_Y + 0.75, 0, 0.006))
boxes("Chalk", SET, chalk, mat("chalk"))
# Worn yellow centre dashes (help read speed), none inside the start box
dashes = [(-0.06, 0.06, y, y + 3.0, 0, 0.004) for y in range(2, int(ROAD_Y1) - 3, 9)]
dashes += [(-0.06, 0.06, y, y + 3.0, 0, 0.004) for y in range(int(ROAD_Y0), -9, 9)]
boxes("CentreDashes", SET, dashes, mat("dash"))

# Chain-link fence: posts every 3 m + top/mid rails, both sides
posts, rails = [], []
for sx in (-1, 1):
    x = sx * FENCE_X
    for y in range(int(ROAD_Y0), int(ROAD_Y1) + 1, 3):
        posts.append(box_c(x, y, 1.1, 0.08, 0.08, 2.2))
    for z in (2.15, 1.1):
        rails.append(box_c(x, (ROAD_Y0 + ROAD_Y1) / 2, z, 0.05, ROAD_Y1 - ROAD_Y0, 0.05))
boxes("FencePosts", SET, posts, mat("fence"))
boxes("FenceRails", SET, rails, mat("fence"))

# Warehouses: big boxes both sides behind the fences
wares = {"ware_a": [], "ware_b": [], "ware_c": []}
for sx in (-1, 1):
    y = ROAD_Y0 - 20
    i = 0
    while y < ROAD_Y1 + 30:
        L = rnd.uniform(28, 60)
        H = rnd.uniform(8, 15)
        x_in = WARE_X + rnd.uniform(0, 3)
        depth = rnd.uniform(18, 30)
        x0, x1 = sorted((sx * x_in, sx * (x_in + depth)))
        wares[("ware_a", "ware_b", "ware_c")[i % 3]].append((x0, x1, y, y + L - 2.0, 0, H))
        y += L
        i += 1
wares["ware_b"].append((-40, 40, ROAD_Y1 + 40, ROAD_Y1 + 60, 0, 16))    # closes the far end
wares["ware_a"].append((-40, 40, ROAD_Y0 - 60, ROAD_Y0 - 40, 0, 16))    # closes the near end
for k, specs in wares.items():
    boxes(f"Warehouses_{k}", SET, specs, mat(k))

# Sodium lamps every 25 m both sides (offset so none stand on the start or finish line)
LAMP_YS = [5.0 + 25 * k for k in range(-1, 19)]
lamp_posts = []
lamp_mesh = template_mesh("sphere", mat("lamp"), r=0.22)
for sx in (-1, 1):
    for y in LAMP_YS:
        if sx < 0 and 370 < y < 420:
            continue            # keep the Cam5 (finish) sightline clear of foreground poles
        lamp_posts.append(box_c(sx * LAMP_X, y, 3.3, 0.14, 0.14, 6.6))
        lamp_posts.append(box_c(sx * (LAMP_X - 0.6), y, 6.6, 1.2, 0.1, 0.1))     # arm over the road
        inst(f"Lamp_{'L' if sx < 0 else 'R'}{y:.0f}", SET, lamp_mesh, (sx * (LAMP_X - 1.15), y, 6.45))
boxes("LampPoles", SET, lamp_posts, mat("pole"))

# Parked tuner cars at the start with headlights on, nosed toward the start line
PARKED = [(-7.8, -13.0, -120), (-7.9, -4.5, -110), (-7.8, 6.0, -70),
          (7.8, -9.0, 115), (7.9, 1.0, 95), (7.8, 9.5, 70)]
head_mesh = template_mesh("sphere", mat("headlight"), r=0.11)
# (the parked cars themselves are built after the hero cars, with the same body builder)

# World: dark blue night sky
world = bpy.data.worlds.new("NightSky")
world.color = C["sky"]
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
if bg:
    bg.inputs["Color"].default_value = (*C["sky"], 1)
sc.world = world

# =============================================================================
# 4. CHARACTERS
# =============================================================================
# ---- 4a. the two cars ------------------------------------------------------
# Car hierarchy (car-local: +Y forward, +X right, origin = centre of footprint on the road):
#   Car (root, animated location)
#     Car_Pivot (at the rear axle; animated pitch = squat/dive, z = bob)
#        body, cabin (roof + 4 pillars, open windows), scoop / wing, lights,
#        dashboard, steering wheel, driver mannequin, (black car:) Cam4 + target
#     Car_Wheel_FL/FR/RL/RR pivots (animated spin about X) -> tyre + hub cross
CARS = new_collection("CARS")
CAR_SPECS = {
    "black": dict(L=4.9, W=2.0, body_z=(0.22, 0.86), roof_z=1.30, cab_y=(-1.55, 0.35), cab_w=1.60,
                  wheel_r=0.36, axle=1.55, tyre_w=(0.30, 0.40), mat="black_car", driver="rex",
                  shape=dict(nose_z=0.74, cowl_y=0.40, cowl_z=0.87, belt_z=0.89, deck_y=-1.62, deck_z=0.90,
                             tail_z=0.80, roof_front=-0.15, roof_rear=-1.22, b_y=-0.62, c_w=0.26)),
    "green": dict(L=4.6, W=1.85, body_z=(0.24, 0.88), roof_z=1.36, cab_y=(-1.25, 0.55), cab_w=1.52,
                  wheel_r=0.34, axle=1.40, tyre_w=(0.28, 0.30), mat="green_car", driver="kai",
                  shape=dict(nose_z=0.72, cowl_y=0.60, cowl_z=0.90, belt_z=0.92, deck_y=-1.30, deck_z=0.95,
                             tail_z=0.86, roof_front=0.02, roof_rear=-1.00, b_y=-0.42, c_w=0.16)),
}

# ---- car shape helpers (beveled / extruded primitives) ---------------------------
_TYRES = {}
def tyre_mesh_for(r, tw):
    key = (round(r, 3), round(tw, 3))
    if key not in _TYRES:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=tw, vertices=32)
        ob = bpy.context.active_object
        bpy.ops.object.shade_smooth()
        me = ob.data
        me.materials.append(mat("tyre"))
        bpy.data.objects.remove(ob)
        _TYRES[key] = me
    return _TYRES[key]

def bevel_mod(ob, width, segs=3):
    m = ob.modifiers.new("Bevel", "BEVEL")
    m.width = width
    m.segments = segs
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(30)
    m.harden_normals = False
    return m

def rbox(name, center, size, material, parent, bev=0.05, rot=None, segs=3):
    """Box with real dimensions in the mesh (so the bevel is not distorted) + Bevel."""
    from mathutils import Matrix
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    ob = bpy.context.active_object
    ob.name = name
    ob.data.transform(Matrix.Diagonal((*size, 1.0)))
    _adopt(ob, CARS, material, parent, center)
    if rot is not None:
        ob.rotation_euler = rot
    if bev > 0:
        bevel_mod(ob, min(bev, 0.45 * min(size)), segs)
    return ob

def beam(name, p0, p1, thick, material, parent, bev=0.02):
    """Beveled bar between two points (pivot-local) -- pillars, struts."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    ob = rbox(name, (p0 + p1) / 2, (thick[0], thick[1], d.length), material, parent, bev)
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = d.to_track_quat("Z", "Y")
    return ob

def profile_solid(name, pts, x0, x1, material, parent, P, bev=0.07):
    """Side profile (list of car-local (y, z)) extruded across x0..x1 as a filled 2D
    curve with a rounded bevel on every edge. The outline is drawn inset by the bevel so
    the finished solid matches the requested silhouette."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "2D"
    cu.fill_mode = "BOTH"
    cu.resolution_u = 12
    half = (x1 - x0) / 2
    cu.extrude = max(0.001, half - bev)
    cu.bevel_depth = bev
    cu.bevel_resolution = 3
    sp_ = cu.splines.new("POLY")
    sp_.points.add(len(pts) - 1)
    for i, (y, z) in enumerate(pts):
        sp_.points[i].co = (y, z, 0, 1)
    sp_.use_cyclic_u = True
    ob = bpy.data.objects.new(name, cu)
    link(ob, CARS)
    cu.materials.append(material)
    ob.parent = parent
    ob.rotation_euler = (math.radians(90), 0, math.radians(90))   # curve XY -> car YZ, extrude -> X
    ob.location = P((x0 + x1) / 2, 0, 0)
    return ob

def inset_profile(pts, d):
    """Offset a closed polygon inward by d (miter offset; fine for these gentle shapes)."""
    n = len(pts)
    area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n)) / 2
    sgn = 1 if area > 0 else -1
    out = []
    for i in range(n):
        a, b, c = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        e1, e2 = (b - a).normalized(), (c - b).normalized()
        n1 = Vector((-e1.y, e1.x)) * sgn
        n2 = Vector((-e2.y, e2.x)) * sgn
        m = (n1 + n2)
        if m.length < 1e-6:
            m = n1
        m.normalize()
        k = d / max(0.35, m.dot(n1))
        out.append(tuple(b + m * k))
    return out

def arch(yc, zc, r, zb, front_to_back=True, n=10):
    """Points of a wheel-arch cut in the bottom edge (walking from +y to -y)."""
    dz = zb - zc
    a0 = math.acos(max(-1, min(1, dz / r)))       # angle from +z... use param form below
    pts = []
    half = math.sqrt(max(0.0, r * r - dz * dz))
    th0 = math.atan2(dz, half)                   # right intersection angle
    th1 = math.pi - th0                          # left intersection angle
    for i in range(n + 1):
        th = th0 + (th1 - th0) * i / n
        pts.append((yc + r * math.cos(th), zc + r * math.sin(th)))
    return pts   # from +y side over the top to -y side

def shape_car_body(key, sp, cm, piv, P):
    L, W, (bz0, bz1) = sp["L"], sp["W"], sp["body_z"]
    r, ax = sp["wheel_r"], sp["axle"]
    g = sp["shape"]
    hl = L / 2
    ar = r + 0.07            # arch radius (tyre + clearance)
    # --- lower body side profile (front = +y), wheel arches cut into the sill line
    pts = [(hl - 0.10, bz0 + 0.02),                        # chin
           (hl, g["nose_z"] - 0.12),                       # nose face
           (hl - 0.06, g["nose_z"]),                       # nose top
           (hl - 0.55, g["nose_z"] + 0.035),
           (g["cowl_y"], g["cowl_z"]),                     # sloped hood up to the cowl
           (g["deck_y"], g["belt_z"]),                     # beltline under the greenhouse
           (g["deck_y"] - 0.15, g["deck_z"]),
           (-hl + 0.12, g["deck_z"] - 0.01),               # trunk deck
           (-hl, g["tail_z"]),                             # tail
           (-hl + 0.03, bz0 + 0.10),
           (-hl + 0.18, bz0)]
    # sill with arches, from the rear bumper forward
    sill = []
    for wy in (-ax, ax):
        a_pts = arch(wy, r, ar, bz0)      # from +y over the top to -y
        sill += list(reversed(a_pts))     # walk -y -> +y along the bottom
    pts += sill
    pts = inset_profile(pts, 0.07)
    profile_solid(f"{key}_Body", pts, -W / 2, W / 2, cm, piv, P, bev=0.07)
    # --- greenhouse: roof + A/B/C pillars; window openings left open (drivers read,
    #     Cam4 sees out). Pillars follow the windshield / backlight rake.
    cw, rz = sp["cab_w"], sp["roof_z"]
    wy0 = g["cowl_y"] - 0.05                 # windshield base
    ry1 = g["roof_front"]                    # roof front edge
    ry0 = g["roof_rear"]                     # roof rear edge
    by = g["deck_y"] + 0.05                  # backlight base
    belt = g["belt_z"] - 0.02
    roof_pts = inset_profile([(ry1, rz - 0.07), (ry1 + 0.06, rz), (ry0 - 0.02, rz + 0.005),
                              (ry0 - 0.1, rz - 0.07)], 0.03)
    profile_solid(f"{key}_Roof", roof_pts, -cw / 2, cw / 2, cm, piv, P, bev=0.03)
    for sx in (-1, 1):
        x = sx * (cw / 2 - 0.045)
        xb = sx * (cw / 2 + 0.02)
        beam(f"{key}_PillarA{sx}", P(xb, wy0, belt), P(x, ry1 + 0.02, rz - 0.04), (0.08, 0.07), cm, piv)
        beam(f"{key}_PillarB{sx}", P(xb, g["b_y"], belt), P(x, g["b_y"], rz - 0.04), (0.07, 0.10), cm, piv)
        beam(f"{key}_PillarC{sx}", P(xb, by, belt), P(x, ry0 + 0.05, rz - 0.04), (0.08, g["c_w"]), cm, piv)
        # window sills along the beltline (the door tops)
        beam(f"{key}_Sill{sx}", P(xb, wy0, belt), P(xb, by, belt), (0.07, 0.07), cm, piv)
        # lights
        inst(f"{key}_Head{sx}", CARS, head_mesh, P(sx * (W / 2 - 0.33), hl - 0.03, g["nose_z"] - 0.1), piv,
             scale=(1.1, 0.55, 0.8))
        rbox(f"{key}_Tail{sx}", P(sx * (W / 2 - 0.32), -hl + 0.005, g["tail_z"] - 0.08),
             (0.42, 0.04, 0.09), mat("taillight"), piv, bev=0.012)
    # windshield header + backlight header bars close the openings' frames
    beam(f"{key}_Cowl", P(-cw / 2 - 0.02, wy0, belt), P(cw / 2 + 0.02, wy0, belt), (0.06, 0.06), cm, piv)
    # --- bumpers
    bm = mat("chrome") if key == "black" else cm
    rbox(f"{key}_BumperF", P(0, hl + 0.04, bz0 + 0.14), (W - 0.1, 0.16, 0.16), bm, piv, bev=0.06)
    rbox(f"{key}_BumperR", P(0, -hl - 0.04, bz0 + 0.14), (W - 0.1, 0.16, 0.16), bm, piv, bev=0.06)
    if key == "black":
        # supercharger scoop through the hood
        hz = g["cowl_z"] - 0.08
        rbox("black_Scoop", P(0, 1.25, hz + 0.12), (0.55, 0.85, 0.26), mat("chrome"), piv, bev=0.07,
             rot=(math.radians(-3), 0, 0))
        rbox("black_ScoopMouth", P(0, 1.68, hz + 0.17), (0.42, 0.03, 0.12), mat("tyre"), piv, bev=0.01)
        # wide rear fender flares over the fat rear tyres
        for sx in (-1, 1):
            fl = inset_profile(list(reversed(arch(-ax, r, ar + 0.10, bz0 + 0.02))) +
                               arch(-ax, r, ar + 0.005, bz0 + 0.02), 0.02)
            profile_solid(f"black_Flare{sx}", fl, sx * W / 2 - 0.04, sx * W / 2 + 0.08, cm, piv, P, bev=0.025)
    elif sp.get("wing", True):
        # big rear wing on struts
        wz = g["deck_z"] + 0.34
        wyw = -hl + 0.32
        for sx in (-1, 1):
            beam(f"green_WingStrut{sx}", P(sx * 0.55, wyw + 0.1, g["deck_z"] - 0.02), P(sx * 0.55, wyw, wz),
                 (0.045, 0.14), mat("tyre"), piv, bev=0.012)
            rbox(f"green_WingEnd{sx}", P(sx * (W / 2 - 0.03), wyw, wz - 0.03), (0.03, 0.46, 0.2), cm, piv, bev=0.01)
        wing = inset_profile([(wyw + 0.24, wz + 0.01), (wyw + 0.05, wz + 0.05), (wyw - 0.2, wz + 0.035),
                              (wyw - 0.22, wz - 0.01), (wyw + 0.05, wz - 0.03)], 0.01)
        profile_solid("green_Wing", wing, -W / 2 + 0.02, W / 2 - 0.02, cm, piv, P, bev=0.012)
        # low front splitter + side skirts
        rbox("green_Splitter", P(0, hl - 0.05, bz0 - 0.04), (W - 0.1, 0.35, 0.03), mat("tyre"), piv, bev=0.01)
CAR = {}

def build_car(key):
    sp = CAR_SPECS[key]
    L, W, (bz0, bz1) = sp["L"], sp["W"], sp["body_z"]
    cm = mat(sp["mat"])
    root = empty(f"Car_{key}", CARS, (LANE_X[key], 0, 0), size=0.5, kind="ARROWS")
    piv_off = Vector((0, -sp["axle"], sp["wheel_r"]))
    piv = empty(f"Car_{key}_Pivot", CARS, piv_off, root)
    piv.rotation_mode = "XYZ"

    def P(x, y, z):          # car-local -> pivot-local
        return Vector((x, y, z)) - piv_off

    shape_car_body(key, sp, cm, piv, P)
    cy0, cy1 = sp["cab_y"]
    cw = sp["cab_w"]
    # dashboard + steering wheel (left seat)
    cube(f"{key}_Dash", CARS, P(0, cy1 - 0.25, bz1 + 0.07), (cw - 0.1, 0.35, 0.14), mat("cabin_in"), piv)
    wheel_c = Vector((-0.42, cy1 - 0.52, bz1 + 0.18))
    sw = cylinder(f"{key}_SteeringWheel", CARS, 0.17, 0.035, P(*wheel_c), mat("cabin_in"), piv, verts=16)
    sw.rotation_euler = (math.radians(65), 0, 0)
    shifter = Vector((-0.06, cy1 - 0.85, bz1 - 0.05))
    cube(f"{key}_Shifter", CARS, P(*shifter), (0.05, 0.05, 0.2), mat("chrome"), piv)
    # wheels (children of the root so the body can pitch over them): plain tyres, slight bevel
    wheels = []
    r = sp["wheel_r"]
    for tag, wy in (("F", sp["axle"]), ("R", -sp["axle"])):
        tw = sp["tyre_w"][0 if tag == "F" else 1]
        tmesh = tyre_mesh_for(r, tw)
        for sx, side in ((-1, "L"), (1, "R")):
            wx = sx * (W / 2 - tw / 2 - 0.02)
            wp = empty(f"{key}_Wheel_{tag}{side}", CARS, (wx, wy, r), root, size=0.3)
            wp.rotation_mode = "XYZ"
            ty = inst(f"{key}_Tyre_{tag}{side}", CARS, tmesh, (0, 0, 0), wp, rot=(0, math.radians(90), 0))
            bevel_mod(ty, 0.035, 3)
            wheels.append((wp, tag))
    # driver mannequin in the left seat
    body_m = mat(sp["driver"])
    skin = mat("rex_skin") if key == "black" else mat("kai_hair")
    hip = Vector((-0.42, cy1 - 1.30, bz0 + 0.21))   # low enough that the head clears the roof
    drv = empty(f"{key}_Driver", CARS, P(*hip), piv)
    drv.rotation_mode = "XYZ"
    torso = sphere(f"{key}_Torso", CARS, 1.0, (0, 0.03, 0.30), body_m, drv)
    torso.scale = (0.20, 0.13, 0.32)
    torso.rotation_euler = (math.radians(-12), 0, 0)
    neck = empty(f"{key}_Neck", CARS, (0, -0.04, 0.60), drv)
    neck.rotation_mode = "XYZ"
    sphere(f"{key}_Head", CARS, 0.11, (0, 0, 0.09), mat("rex_skin"), neck)
    if key == "green":
        sphere(f"{key}_Hair", CARS, 0.105, (0, -0.02, 0.13), skin, neck)
    # shoulders are in pivot space; arms re-aimed each frame toward their hand targets
    arms = {}
    for side, sx in (("L", -1), ("R", 1)):
        sh_local = hip + Vector((sx * 0.19, -0.02, 0.50))
        sh = empty(f"{key}_Shoulder_{side}", CARS, P(*sh_local), piv)
        sh.rotation_mode = "QUATERNION"
        arm = cylinder(f"{key}_Arm_{side}", CARS, 0.045, 1.0, (0, 0, -0.5), body_m, sh, verts=10)
        hand = sphere(f"{key}_Hand_{side}", CARS, 0.05, (0, 0, -1.0), mat("rex_skin"), sh)
        arms[side] = dict(sh=sh, arm=arm, hand=hand, sh_local=sh_local)
    rim = {"L": wheel_c + Vector((-0.15, 0.03, 0.04)), "R": wheel_c + Vector((0.15, 0.03, 0.04))}
    CAR[key] = dict(root=root, piv=piv, piv_off=piv_off, wheels=wheels, spec=sp, arms=arms, rim=rim,
                    shifter=shifter + Vector((0, 0, 0.1)), neck=neck, drv=drv, P=P)

build_car("black")
build_car("green")

def build_parked(i, x, y, yaw):
    """Parked car at the start: the green car's body/cabin/wheels (no wing, no driver),
    scaled 0.95, dark neutral paint, headlights on. Static."""
    sp = dict(CAR_SPECS["green"])
    sp["wing"] = False
    root = empty(f"Parked{i}", SET, (x, y, 0))
    root.rotation_euler = (0, 0, math.radians(yaw))
    root.scale = (0.95, 0.95, 0.95)
    piv_off = Vector((0, -sp["axle"], sp["wheel_r"]))
    piv = empty(f"Parked{i}_Pivot", SET, piv_off, root)
    def P(px, py, pz):
        return Vector((px, py, pz)) - piv_off
    shape_car_body(f"parked{i}", sp, mat(("parked_a", "parked_b", "parked_c")[i % 3]), piv, P)
    r, W = sp["wheel_r"], sp["W"]
    for tag, wy in (("F", sp["axle"]), ("R", -sp["axle"])):
        tw = sp["tyre_w"][0 if tag == "F" else 1]
        for sx in (-1, 1):
            ty = inst(f"parked{i}_Tyre_{tag}{sx}", CARS, tyre_mesh_for(r, tw),
                      (sx * (W / 2 - tw / 2 - 0.02), wy, r), root, rot=(0, math.radians(90), 0))
            bevel_mod(ty, 0.035, 3)

for i, (x, y, yaw) in enumerate(PARKED):
    build_parked(i, x, y, yaw)

# ---- 4b. NOVA the flagger ----------------------------------------------------
# Hierarchy: Nova (root: location + heading) -> Hips (height) -> Torso (lean) -> Neck (head
# yaw/pitch), Shoulder_L/R (arm swing X, splay Y) -> Wrist_R (YXZ: roll, pitch) -> flag stick
# + red flag plane; Leg_L/R pivots (swing X).
NOVA_C = new_collection("NOVA")
NV = {}
HIP_H = 0.92
NV["root"] = empty("Nova", NOVA_C, size=0.3, kind="ARROWS")
NV["root"].rotation_mode = "XYZ"
NV["hips"] = empty("Nova_Hips", NOVA_C, (0, 0, HIP_H), NV["root"])
NV["torso"] = empty("Nova_Torso", NOVA_C, (0, 0, 0), NV["hips"])
NV["torso"].rotation_mode = "XYZ"
t_ob = sphere("Nova_TorsoMesh", NOVA_C, 1.0, (0, 0, 0.28), mat("nova"), NV["torso"])
t_ob.scale = (0.16, 0.11, 0.31)
NV["neck"] = empty("Nova_Neck", NOVA_C, (0, 0, 0.58), NV["torso"])
NV["neck"].rotation_mode = "XYZ"
sphere("Nova_Head", NOVA_C, 0.105, (0, 0, 0.12), mat("nova"), NV["neck"])
braids = sphere("Nova_Braids", NOVA_C, 1.0, (0, -0.07, 0.02), mat("nova_hair"), NV["neck"])
braids.scale = (0.09, 0.05, 0.22)
ARM_LEN = 0.60
for side, sx in (("L", -1), ("R", 1)):
    sh = empty(f"Nova_Shoulder_{side}", NOVA_C, (sx * 0.17, 0, 0.50), NV["torso"])
    sh.rotation_mode = "XYZ"
    cylinder(f"Nova_Arm_{side}", NOVA_C, 0.038, ARM_LEN - 0.04, (0, 0, -(ARM_LEN - 0.04) / 2), mat("nova"), sh)
    sphere(f"Nova_Hand_{side}", NOVA_C, 0.045, (0, 0, -ARM_LEN), mat("nova"), sh)
    NV[f"sh_{side}"] = sh
    lp = empty(f"Nova_Leg_{side}", NOVA_C, (sx * 0.09, 0, 0), NV["hips"])
    lp.rotation_mode = "XYZ"
    cylinder(f"Nova_LegMesh_{side}", NOVA_C, 0.06, HIP_H - 0.06, (0, 0, -(HIP_H - 0.06) / 2), mat("nova"), lp)
    cube(f"Nova_Foot_{side}", NOVA_C, (0, 0.05, -HIP_H + 0.03), (0.09, 0.22, 0.06), mat("nova_hair"), lp)
    NV[f"leg_{side}"] = lp
NV["wrist"] = empty("Nova_Wrist_R", NOVA_C, (0, 0, -ARM_LEN), NV["sh_R"])
NV["wrist"].rotation_mode = "YXZ"
STICK = 0.55
stick = cylinder("Nova_FlagStick", NOVA_C, 0.012, STICK, (0, STICK / 2, 0), mat("stick"), NV["wrist"], verts=8)
stick.rotation_euler = (math.radians(-90), 0, 0)
_fv = [(0.0, STICK - 0.36, 0), (0.46, STICK - 0.36, 0), (0.46, STICK, 0), (0.0, STICK, 0)]
_fm = bpy.data.meshes.new("Nova_Flag")
_fm.from_pydata(_fv, [], [(0, 1, 2, 3)])
_fm.materials.append(mat("flag"))
FLAG = link(bpy.data.objects.new("Nova_Flag", _fm), NOVA_C)
FLAG.parent = NV["wrist"]
# (the plane is single-sided but Workbench renders both faces)

# ---- 4c. crowds ---------------------------------------------------------------
CROWD_C = new_collection("CROWD")
body_mesh = template_mesh("sphere", mat("crowd"), r=1.0)
head_mesh_c = template_mesh("sphere", mat("crowd_head"), r=0.115)
arm_mesh = template_mesh("cyl", mat("crowd"), r=0.045, depth=0.58)
CROWD = []    # dicts: root, sh_L, sh_R, finish(bool), x0, y

CROWD_RND = random.Random(23)
CROWD_GRAYS = [0.20, 0.25, 0.30, 0.35, 0.41]

def build_figure(i, x, y, finish):
    root = empty(f"Fan{i:03d}", CROWD_C, (x, y, 0), size=0.2)
    root.rotation_mode = "XYZ"
    root.rotation_euler = (0, 0, math.radians(90 if x > 0 else -90) + rnd.uniform(-0.4, 0.4))
    h = rnd.uniform(0.92, 1.08)          # heights +-8%
    root.scale = (h, h, h)
    bo = inst(f"Fan{i:03d}_Body", CROWD_C, body_mesh, (0, 0, 0.74), root, scale=(0.21, 0.15, 0.73))
    he = inst(f"Fan{i:03d}_Head", CROWD_C, head_mesh_c, (0, 0, 1.60), root)
    # slightly darker / lighter grays per figure (own RNG: the main stream stays as it was)
    gk = CROWD_RND.randrange(len(CROWD_GRAYS))
    for ob, lift in ((bo, 0.0), (he, 0.06)):
        ob.material_slots[0].link = "OBJECT"
        ob.material_slots[0].material = mat(f"crowd_{gk}_{lift}", (*[CROWD_GRAYS[gk] + lift] * 3, 1))
    sh = {}
    for side, sx in (("L", -1), ("R", 1)):
        p = empty(f"Fan{i:03d}_Sh{side}", CROWD_C, (sx * 0.2, 0, 1.36), root, size=0.05)
        p.rotation_mode = "XYZ"
        p.rotation_euler = (0, math.radians(-sx * 6), 0)
        inst(f"Fan{i:03d}_Arm{side}", CROWD_C, arm_mesh, (0, 0, -0.29), p)
        sh[side] = p
    CROWD.append(dict(root=root, sh_L=sh["L"], sh_R=sh["R"], finish=finish, x0=x, y=y, i=i))

k = 0
# dense start crowd: 2 rows x 2 sides x 15 = 60, y -10..40
for sx in (-1, 1):
    for row, cx in enumerate(CROWD_X):
        for j in range(15):
            y = -10 + j * (50 / 14.0) + (0.0 if row == 0 else 1.6) + rnd.uniform(-0.5, 0.5)
            build_figure(k, sx * (cx + rnd.uniform(-0.15, 0.15)), y, False)
            k += 1
# finish crowd: 2 rows x 2 sides x 5 = 20, y 395..410
for sx in (-1, 1):
    for row, cx in enumerate(CROWD_X):
        for j in range(5):
            y = 395 + j * 3.6 + (0.0 if row == 0 else 1.5) + rnd.uniform(-0.3, 0.3)
            build_figure(k, sx * (cx + rnd.uniform(-0.15, 0.15)), min(y, 410.0), True)
            k += 1

# =============================================================================
# 5. ANIMATION
# =============================================================================
# ---- race kinematics -----------------------------------------------------------
def black_d(tau):
    """Black car nose travel (m) since launch, and speed (m/s)."""
    def raw(t):
        return V_TOP * (t - K_ACC * (1 - math.exp(-t / K_ACC))), V_TOP * (1 - math.exp(-t / K_ACC))
    if tau <= 0:
        return 0.0, 0.0
    if tau <= BRAKE_T:
        return raw(tau)
    d0, v0 = raw(BRAKE_T)
    dt = min(tau - BRAKE_T, v0 / BRAKE_DEC)
    return d0 + v0 * dt - 0.5 * BRAKE_DEC * dt * dt, v0 - BRAKE_DEC * dt

ROLL = {"black": dict(T=3.2, D=14.0), "green": dict(T=3.6, D=17.0)}   # shot-1 roll-in

def car_nose(key, t):
    """Nose y (m) of a car at global time t (s)."""
    if t < T_LAUNCH:
        r = ROLL[key]
        s = clamp01(t / r["T"])
        return -0.05 - r["D"] * (1 - s) ** 2
    tau = t - T_LAUNCH
    d, _ = black_d(tau)
    if key == "green":
        d += pchip(LEAD, tau)
    return -0.05 + d

def car_speed(key, t, h=1 / 96):
    return (car_nose(key, t + h) - car_nose(key, t - h)) / (2 * h)

def car_center(key, t):
    return car_nose(key, t) - CAR_SPECS[key]["L"] / 2

def car_pose(key, f):
    """(root location, pivot pitch rad, pivot z offset, wheel angle front, wheel angle rear)."""
    t = gt(f)
    sp = CAR_SPECS[key]
    y = car_center(key, t)
    y_start = car_center(key, 0.0)
    v = car_speed(key, t)
    a = (car_speed(key, t + 1 / 48) - car_speed(key, t - 1 / 48)) * 24
    tau = t - T_LAUNCH
    # squat on launch (nose up, rear down), dive under braking; idle rock; bob at speed
    pitch = math.radians(0.28 * max(-8.0, min(10.0, a)))
    if tau >= 0:
        pitch += math.radians(1.2) * math.exp(-tau / 0.5) * (1 - math.exp(-tau / 0.08))  # launch kick
    idle = 1.0 if (t > ROLL[key]["T"] and t < T_LAUNCH) else 0.0
    z = 0.006 * math.sin(2 * math.pi * 2.3 * t + (0 if key == "black" else 1.3)) * idle
    pitch += math.radians(0.35) * math.sin(2 * math.pi * 1.1 * t) * idle
    speed_k = clamp01(v / 25.0)
    z += 0.018 * math.sin(2 * math.pi * 1.7 * t + (0.7 if key == "green" else 0)) * speed_k
    pitch += math.radians(0.25) * math.sin(2 * math.pi * 1.3 * t + 0.4) * speed_k
    r = sp["wheel_r"]
    roll = (y - y_start) / r
    spin = 0.0
    if tau > 0:   # rear wheelspin at launch (black smokes them more)
        amt = 22.0 if key == "black" else 12.0
        spin = amt * (1 - math.exp(-tau / 0.5))
    return Vector((LANE_X[key], y, 0.0)), pitch, z, -roll, -(roll + spin)

def bake_cars():
    for key, c in CAR.items():
        for f in range(FRAME_START, FRAME_END + 1):
            loc, pitch, z, wf, wr = car_pose(key, f)
            c["root"].location = loc
            c["root"].keyframe_insert("location", frame=f)
            c["piv"].location = c["piv_off"] + Vector((0, 0, z))
            c["piv"].rotation_euler = (pitch, 0, 0)
            c["piv"].keyframe_insert("location", frame=f)
            c["piv"].keyframe_insert("rotation_euler", frame=f)
            for wp, tag in c["wheels"]:
                wp.rotation_euler = (wf if tag == "F" else wr, 0, 0)
                wp.keyframe_insert("rotation_euler", frame=f, index=0)

def driver_targets(key, f):
    """Hand targets in car-local space + head yaw/pitch (deg)."""
    c = CAR[key]
    t = gt(f)
    L, R = c["rim"]["L"].copy(), c["rim"]["R"].copy()
    yaw, pitch = 0.0, 0.0
    if key == "black":
        # REX: two upshifts in shot 4 (t=1.0 s and t=3.0 s), glances at the rival in shot 1-2
        for ts in (1.0, 3.0):
            ta = shot(4)["start"] / FPS + ts - 1 / FPS
            u = seg(t, ta - 0.25, ta) * (1 - seg(t, ta + 0.35, ta + 0.6))
            R = R.lerp(c["shifter"], u)
        yaw = -25 * seg(t, 6.0, 6.6) * (1 - seg(t, 7.6, 8.1))
    else:
        yaw = 30 * seg(t, 5.5, 6.1) * (1 - seg(t, 7.0, 7.5))
    tau = t - T_LAUNCH
    pitch = -8 * math.exp(-max(0, tau) / 0.6) * (1 if tau > 0 else 0)   # head snaps back at launch
    return L, R, yaw, pitch

def bake_drivers():
    for key, c in CAR.items():
        for f in range(FRAME_START, FRAME_END + 1):
            L, R, yaw, pitch = driver_targets(key, f)
            for side, tgt in (("L", L), ("R", R)):
                a = c["arms"][side]
                q, ln = aim_quat(a["sh_local"], tgt)
                a["sh"].rotation_quaternion = q
                a["arm"].scale = (1, 1, ln)
                a["arm"].location = (0, 0, -ln / 2)
                a["hand"].location = (0, 0, -ln)
                a["sh"].keyframe_insert("rotation_quaternion", frame=f)
                a["arm"].keyframe_insert("scale", frame=f)
                a["arm"].keyframe_insert("location", frame=f)
                a["hand"].keyframe_insert("location", frame=f)
            c["neck"].rotation_euler = (math.radians(pitch), 0, math.radians(yaw))
            c["neck"].keyframe_insert("rotation_euler", frame=f)

# ---- Nova -------------------------------------------------------------------------
NOVA_MARK = Vector((0.0, -0.7))       # her spot between the hoods
def walk(t, freq=1.8, amp=1.0):
    s = math.sin(2 * math.pi * freq * t)
    return 24 * s * amp, -24 * s * amp, 0.025 * abs(s) * amp

def nova_pose(f):
    t = gt(f)
    p = dict(x=-4.4, y=0.9, heading=-90.0, lean=0.0, head_yaw=0.0, head_pitch=0.0, bob=0.0, crouch=0.0,
             legL=0.0, legR=0.0, armR=6.0, armL=-4.0, splayR=6.0, splayL=6.0, wrist=-40.0, roll=0.0)
    # shot 1: waits at the left crowd edge, then walks out in front of the noses to the
    # centre line (2.4-4.5 s), backs into her spot between the hoods facing down the road
    if t < 3.9:
        u = clamp01((t - 2.1) / 1.8)
        p["x"] = lerp(-4.4, 0.0, u)
        w = 1.0 if 2.1 < t < 3.9 else 0.0
        p["legL"], p["legR"], p["bob"] = walk(t, amp=w)
        p["armL"] = -4 - 12 * math.sin(2 * math.pi * 1.8 * t) * w
        p["head_yaw"] = 30 * seg(t, 0.5, 1.5) * (1 - seg(t, 2.0, 2.4))
    else:
        u = seg(t, 3.9, 4.9)
        p["x"] = 0.0
        p["y"] = lerp(0.9, NOVA_MARK.y, u)
        p["heading"] = lerp(-90.0, 0.0, seg(t, 3.9, 4.5))
        w = 1.0 if t < 4.9 else 0.0
        p["legL"], p["legR"], p["bob"] = walk(t, amp=0.7 * w)
    t2 = t - gt(shot(2)["start"])          # shot-2 local time
    if t2 >= 0:
        up = seg(t2, 0.8, 1.8)
        p["armR"] = lerp(6, 158, up)
        p["wrist"] = lerp(-40, -68, up)
        p["splayR"] = lerp(6, 12, up)
        p["armL"] = lerp(-4, 20, up)            # free hand on the hip-ish
        p["splayL"] = lerp(6, 30, up)
        # glance left (black car) then right (green car)
        p["head_yaw"] = 50 * seg(t2, 2.0, 2.35) * (1 - seg(t2, 2.5, 2.85)) \
            - 50 * seg(t2, 2.5, 2.85) * (1 - seg(t2, 3.0, 3.25))
        wind = seg(t2, 3.25, 3.5)
        p["armR"] += 12 * wind
        drop = seg(t2, 3.5, 3.68)
        p["armR"] = lerp(p["armR"], -12, drop)
        p["wrist"] = lerp(p["wrist"], -55, drop)
        p["roll"] = 90 * seg(t2, 3.6, 3.9)     # flag turns edge-on so it clears the cars
        p["lean"] = 18 * drop * (1 - seg(t2, 4.0, 4.6))
        p["crouch"] = 0.08 * drop * (1 - seg(t2, 4.0, 4.6))
        p["armL"] = lerp(p["armL"], -4, seg(t2, 3.5, 3.9))
        p["splayL"] = lerp(p["splayL"], 4, seg(t2, 3.5, 3.9))
        p["splayR"] = lerp(p["splayR"], 4, seg(t2, 3.5, 3.9))
        # steps back between the launching cars
        back = seg(t2, 3.9, 4.9)
        p["y"] = NOVA_MARK.y - 0.8 * back
        if 3.9 < t2 < 4.9:
            lL, lR, b = walk(t2, freq=2.0, amp=0.6)
            p["legL"], p["legR"], p["bob"] = lL, lR, b
        # watches the cars go
        p["head_yaw"] += 0.0
    return p

def apply_nova(p, f):
    NV["root"].location = (p["x"], p["y"], 0)
    NV["root"].rotation_euler = (0, 0, math.radians(p["heading"]))
    NV["hips"].location = (0, 0, HIP_H + p["bob"] - p["crouch"] - 0.03 * (1 - math.cos(math.radians(max(abs(p["legL"]), abs(p["legR"]))))) * 0)
    NV["torso"].rotation_euler = (math.radians(-p["lean"]), 0, 0)
    NV["neck"].rotation_euler = (math.radians(p["head_pitch"]), 0, math.radians(p["head_yaw"]))
    NV["sh_R"].rotation_euler = (math.radians(p["armR"] + p["lean"]), math.radians(-p["splayR"]), 0)
    NV["sh_L"].rotation_euler = (math.radians(p["armL"] + p["lean"]), math.radians(p["splayL"]), 0)
    NV["wrist"].rotation_euler = (math.radians(p["wrist"]), math.radians(p["roll"]), 0)
    NV["leg_L"].rotation_euler = (math.radians(p["legL"]), 0, 0)
    NV["leg_R"].rotation_euler = (math.radians(p["legR"]), 0, 0)
    for key, path in (("root", "location"), ("root", "rotation_euler"), ("hips", "location"),
                      ("torso", "rotation_euler"), ("neck", "rotation_euler"), ("sh_R", "rotation_euler"),
                      ("sh_L", "rotation_euler"), ("wrist", "rotation_euler"), ("leg_L", "rotation_euler"),
                      ("leg_R", "rotation_euler")):
        NV[key].keyframe_insert(path, frame=f)

def bake_nova():
    for f in range(FRAME_START, FRAME_END + 1):
        apply_nova(nova_pose(f), f)

# ---- crowd: few keys + F-curve noise (sway / bob always) ---------------------------
F_CHEER = int(round(T_CROSS * FPS)) + 1 + 3      # finish crowd starts throwing arms up

def bake_crowd():
    for c in CROWD:
        r = c["root"]
        ph = rnd.uniform(0, 100)
        # start crowd closes in toward the road behind the cars during shot 1
        if not c["finish"] and c["y"] < 12:
            sgn = 1 if c["x0"] > 0 else -1
            r.location = (c["x0"], c["y"], 0)
            r.keyframe_insert("location", frame=1 + rnd.randint(0, 20))
            r.location = (c["x0"] - sgn * rnd.uniform(0.35, 0.6), c["y"] + rnd.uniform(-0.3, 0.3), 0)
            r.keyframe_insert("location", frame=70 + rnd.randint(0, 30))
        else:
            r.keyframe_insert("location", frame=1)
        r.keyframe_insert("location", frame=FRAME_END)
        r.keyframe_insert("rotation_euler", frame=1)
        r.keyframe_insert("rotation_euler", frame=FRAME_END)
        add_noise(r, "location", 0.035, rnd.uniform(5, 9), ph, index=2)            # bob
        add_noise(r, "rotation_euler", 0.07, rnd.uniform(14, 24), ph + 3, index=0)  # sway
        add_noise(r, "rotation_euler", 0.07, rnd.uniform(14, 24), ph + 9, index=1)
        add_noise(r, "rotation_euler", 0.25, rnd.uniform(20, 40), ph + 17, index=2)  # look around
        for side, sx in (("L", -1), ("R", 1)):
            p = c[f"sh_{side}"]
            rest = (math.radians(rnd.uniform(-10, 15)), math.radians(-sx * 6), 0)
            p.rotation_euler = rest
            p.keyframe_insert("rotation_euler", frame=1)
            if c["finish"]:
                f0 = F_CHEER + rnd.randint(0, 8)
                p.keyframe_insert("rotation_euler", frame=f0)
                up = (math.radians(rnd.uniform(-10, 10)), math.radians(-sx * rnd.uniform(140, 160)), 0)
                p.rotation_euler = up
                p.keyframe_insert("rotation_euler", frame=f0 + 8)
                ff = f0 + 8
                while ff + 7 <= FRAME_END:          # pumping fists
                    ff += 7
                    p.rotation_euler = (up[0], up[1] + math.radians(sx * 25 * ((ff // 7) % 2)), 0)
                    p.keyframe_insert("rotation_euler", frame=ff)
            else:
                # start crowd: some wave an arm as the cars launch
                if rnd.random() < 0.4:
                    f0 = F_DROP + rnd.randint(-6, 12)
                    p.keyframe_insert("rotation_euler", frame=f0)
                    p.rotation_euler = (rest[0], math.radians(-sx * 130), 0)
                    p.keyframe_insert("rotation_euler", frame=f0 + 8)
                    p.rotation_euler = rest
                    p.keyframe_insert("rotation_euler", frame=f0 + 40)
            p.keyframe_insert("rotation_euler", frame=FRAME_END) if not c["finish"] else None
            add_noise(p, "rotation_euler", 0.08, rnd.uniform(8, 14), ph + 31 + sx, index=0)

# =============================================================================
# 6. CAMERAS
# =============================================================================
CAMS = new_collection("CAMERAS")
CAM4_LOCAL = Vector((-0.20, -1.25, 1.19))          # black-car local: behind REX's right shoulder
CAM4_YAW, CAM4_PITCH = 16.0, -4.0

def dir_from(yaw_deg, pitch_deg):
    """Unit vector: yaw 0 = +Y, positive yaw turns toward +X; pitch positive = up."""
    y, p = math.radians(yaw_deg), math.radians(pitch_deg)
    return Vector((math.sin(y) * math.cos(p), math.cos(y) * math.cos(p), math.sin(p)))

WHIP0, WHIP_MID, WHIP1 = F_DROP + 1, F_DROP + 4, F_DROP + 8
CAM2_MCU = Vector((-0.85, 1.55, 1.42))
CAM2_REAR = Vector((0.0, -4.95 - 4.0, 0.5))     # 4 m behind the rear bumpers

def cam_state(n, f):
    """(camera location, target location, lens mm) for shot n at frame f."""
    t = t_in(f, n)
    tg = gt(f)
    if n == 1:
        # wide, low, in front of the start line looking back up the road; crane down
        u = ease(t / 5.0)
        cam = Vector((0.35, 6.8, lerp(2.5, 0.4, u)))
        tgt = Vector((0.0, -6.0, lerp(0.2, 1.0, u)))
        return cam, tgt, 20.0
    if n == 2:
        nv = nova_pose(f)
        up = seg(t, 0.8, 1.8) * (1 - seg(t, 3.5, 3.7))
        mcu_tgt = Vector((nv["x"] + 0.08 * up, nv["y"], lerp(1.55, 1.85, up)))
        if f < WHIP0:
            return CAM2_MCU.copy(), mcu_tgt, 35.0
        # whip: a fast pan right (toward the green car's flank) ...
        yaw0 = math.degrees(math.atan2(mcu_tgt.x - CAM2_MCU.x, mcu_tgt.y - CAM2_MCU.y))
        if f <= WHIP_MID:
            u = (f - WHIP0 + 1) / (WHIP_MID - WHIP0 + 1)
            yaw = lerp(yaw0, yaw0 - 150, u * u)
            cam = CAM2_MCU + Vector((0.15 * u, -0.3 * u, -0.25 * u))
            return cam, cam + dir_from(yaw, lerp(-3, -8, u)) * 4, lerp(35, 24, u)
        # ... that lands low behind the cars, completing the turn toward the road ahead
        u = clamp01((f - WHIP_MID) / (WHIP1 - WHIP_MID))
        yaw = lerp(70, 0, 1 - (1 - u) ** 2)
        tgt_end = Vector((0.0, 4.0, 0.75))
        d_end = (tgt_end - CAM2_REAR).normalized()
        d = dir_from(yaw, lerp(4, math.degrees(math.asin(d_end.z)), u))
        return CAM2_REAR.copy(), CAM2_REAR + d * 6, 20.0
    if n == 3:
        # low tracking at the left road edge, travelling just ahead of the green car's
        # nose and looking back at both: the green car across the road, the black car
        # chasing in the near lane
        yb = car_center("black", tg)
        yg = car_center("green", tg)
        cam = Vector((-hw + 0.3, car_nose("green", tg) + 1.4, 0.32))
        tgt = Vector((0.0, (yg + yb) / 2, 0.62))
        return cam, tgt, 20.0
    if n == 4:
        return None     # parented to the black car (static mount)
    if n == 5:
        # high side angle at the finish, 4 m up; pan with the cars, then hold on the crowd
        # Long lens up the road on the approaching pair, zooming out as they arrive
        # (lens ~ distance so the pair keeps roughly a constant size, clamped 24-70 mm),
        # tight pan on the midpoint of the two cars, then hold on the finish crowd with
        # the braking cars still in frame.
        cam = Vector((-9.0, 399.0, 4.0))
        mid = Vector((0.0, (car_center("black", tg) + car_center("green", tg)) / 2, 0.7))
        hold_pt = Vector((3.0, 422.0, 1.0))
        tgt = mid.lerp(hold_pt, seg(tg, T_CROSS + 0.3, T_CROSS + 1.5))
        dist = (mid - cam).length
        lens = min(70.0, max(24.0, 2.45 * dist)) if tg < T_CROSS else 24.0
        return cam, tgt, lens

CAM5_SMOOTH = {}   # frame -> (smoothed target, smoothed lens) for cam 5

def build_cameras():
    cams = {}
    for s in SHOTS:
        n = s["n"]
        cd = bpy.data.cameras.new(f"Cam{n}")
        cd.sensor_width = 36.0
        cd.sensor_fit = "HORIZONTAL"
        cd.clip_start = 0.05
        cd.clip_end = 800.0
        cam = bpy.data.objects.new(f"Cam{n}", cd)
        link(cam, CAMS)
        tgt = empty(f"Cam{n}_Target", CAMS, size=0.15, kind="SPHERE")
        con = cam.constraints.new("TRACK_TO")
        con.target = tgt
        con.track_axis = "TRACK_NEGATIVE_Z"
        con.up_axis = "UP_Y"
        cams[n] = (cam, tgt)
        if n == 4:
            piv = CAR["black"]["piv"]
            P = CAR["black"]["P"]
            cam.parent = piv
            cam.location = P(*CAM4_LOCAL)
            tgt.parent = piv
            tgt.location = P(*(CAM4_LOCAL + dir_from(CAM4_YAW, CAM4_PITCH) * 10.0))
            cd.lens = 35.0
            cd.clip_start = 0.03
        else:
            for f in range(max(FRAME_START, s["start"] - 1), min(FRAME_END, s["end"] + 1) + 1):
                ff = min(max(f, s["start"]), s["end"])
                c, g, lens = cam_state(n, ff)
                if n == 5:
                    g, lens = CAM5_SMOOTH[ff]
                cam.location = c
                tgt.location = g
                cd.lens = lens
                cam.keyframe_insert("location", frame=f)
                tgt.keyframe_insert("location", frame=f)
                cd.keyframe_insert("lens", frame=f)
        m = sc.timeline_markers.new(f"S{n}_{s['name']}", frame=s["start"])
        m.camera = cam
    # handheld noise on the shot-2 MCU (before the whip)
    s2 = shot(2)
    cam2, tgt2 = cams[2]
    add_noise(cam2, "location", 0.012, 8.0, 3.1, fstart=s2["start"], fend=WHIP0 - 1)
    add_noise(tgt2, "location", 0.010, 10.0, 8.7, fstart=s2["start"], fend=WHIP0 - 1)
    # rig vibration on the tracking car (shot 3) and a whisper of engine shake in the cockpit
    s3 = shot(3)
    add_noise(cams[3][0], "location", 0.012, 3.0, 5.5, fstart=s3["start"], fend=s3["end"])
    return cams

# ---- bake everything -----------------------------------------------------------------
bake_cars()
bake_drivers()
bake_nova()
bake_crowd()
# smooth the cam-5 pan target (+-2 frames: tight) and its zoom (+-5 frames)
_s5 = shot(5)
_raw = {f: cam_state(5, min(max(f, _s5["start"]), _s5["end"]))
        for f in range(_s5["start"] - 6, _s5["end"] + 7)}
for f in range(_s5["start"], _s5["end"] + 1):
    _tg = sum((_raw[g][1] for g in range(f - 2, f + 3)), Vector()) / 5.0
    _ln = sum(_raw[g][2] for g in range(f - 5, f + 6)) / 11.0
    CAM5_SMOOTH[f] = (_tg, _ln)
CAMS_BY_SHOT = build_cameras()
sc.camera = CAMS_BY_SHOT[1][0]

# Sanity checks: cameras never inside a car (except Cam4 by design) / under the road /
# behind a fence; Cam4 clear of REX's head and the cabin pillars.
WARNINGS = []
def car_box(key, t, pad=0.12):
    sp = CAR_SPECS[key]
    yc = car_center(key, t)
    x = LANE_X[key]
    return (x - sp["W"] / 2 - 0.1 - pad, x + sp["W"] / 2 + 0.1 + pad,
            yc - sp["L"] / 2 - pad, yc + sp["L"] / 2 + pad, -1, sp["roof_z"] + 0.35 + pad)

for s in SHOTS:
    n = s["n"]
    if n == 4:
        continue
    cam = CAMS_BY_SHOT[n][0]
    for f in range(s["start"], s["end"] + 1):
        st = cam_state(n, f)
        p = st[0]
        for key in CAR:
            x0, x1, y0, y1, z0, z1 = car_box(key, gt(f))
            if x0 < p.x < x1 and y0 < p.y < y1 and z0 < p.z < z1:
                WARNINGS.append(f"Cam{n} frame {f} inside/near {key} car at {tuple(round(v, 2) for v in p)}")
        if p.z < 0.1 or abs(p.x) > FENCE_X - 0.3:
            WARNINGS.append(f"Cam{n} frame {f} below road / beyond fence: {tuple(p)}")
# Cam4: distances inside the cabin
_rex_head = CAR["black"]["drv"].location + CAR["black"]["piv_off"] + Vector((0, -0.04, 0.69))
_d_head = (CAM4_LOCAL - _rex_head).length
if _d_head < 0.2:
    WARNINGS.append(f"Cam4 too close to REX's head ({_d_head:.2f} m)")
_sp = CAR_SPECS["black"]
if not (CAM4_LOCAL.z < _sp["roof_z"] - 0.05 and abs(CAM4_LOCAL.x) < _sp["cab_w"] / 2 - 0.15
        and _sp["cab_y"][0] + 0.2 < CAM4_LOCAL.y < _sp["cab_y"][1]):
    WARNINGS.append("Cam4 is not clear of the cabin shell")
for w in WARNINGS[:20]:
    print("WARNING:", w)
print(f"[previs] camera sanity warnings: {len(WARNINGS)}; Cam4-REX head distance {_d_head:.2f} m")

# =============================================================================
# 7. RENDER SETTINGS -- Workbench + depth compositor
# =============================================================================
sc.frame_start, sc.frame_end = FRAME_START, FRAME_END
sc.render.fps = FPS
sc.render.resolution_x, sc.render.resolution_y = RES_X, RES_Y
sc.render.resolution_percentage = 100
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.render_aa = os.environ.get("PREVIS_AA", "8")
sh = sc.display.shading
sh.light = "STUDIO"
sh.color_type = "MATERIAL"
sh.background_type = "WORLD"
sh.show_shadows = True
sh.shadow_intensity = 0.45
sh.show_specular_highlight = True
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

comp = bpy.data.node_groups.new("PrevisComp", "CompositorNodeTree")
sc.compositing_node_group = comp
rl = comp.nodes.new("CompositorNodeRLayers")
comp.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
gout = comp.nodes.new("NodeGroupOutput")
comp.links.new(rl.outputs["Image"], gout.inputs[0])
DEPTH_MAP = comp.nodes.new("ShaderNodeMapRange")
DEPTH_MAP.clamp = True
DEPTH_MAP.inputs["To Min"].default_value = 1.0
DEPTH_MAP.inputs["To Max"].default_value = 0.0
comp.links.new(rl.outputs["Depth"], DEPTH_MAP.inputs["Value"])
DEPTH_OUT = comp.nodes.new("CompositorNodeOutputFile")
DEPTH_OUT.file_output_items.new("FLOAT", "depth")
if hasattr(DEPTH_OUT.format, "media_type"):
    DEPTH_OUT.format.media_type = "IMAGE"
DEPTH_OUT.format.file_format = "PNG"
DEPTH_OUT.format.color_mode = "BW"
DEPTH_OUT.format.color_depth = "8"
DEPTH_OUT.save_as_render = False
comp.links.new(DEPTH_MAP.outputs["Result"], DEPTH_OUT.inputs[0])

def depth_range(f):
    """(near, far) metres for frame f. Constant per shot, except shot 5 where the window
    follows the approaching cars (they start ~110 m away) and settles at the shot's
    near/far once they are close, so the cars keep contrast against the road."""
    s = shot_of_frame(f)
    if s["n"] != 5:
        return s["near"], s["far"]
    cam = Vector((-9.0, 399.0, 4.0))
    def dist(ff):
        tg = gt(min(ff, int(T_CROSS * FPS)))
        mid = Vector((0.0, (car_center("black", tg) + car_center("green", tg)) / 2, 0.7))
        return (mid - cam).length
    d = sum(dist(g) for g in range(f - 4, f + 5)) / 9.0
    return max(s["near"], d - 30.0), max(s["far"], d + 35.0)

def set_depth_range(s):
    pass    # depth window is keyframed per frame on the Map Range node (see below)

for _f in range(FRAME_START, FRAME_END + 1):
    _n, _fa = depth_range(_f)
    DEPTH_MAP.inputs["From Min"].default_value = _n
    DEPTH_MAP.inputs["From Max"].default_value = _fa
    DEPTH_MAP.inputs["From Min"].keyframe_insert("default_value", frame=_f)
    DEPTH_MAP.inputs["From Max"].keyframe_insert("default_value", frame=_f)

os.makedirs(OUT, exist_ok=True)
sc.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
T_BUILD = time.time() - T0
print(f"[previs] scene built + saved in {T_BUILD:.1f}s -> {BLEND_PATH}")

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
    p = os.path.join(d, "d_depth.png")
    if os.path.exists(p):
        os.replace(p, os.path.join(d, f"d_depth{frame:04d}.png"))

def whip_blur(fdir):
    """Fake motion blur on the whip frames: average each frame with its neighbours."""
    import numpy as np
    frames = list(range(WHIP0, WHIP1 + 1))
    src = {}
    for f in range(WHIP0 - 1, WHIP1 + 2):
        p = os.path.join(fdir, f"f_{f:04d}.png")
        im = bpy.data.images.load(p)
        a = np.empty(len(im.pixels), dtype=np.float32)
        im.pixels.foreach_get(a)
        src[f] = a
        bpy.data.images.remove(im)
    for f in frames:
        w = [1, 2, 1] if f in (WHIP0, WHIP1) else [1, 1, 1, 1, 1]
        rng = range(f - len(w) // 2, f + len(w) // 2 + 1)
        acc = sum(src[min(max(g, WHIP0 - 1), WHIP1 + 1)] * wi for g, wi in zip(rng, w)) / sum(w)
        p = os.path.join(fdir, f"f_{f:04d}.png")
        im = bpy.data.images.load(p)
        im.pixels.foreach_set(acc)
        im.filepath_raw = p
        im.file_format = "PNG"
        im.save()
        bpy.data.images.remove(im)

def pick16(start, end):
    """81 frames evenly picked out of the shot's 120 (for 16 fps)."""
    N = end - start + 1
    return [start + int(round(i * (N - 1) / (N16 - 1))) for i in range(N16)]

RENDER_TIMES = {}
for s in SHOTS:
    n = s["n"]
    sdir = os.path.join(OUT, f"shot{n}")
    fdir = os.path.join(WORK, f"shot{n}", "beauty")
    ddir = os.path.join(WORK, f"shot{n}", "depth")
    for d in (sdir, fdir, ddir):
        shutil.rmtree(d, ignore_errors=True) if d != sdir else None
        os.makedirs(d, exist_ok=True)
    set_depth_range(s)
    DEPTH_OUT.directory = ddir + os.sep
    DEPTH_OUT.file_name = "d_"
    mid = (s["start"] + s["end"]) // 2
    t_start = time.time()
    if MODE == "stills":
        for f in (s["start"], mid, s["end"]):
            sc.frame_set(f)
            sc.render.filepath = os.path.join(fdir, f"f_{f:04d}.png")
            bpy.ops.render.render(write_still=True)
            grab_single_depth(ddir, f)
    else:
        sc.frame_start, sc.frame_end = s["start"], s["end"]
        sc.render.filepath = os.path.join(fdir, "f_")
        bpy.ops.render.render(animation=True)
        if n == 2:
            whip_blur(fdir)
    RENDER_TIMES[n] = round(time.time() - t_start, 1)
    for which, fr in (("first", s["start"]), ("mid", mid), ("last", s["end"])):
        shutil.copy(os.path.join(fdir, f"f_{fr:04d}.png"), os.path.join(sdir, f"{which}.png"))
    dfirst = find_depth_file(ddir, s["start"])
    if dfirst:
        shutil.copy(dfirst, os.path.join(sdir, "depth_first.png"))
    if MODE != "stills":
        for p in glob.glob(os.path.join(ddir, "*.png")):
            fr = int(os.path.basename(p)[-8:-4])
            os.replace(p, os.path.join(ddir, f"z_{fr:04d}.png"))
        enc = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18"]
        common = ["-framerate", str(FPS), "-start_number", str(s["start"])]
        ffmpeg(*common, "-i", os.path.join(fdir, "f_%04d.png"), *enc, "-r", str(FPS),
               os.path.join(sdir, "clip.mp4"))
        ffmpeg(*common, "-i", os.path.join(ddir, "z_%04d.png"), *enc, "-r", str(FPS),
               os.path.join(sdir, "depth.mp4"))
        # 16 fps / 81-frame versions: symlink the evenly picked frames into a clean sequence
        for src_dir, pre, out_name in ((fdir, "f_", "clip16.mp4"), (ddir, "z_", "depth16.mp4")):
            sel = os.path.join(src_dir, "sel16")
            shutil.rmtree(sel, ignore_errors=True)
            os.makedirs(sel)
            for i, fr in enumerate(pick16(s["start"], s["end"])):
                os.symlink(os.path.join(src_dir, f"{pre}{fr:04d}.png"), os.path.join(sel, f"s_{i:03d}.png"))
            ffmpeg("-framerate", "16", "-start_number", "0", "-i", os.path.join(sel, "s_%03d.png"),
                   *enc, "-r", "16", os.path.join(sdir, out_name))
    print(f"[previs] shot {n} rendered in {RENDER_TIMES[n]}s")

sc.frame_start, sc.frame_end = FRAME_START, FRAME_END

if MODE != "stills":
    lst = os.path.join(WORK, "concat.txt")
    with open(lst, "w") as fh:
        for s in SHOTS:
            fh.write(f"file '{os.path.join(OUT, 'shot%d' % s['n'], 'clip.mp4')}'\n")
    ffmpeg("-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", os.path.join(OUT, "final_cut.mp4"))

# =============================================================================
# 8. REPORTS
# =============================================================================
BEATS = {
    1: ["wide low shot from in front of the start line, camera 2.5 m up, the two cars rolling up the road side by side toward the start box, crowds on both shoulders",
        "the camera cranes down slowly as the black car (left) and the green car (right) creep into the start box",
        "both cars stop at the chalk line, engines idling; the crowd closes in behind them",
        "NOVA walks out from the left crowd across the front of the cars, camera still craning down",
        "the camera arrives at 0.4 m, NOVA reaching the centre line between the two hoods"],
    2: ["handheld medium close-up on NOVA between the two hoods, flag held low",
        "she raises the red flag high above her head",
        "she holds the flag up and glances left at the black car",
        "she glances right at the green car, then throws the flag down at 3.5 s: the camera whips round",
        "low angle 4 m behind the rear bumpers as both cars launch away with wheelspin, rear ends squatting, the camera holding as they pull away"],
    3: ["low tracking shot at 30 cm off the road at the left road edge, racing just ahead of the green car's nose and looking back: the green car across the road, the black car half a car behind in the near lane",
        "the camera races along with the cars, the crowd streaking past",
        "the green car stretches its lead, lamps and fence flashing by",
        "the black car's rear tyres bite; it holds the green car's pace",
        "the black car begins to reel the green car in"],
    4: ["inside the black car over REX's right shoulder; through the windshield the green car ahead to the right",
        "REX shifts up; the road lamps strobe past",
        "the green car's tail lights drift right as the black car closes",
        "REX shifts up again",
        "the green car reaches the right edge of the windshield, nearly level"],
    5: ["high side angle at the finish line, 4 m up, long lens up the road on the two cars racing nose to nose toward us",
        "tight on the approaching pair, the lens easing wider as they close in",
        "the camera zooms out to 24 mm and pans hard with the cars as they arrive at the chalk line",
        "the black car crosses the finish line a hood ahead of the green car; the camera keeps panning with them",
        "the camera settles on the finish crowd throwing their arms up, the two cars braking down the road beyond"],
}
log = dict(film="QUARTER MILE", fps=FPS, resolution=[RES_X, RES_Y],
           units="metres, Z up; road runs along +Y; start line y=0, finish line y=400",
           race=dict(launch_frame=F_DROP, launch_t_s=T_LAUNCH, black_cross_t_s=T_CROSS,
                     black_top_speed_ms=round(V_TOP, 2), accel_time_constant_s=K_ACC),
           shots=[], cars_per_second=[])
for s in SHOTS:
    n = s["n"]
    cam, tgt = CAMS_BY_SHOT[n]
    samples = []
    for sec in range(6):
        f = min(s["start"] + sec * FPS, s["end"])
        sc.frame_set(f)
        samples.append(dict(
            t=sec, frame=f, global_t=round(gt(f), 3),
            camera=[round(v, 3) for v in cam.matrix_world.translation],
            target=[round(v, 3) for v in tgt.matrix_world.translation],
            lens_mm=round(cam.data.lens, 1),
            description=BEATS[n][min(sec, 4)] if sec < 5 else BEATS[n][4] + " (end of shot)"))
    log["shots"].append(dict(shot=n, name=s["name"], camera_object=cam.name,
                             frame_range=[s["start"], s["end"]],
                             global_time_s=[round(gt(s["start"]), 3), round(gt(s["end"] + 1), 3)],
                             bible_camera=s["bible_camera"], depth_range_m=[s["near"], s["far"]],
                             depth_range_per_second=[[round(v, 1) for v in depth_range(min(s["start"] + k * FPS, s["end"]))]
                                                     for k in range(6)],
                             per_second=samples))
for sec in range(26):
    t = float(sec) if sec < 25 else gt(FRAME_END)
    row = dict(t=round(t, 3), frame=int(round(t * FPS)) + 1)
    for key in CAR:
        row[key] = dict(nose_y=round(car_nose(key, t), 2), speed_ms=round(car_speed(key, t), 2),
                        speed_kmh=round(car_speed(key, t) * 3.6, 1))
    row["green_lead_m"] = round(car_nose("green", t) - car_nose("black", t), 2)
    log["cars_per_second"].append(row)
log["shot_boundaries"] = []
for s in SHOTS:
    for edge, f in (("start", s["start"]), ("end", s["end"])):
        t = gt(f)
        log["shot_boundaries"].append(dict(shot=s["n"], edge=edge, frame=f, t=round(t, 3),
            black=dict(nose_y=round(car_nose("black", t), 2), speed_ms=round(car_speed("black", t), 2)),
            green=dict(nose_y=round(car_nose("green", t), 2), speed_ms=round(car_speed("green", t), 2))))
# exact crossing times
def cross_time(key):
    t = T_LAUNCH
    while car_nose(key, t) < FINISH_Y:
        t += 1 / 480
    return round(t, 3)
log["finish_crossing"] = {k: dict(t_s=cross_time(k), frame=int(cross_time(k) * FPS) + 1,
                                  speed_ms=round(car_speed(k, cross_time(k)), 2)) for k in CAR}
log["camera_warnings"] = WARNINGS
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
    forward: the world axis treated as "ahead" for every subject (both previs builds
    run their action along +Y, so one shared axis is enough -- see module docstring)."""
    right = Vector((forward.y, -forward.x, 0.0))   # subject's right-hand side (GREEN's lane, here)
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
    dict(name="BLACK CAR", ob=bpy.data.objects["black_Body"]),
    dict(name="GREEN CAR", ob=bpy.data.objects["green_Body"]),
    dict(name="REX", ob=bpy.data.objects["black_Torso"]),
    dict(name="KAI", ob=bpy.data.objects["green_Torso"]),
    dict(name="NOVA", ob=bpy.data.objects["Nova_TorsoMesh"]),
    dict(name="FLAG", ob=FLAG),
]
write_continuity(SHOTS, CONTINUITY_SUBJECTS, lambda n: CAMS_BY_SHOT[n][0],
                  os.path.join(OUT, "continuity.json"), fps=FPS, ground_z=lambda x, y: 0.0,
                  forward=Vector((0.0, 1.0, 0.0)))

def make_contact_sheet():
    GAP, LAB, TOP = 10, 30, 52
    TW = (RES_X - 4 * GAP) // 3             # 413
    TH = int(TW * 9 / 16)
    W = 3 * TW + 4 * GAP
    W += W % 2
    H = TOP + len(SHOTS) * (LAB + TH + GAP) + GAP
    H += H % 2
    cs = sc
    cs.render.use_compositing = False
    cs.render.resolution_x, cs.render.resolution_y = W, H
    cs.render.resolution_percentage = 100
    cs.render.image_settings.file_format = "JPEG"
    cs.render.image_settings.quality = 92
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

    text("QUARTER MILE - greybox previs - first / mid / last frame of each shot", GAP, 12, 28, True)
    for r, s in enumerate(SHOTS):
        y_row = TOP + r * (LAB + TH + GAP)
        mid = (s["start"] + s["end"]) // 2
        for c, (which, fr) in enumerate((("first", s["start"]), ("mid", mid), ("last", s["end"]))):
            x = GAP + c * (TW + GAP)
            path = os.path.join(OUT, f"shot{s['n']}", f"{which}.png")
            im = sed.strips.new_image(name=f"s{s['n']}{which}", filepath=path, channel=ch, frame_start=1,
                                      fit_method="ORIGINAL")
            ch += 1
            im.transform.scale_x = im.transform.scale_y = TW / RES_X
            cx, cy = x + TW / 2, y_row + LAB + TH / 2
            im.transform.offset_x = cx - W / 2
            im.transform.offset_y = H / 2 - cy
            text(f"S{s['n']} {s['name'].upper()} - {which} - f{fr} ({gt(fr):.2f}s)", x, y_row + 5, 19)
    cs.render.filepath = os.path.join(OUT, "contact.jpg")
    bpy.ops.render.render(write_still=True)

make_contact_sheet()

if not KEEP_FRAMES and MODE != "stills":
    shutil.rmtree(WORK, ignore_errors=True)

print("[previs] render times per shot (s):", RENDER_TIMES)
print("[previs] finish crossing:", log["finish_crossing"])
print(f"[previs] done in {time.time() - T0:.1f}s")

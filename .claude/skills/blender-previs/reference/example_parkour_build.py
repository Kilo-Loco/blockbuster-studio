"""
FIRST STEP -- 20 s shoe ad (parkour) -- greybox previs, built entirely from code. The reference-to-video example:
close-up cameras with handheld noise, a simple-capsule proxy mode (PREVIS_PROXY=simple), framing checks per shot.
(Derived from the PAPER BOAT reference build: same CONFIG / HELPERS / ... / REPORTS layout.)

Run (from anywhere):
    /Applications/Blender.app/Contents/MacOS/Blender -b --python build.py

Environment switches (optional):
    PREVIS_MODE=stills   only render each shot's first/mid/last frame (+ depth) and the
                         contact sheet -- fast loop for checking framing
    PREVIS_MODE=full     (default) everything: stills, per-shot clips, depth clips,
                         playblast, contact sheet, camera log, continuity, .blend
    PREVIS_KEEP_FRAMES=1 keep the intermediate PNG sequences in out/_frames

Outputs (next to this script, in out/):
    playblast.mp4, contact.jpg, camera_log.json, continuity.json, parkour.blend,
    shotN/{first,mid,last,depth_first}.png, shotN/{clip,depth}.mp4

How this file is organised:
    1. CONFIG      -- timeline (8 shots, 480 frames @ 24 fps), colours, rooftop layout
    2. HELPERS     -- maths, materials, box/primitive builders, keyframing, FK/IK
    3. SET         -- three brownstone rooftops, gap, vault rail, wall, ledge, props, city
    4. CHARACTER   -- MAYA mannequin (empties + primitives), two orange SHOE objects
    5. ANIMATION   -- per-shot pose functions of time, baked one key per frame
    6. CAMERAS     -- Cam1..Cam8, rotation baked from a target + handheld noise, markers
    7. RENDER      -- Workbench + compositor depth pass, per shot, then ffmpeg
    8. REPORTS     -- camera_log.json, continuity.json, contact sheet (VSE), playblast

Units: metres, Z up. MAYA runs along +Y down the middle of the rooftop row (x = 0).
Sun from the WEST = -X. Side cameras all sit on the +X side of her line (screen L->R).
Roofs: roof 1 y -40..0 (z 12.0) | roof 2 y 0..34 (2a z 12.0 to the wall at y 22, 2b z 13.6)
       | 3 m gap y 34..37 | roof 3 y 37..100 (z 12.4, landing ledge y 37..38.2 top 13.0).
NOTE: the bible's World section puts the wall-run wall on roof 3, but its shot order has the
wall-run (shot 4) BEFORE the gap jump (shot 5); the wall therefore sits on roof 2 (the step up
from 2a to 2b) so the action runs in order along +Y.
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
from mathutils import Vector, Matrix, Euler
from bpy_extras.object_utils import world_to_camera_view

T0 = time.time()

# =============================================================================
# 1. CONFIG
# =============================================================================
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()
OUT = os.path.join(HERE, os.environ.get("PREVIS_OUT", "out"))   # PREVIS_OUT: output folder (default out/)
PROXY = os.environ.get("PREVIS_PROXY", "articulated")            # "articulated" mannequin | "simple" capsules
WORK = os.path.join(OUT, "_frames")
BLEND_PATH = os.path.join(OUT, "parkour.blend")
MODE = os.environ.get("PREVIS_MODE", "full")
KEEP_FRAMES = os.environ.get("PREVIS_KEEP_FRAMES") == "1"

FPS = 24
RES_X, RES_Y = 1280, 720

# Shot table (bible): start/end are inclusive timeline frames; no handles -> hard cuts.
SHOTS = [
    dict(n=1, start=1,   end=48,  t=0.0,  cut=2.0, near=0.08, far=1.6,  name="Shoe",
         beat="set: the shoe", subject="SHOE", hand=(0.0035, 0.0012, 14.0),
         bible_camera="ECU shoe on the ledge, toe flexes, heel lifts; handheld"),
    dict(n=2, start=49,  end=108, t=2.0,  cut=2.5, near=0.5,  far=16.0, name="RunBy",
         beat="launch", subject="MAYA", hand=(0.020, 0.012, 5.0),
         bible_camera="run-by, low side angle: Maya sprints past L->R, camera whips to follow her back"),
    dict(n=3, start=109, end=156, t=4.5,  cut=2.0, near=1.0,  far=18.0, name="Vault",
         beat="obstacle 1", subject="MAYA", hand=(0.010, 0.006, 7.0),
         bible_camera="vault: front 3/4, hand on the railing, legs swing through toward camera"),
    dict(n=4, start=157, end=204, t=6.5,  cut=2.0, near=0.3,  far=9.0,  name="WallRun",
         beat="grip", subject="SHOE", hand=(0.004, 0.002, 12.0),
         bible_camera="ECU sole hits a wall, wall-run two steps up, handheld tilt up"),
    dict(n=5, start=205, end=264, t=8.5,  cut=2.5, near=15.0, far=40.0, name="Gap",
         beat="the jump", subject="MAYA", hand=(0.0025, 0.010, 10.0),
         bible_camera="the gap: wide side-on, leap roof 2 -> roof 3, sky behind; camera pans with her"),
    dict(n=6, start=265, end=312, t=11.0, cut=2.0, near=0.8,  far=10.0, name="Landing",
         beat="the landing", subject="MAYA", hand=(0.018, 0.006, 5.0),
         bible_camera="landing: low front, shoes hit the ledge, knees absorb; camera drops with her"),
    dict(n=7, start=313, end=384, t=13.0, cut=3.0, near=0.3,  far=25.0, name="Sprint",
         beat="run-by 2", subject="MAYA", hand=(0.022, 0.005, 4.5),
         bible_camera="sprint at camera: runs straight at the lens and past it; heavy shake"),
    dict(n=8, start=385, end=480, t=16.0, cut=4.0, near=0.2,  far=9.0,  name="Stop",
         beat="payoff", subject="MAYA", hand=(0.004, 0.0015, 14.0),
         bible_camera="stop: skid to a halt on the roof edge, looks down at the shoes; push in to ECU of the shoe"),
]
FRAME_START, FRAME_END = SHOTS[0]["start"], SHOTS[-1]["end"]
assert FRAME_END == 480 and all(s["end"] - s["start"] + 1 == round(s["cut"] * FPS) for s in SHOTS)

# Rooftop layout (see module docstring)
ROW_X = 5.0                  # the brownstone row spans x -5..+5
Z_R1 = 12.0                  # roof 1 and roof 2a
Z_R2B = 13.6                 # roof 2b (above the wall-run wall)
Z_R3 = 12.4                  # roof 3
Z_LEDGE = 13.0               # landing ledge on roof 3 (0.6 m high)
Y_R1 = (-40.0, 0.0)
Y_R2A = (0.0, 22.0)
Y_WALL = 22.0                # wall face (faces -Y), 1.6 m high
Y_R2B = (22.0, 34.0)
Y_GAP = (34.0, 37.0)         # the 3 m gap
Y_LEDGE = (37.0, 38.2)
Y_R3 = (37.0, 100.0)         # roof 3 ends at the roof edge y = 100 (shot 8)
RAIL_Y, RAIL_TOP = 4.0, Z_R1 + 1.0   # vault rail across the run on roof 2a
START_LEDGE = (-31.0, -30.0, Z_R1 + 0.5)   # shot 1: y0, y1, top z (roof 1)

# Colours (linear RGBA). Set = grays; MAYA = magenta; shoes = bright orange.
C = dict(
    street=(0.10, 0.10, 0.11, 1), roof1=(0.42, 0.42, 0.42, 1), roof2=(0.38, 0.38, 0.39, 1),
    roof3=(0.45, 0.45, 0.44, 1), facade=(0.30, 0.29, 0.29, 1), facade2=(0.26, 0.26, 0.27, 1),
    parapet=(0.52, 0.52, 0.52, 1), ledge=(0.60, 0.60, 0.60, 1), rail=(0.16, 0.16, 0.17, 1),
    chimney=(0.34, 0.33, 0.33, 1), tank=(0.33, 0.32, 0.31, 1), ac=(0.62, 0.62, 0.63, 1),
    city_a=(0.40, 0.41, 0.44, 1), city_b=(0.47, 0.48, 0.51, 1), city_c=(0.34, 0.35, 0.38, 1),
    maya=(0.85, 0.02, 0.55, 1), hair=(0.03, 0.03, 0.03, 1),
    shoe=(1.0, 0.33, 0.0, 1), sole=(0.92, 0.92, 0.92, 1), lace=(0.02, 0.02, 0.02, 1),
    sky=(0.62, 0.64, 0.69),
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

def catmull(keys, t):
    """keys: [(t, value-or-tuple)], Catmull-Rom through the keys, clamped at the ends."""
    if t <= keys[0][0]:
        return Vector(keys[0][1])
    if t >= keys[-1][0]:
        return Vector(keys[-1][1])
    for i in range(len(keys) - 1):
        if keys[i][0] <= t <= keys[i + 1][0]:
            break
    t0, t1 = keys[i][0], keys[i + 1][0]
    p0 = Vector(keys[max(i - 1, 0)][1]); p1 = Vector(keys[i][1])
    p2 = Vector(keys[i + 1][1]); p3 = Vector(keys[min(i + 2, len(keys) - 1)][1])
    tm0 = keys[max(i - 1, 0)][0]; tm3 = keys[min(i + 2, len(keys) - 1)][0]
    m1 = (p2 - p0) / max(t1 - tm0, 1e-6) * (t1 - t0)
    m2 = (p3 - p1) / max(tm3 - t0, 1e-6) * (t1 - t0)
    u = (t - t0) / (t1 - t0)
    h00, h10, h01, h11 = 2*u**3 - 3*u**2 + 1, u**3 - 2*u**2 + u, -2*u**3 + 3*u**2, u**3 - u**2
    return p1 * h00 + m1 * h10 + p2 * h01 + m2 * h11

def shot(n):
    return SHOTS[n - 1]

def shot_of_frame(f):
    for s in SHOTS:
        if s["start"] <= f <= s["end"]:
            return s
    return None

def t_in(f, n):
    return (f - shot(n)["start"]) / FPS

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.name = "FirstStep"
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
    MATS[name] = m
    return m

def link(ob, coll):
    coll.objects.link(ob)
    return ob

def new_collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c

SOLIDS = []   # axis-aligned boxes (x0,x1,y0,y1,z0,z1,name) for the camera sanity check

def box(name, coll, x0, x1, y0, y1, z0, z1, material, solid=True):
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(v, [], f)
    me.update()
    ob = bpy.data.objects.new(name, me)
    me.materials.append(material)
    if solid:
        SOLIDS.append((x0, x1, y0, y1, z0, z1, name))
    return link(ob, coll)

def box_c(name, coll, cx, cy, z0, sx, sy, sz, material, solid=True):
    return box(name, coll, cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, z0, z0 + sz, material, solid)

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

def cylinder(name, coll, r, depth, loc, material, parent=None, verts=16, rot=None):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts)
    ob = bpy.context.active_object
    ob.name = name
    if rot is not None:
        ob.rotation_euler = rot
    return _adopt(ob, coll, material, parent, loc)

def cone(name, coll, r1, r2, depth, loc, material, parent=None, verts=20):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth, vertices=verts)
    ob = bpy.context.active_object
    ob.name = name
    return _adopt(ob, coll, material, parent, loc)

def sphere(name, coll, r, loc, material, parent=None, scale=None):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=20, ring_count=10)
    ob = bpy.context.active_object
    ob.name = name
    if scale is not None:
        ob.scale = scale
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

def add_noise(ob, path, strength, scale, phase, fstart=None, fend=None):
    for fc in fcurves_of(ob):
        if fc.data_path != path:
            continue
        mod = fc.modifiers.new("NOISE")
        mod.scale = scale
        mod.strength = strength
        mod.phase = phase + 7.3 * fc.array_index
        if fstart is not None:
            mod.use_restricted_range = True
            mod.frame_start, mod.frame_end = fstart, fend
            mod.blend_in = mod.blend_out = 1

def ground_z(x, y):
    """Walkable surface height under (x, y) along the rooftop row."""
    if abs(x) > ROW_X:
        return 0.0
    if START_LEDGE[0] <= y <= START_LEDGE[1] and abs(x) < 1.5:
        return START_LEDGE[2]
    if Y_R1[0] <= y < Y_R2A[1]:
        return Z_R1
    if Y_R2B[0] <= y < Y_R2B[1]:
        return Z_R2B
    if Y_LEDGE[0] <= y < Y_LEDGE[1]:
        return Z_LEDGE
    if Y_R3[0] <= y <= Y_R3[1]:
        return Z_R3
    return 0.0

# =============================================================================
# 3. SET -- three brownstone rooftops in a row along +Y, city beyond
# =============================================================================
sc = reset_scene()
bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
bpy.context.preferences.filepaths.save_version = 0
SET = new_collection("SET")
rnd = random.Random(21)
M = {k: mat(k) for k in ("street", "roof1", "roof2", "roof3", "facade", "facade2", "parapet", "ledge",
                         "rail", "chimney", "tank", "ac", "city_a", "city_b", "city_c")}

# street / ground
box("Street", SET, -400, 400, -300, 450, -0.5, 0.0, M["street"], solid=False)

# the row: building masses (roof surface = top)
box("Bldg1", SET, -ROW_X, ROW_X, Y_R1[0], Y_R1[1], 0, Z_R1, M["roof1"])
box("Bldg2a", SET, -ROW_X, ROW_X, Y_R2A[0], Y_R2A[1], 0, Z_R1, M["roof2"])
box("Bldg2b", SET, -ROW_X, ROW_X, Y_R2B[0], Y_R2B[1], 0, Z_R2B, M["roof2"])   # its -Y face = the wall
box("Bldg3", SET, -ROW_X, ROW_X, Y_R3[0], Y_R3[1], 0, Z_R3, M["roof3"])
box("Bldg0", SET, -ROW_X, ROW_X, -80, Y_R1[0], 0, 10.8, M["facade2"])          # lower one behind roof 1
box("BldgEnd", SET, -ROW_X, ROW_X, 112, 140, 0, 9.0, M["facade2"])             # beyond the roof edge (lower)

# facade bands / cornices on the long sides and at the gap (brownstone read)
for nm, y0, y1, zt in (("1", Y_R1[0], Y_R1[1], Z_R1), ("2a", Y_R2A[0], Y_R2A[1], Z_R1),
                       ("2b", Y_R2B[0], Y_R2B[1], Z_R2B), ("3", Y_R3[0], Y_R3[1], Z_R3)):
    for sgn in (-1, 1):
        x_in, x_out = sgn * ROW_X, sgn * (ROW_X + 0.25)
        box(f"Cornice{nm}_{'L' if sgn < 0 else 'R'}", SET, min(x_in, x_out), max(x_in, x_out), y0, y1,
            zt - 0.45, zt - 0.1, M["parapet"], solid=False)
        # low parapet along the long edges
        x_a, x_b = sgn * (ROW_X - 0.25), sgn * ROW_X
        if nm == "2b" and sgn > 0:
            continue
        box(f"Parapet{nm}_{'L' if sgn < 0 else 'R'}", SET, min(x_a, x_b), max(x_a, x_b), y0, y1,
            zt, zt + 0.35, M["parapet"])
    for k in range(int((y1 - y0) // 6)):          # vertical window piers on the facades (shading rhythm)
        yy = y0 + 3 + 6 * k
        for sgn in (-1, 1):
            box(f"Pier{nm}_{k}_{sgn}", SET, sgn * ROW_X - 0.08 if sgn > 0 else -ROW_X - 0.08,
                sgn * ROW_X + 0.08 if sgn > 0 else -ROW_X + 0.08, yy - 0.4, yy + 0.4, 1.0, zt - 0.5,
                M["facade"], solid=False)
# gap facades get cornices too
box("GapCornice2", SET, -ROW_X, ROW_X, Y_GAP[0], Y_GAP[0] + 0.25, Z_R2B - 0.45, Z_R2B - 0.1, M["parapet"], False)
box("GapCornice3", SET, -ROW_X, ROW_X, Y_GAP[1] - 0.25, Y_GAP[1], Z_R3 - 0.45, Z_R3 - 0.1, M["parapet"], False)
# roof-edge curb at the end of roof 3 (shot 8)
box("EdgeCurb", SET, -ROW_X, ROW_X, Y_R3[1] - 0.15, Y_R3[1], Z_R3, Z_R3 + 0.12, M["parapet"])

# shot 1 start ledge on roof 1 (0.5 m block she stands on)
box("StartLedge", SET, -1.5, 1.5, START_LEDGE[0], START_LEDGE[1], Z_R1, START_LEDGE[2], M["ledge"])
# landing ledge at the front of roof 3 (0.6 m)
box("LandingLedge", SET, -ROW_X, ROW_X, Y_LEDGE[0], Y_LEDGE[1], Z_R3, Z_LEDGE, M["ledge"])
# wall-run wall: a slightly proud cap/band on the face of 2b so the wall reads as a wall
box("WallCap", SET, -ROW_X, ROW_X, Y_WALL - 0.12, Y_WALL + 0.1, Z_R2B - 0.08, Z_R2B + 0.12, M["parapet"])

# vault rail across the run on roof 2a (posts + top bar + mid bar)
RAIL = new_collection("RAIL")
for i, px in enumerate((-2.5, -1.5, 1.5, 2.5)):
    cylinder(f"RailPost{i}", SET, 0.035, 1.0, (px, RAIL_Y, Z_R1 + 0.5), M["rail"], verts=8)
cylinder("RailTop", SET, 0.035, 5.1, (0, RAIL_Y, RAIL_TOP), M["rail"], verts=10, rot=(0, math.radians(90), 0))
cylinder("RailMid", SET, 0.02, 5.1, (0, RAIL_Y, Z_R1 + 0.5), M["rail"], verts=8, rot=(0, math.radians(90), 0))

# side pipe railings on roof 2a and roof 3
def side_rail(tag, y0, y1, zt):
    for sgn in (-1, 1):
        x = sgn * (ROW_X - 0.45)
        cylinder(f"SideRail{tag}_{sgn}", SET, 0.03, y1 - y0, (x, (y0 + y1) / 2, zt + 1.0), M["rail"],
                 verts=8, rot=(math.radians(90), 0, 0))
        n = int((y1 - y0) // 2.5) + 1
        for k in range(n):
            yy = y0 + k * (y1 - y0) / (n - 1)
            cylinder(f"SideRailPost{tag}_{sgn}_{k}", SET, 0.025, 1.0, (x, yy, zt + 0.5), M["rail"], verts=6)
side_rail("2a", 8.0, 20.5, Z_R1)
side_rail("3", 41.0, 97.0, Z_R3)

# rooftop props: chimneys, AC units, water tanks, a stair bulkhead, a skylight
def chimney(nm, x, y, zt, h=1.3):
    box_c(nm, SET, x, y, zt, 0.7, 0.9, h, M["chimney"])
    box_c(nm + "_Cap", SET, x, y, zt + h, 0.85, 1.05, 0.12, M["parapet"])

def ac_unit(nm, x, y, zt):
    box_c(nm, SET, x, y, zt, 1.1, 0.8, 0.9, M["ac"])
    box_c(nm + "_Base", SET, x, y, zt, 1.3, 1.0, 0.12, M["chimney"])

def water_tank(nm, x, y, zt):
    for i, (dx, dy) in enumerate(((-0.8, -0.8), (0.8, -0.8), (0.8, 0.8), (-0.8, 0.8))):
        box_c(f"{nm}_Leg{i}", SET, x + dx, y + dy, zt, 0.14, 0.14, 1.6, M["rail"])
    cylinder(nm, SET, 1.25, 2.3, (x, y, zt + 1.6 + 1.15), M["tank"], verts=24)
    cone(nm + "_Roof", SET, 1.35, 0.1, 0.7, (x, y, zt + 1.6 + 2.3 + 0.35), M["chimney"], verts=24)
    SOLIDS.append((x - 1.35, x + 1.35, y - 1.35, y + 1.35, zt, zt + 4.6, nm))

chimney("Chim1a", -4.0, -27.0, Z_R1); chimney("Chim1b", 3.9, -34.0, Z_R1, 1.6)
chimney("Chim1c", -3.9, -4.0, Z_R1, 1.1)
ac_unit("AC1a", -3.4, -19.0, Z_R1); ac_unit("AC1b", 3.5, -7.5, Z_R1)
water_tank("Tank1", -3.1, -11.5, Z_R1)
chimney("Chim2a", -4.0, 7.0, Z_R1); ac_unit("AC2a", -3.3, 12.0, Z_R1); ac_unit("AC2b", 3.6, 17.5, Z_R1)
box_c("Skylight2", SET, -2.2, 16.5, Z_R1, 1.2, 1.6, 0.6, M["parapet"])
chimney("Chim2b", -3.8, 26.0, Z_R2B, 1.5); chimney("Chim2c", -4.0, 31.5, Z_R2B, 1.2)
water_tank("Tank3", -3.0, 49.0, Z_R3)
chimney("Chim3a", 3.8, 52.0, Z_R3, 1.4); ac_unit("AC3a", -3.2, 58.0, Z_R3); ac_unit("AC3b", 3.3, 62.0, Z_R3)
chimney("Chim3b", -3.9, 66.0, Z_R3); ac_unit("AC3c", 3.5, 84.0, Z_R3); chimney("Chim3c", -3.8, 93.0, Z_R3, 1.2)
box_c("Bulkhead3", SET, -3.2, 80.0, Z_R3, 2.2, 3.0, 2.5, M["chimney"])
box_c("Bulkhead3_Roof", SET, -3.2, 80.0, Z_R3 + 2.5, 2.5, 3.3, 0.15, M["parapet"])

# neighbouring lower buildings across the streets + the shot-5 camera rooftop (+X side)
box("CamRoof5", SET, 16.0, 30.0, 20.0, 46.0, 0, 12.1, M["city_c"])
for sgn in (-1, 1):
    y = -80.0
    i = 0
    while y < 140:
        w = rnd.uniform(10, 18)
        if not (sgn > 0 and 18 <= y + w and y <= 48):
            x0 = sgn * 16.0
            x1 = sgn * rnd.uniform(26, 34)
            h = rnd.uniform(7.0, 11.0)
            box(f"Near{'L' if sgn < 0 else 'R'}{i}", SET, min(x0, x1), max(x0, x1), y, y + w - 1.5, 0, h,
                M[("city_a", "city_b", "city_c")[i % 3]])
        y += w
        i += 1

# distant city blocks: gray boxes on a jittered grid (taller downtown toward +Y)
k = 0
for gx in range(-9, 10):
    for gy in range(-6, 14):
        cx = gx * 28 + rnd.uniform(-5, 5)
        cy = gy * 28 + rnd.uniform(-5, 5)
        if abs(cx) < 40 and -95 < cy < 150:
            continue
        d = math.hypot(cx, cy - 30)
        h = rnd.uniform(10, 26) + max(0.0, (cy - 100) * 0.12) + rnd.uniform(0, 1) ** 3 * 35
        if cx < -30 and 0 < cy < 70:
            h = min(h, 12.5)          # keep the sky open behind the gap jump (shot 5 looks -X)
        sx, sy = rnd.uniform(12, 22), rnd.uniform(12, 22)
        box_c(f"City{k}", SET, cx, cy, 0, sx, sy, h, M[("city_a", "city_b", "city_c")[k % 3]], solid=False)
        k += 1

# Sun from the west (-X), low: long shadows toward +X (for EEVEE/Cycles; Workbench uses
# scene.display.light_direction, set to the same direction below).
SUN_DIR = Vector((math.cos(math.radians(22)), 0.12, -math.sin(math.radians(22)))).normalized()
sun_data = bpy.data.lights.new("Sun", "SUN")
sun_data.energy = 4.0
sun_data.color = (1.0, 0.78, 0.55)
sun = bpy.data.objects.new("Sun", sun_data)
sun.rotation_euler = SUN_DIR.to_track_quat("-Z", "Y").to_euler()
sun.location = (-30, 30, 40)
link(sun, SET)

world = bpy.data.worlds.new("Sky")
world.color = C["sky"]
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
if bg:
    bg.inputs["Color"].default_value = (*C["sky"], 1)
    bg.inputs["Strength"].default_value = 1.0
sc.world = world

# =============================================================================
# 4. CHARACTER -- MAYA (mannequin, 1.75 m), magenta body, two orange SHOE objects
# =============================================================================
# Hierarchy (front = local +Y, right = local +X):
#   Maya (root on the ground; location + heading)
#     Maya_Hips (height/offset + pitch/roll)
#       Maya_Torso (lean/roll/twist) -> chest, neck/head, shoulders -> upper arm -> elbow -> forearm
#       Maya_Leg_L/R (hip pivot) -> thigh -> knee -> shin -> ankle -> SHOE (+ sole, laces)
CHAR = new_collection("MAYA")
MM, MHAIR, MSHOE, MSOLE, MLACE = mat("maya"), mat("hair"), mat("shoe"), mat("sole"), mat("lace")
HIPW = 0.10
THIGH, SHIN, ANK = 0.44, 0.42, 0.08       # hip->knee, knee->ankle, ankle->sole  (hip height 0.94)
UPPER, FORE = 0.30, 0.27
HEEL_Y, TOE_Y = -0.085, 0.205             # sole extent along the foot (ankle-local)

J = {}
J["root"] = empty("Maya", CHAR, size=0.3, kind="ARROWS")
J["hips"] = empty("Maya_Hips", CHAR, (0, 0, 0.94), J["root"])
J["torso"] = empty("Maya_Torso", CHAR, (0, 0, 0), J["hips"])
sphere("Maya_Pelvis", CHAR, 0.14, (0, 0, 0.0), MM, J["hips"], scale=(1.0, 0.75, 0.8))
TORSO_MESH = cone("Maya_Torso_Mesh", CHAR, 0.12, 0.17, 0.46, (0, 0, 0.27), MM, J["torso"])
TORSO_MESH.scale = (1.0, 0.7, 1.0)
J["neck"] = empty("Maya_Neck", CHAR, (0, 0, 0.56), J["torso"])
cylinder("Maya_NeckMesh", CHAR, 0.045, 0.10, (0, 0, 0.02), MM, J["neck"], verts=10)
HEAD = sphere("Maya_Head", CHAR, 0.105, (0, 0.0, 0.14), MM, J["neck"], scale=(0.9, 1.0, 1.1))
sphere("Maya_Hair", CHAR, 0.095, (0, -0.045, 0.175), MHAIR, J["neck"])      # dark curls at the back/top
for side, sx in (("L", -1), ("R", 1)):
    sh = empty(f"Maya_Shoulder_{side}", CHAR, (sx * 0.19, 0, 0.50), J["torso"])
    sh.rotation_mode = "XYZ"
    cylinder(f"Maya_UpperArm_{side}", CHAR, 0.04, UPPER, (0, 0, -UPPER / 2), MM, sh, verts=10)
    el = empty(f"Maya_Elbow_{side}", CHAR, (0, 0, -UPPER), sh)
    cylinder(f"Maya_Forearm_{side}", CHAR, 0.034, FORE, (0, 0, -FORE / 2), MM, el, verts=10)
    J[f"hand_{side}"] = sphere(f"Maya_Hand_{side}", CHAR, 0.045, (0, 0, -FORE - 0.03), MM, el)
    J[f"sh_{side}"], J[f"el_{side}"] = sh, el
    lp = empty(f"Maya_Leg_{side}", CHAR, (sx * HIPW, 0, 0), J["hips"])
    cylinder(f"Maya_Thigh_{side}", CHAR, 0.068, THIGH, (0, 0, -THIGH / 2), MM, lp, verts=12)
    kn = empty(f"Maya_Knee_{side}", CHAR, (0, 0, -THIGH), lp)
    cylinder(f"Maya_Shin_{side}", CHAR, 0.052, SHIN, (0, 0, -SHIN / 2), MM, kn, verts=12)
    an = empty(f"Maya_Ankle_{side}", CHAR, (0, 0, -SHIN), kn)
    # SHOE: bright orange upper, white sole, black laces (named object = continuity subject)
    shoe = cube(f"Maya_Shoe_{side}", CHAR, (0, 0.06, -0.035), (0.10, 0.27, 0.075), MSHOE, an)
    cube(f"Maya_Sole_{side}", CHAR, (0, 0.06, -0.066), (0.108, 0.29, 0.028), MSOLE, an)
    cube(f"Maya_Laces_{side}", CHAR, (0, 0.10, 0.004), (0.045, 0.12, 0.012), MLACE, an)
    for o in (lp, kn, an):
        o.rotation_mode = "XYZ"
    J[f"leg_{side}"], J[f"knee_{side}"], J[f"ank_{side}"], J[f"shoe_{side}"] = lp, kn, an, shoe
SHOE_R, SHOE_L = J["shoe_R"], J["shoe_L"]

# ---- PREVIS_PROXY=simple: anchor shapes only (one body capsule, two leg capsules, the shoes) ----
def capsule_mesh(name, r, z0, z1, segs=16, rings=6):
    """Capsule along local Z from z0 (bottom cap centre) to z1 (top cap centre)."""
    verts, faces = [], []
    rows = []
    for k in range(rings + 1):                                  # bottom hemisphere
        a = -math.pi / 2 + (math.pi / 2) * k / rings
        rows.append((r * math.cos(a), z0 + r * math.sin(a)))
    for k in range(rings + 1):                                  # top hemisphere
        a = (math.pi / 2) * k / rings
        rows.append((r * math.cos(a), z1 + r * math.sin(a)))
    for rad, z in rows:
        for i in range(segs):
            th = 2 * math.pi * i / segs
            verts.append((rad * math.cos(th), rad * math.sin(th), z))
    for j in range(len(rows) - 1):
        for i in range(segs):
            a, b = j * segs + i, j * segs + (i + 1) % segs
            faces.append((a, b, b + segs, a + segs))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    for poly in me.polygons:
        poly.use_smooth = True
    return me

LEG_CAPS = {}
if PROXY == "simple":
    keep = {"Maya_Shoe_L", "Maya_Shoe_R", "Maya_Sole_L", "Maya_Sole_R", "Maya_Laces_L", "Maya_Laces_R"}
    for o in [o for o in CHAR.objects if o.type == "MESH" and o.name not in keep]:
        bpy.data.objects.remove(o, do_unlink=True)
    me = capsule_mesh("Maya_BodyCap", 0.16, -0.02, 0.70)       # hips -> top of head (~0.86 above hips)
    me.materials.append(MM)
    TORSO_MESH = link(bpy.data.objects.new("Maya_BodyCap", me), CHAR)
    TORSO_MESH.parent = J["torso"]
    TORSO_MESH.scale = (1.0, 0.8, 1.0)
    HEAD = None
    for side in ("L", "R"):
        me = capsule_mesh(f"Maya_LegCap_{side}", 0.068, -1.0 + 0.068, -0.068)   # unit length hip -> ankle
        me.materials.append(MM)
        LEG_CAPS[side] = link(bpy.data.objects.new(f"Maya_LegCap_{side}", me), CHAR)
        LEG_CAPS[side].rotation_mode = "XYZ"

# =============================================================================
# 5. ANIMATION -- every pose is a pure function of time; baked one key per frame
# =============================================================================
R = math.radians

def base_pose():
    return dict(x=0.0, y=0.0, z=0.0, heading=0.0,
                hipy=0.0, hipz=None, hipfloor=None, bob=0.0, hpitch=0.0, hroll=0.0,
                lean=8.0, troll=0.0, tyaw=0.0, head=0.0, head_yaw=0.0,
                legL=0.0, legR=0.0, kneeL=-4.0, kneeR=-4.0, legYL=4.0, legYR=4.0, legZL=0.0, legZR=0.0,
                footL=0.0, footR=0.0,
                armL=-4.0, armR=-4.0, abdL=6.0, abdR=6.0, elbL=10.0, elbR=10.0,
                ikL=None, ikR=None, iwL=0.0, iwR=0.0)

NUMERIC = [k for k, v in base_pose().items() if isinstance(v, float)] + ["hipz"]

def leg_matrix(p, side, hipz):
    sx = -1 if side == "L" else 1
    legx, knee, foot = p["leg" + side], p["knee" + side], p["foot" + side]
    legy = p["legY" + side] * (1 if side == "L" else -1)
    ank = foot - p["hpitch"] - legx - knee
    Mh = Matrix.Translation((0, p["hipy"], hipz)) @ Euler((R(p["hpitch"]), R(p["hroll"]), 0)).to_matrix().to_4x4()
    Ml = Matrix.Translation((sx * HIPW, 0, 0)) @ Euler((R(legx), R(legy), R(p["legZ" + side]))).to_matrix().to_4x4()
    Mk = Matrix.Translation((0, 0, -THIGH)) @ Matrix.Rotation(R(knee), 4, "X")
    Ma = Matrix.Translation((0, 0, -SHIN)) @ Matrix.Rotation(R(ank), 4, "X")
    return Mh @ Ml @ Mk @ Ma

def foot_points(p, side, hipz):
    Mx = leg_matrix(p, side, hipz)
    return [Mx @ Vector((0, HEEL_Y, -ANK)), Mx @ Vector((0, TOE_Y, -ANK))]

def ik_leg(p, side, tgt, hipz):
    """Sagittal 2-bone IK: ankle target (root-local) -> (thigh swing, knee bend) in degrees."""
    hip = Vector((0, p["hipy"], hipz))
    dy, dz = tgt[1] - hip.y, tgt[2] - hip.z
    d = max(0.2, min(THIGH + SHIN - 1e-4, math.hypot(dy, dz)))
    phi = math.atan2(dy, -dz)
    a = math.acos(max(-1, min(1, (THIGH ** 2 + d ** 2 - SHIN ** 2) / (2 * THIGH * d))))
    b = math.acos(max(-1, min(1, (THIGH ** 2 + SHIN ** 2 - d ** 2) / (2 * THIGH * SHIN))))
    return math.degrees(phi + a), -math.degrees(math.pi - b)

def finalize(p):
    """Resolve auto hip height (lowest FK foot on the ground) and IK legs into plain angles."""
    q = dict(p)
    if q["hipz"] is None:
        sides = [s for s in ("L", "R") if q["iw" + s] < 0.5] or ["L", "R"]
        pts = [pt for s in sides for pt in foot_points(q, s, 0.0)]
        auto = -min(pt.z for pt in pts)
        if q["hipfloor"] is not None:
            auto = max(auto, q["hipfloor"])
        q["hipz"] = auto + q["bob"]
    for s in ("L", "R"):
        w = q["iw" + s]
        if w > 0 and q["ik" + s] is not None:
            lx, kn = ik_leg(q, s, q["ik" + s], q["hipz"])
            q["leg" + s] = lerp(q["leg" + s], lx, w)
            q["knee" + s] = lerp(q["knee" + s], kn, w)
            q["legY" + s] = lerp(q["legY" + s], 3.0, w)
            q["legZ" + s] = lerp(q["legZ" + s], 0.0, w)
        q["ik" + s], q["iw" + s] = None, 0.0
    return q

def blend(a, b, w):
    """Blend two finalized poses."""
    a, b = finalize(a), finalize(b)
    q = dict(a)
    for k in NUMERIC:
        q[k] = lerp(a[k], b[k], w)
    return q

def to_local(p, world):
    """World point -> root-local (heading only)."""
    d = Vector(world) - Vector((p["x"], p["y"], p["z"]))
    return Matrix.Rotation(-R(p["heading"]), 3, "Z") @ d

def ankle_for_toe(toe_local, pitch_deg):
    """Ankle position that keeps the toe tip at toe_local with the foot pitched (toe-down < 0)."""
    a = R(pitch_deg)
    oy, oz = TOE_Y, -ANK
    return Vector((toe_local[0], toe_local[1] - (oy * math.cos(a) - oz * math.sin(a)),
                   toe_local[2] - (oy * math.sin(a) + oz * math.cos(a))))

def run(p, t, freq=1.6, amp=1.0, ph0=0.0, lean=12.0):
    """Sprint cycle (~7 m/s at freq 1.6 Hz / 2.2 m steps). Stance = leg swinging back."""
    ph = 2 * math.pi * freq * t + ph0
    s, c = math.sin(ph), math.cos(ph)
    p.update(legL=42 * amp * s, legR=-42 * amp * s,
             kneeL=-(10 + 105 * amp * max(0.0, c) ** 1.2), kneeR=-(10 + 105 * amp * max(0.0, -c) ** 1.2),
             footL=-25 * max(0.0, c) * amp, footR=-25 * max(0.0, -c) * amp,
             armL=-50 * amp * s, armR=50 * amp * s, elbL=95.0, elbR=95.0, abdL=8.0, abdR=8.0,
             lean=lean, head=4.0, hipfloor=0.86, legYL=3.0, legYR=3.0)
    return p

# ---- shot 1: ECU shoe on the start ledge ------------------------------------
S1_ROOT = Vector((0.0, -30.4, START_LEDGE[2]))

def pose_s1(t):
    p = base_pose()
    h = 38 * seg(t, 0.30, 1.10) + 4 * math.sin(2 * math.pi * 2.2 * t) * seg(t, 0.3, 0.6) * (1 - seg(t, 0.6, 1.0))
    rock = seg(t, 1.20, 1.95)
    p.update(x=S1_ROOT.x, y=S1_ROOT.y, z=S1_ROOT.z, heading=0.0,
             hipz=0.86 - 0.04 * seg(t, 0.2, 1.0) - 0.05 * rock, hipy=0.12 * rock,
             lean=18 + 18 * rock, head=-8 + 16 * rock,
             armL=lerp(12, -35, rock), armR=lerp(-12, 30, rock), elbL=60.0, elbR=60.0,
             footL=0.0, footR=-h,
             ikL=Vector((-HIPW, 0.24, ANK)), iwL=1.0,
             ikR=ankle_for_toe((HIPW, -0.28 + TOE_Y, 0.0), -h), iwR=1.0)
    return finalize(p)

# ---- shot 2: sprint run-by on roof 1 ----------------------------------------
S2_YP, S2_TPASS, V = -15.0, 0.9, 7.0

def s2_y(t):
    return S2_YP + V * (t - S2_TPASS)

def pose_s2(t):
    p = base_pose()
    p.update(x=0.0, y=s2_y(t), z=Z_R1)
    return finalize(run(p, t, ph0=0.4))

# ---- shot 3: speed vault over the rail on roof 2a ---------------------------
S3_TP, S3_TL = 0.74, 1.12            # hand plant / landing
S3_YP, S3_YL = 2.95, 5.25            # hips y at plant / landing

def s3_y(t):
    if t < S3_TP:
        return S3_YP - 6.5 * (S3_TP - t)
    if t < S3_TL:
        u = (t - S3_TP) / (S3_TL - S3_TP)
        return lerp(S3_YP, S3_YL, u)
    return S3_YL + 6.2 * (t - S3_TL)

def pose_s3(t):
    p = base_pose()
    p.update(x=0.0, y=s3_y(t), z=Z_R1)
    base = finalize(run(p, t, freq=1.55, ph0=1.2))
    u = clamp01((t - S3_TP) / (S3_TL - S3_TP))
    sn = math.sin(math.pi * u)
    lift = seg(t, S3_TP - 0.22, S3_TP - 0.02) * (1 - seg(t, S3_TL - 0.12, S3_TL + 0.02))
    v = dict(base)
    v.update(hipz=lerp(1.12, 0.92, u) + 0.34 * math.sin(math.pi * clamp01(u * 0.85 + 0.15)) + 0.15 * seg(t, S3_TP - 0.22, S3_TP) * (1 - u),
             hroll=-30 * sn, lean=10.0, troll=0.0, tyaw=-10 * sn,
             legL=88 * lift, legR=84 * lift, kneeL=-22.0, kneeR=-14.0, legYL=0.0, legYR=0.0,
             legZL=-25 * lift, legZR=-25 * lift, footL=10.0, footR=10.0,
             armL=lerp(50, -20, u), abdL=lerp(10, 25, u), elbL=8.0,
             armR=lerp(40, 75, sn), abdR=10 + 60 * sn, elbR=30.0, head=-5.0, head_yaw=0.0)
    w = seg(t, S3_TP - 0.24, S3_TP - 0.04) * (1 - seg(t, S3_TL - 0.04, S3_TL + 0.12))
    return blend(base, v, w)

# ---- shot 4: wall-run, two steps up the 1.6 m wall onto roof 2b -------------
S4_TC1, S4_TC2, S4_TH, S4_TPK, S4_TTOP = 0.30, 0.55, 0.65, 0.88, 1.06
S4_KEYS = [(S4_TC1 - 0.30, (0.0, 21.30 - 6.5 * 0.30, Z_R1 + 0.92)),
           (S4_TC1, (0.0, 21.30, Z_R1 + 0.95)),
           (S4_TC2, (0.0, 21.55, Z_R1 + 1.30)),
           (S4_TH, (0.0, 21.66, Z_R1 + 1.72)),
           (S4_TPK, (0.0, 22.05, Z_R2B + 0.98)),
           (S4_TTOP, (0.0, 22.60, Z_R2B + 0.92)),
           (S4_TTOP + 0.20, (0.0, 23.70, Z_R2B + 0.90))]
S4_V_OUT = 6.0
WALL_STEP1 = Vector((HIPW, Y_WALL - ANK, Z_R1 + 0.50))    # right sole on the wall (ankle point)
WALL_STEP2 = Vector((-HIPW, Y_WALL - ANK, Z_R1 + 1.10))   # left

def pose_s4(t):
    if t > S4_TTOP + 0.20:                                   # running on across roof 2b
        p = base_pose()
        p.update(x=0.0, y=S4_KEYS[-1][1][1] + S4_V_OUT * (t - S4_TTOP - 0.20), z=Z_R2B)
        return finalize(run(p, t, ph0=0.0))
    hp = catmull(S4_KEYS, max(t, 0.0))
    top = t >= S4_TTOP - 0.04
    q = base_pose()
    q.update(x=0.0, y=hp.y, z=Z_R2B if top else Z_R1)
    q["hipz"] = hp.z - q["z"]
    climb = seg(t, S4_TC1 - 0.08, S4_TC1 + 0.05)
    over = seg(t, S4_TH, S4_TPK)
    land = seg(t, S4_TTOP - 0.10, S4_TTOP + 0.05)
    up2 = seg(t, S4_TC2, S4_TH + 0.1)
    # legs: right plants on the wall at TC1, left at TC2, then both tuck over the top
    q.update(legL=lerp(lerp(55, 95, over), 30, land), kneeL=lerp(lerp(-100, -125, over), -40, land),
             legR=lerp(lerp(-20, 90, up2), -15, land), kneeR=lerp(lerp(-40, -125, up2), -60, land),
             footL=lerp(80, 0, seg(t, S4_TH, S4_TPK)), footR=lerp(80, 0, seg(t, S4_TC2, S4_TH)),
             lean=lerp(lerp(8, 4, climb), 38, over) * (1 - land) + 14 * land,
             head=lerp(15, -10, over),
             armL=lerp(lerp(lerp(-30, 125, seg(t, S4_TC1, S4_TC2)), 20, seg(t, S4_TC2 + 0.02, S4_TH)), -25, over),
             armR=lerp(lerp(lerp(40, 135, seg(t, S4_TC1, S4_TC2)), 20, seg(t, S4_TC2 + 0.02, S4_TH)), -25, over),
             elbL=lerp(40, 10, climb), elbR=lerp(40, 10, climb), abdL=12.0, abdR=12.0)
    q["iwR"] = seg(t, S4_TC1 - 0.18, S4_TC1) * (1 - seg(t, S4_TC2 + 0.02, S4_TC2 + 0.12))
    q["ikR"] = to_local(q, WALL_STEP1)
    q["iwL"] = seg(t, S4_TC2 - 0.08, S4_TC2) * (1 - seg(t, S4_TH + 0.04, S4_TH + 0.14))
    q["ikL"] = to_local(q, WALL_STEP2)
    q = finalize(q)
    if t < S4_TC1:                                           # sprinting in to the wall
        p = base_pose()
        p.update(x=0.0, y=S4_KEYS[1][1][1] - 6.5 * (S4_TC1 - t), z=Z_R1)
        run(p, t, ph0=3 * math.pi / 2 - 0.4 - 2 * math.pi * 1.6 * S4_TC1)
        return blend(finalize(p), q, seg(t, S4_TC1 - 0.12, S4_TC1))
    if t > S4_TTOP:
        p = base_pose()
        p.update(x=0.0, y=hp.y, z=Z_R2B)
        run(p, t, ph0=0.0)
        return blend(q, finalize(p), seg(t, S4_TTOP, S4_TTOP + 0.20))
    return q

# ---- shots 5 + 6: the gap jump (one continuous "jump clock") ----------------
J_TTO, J_T = 1.60, 0.78                       # take-off time (shot-5 clock), time in the air
J_TLD = J_TTO + J_T                           # 2.38: touch-down on the ledge
J_YTO, J_ZTO = 33.35, Z_R2B + 0.95            # hips at take-off
J_YLD, J_ZLD = 37.30, Z_LEDGE + 0.90          # hips at touch-down
J_VY = (J_YLD - J_YTO) / J_T
J_VZ = (J_ZLD - J_ZTO + 0.5 * 9.81 * J_T ** 2) / J_T
LAND_L = Vector((-0.12, 37.50, Z_LEDGE + ANK))
LAND_R = Vector((0.12, 37.56, Z_LEDGE + ANK))
S6_OFFSET = J_TLD - 0.25                      # shot 6 starts 0.25 s before touch-down
J_RUN = J_TLD + 0.95                          # she pushes off the ledge and runs on

def jump_hips(tt):
    """World hip position on the jump clock (ballistic Z while airborne)."""
    if tt < J_TTO:
        return Vector((0.0, J_YTO - V * (J_TTO - tt), None or 0.0))
    if tt < J_TLD:
        tau = tt - J_TTO
        return Vector((0.0, J_YTO + J_VY * tau, J_ZTO + J_VZ * tau - 0.5 * 9.81 * tau * tau))
    tau = tt - J_TLD
    y = J_YLD + 0.22 * (1 - math.exp(-9 * tau))
    z = lerp(J_ZLD, Z_LEDGE + 0.50, 1 - math.exp(-12 * tau)) if tau < 0.45 else \
        lerp(Z_LEDGE + 0.50 + (J_ZLD - Z_LEDGE - 0.50) * math.exp(-12 * 0.45), Z_LEDGE + 0.88, seg(tau, 0.45, 0.95))
    return Vector((0.0, y, z))

def run_off_y(tr):
    """Hips y after she pushes off the ledge: accelerate 8.5 m/s^2 up to 6 m/s."""
    y0 = jump_hips(J_RUN).y
    a, vmax = 8.5, 6.0
    ta = vmax / a
    return y0 + (0.5 * a * tr * tr if tr < ta else 0.5 * a * ta * ta + vmax * (tr - ta))

def pose_jump(tt):
    p = base_pose()
    if tt < J_TTO:                                        # sprint on roof 2b to the edge
        p.update(x=0.0, y=J_YTO - V * (J_TTO - tt), z=Z_R2B)
        run(p, tt, ph0=-2 * math.pi * 1.6 * (J_TTO - 0.06))
        runp = finalize(p)
        if tt < J_TTO - 0.12:
            return runp
    if tt < J_TLD:                                        # airborne: ballistic hips
        tt_ = max(tt, J_TTO)
        hp = jump_hips(tt_)
        a = (tt_ - J_TTO) / J_T
        drive, tuck, ext = seg(a, 0.0, 0.18), seg(a, 0.22, 0.50), seg(a, 0.62, 0.98)
        q = base_pose()
        q.update(x=0.0, y=hp.y, z=Z_R2B, hipz=hp.z - Z_R2B,
                 legL=lerp(lerp(lerp(20, 75, drive), 100, tuck), 38, ext),
                 kneeL=lerp(lerp(lerp(-60, -95, drive), -128, tuck), -30, ext),
                 legR=lerp(lerp(lerp(-30, -20, drive), 100, tuck), 38, ext),
                 kneeR=lerp(lerp(lerp(-20, -45, drive), -128, tuck), -30, ext),
                 footL=lerp(-10, 0, ext), footR=lerp(-20, 0, ext),
                 lean=lerp(lerp(15, 25, tuck), 16, ext), head=lerp(10, -5, ext),
                 armL=lerp(lerp(120, 70, tuck), 55, ext), armR=lerp(lerp(140, 70, tuck), 55, ext),
                 elbL=30.0, elbR=30.0, abdL=lerp(10, 25, ext), abdR=lerp(10, 25, ext))
        q["iwL"] = q["iwR"] = seg(tt, J_TLD - 0.06, J_TLD)
        q["ikL"], q["ikR"] = to_local(q, LAND_L), to_local(q, LAND_R)
        q = finalize(q)
        if tt < J_TTO:
            return blend(runp, q, seg(tt, J_TTO - 0.12, J_TTO))
        return q
    hp = jump_hips(tt)                                    # landed: knees absorb, then rise
    tau = tt - J_TLD
    deep = math.exp(-((tau - 0.30) / 0.22) ** 2)
    q = base_pose()
    q.update(x=0.0, y=hp.y, z=Z_LEDGE, hipz=hp.z - Z_LEDGE,
             lean=16 + 28 * deep * (1 - seg(tau, 0.5, 0.95)), head=lerp(-10, 8, seg(tau, 0.45, 0.95)),
             armL=lerp(55, 20, seg(tau, 0.0, 0.3)) + 20 * deep, armR=lerp(55, 20, seg(tau, 0.0, 0.3)) + 20 * deep,
             elbL=30.0, elbR=30.0, abdL=25.0, abdR=25.0, footL=0.0, footR=0.0,
             ikL=None, ikR=None, iwL=1.0, iwR=1.0)
    q["ikL"], q["ikR"] = to_local(q, LAND_L), to_local(q, LAND_R)
    q = finalize(q)
    if tt < J_RUN - 0.15:
        return q
    # push off the ledge and run toward shot 6's camera, stepping down onto roof 3
    tr = tt - J_RUN
    y = run_off_y(max(tr, 0.0))
    zg = lerp(Z_LEDGE, Z_R3, seg(y, Y_LEDGE[1] - 0.15, Y_LEDGE[1] + 0.55))
    r = base_pose()
    r.update(x=-0.35 * seg(tr, 0.0, 0.8), y=y, z=zg)
    run(r, max(tr, 0.0), freq=1.45, amp=lerp(0.55, 1.0, seg(tr, 0.0, 0.7)), ph0=-1.2, lean=26 - 10 * seg(tr, 0.3, 0.9))
    return blend(q, finalize(r), seg(tt, J_RUN - 0.15, J_RUN + 0.10))

def pose_s5(t):
    return pose_jump(t)

def pose_s6(t):
    return pose_jump(t + S6_OFFSET)

# ---- shot 7: sprint at the camera on roof 3 ---------------------------------
S7_CAM = Vector((0.50, 72.0, Z_R3 + 1.25))
S7_TPASS = 2.50

def s7_y(t):
    return S7_CAM.y - V * (S7_TPASS - t)

def pose_s7(t):
    p = base_pose()
    p.update(x=-HIPW, y=s7_y(t), z=Z_R3)     # right foot line = x 0 = over the worm's-eye lens
    # stride phase set so her right foot is mid-swing over the worm's-eye lens at t = 1.62 s
    return finalize(run(p, t, ph0=7 * math.pi - 2 * math.pi * 1.6 * 1.62))

# ---- shot 8: skid stop at the roof edge, look down at the shoes -------------
S8_TS0, S8_TS1 = 0.45, 1.20
S8_YS0 = 96.45
S8_DEC = V / (S8_TS1 - S8_TS0)
S8_YSTOP = S8_YS0 + V * (S8_TS1 - S8_TS0) - 0.5 * S8_DEC * (S8_TS1 - S8_TS0) ** 2
S8_HEAD = -72.0

def s8_y(t):
    if t < S8_TS0:
        return S8_YS0 - V * (S8_TS0 - t)
    tau = min(t, S8_TS1) - S8_TS0
    return S8_YS0 + V * tau - 0.5 * S8_DEC * tau * tau

def pose_s8(t):
    p = base_pose()
    p.update(x=0.0, y=s8_y(t), z=Z_R3, heading=S8_HEAD * seg(t, 0.35, 0.80))
    runp = finalize(run(p, t, ph0=0.8))
    sk = base_pose()
    sk.update(x=p["x"], y=p["y"], z=p["z"], heading=p["heading"],
              legL=12.0, legYL=30.0, kneeL=-8.0, footL=18.0,
              legR=38.0, legYR=4.0, kneeR=-80.0, footR=0.0,
              lean=-6.0, troll=16.0, head=0.0, head_yaw=38.0,
              armL=25.0, abdL=75.0, armR=30.0, abdR=55.0, elbL=30.0, elbR=30.0)
    skid = finalize(sk)
    settle = seg(t, S8_TS1, S8_TS1 + 0.55)
    look = seg(t, 1.85, 2.45)
    h = 30 * seg(t, 2.75, 3.35) + 5 * math.sin(2 * math.pi * 1.6 * (t - 3.35)) * seg(t, 3.35, 3.6)
    st = base_pose()
    st.update(x=p["x"], y=p["y"], z=p["z"], heading=p["heading"],
              legL=4.0, legYL=9.0, kneeL=-6.0, legR=-3.0, legYR=5.0, kneeR=-6.0,
              lean=lerp(6, 24, look), head=lerp(4, -42, look), head_yaw=lerp(15, 0, settle),
              armL=lerp(0, 8, look), armR=lerp(0, 8, look), abdL=10.0, abdR=10.0, elbL=18.0, elbR=18.0,
              footL=0.0, footR=-h)
    st_f = finalize(dict(st, iwR=1.0, ikR=Vector((0, 0, 0))))   # hip height from the (flat) left foot
    toe = foot_points(finalize(dict(st, footR=0.0)), "R", st_f["hipz"])[1]
    st.update(hipz=st_f["hipz"], ikR=ankle_for_toe((toe.x, toe.y, 0.0), -h), iwR=seg(t, 2.6, 2.75))
    stand = finalize(st)
    if t < S8_TS0 - 0.1:
        return runp
    if t < S8_TS1:
        return blend(runp, skid, seg(t, S8_TS0 - 0.1, S8_TS0 + 0.12))
    return blend(skid, stand, settle)

POSE_FN = {1: pose_s1, 2: pose_s2, 3: pose_s3, 4: pose_s4, 5: pose_s5, 6: pose_s6, 7: pose_s7, 8: pose_s8}

def maya_pose(f):
    s = shot_of_frame(f)["n"]
    return POSE_FN[s](t_in(f, s))

def apply_pose(p, f):
    J["root"].location = (p["x"], p["y"], p["z"])
    J["root"].rotation_euler = (0, 0, R(p["heading"]))
    J["hips"].location = (0, p["hipy"], p["hipz"])
    J["hips"].rotation_euler = (R(p["hpitch"]), R(p["hroll"]), 0)
    J["torso"].rotation_euler = (R(-p["lean"]), R(p["troll"]), R(p["tyaw"]))
    J["neck"].rotation_euler = (R(p["head"]), 0, R(p["head_yaw"]))
    # arm swing is given relative to straight DOWN in the hips frame -> compensate the lean
    J["sh_L"].rotation_euler = (R(p["armL"] + p["lean"]), R(p["abdL"]), 0)
    J["sh_R"].rotation_euler = (R(p["armR"] + p["lean"]), R(-p["abdR"]), 0)
    J["el_L"].rotation_euler = (R(p["elbL"]), 0, 0)
    J["el_R"].rotation_euler = (R(p["elbR"]), 0, 0)
    for s in ("L", "R"):
        legy = p["legY" + s] * (1 if s == "L" else -1)
        J["leg_" + s].rotation_euler = (R(p["leg" + s]), R(legy), R(p["legZ" + s]))
        J["knee_" + s].rotation_euler = (R(p["knee" + s]), 0, 0)
        J["ank_" + s].rotation_euler = (R(p["foot" + s] - p["hpitch"] - p["leg" + s] - p["knee" + s]), 0, 0)
    for key, path in (("root", "location"), ("root", "rotation_euler"), ("hips", "location"),
                      ("hips", "rotation_euler"), ("torso", "rotation_euler"), ("neck", "rotation_euler"),
                      ("sh_L", "rotation_euler"), ("sh_R", "rotation_euler"),
                      ("el_L", "rotation_euler"), ("el_R", "rotation_euler"),
                      ("leg_L", "rotation_euler"), ("leg_R", "rotation_euler"),
                      ("knee_L", "rotation_euler"), ("knee_R", "rotation_euler"),
                      ("ank_L", "rotation_euler"), ("ank_R", "rotation_euler")):
        J[key].keyframe_insert(path, frame=f)

def bbox_center(ob):
    local = sum((Vector(c) for c in ob.bound_box), Vector((0.0, 0.0, 0.0))) / 8
    return ob.matrix_world @ local

POS = {"hips": {}, "shoeR": {}, "shoeL": {}, "head": {}}
def bake_maya():
    for f in range(FRAME_START, FRAME_END + 1):
        apply_pose(maya_pose(f), f)
    for f in range(FRAME_START, FRAME_END + 1):
        sc.frame_set(f)
        POS["hips"][f] = J["hips"].matrix_world.translation.copy()
        POS["shoeR"][f] = bbox_center(SHOE_R)
        POS["shoeL"][f] = bbox_center(SHOE_L)
        POS["head"][f] = J["neck"].matrix_world @ Vector((0, 0, 0.14))   # head centre (same in both proxies)
        for side, cap in LEG_CAPS.items():
            POS.setdefault("hip" + side, {})[f] = J["leg_" + side].matrix_world.translation.copy()
            POS.setdefault("ank" + side, {})[f] = J["ank_" + side].matrix_world.translation.copy()
    # simple proxy: each leg capsule spans hip -> ankle, tilting and shortening with the pose
    for side, cap in LEG_CAPS.items():
        prev = None
        for f in range(FRAME_START, FRAME_END + 1):
            h, a = POS["hip" + side][f], POS["ank" + side][f]
            d = a - h
            eul = d.to_track_quat("-Z", "Y").to_euler("XYZ", prev) if prev else d.to_track_quat("-Z", "Y").to_euler("XYZ")
            prev = eul
            cap.location, cap.rotation_euler, cap.scale = h, eul, (1.0, 1.0, d.length)
            for path in ("location", "rotation_euler", "scale"):
                cap.keyframe_insert(path, frame=f)

def smoothed(key, f, radius, n):
    s = shot(n)
    fs = [min(max(g, s["start"]), s["end"]) for g in range(f - radius, f + radius + 1)]
    return sum((POS[key][g] for g in fs), Vector()) / len(fs)

# =============================================================================
# 6. CAMERAS -- one per shot; aim baked into rotation so handheld noise can sit on it
# =============================================================================
CAMS = new_collection("CAMERAS")

def aim_dir(yaw, pitch):
    """yaw = atan2(dx, dy) (pi looks -Y, 2pi looks +Y), pitch up in radians."""
    return Vector((math.sin(yaw) * math.cos(pitch), math.cos(yaw) * math.cos(pitch), math.sin(pitch)))

S2_CAMY = s2_y(0.35)          # she crosses the shot-2 lens 0.35 s into the shot
S3_CAM0 = Vector((1.1, RAIL_Y + 1.5, Z_R1 + 0.95))   # 1.5 m past the rail, hip height
S3_RAIL_AIM = Vector((-0.55, RAIL_Y, RAIL_TOP + 0.38))
S7_LENS = None                # set after baking: the spot her right shoe passes over
S7_TSTAR = None
S8_FEET = None

def cam_state(n, f):
    """(camera location, target location, lens mm) for shot n at frame f."""
    t = t_in(f, n)
    if n == 1:
        # ECU of the right shoe on the start ledge, low at shoe level, +X side (unchanged).
        s0 = POS["shoeR"][shot(1)["start"]]
        cam = s0 + Vector((0.54, 0.02, 0.12))
        tgt = smoothed("shoeR", f, 3, 1) + Vector((0, 0, 0.03))
        return cam, tgt, 50.0
    if n == 2:
        # Knee height, 0.8 m off her line (+X), 35 mm. Pans loosely with her legs as they come in,
        # they cross the lens at 0.35 s (a 0.8 m wide frame -> ~0.12 s crossing); the camera whips
        # after her, then chases her (vehicle/steadicam) and rises to a waist-up MS of her back.
        y = s2_y(t)
        chase = seg(t, 0.62, 1.05)
        d_along = max(0.0, y - S2_CAMY)
        d_along = lerp(d_along, 2.6, chase) if d_along > 2.6 or chase > 0 else d_along
        cam = Vector((lerp(0.8, 0.55, chase), max(S2_CAMY, y - d_along), Z_R1 + lerp(0.5, 1.25, chase)))
        hips = smoothed("hips", f, 1, 2)
        alpha = math.atan2(hips.y - cam.y, cam.x - hips.x)
        aim = lerp(0.7 * alpha, alpha, seg(t, 0.30, 0.45))
        dist = max(1.0, (hips - cam).length)
        tgt = cam + Vector((-math.cos(aim), math.sin(aim), 0)) * dist
        tgt.z = lerp(Z_R1 + 0.42, hips.z + 0.30, seg(t, 0.40, 0.95))
        return cam, tgt, lerp(35.0, 55.0, seg(t, 0.70, 1.15))
    if n == 3:
        # Medium close-up 1.5 m past the rail at hip height, 35 mm, framed so her hand slaps the
        # rail in the left third; legs swing through toward the lens; after landing the camera
        # retreats ahead of her (torso + shoes close, head may leave the frame).
        hips = smoothed("hips", f, 2, 3)
        cy = max(S3_CAM0.y, hips.y + lerp(-0.3, 1.9, seg(t, 0.95, 1.6)))
        cam = Vector((S3_CAM0.x, cy, S3_CAM0.z))
        tgt = S3_RAIL_AIM.lerp(hips + Vector((0, 0, -0.10)), seg(t, 0.80, 1.00))
        tgt = tgt.lerp(hips + Vector((0, 0, -0.32)), seg(t, 1.05, 1.40))
        return cam, tgt, 35.0
    if n == 4:
        # ECU at the wall foot on the sole hitting the wall, then the camera rises in front of the
        # wall, tilts up with her and follows her over the top onto roof 2b (back/legs, no sky end).
        cam = vlerp((1.15, 21.20, Z_R1 + 0.30), (0.90, 21.55, Z_R2B + 0.55), ease(seg(t, 0.35, 1.10)))
        hips = smoothed("hips", f, 3, 4)
        cam.y = max(cam.y, hips.y - 2.2)
        wall_pt = WALL_STEP1 + Vector((0, 0.04, 0.06))
        shoe = POS["shoeR"][f].lerp(wall_pt, 0.40 * seg(t, 0.05, 0.20) + 0.60 * seg(t, 0.26, 0.34))
        tgt = shoe.lerp(hips + Vector((0, 0, 0.10)), seg(t, 0.42, 1.0))
        tgt = tgt.lerp(hips + Vector((0, 0, -0.20)), seg(t, 1.0, 1.4))
        return cam, tgt, lerp(43.0, 32.0, seg(t, 0.55, 1.20))
    if n == 5:
        # Wide side-on from the rooftop across the street, 85 mm pan (the one full-body shot).
        cam = Vector((16.5, 31.0, 12.1 + 1.6))
        tgt = smoothed("hips", f, 4, 5) + Vector((0, 0.8, 0.1))
        return cam, tgt, 85.0
    if n == 6:
        # 0.5 m in front of the landing ledge at ledge height, looking slightly up, 35 mm:
        # shoes drop in from the top and hit the ledge in the lower half, knees fold into frame,
        # then her legs push out of frame past the lens.
        cam = Vector((0.35, Y_LEDGE[1] + 0.5, Z_LEDGE + 0.03))
        tgt = Vector((0.0, 37.5, Z_LEDGE + lerp(0.37, 0.21, seg(t, 0.0, 0.32))))
        return cam, tgt, 35.0
    if n == 7:
        # Worm's-eye POV lying on the roof on her line, lens 5 cm up, 20 mm, tilted up 25 deg.
        # She runs over it (right shoe over the lens, left lands beside), the camera tilts up
        # onto the sole and her underside against the sky, then whips round onto her back.
        cam = S7_LENS.copy()
        ts = S7_TSTAR
        pitch = lerp(R(25), R(72), seg(t, ts - 0.22, ts + 0.04))
        pitch = lerp(pitch, R(20), seg(t, ts + 0.06, ts + 0.36))
        yaw = lerp(math.pi, 2 * math.pi, seg(t, ts + 0.04, ts + 0.36))
        return cam, cam + aim_dir(yaw, pitch) * 2.0, 20.0
    if n == 8:
        # Knee height, 50 mm, 1.2 m from where her feet stop: the shoes skid into frame and stop
        # in a close-up, tilt up to an MCU of her looking down, then push in to the shoe ECU.
        start = S8_FEET + Vector((1.10, -0.45, 0.0))
        start.z = Z_R3 + 0.50
        feet = (smoothed("shoeL", f, 1, 8) + smoothed("shoeR", f, 1, 8)) / 2
        shoe_end = POS["shoeR"][shot(8)["start"] + int(3.4 * FPS)]
        end = shoe_end + Vector((0.42, -0.40, 0.13))
        cam = start.lerp(end, ease(seg(t, 2.80, 3.85)))
        tgt = (S8_FEET + Vector((0, 0, 0.06))).lerp(feet, 0.25 * (1 - seg(t, 0.9, 1.3)))
        tgt = tgt.lerp(smoothed("head", f, 2, 8) + Vector((0, 0, -0.08)), seg(t, 1.70, 2.30))
        tgt = tgt.lerp(smoothed("shoeR", f, 2, 8), seg(t, 2.80, 3.55))
        return cam, tgt, 50.0

def setup_derived_cameras():
    """Camera spots that depend on the baked animation (shot 7 lens spot, shot 8 feet)."""
    global S7_LENS, S7_TSTAR, S8_FEET
    s7 = shot(7)
    best = None
    for f in range(s7["start"], s7["end"] + 1):
        t = t_in(f, 7)
        if 1.45 <= t <= 1.80:
            p = POS["shoeR"][f]
            if best is None or p.z > best[1].z:
                best = (t, p)
    S7_TSTAR = best[0]
    S7_LENS = Vector((best[1].x, best[1].y, Z_R3 + 0.05))
    f8 = shot(8)["start"] + int(1.4 * FPS)
    S8_FEET = (POS["shoeL"][f8] + POS["shoeR"][f8]) / 2
    S8_FEET.z = Z_R3

def build_cameras():
    cams = {}
    for s in SHOTS:
        n = s["n"]
        cd = bpy.data.cameras.new(f"Cam{n}")
        cd.sensor_width = 36.0
        cd.sensor_fit = "HORIZONTAL"
        cd.clip_start = 0.02 if n in (1, 4, 6, 7, 8) else 0.05
        cd.clip_end = 1200.0
        cam = bpy.data.objects.new(f"Cam{n}", cd)
        cam.rotation_mode = "XYZ"
        link(cam, CAMS)
        tgt = empty(f"Cam{n}_Target", CAMS, size=0.15, kind="SPHERE")
        cams[n] = (cam, tgt)
        prev = None
        for f in range(max(FRAME_START, s["start"] - 1), min(FRAME_END, s["end"] + 1) + 1):
            ff = min(max(f, s["start"]), s["end"])
            c, g, lens = cam_state(n, ff)
            q = (g - c).to_track_quat("-Z", "Y")
            eul = q.to_euler("XYZ", prev) if prev is not None else q.to_euler("XYZ")
            prev = eul
            cam.location = c
            cam.rotation_euler = eul
            tgt.location = g
            cd.lens = lens
            cam.keyframe_insert("location", frame=f)
            cam.keyframe_insert("rotation_euler", frame=f)
            tgt.keyframe_insert("location", frame=f)
            cd.keyframe_insert("lens", frame=f)
        m = sc.timeline_markers.new(f"S{n}_{s['name']}", frame=s["start"])
        m.camera = cam
        # HANDHELD: f-curve noise on rotation (and a little on location), per-shot strength
        rot_s, loc_s, scale = s["hand"]
        add_noise(cam, "rotation_euler", rot_s, scale, 3.1 * n, s["start"], s["end"])
        add_noise(cam, "location", loc_s, scale * 1.3, 11.7 * n, s["start"], s["end"])
    return cams

# ---- bake everything --------------------------------------------------------
bake_maya()
setup_derived_cameras()
CAMS_BY_SHOT = build_cameras()
sc.camera = CAMS_BY_SHOT[1][0]

# ---- camera sanity checks ----------------------------------------------------
WARNINGS = []
CHAR_MESHES = [o for o in CHAR.objects if o.type == "MESH"]

def maya_screen_box(cam):
    xs, ys, zs = [], [], []
    for o in CHAR_MESHES:
        for c in o.bound_box:
            co = world_to_camera_view(sc, cam, o.matrix_world @ Vector(c))
            xs.append(co.x); ys.append(co.y); zs.append(co.z)
    return min(xs), max(xs), min(ys), max(ys), min(zs)

GROUPS = {
    "MAYA": CHAR_MESHES,
    "SHOE": [SHOE_R, bpy.data.objects["Maya_Sole_R"]],
    "LEGS": [o for o in CHAR_MESHES if any(k in o.name for k in ("Thigh", "Shin", "Shoe", "Sole", "Laces", "LegCap"))],
    "UPPER": [o for o in CHAR_MESHES if any(k in o.name for k in ("Torso", "Pelvis", "Neck", "Head", "Hair", "Arm", "Forearm", "Hand", "BodyCap"))],
}

def group_box(cam, group):
    """Projected (clipped) screen box of a mesh group + whether the whole group is inside the frame."""
    pts = []
    for o in GROUPS[group]:
        for c in o.bound_box:
            pts.append(world_to_camera_view(sc, cam, o.matrix_world @ Vector(c)))
    front = [p for p in pts if p.z > 0]
    whole = len(front) == len(pts) and all(0 <= p.x <= 1 and 0 <= p.y <= 1 for p in pts)
    if not front:
        return None, whole
    x0, x1 = max(0, min(p.x for p in front)), min(1, max(p.x for p in front))
    y0, y1 = max(0, min(p.y for p in front)), min(1, max(p.y for p in front))
    if x1 - x0 < 0.02 or y1 - y0 < 0.02:
        return None, whole
    return (round(x0, 2), round(x1, 2), round(y0, 2), round(y1, 2)), whole

# per shot: (subject part, may be out of frame) at first / mid / last
FRAME_SPEC = {
    1: (("SHOE", 0), ("SHOE", 0), ("SHOE", 0)),
    2: (("LEGS", 0), ("UPPER", 0), ("UPPER", 0)),
    3: (("MAYA", 1), ("LEGS", 0), ("MAYA", 0)),      # opens on the rail; she enters frame left
    4: (("SHOE", 0), ("MAYA", 0), ("LEGS", 0)),
    5: (("MAYA", 0), ("MAYA", 0), ("MAYA", 0)),
    6: (("SHOE", 0), ("LEGS", 0), ("LEGS", 1)),      # ends as her legs push out past the lens
    7: (("MAYA", 0), ("MAYA", 0), ("MAYA", 0)),
    8: (("SHOE", 1), ("MAYA", 0), ("SHOE", 0)),      # opens on the empty stop spot; shoes skid in
}
MID_MIN = {2: 0.40, 3: 0.40, 4: 0.40, 6: 0.40, 7: 0.40, 8: 0.40}

FRAMING = {}
for s in SHOTS:
    n = s["n"]
    cam = CAMS_BY_SHOT[n][0]
    mid = (s["start"] + s["end"]) // 2
    FRAMING[n] = {}
    for (label, f), (sub, may_out) in zip((("first", s["start"]), ("mid", mid), ("last", s["end"])), FRAME_SPEC[n]):
        sc.frame_set(f)
        bx, _ = group_box(cam, sub)
        _, full = group_box(cam, "MAYA")
        hf = round(bx[3] - bx[2], 2) if bx else 0.0
        FRAMING[n][label] = dict(subject=sub, box_x0x1y0y1=bx, height_frac=hf, full_body_in_frame=full)
        if bx is None and not may_out:
            WARNINGS.append(f"Cam{n} {label} (f{f}): {sub} out of frame")
        if label == "mid" and n in MID_MIN and hf < MID_MIN[n]:
            WARNINGS.append(f"Cam{n} mid (f{f}): {sub} only {hf:.2f} of frame height (< {MID_MIN[n]})")
        if full and n != 5 and not (n == 7 and label in ("first", "last")):   # S7 plan: she runs in from ~12 m and away
            WARNINGS.append(f"Cam{n} {label} (f{f}): full body in frame (only shot 5 may be full body)")
# shot 4: the sole on the wall must fill >= 1/3 of the frame height at f163-170
S4_SOLE = {}
for f in range(163, 171):
    sc.frame_set(f)
    bx, _ = group_box(CAMS_BY_SHOT[4][0], "SHOE")
    S4_SOLE[f] = round(bx[3] - bx[2], 2) if bx else 0.0
    if S4_SOLE[f] < 0.33:
        WARNINGS.append(f"Cam4 f{f}: sole only {S4_SOLE[f]:.2f} of frame height (< 0.33)")
for s in SHOTS:
    n = s["n"]
    cam = CAMS_BY_SHOT[n][0]
    for f in range(s["start"], s["end"] + 1):
        sc.frame_set(f)
        p = cam.matrix_world.translation
        for (x0, x1, y0, y1, z0, z1, nm) in SOLIDS:
            if x0 - 0.03 < p.x < x1 + 0.03 and y0 - 0.03 < p.y < y1 + 0.03 and z0 - 0.03 < p.z < z1 + 0.03:
                WARNINGS.append(f"Cam{n} frame {f} inside/touching {nm} at {tuple(round(v, 2) for v in p)}")
                break
        dmin = min((p - bbox_center(o)).length for o in CHAR_MESHES)
        if dmin < 0.12:
            WARNINGS.append(f"Cam{n} frame {f} only {dmin:.2f} m from MAYA geometry")
        # action axis: side cameras stay on +X of her line (front/back views 6, 7 exempt)
        if n in (2, 3, 4, 5, 8) and p.x < POS["hips"][f].x - 0.05:
            WARNINGS.append(f"Cam{n} frame {f} crossed the action axis (camera x {p.x:.2f} < MAYA x)")
# S7: closest pass distance, S5: time in the air, S3: shoe clearance over the rail
S7_MIN = min((S7_LENS - POS["shoeR"][f]).length for f in range(shot(7)["start"], shot(7)["end"] + 1))
_rail_clear = []
for f in range(shot(3)["start"], shot(3)["end"]):
    for key in ("shoeL", "shoeR"):
        p0, p1 = POS[key][f], POS[key][f + 1]
        if (p0.y - RAIL_Y) * (p1.y - RAIL_Y) <= 0 and p1.y != p0.y:
            u = (RAIL_Y - p0.y) / (p1.y - p0.y)
            pt = p0.lerp(p1, u)
            if abs(pt.x) < 2.5:
                _rail_clear.append(round(pt.z - 0.07 - (RAIL_TOP + 0.035), 3))
RAIL_CLEARANCE = min(_rail_clear) if _rail_clear else None
if RAIL_CLEARANCE is not None and RAIL_CLEARANCE < 0:
    WARNINGS.append(f"Shot 3: a shoe passes {RAIL_CLEARANCE:.2f} m through the rail")
for w in WARNINGS[:40]:
    print("WARNING:", w)
print(f"[previs] camera sanity warnings: {len(WARNINGS)}")
print(f"[previs] framing: {json.dumps(FRAMING)}")
print(f"[previs] S4 sole frac {S4_SOLE} ; S7 lens y {S7_LENS.y:.2f} t* {S7_TSTAR:.2f} ; S7 closest right-shoe-to-lens {S7_MIN:.2f} m ; S5 air time {J_T:.2f} s, vy {J_VY:.2f} m/s, "
      f"vz {J_VZ:.2f} m/s, apex +{J_VZ ** 2 / 19.62:.2f} m ; S3 rail clearance {RAIL_CLEARANCE}")

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
sh.shadow_intensity = 0.45
sh.show_cavity = True
sh.cavity_type = "BOTH"
sh.cavity_ridge_factor = 1.0
sh.cavity_valley_factor = 1.2
sc.display.light_direction = tuple(-SUN_DIR)          # towards the (western, low) sun
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
    p = os.path.join(d, "d_depth.png")
    if os.path.exists(p):
        os.replace(p, os.path.join(d, f"d_depth{frame:04d}.png"))

T_RENDER = time.time()
RENDER_TIMES = {}
for s in SHOTS:
    n = s["n"]
    sdir = os.path.join(OUT, f"shot{n}")
    fdir = os.path.join(WORK, f"shot{n}", "beauty")
    ddir = os.path.join(WORK, f"shot{n}", "depth")
    for d in (fdir, ddir):
        shutil.rmtree(d, ignore_errors=True)
    for d in (sdir, fdir, ddir):
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
        common = ["-framerate", str(FPS), "-start_number", str(s["start"])]
        enc = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-r", str(FPS)]
        ffmpeg(*common, "-i", os.path.join(fdir, "f_%04d.png"), *enc, os.path.join(sdir, "clip.mp4"))
        ffmpeg(*common, "-i", os.path.join(ddir, "z_%04d.png"), *enc, os.path.join(sdir, "depth.mp4"))
    print(f"[previs] shot {n} rendered in {RENDER_TIMES[n]}s")

sc.frame_start, sc.frame_end = FRAME_START, FRAME_END

if MODE != "stills":
    lst = os.path.join(WORK, "concat.txt")
    with open(lst, "w") as fh:
        for s in SHOTS:
            fh.write(f"file '{os.path.join(OUT, 'shot%d' % s['n'], 'clip.mp4')}'\n")
    ffmpeg("-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", os.path.join(OUT, "playblast.mp4"))

# =============================================================================
# 8. REPORTS
# =============================================================================
# ---- camera_log.json: one sample per second of the film ----------------------
DESCRIPTIONS = {
    1: dict(move="Handheld extreme close-up, camera 0.3 m from MAYA's right shoe at shoe level on the start "
                 "ledge, 50 mm; barely moving while the heel lifts and she rocks forward.",
            beats=["extreme close-up of the orange shoe planted on the concrete ledge, toe flexing",
                   "the heel peels up off the ledge, weight rolling onto the toe, she rocks forward to go"]),
    2: dict(move="Low side angle 0.35 m above the roof on her right (+X), 24 mm: she sprints past left to "
                 "right inside a second, the camera whips right to follow her back and punches in to 45 mm.",
            beats=["low side angle, MAYA sprinting in from frame left across the rooftop",
                   "she blows past the lens left to right, the camera whip-pans to follow",
                   "the camera holds on her back as she sprints away toward the rail, zooming in"]),
    3: dict(move="Front three-quarter from beyond the rail on the +X side, 35 mm, panning with her: hand "
                 "plant, legs swing through over the rail toward camera, she lands running at the lens.",
            beats=["front three-quarter, MAYA sprinting at the rail, left hand reaching for it",
                   "legs swing through over the rail toward camera, she lands and runs at the lens"]),
    4: dict(move="Handheld ECU low at the foot of the wall: the orange sole slaps flat on the wall, two steps "
                 "up; the camera tilts up, rises and widens as she mantles over the top and runs on.",
            beats=["extreme close-up, the orange sole hits the wall flat, second foot higher",
                   "tilt up: she pulls over the top of the wall and sprints away across the upper roof"]),
    5: dict(move="Wide side-on from the rooftop across the street, 85 mm, low so the sky sits behind her; "
                 "pans left to right with her sprint, take-off and 0.78 s flight over the 3 m gap.",
            beats=["wide side-on, MAYA sprinting along the upper roof toward the edge, sky behind",
                   "she plants on the edge and launches over the 3 m gap, knees tucked",
                   "still in the air, legs reaching for the ledge on the far roof"]),
    6: dict(move="Low front on roof 3 past the ledge, 24 mm: she drops in toward camera, both shoes hit the "
                 "ledge, knees absorb deep; the camera drops with her, then she pushes off toward the lens.",
            beats=["low front, MAYA dropping out of the sky, the shoes slam onto the ledge",
                   "she rises from the crouch and steps down off the ledge running at the lens"]),
    7: dict(move="Chest-height handheld in the middle of the long straight, 30 mm, heavy shake: she sprints "
                 "straight at the lens, passes 0.5 m to screen right, and the camera whips round to her back.",
            beats=["heavy handheld, MAYA small at the end of the long rooftop straight, sprinting at the lens",
                   "she fills the frame, arms pumping, closing fast",
                   "she blows past the lens, the camera whips round onto her back"]),
    8: dict(move="+X side, standing height, 28 mm: follows her skid to a sideways halt at the roof edge, "
                 "city behind; she looks down at her shoes and the camera pushes in to a 50 mm ECU of the shoe.",
            beats=["MAYA sprints in along the rooftop toward the edge",
                   "she skids sideways to a halt at the roof edge, arms out, city behind",
                   "she looks down at the shoes, the camera starts pushing in",
                   "extreme close-up of the orange shoe, heel lifting, on the roof edge"]),
}
log = dict(film="FIRST STEP (VOLT ONE)", fps=FPS, resolution=[RES_X, RES_Y],
           units="metres, Z up; MAYA runs along +Y; sun from -X (west)", total_frames=FRAME_END,
           total_s=FRAME_END / FPS, shots=[], per_second=[])
for s in SHOTS:
    n = s["n"]
    cam, tgt = CAMS_BY_SHOT[n]
    samples = []
    nsec = int(math.ceil(s["cut"] - 1e-6))
    for sec in range(nsec):
        f = s["start"] + sec * FPS
        sc.frame_set(f)
        rec = dict(film_t=round(s["t"] + sec, 2), shot=n, t=sec, frame=f, camera_object=cam.name,
                   camera=[round(v, 3) for v in cam.matrix_world.translation],
                   target=[round(v, 3) for v in tgt.matrix_world.translation],
                   lens_mm=round(cam.data.lens, 1), beat=s["beat"],
                   description=DESCRIPTIONS[n]["beats"][sec])
        samples.append(rec)
        log["per_second"].append(rec)
    log["shots"].append(dict(
        shot=n, name=s["name"], camera_object=cam.name, frame_range=[s["start"], s["end"]],
        start_s=s["t"], duration_s=round((s["end"] - s["start"] + 1) / FPS, 3),
        bible_cut_length_s=s["cut"], bible_camera=s["bible_camera"], beat=s["beat"],
        move=DESCRIPTIONS[n]["move"], depth_range_m=[s["near"], s["far"]],
        handheld=dict(rot_rad=s["hand"][0], loc_m=s["hand"][1], scale_frames=s["hand"][2]),
        framing=FRAMING[n], per_second=samples))
log["camera_warnings"] = WARNINGS
log["checks"] = dict(s7_right_shoe_over_lens_m=round(S7_MIN, 2), s4_sole_height_frac=S4_SOLE, s5_air_time_s=J_T, s3_rail_clearance_m=RAIL_CLEARANCE)
with open(os.path.join(OUT, "camera_log.json"), "w") as fh:
    json.dump(log, fh, indent=2)

# ---- continuity.json (unchanged from the reference) ----------------------------
def write_continuity(shots, subjects, cam_for_shot, out_path, fps=FPS, ground_z=lambda x, y: 0.0,
                      forward=Vector((0.0, 1.0, 0.0))):
    right = Vector((forward.y, -forward.x, 0.0))
    frame_lo = shots[0]["start"]

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
        cam, cam_pos, subs = mid["cam"], mid["cam_pos"], mid["subs"]
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

def cam_ground(x, y):
    """Surface under a camera: the row's roofs, the shot-5 camera rooftop, else the street."""
    if 16.0 <= x <= 30.0 and 20.0 <= y <= 46.0:
        return 12.1
    return ground_z(x, y)

CONTINUITY_SUBJECTS = [
    dict(name="MAYA", ob=TORSO_MESH),
    dict(name="SHOE", ob=SHOE_R),
]
write_continuity(SHOTS, CONTINUITY_SUBJECTS, lambda n: CAMS_BY_SHOT[n][0],
                  os.path.join(OUT, "continuity.json"), fps=FPS, ground_z=cam_ground,
                  forward=Vector((0.0, 1.0, 0.0)))

# ---- contact sheet (VSE): first / mid / last of every shot -------------------
def make_contact_sheet():
    GAP, LAB, TOP = 10, 30, 52
    TW = (RES_X - 4 * GAP) // 3
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

    text(f"FIRST STEP - previs ({PROXY} proxy) - first / mid / last", GAP, 12, 28, True)
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
            text(f"S{s['n']} {s['name'].upper()} - {which} - f{fr} "
                 f"({s['t'] + (fr - s['start']) / FPS:.2f}s)", x, y_row + 5, 19)
    cs.render.filepath = os.path.join(OUT, "contact.jpg")
    bpy.ops.render.render(write_still=True)

make_contact_sheet()

if not KEEP_FRAMES and MODE != "stills":
    shutil.rmtree(WORK, ignore_errors=True)

print("[previs] render times per shot (s):", RENDER_TIMES, f"total render {time.time() - T_RENDER:.1f}s")
print(f"[previs] done in {time.time() - T0:.1f}s")

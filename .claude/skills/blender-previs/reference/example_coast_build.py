"""
COAST ROAD -- 10 s bake-off test film -- greybox previs, built entirely from code.
Derived from the skill's parkour reference build (example_parkour_build.py): same CONFIG / HELPERS / SET /
CHARACTER / ANIMATION / CAMERAS / RENDER / REPORTS layout, monolith proxy, slow body-sway handheld,
offset lagging aim targets, lens moves, speed ramps, gray-on-gray near-surface texture (none on distant
masses), hero-in-frame and clean-cut build checks, one playblast for the one sequence, continuity.json,
camera_log.json, sequences.json and a contact sheet.

Run (from anywhere):
    /Applications/Blender.app/Contents/MacOS/Blender -b --python build.py

Environment switches (optional):
    PREVIS_MODE=stills   only render each shot's first/mid/last frame (+ depth) and the contact sheet
    PREVIS_MODE=full     (default) stills, per-shot clips + depth clips, playblast (= seq.mp4), reports, .blend
    PREVIS_KEEP_FRAMES=1 keep the intermediate PNG sequences in out/_frames
    PREVIS_ALLOW_FAIL=1  render even if the hero-in-frame / clean-cut check fails
    PREVIS_OUT=dir       output folder (default out/)
    PREVIS_LIGHT=STUDIO  Workbench lighting (default FLAT keeps the proxy colours saturated)

Outputs (in out/):
    playblast.mp4 (= seq.mp4, the whole 10 s is one sequence), chunks/c1.mp4 + c2.mp4 (5 s halves split
    at the 5.0 s cut), contact.jpg, camera_log.json, continuity.json, sequences.json, coast.blend,
    shotN/{first,mid,last,depth_first}.png, shotN/{clip,depth}.mp4

How this file is organised:
    1. CONFIG      -- timeline (4 shots, 240 frames @ 24 fps), colours, road layout, speed profile
    2. HELPERS     -- maths, materials, textures, box/primitive builders, keyframing (from the reference)
    3. SET         -- road cut into the cliff, one left-hand bend, stone wall, cliffs, sea, headlands, sun
    4. VEHICLE     -- the red roadster proxy (body, wings/arches, windscreen frame, open cabin, 4 wheels)
       + DRIVER    -- ROSA as the orientation-coded monolith in the left seat (front CYAN, back black,
                      sides/top green: cyan instead of red because the car is red)
    5. ANIMATION   -- speed profile along the right lane, wheel roll = distance / radius, steering,
                      body roll in the bend, ROSA turning toward the bend; baked one key per frame
    6. CAMERAS     -- Cam1..Cam4: aim baked from an offset, lagging target + slow sway handheld, markers
    7. RENDER      -- Workbench + compositor depth pass, per shot, then ffmpeg
    8. REPORTS     -- camera_log.json, continuity.json, contact sheet, sequences.json

Units: metres, Z up. The road centreline starts along +Y (x = 0), the car drives in the RIGHT lane
(right-hand traffic, left-hand drive). The CLIFF rises on the LEFT (-X), the stone wall and the drop to
the sea are on the RIGHT (+X), the sea is a flat plane 80 m below. At road s = BEND_S the road turns LEFT
(inland round the cliff; TURN = -1) through 70 degrees on a 30 m radius and runs on north-west, toward the
low sun over the open sea. Every camera stays on the car's LEFT (cliff / driver side): screen right -> left.
Heading psi is measured clockwise from +Y (psi = 0 -> +Y, psi = 90 -> +X); right(psi) = (cos psi, -sin psi).
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
OUT = os.path.join(HERE, os.environ.get("PREVIS_OUT", "out"))
PROXY = "monolith"                   # the only proxy this film uses (orientation-coded box for ROSA)
WORK = os.path.join(OUT, "_frames")
BLEND_PATH = os.path.join(OUT, "coast.blend")
MODE = os.environ.get("PREVIS_MODE", "full")
KEEP_FRAMES = os.environ.get("PREVIS_KEEP_FRAMES") == "1"

FPS = 24
RES_X, RES_Y = 1280, 720

# Shot table (bible): start/end inclusive timeline frames; hard cuts, no handles.
# hand = (sway rotation rad, sway location m, tremor rotation rad, aim-target breathe m)
SHOTS = [
    dict(n=1, start=1,   end=72,  t=0.0, cut=3.0, near=15.0, far=140.0, name="Aerial",
         beat="establish: the car on the cliff road", subject="CAR", hand=(0.010, 0.30, 0.0002, 0.25),
         bible_camera="aerial chase: the car small on the road, sea filling the right of frame, road curving "
                      "ahead; drone behind-left and high, 24 mm, slow push, gentle float"),
    dict(n=2, start=73,  end=120, t=3.0, cut=2.0, near=0.4,  far=12.0,  name="Wheel",
         beat="speed: wheel and wing at road level", subject="WHEEL", hand=(0.008, 0.006, 0.0010, 0.02),
         bible_camera="wheel close-up: wire wheel and red wing at road level, stone wall streaking past; "
                      "tracking alongside at 30 cm, 35 mm, road vibration"),
    dict(n=3, start=121, end=180, t=5.0, cut=2.5, near=0.8,  far=14.0,  name="Rosa",
         beat="the driver grins into the bend", subject="ROSA", hand=(0.007, 0.006, 0.0004, 0.012),
         bible_camera="Rosa in profile through the open cabin, she grins into the bend; side-mounted on the "
                      "car, 50 mm, slow sway"),
    dict(n=4, start=181, end=240, t=7.5, cut=2.5, near=1.0,  far=60.0,  name="Bend",
         beat="the car sweeps out of the corner and past", subject="CAR", hand=(0.004, 0.008, 0.0003, 0.05),
         bible_camera="the bend: low wide ahead of the car as it sweeps out of the corner into the sun; "
                      "static low at the roadside, 28 mm, slight pan, the car passes close"),
]
FRAME_START, FRAME_END = SHOTS[0]["start"], SHOTS[-1]["end"]
assert FRAME_END == 240 and all(s["end"] - s["start"] + 1 == round(s["cut"] * FPS) for s in SHOTS)

# Road layout
HALF_W = 3.2                 # road half width (two 3.2 m lanes)
LANE = 1.4                   # car centre: 1.4 m right of the centreline (right lane, toward the wall)
WALL_IN, WALL_OUT, WALL_H = 3.25, 3.65, 0.80    # stone wall on the sea side (offsets, height)
R_BEND = 30.0                # centreline radius of the one bend
BEND_DEG = 70.0
TURN = -1                    # -1 = LEFT-hand bend (inland, round the cliff): the sea stays open on the right
SEA_Z = -80.0                # the sea, flat, far below
S_ROAD = (-160.0, 520.0)     # road s range

# Speed profile (m/s): ~15 on the straight, brakes to ~10 into the bend, holds, accelerates out.
def v_of_t(t):
    if t < 3.8:
        return 15.0
    if t < 5.0:
        return 15.0 - 5.0 * ease((t - 3.8) / 1.2)
    if t < 7.3:
        return 10.0
    if t < 7.5:                                   # shots 1-3 unchanged
        return 10.0 + 8.0 * ease((t - 7.3) / 3.1)
    # shot 4: hard acceleration out of the bend, ~18 m/s at the pass (8.8 s), 20 m/s by 9.0 s, 21 m/s peak
    v75 = 10.0 + 8.0 * ease(0.2 / 3.1)
    return v75 + (V_PEAK - v75) * ease((t - 7.5) / 1.9)
V_PEAK = 21.0
BEND_T = 5.1                 # the car enters the arc 0.1 s into shot 3 (she grins into the bend)

# Colours (linear RGBA). Set = grays; car = ONE saturated colour (cherry red); ROSA = monolith code.
C = dict(
    road=(0.30, 0.30, 0.31, 1), dash=(0.62, 0.62, 0.62, 1), wall=(0.50, 0.49, 0.47, 1),
    cliff=(0.44, 0.43, 0.41, 1), drop=(0.38, 0.37, 0.36, 1), cliff_far=(0.40, 0.40, 0.40, 1),
    far=(0.47, 0.48, 0.50, 1), sea=(0.20, 0.21, 0.23, 1),
    car=(0.62, 0.012, 0.03, 1), tyre=(0.035, 0.035, 0.037, 1), hub=(0.55, 0.55, 0.56, 1),
    spoke=(0.30, 0.30, 0.31, 1), chrome=(0.66, 0.66, 0.67, 1), interior=(0.10, 0.10, 0.10, 1),
    seat=(0.16, 0.16, 0.16, 1), grille=(0.06, 0.06, 0.06, 1),
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

# ---- set surface textures (gray-on-gray, low contrast; rendered with Workbench colour_type TEXTURE) ----
import numpy as np
TEX_TILE = {}          # material name -> (u metres, v metres) covered by one image tile

def _tex_pattern(kind, n=256, seed=3):
    rs = np.random.RandomState(seed)
    f = np.ones((n, n), np.float32)
    yy, xx = np.mgrid[0:n, 0:n]
    if kind == "brick":                   # 1.2 m tile: 16 courses of 7.5 cm, 30 cm bricks, running bond
        ch = n // 16
        row = yy // ch
        off = (row % 2) * (n // 8)
        bw = n // 4
        col = (xx + off) // bw
        tone = 1.0 + 0.05 * (rs.rand(16, 8)[row % 16, col % 8] - 0.5)
        mortar = ((yy % ch) < 2) | (((xx + off) % bw) < 2)
        f = np.where(mortar, 0.80, tone)
    elif kind == "tar":                   # 3.6 m tile: tar-paper rolls 0.9 m wide, lapped seams
        f = 1.0 + 0.04 * (rs.rand(n, n) - 0.5)
        f = np.where((xx % (n // 4)) < 3, 0.84, f)
        f = np.where(((xx % (n // 4)) >= 3) & ((xx % (n // 4)) < 6), 1.05, f)
        f = np.where((yy % (n // 2)) < 2, 0.88, f)
    elif kind == "slab":                  # 1.2 m tile: 0.6 m concrete slabs with joints
        f = 1.0 + 0.03 * (rs.rand(n, n) - 0.5)
        f = np.where(((xx % (n // 2)) < 2) | ((yy % (n // 2)) < 2), 0.78, f)
    elif kind == "windows":               # 3.2 m tile: two 1.6 m bays x two 1.6 m floors
        cw = n // 2
        wx, wy = xx % cw, yy % cw
        win = (wx > cw * 0.28) & (wx < cw * 0.72) & (wy > cw * 0.22) & (wy < cw * 0.80)
        f = np.where(win, 0.66, 1.0)
        f = np.where(wy < 2, 0.85, f)
    return f

def textured(m, kind, tile):
    """Replace a set material's flat colour by a tiled gray pattern image (base colour x pattern)."""
    base = np.array(m.diffuse_color[:3], np.float32)
    pat = _tex_pattern(kind)
    n = pat.shape[0]
    px = np.ones((n, n, 4), np.float32)
    px[..., :3] = np.clip(pat[..., None] * base[None, None, :], 0, 1)
    img = bpy.data.images.new(f"tex_{m.name}", n, n, float_buffer=True)
    img.pixels.foreach_set(px.ravel())
    try:
        img.pack()
    except Exception:
        pass
    nt = m.node_tree
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = img
    tn.interpolation = "Closest" if kind in ("brick", "slab") else "Linear"
    nt.links.new(tn.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    nt.nodes.active = tn
    TEX_TILE[m.name] = tile
    return m

SOLIDS = []   # axis-aligned boxes (x0,x1,y0,y1,z0,z1,name) for the camera sanity check

def box(name, coll, x0, x1, y0, y1, z0, z1, material, solid=True, side=None):
    """Box; 'side' = optional material for the four vertical faces (e.g. brick under a tar roof).
    UVs are world-scale per face, divided by the face material's texture tile size."""
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    axes = ["z", "z", "y", "x", "y", "x"]
    me = bpy.data.meshes.new(name)
    me.from_pydata(v, [], f)
    me.update()
    ob = bpy.data.objects.new(name, me)
    me.materials.append(material)
    if side is not None:
        me.materials.append(side)
    uv = me.uv_layers.new(name="UVMap")
    for poly, ax in zip(me.polygons, axes):
        mi = 1 if (side is not None and ax != "z") else 0
        poly.material_index = mi
        tu, tv = TEX_TILE.get(me.materials[mi].name, (1.0, 1.0))
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            a, b = {"z": (co.x, co.y), "x": (co.y, co.z), "y": (co.x, co.z)}[ax]
            uv.data[li].uv = (a / tu, b / tv)
    if solid:
        SOLIDS.append((x0, x1, y0, y1, z0, z1, name))
    return link(ob, coll)

def box_c(name, coll, cx, cy, z0, sx, sy, sz, material, solid=True, side=None):
    return box(name, coll, cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, z0, z0 + sz, material, solid, side)

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
            mod.blend_in = mod.blend_out = 0


# ---- extra gray-on-gray patterns for this set (stone courses, rock strata, asphalt) ----
_tex_pattern_ref = _tex_pattern

def _tex_pattern(kind, n=256, seed=3):
    rs = np.random.RandomState(seed)
    yy, xx = np.mgrid[0:n, 0:n]
    if kind == "stone":                   # 2.0 x 1.0 m tile: 4 courses of 25 cm, blocks 25-60 cm, dark joints
        f = np.ones((n, n), np.float32)
        ch = n // 4
        for row in range(4):
            x = int(rs.randint(0, 20))
            while x < n:
                w = int(rs.randint(16, 40))
                tone = 1.0 + 0.10 * (rs.rand() - 0.5)
                f[row * ch:(row + 1) * ch, x:x + w] = tone
                f[row * ch:(row + 1) * ch, x:min(x + 2, n)] = 0.74
                x += w
            f[row * ch:row * ch + 2, :] = 0.74
        f *= 1.0 + 0.04 * (rs.rand(n, n) - 0.5)
        return f
    if kind == "rock":                    # soft periodic mottling, no lines: hard bands render as striped rock
        f = np.ones((n, n), np.float32)
        for _ in range(14):
            kx, ky = int(rs.randint(1, 5)), int(rs.randint(1, 5))
            f += 0.035 * np.sin(2 * math.pi * (kx * xx + ky * yy) / n + rs.rand() * 2 * math.pi).astype(np.float32)
        f *= 1.0 + 0.03 * (rs.rand(n, n) - 0.5)
        return f
    if kind == "strata":                  # 6 m tile: horizontal rock bands of varying tone + a few cracks
        f = np.ones((n, n), np.float32)
        y = 0
        while y < n:
            h = int(rs.randint(6, 34))
            f[y:y + h, :] = 1.0 + 0.16 * (rs.rand() - 0.5)
            f[y:y + 1, :] = 0.82
            y += h
        for _ in range(9):
            cx = int(rs.randint(0, n)); y0 = int(rs.randint(0, n - 40)); ln = int(rs.randint(20, 90))
            for k in range(ln):
                xk = (cx + int(3 * math.sin(k * 0.3))) % n
                f[min(y0 + k, n - 1), xk] = 0.80
        f *= 1.0 + 0.05 * (rs.rand(n, n) - 0.5)
        return f
    if kind == "asphalt":                 # 4 m tile: fine grain + one patch seam
        f = 1.0 + 0.05 * (rs.rand(n, n) - 0.5)
        f = np.where((yy % n) < 2, 0.90, f)
        f = np.where((xx > n * 0.55) & (xx < n * 0.85) & (yy > n * 0.2) & (yy < n * 0.45), f * 0.95, f)
        return f
    return _tex_pattern_ref(kind, n, seed)

# ---- road path: centreline straight along +Y, then one arc (TURN), then straight ----
def _integrate_speed():
    dt = 1.0 / 480.0
    ts, ds = [0.0], [0.0]
    t, d = 0.0, 0.0
    while t < 10.5:
        d += 0.5 * (v_of_t(t) + v_of_t(t + dt)) * dt
        t += dt
        ts.append(t); ds.append(d)
    return np.array(ts), np.array(ds)
_TS, _DS = _integrate_speed()

def dist_at(t):
    return float(np.interp(t, _TS, _DS))

BEND_S = dist_at(BEND_T)                         # straight: lane distance == road s (car starts at s = 0)
ARC_L = R_BEND * math.radians(BEND_DEG)
BEND_E = BEND_S + ARC_L
PSI_MAX = TURN * math.radians(BEND_DEG)

def centre(s):
    """Road centreline point (Vector, z = 0) and heading psi at road s."""
    if s <= BEND_S:
        return Vector((0.0, s, 0.0)), 0.0
    if s <= BEND_E:
        psi = TURN * (s - BEND_S) / R_BEND
        return Vector((TURN * R_BEND * (1 - math.cos(psi)), BEND_S + TURN * R_BEND * math.sin(psi), 0.0)), psi
    p_end = Vector((TURN * R_BEND * (1 - math.cos(PSI_MAX)), BEND_S + TURN * R_BEND * math.sin(PSI_MAX), 0.0))
    return p_end + (s - BEND_E) * Vector((math.sin(PSI_MAX), math.cos(PSI_MAX), 0.0)), PSI_MAX

def right_of(psi):
    return Vector((math.cos(psi), -math.sin(psi), 0.0))

def fwd_of(psi):
    return Vector((math.sin(psi), math.cos(psi), 0.0))

def road_point(s, off, z=0.0):
    c, psi = centre(s)
    p = c + off * right_of(psi)
    p.z = z
    return p

# dense samples: centreline (for road coordinates) and the right lane (for the car)
_CS = np.arange(S_ROAD[0], S_ROAD[1] + 1e-6, 0.1)
_CX, _CY, _CPSI = [], [], []
for s_ in _CS:
    c_, p_ = centre(float(s_))
    _CX.append(c_.x); _CY.append(c_.y); _CPSI.append(p_)
_CX, _CY, _CPSI = np.array(_CX), np.array(_CY), np.array(_CPSI)
_LX = _CX + LANE * np.cos(_CPSI)
_LY = _CY - LANE * np.sin(_CPSI)
_LD = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(_LX), np.diff(_LY)))])
_LD -= float(np.interp(0.0, _CS, _LD))            # lane distance 0 at road s = 0

def lane_at(d):
    """Car centre (ground) and heading at lane distance d."""
    return (Vector((float(np.interp(d, _LD, _LX)), float(np.interp(d, _LD, _LY)), 0.0)),
            float(np.interp(d, _LD, _CPSI)))

def road_coords(p):
    """(road s, lateral offset, heading) of the centreline point nearest to world point p."""
    i = int(np.argmin((_CX - p.x) ** 2 + (_CY - p.y) ** 2))
    psi = float(_CPSI[i])
    off = (p.x - _CX[i]) * math.cos(psi) - (p.y - _CY[i]) * math.sin(psi)
    return float(_CS[i]), off, psi

# ---- ribbons: meshes swept along the road (profile = [(offset, z)]), UVs in metres / tile ----
def ribbon(name, coll, s0, s1, ds, profile, material, jitter=None):
    ss = [s0 + k * ds for k in range(int(round((s1 - s0) / ds)) + 1)]
    n = len(profile)
    verts, faces = [], []
    for s in ss:
        c, psi = centre(s)
        r = right_of(psi)
        for i, (o, z) in enumerate(profile):
            do, dz = jitter(s, i, o, z) if jitter else (0.0, 0.0)
            verts.append((c.x + (o + do) * r.x, c.y + (o + do) * r.y, z + dz))
    for j in range(len(ss) - 1):
        for i in range(n - 1):
            a = j * n + i
            faces.append((a, a + n, a + n + 1, a + 1))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    me.materials.append(material)
    tu, tv = TEX_TILE.get(material.name, (1.0, 1.0))
    # v = cumulative profile length (so strata / courses run along the road)
    vcum = [0.0]
    for i in range(1, n):
        vcum.append(vcum[-1] + math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]))
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            j, i = divmod(vi, n)
            uv.data[li].uv = (ss[j] / tu, vcum[i] / tv)
    return link(bpy.data.objects.new(name, me), coll)

def rock_jitter(amp):
    def jit(s, i, o, z):
        if i == 0:
            return 0.0, 0.0
        k = amp * min(1.0, abs(z) / 6.0 + 0.3)
        return (k * (0.6 * math.sin(s * 0.37 + i * 1.7) + 0.4 * math.sin(s * 1.13 + i * 0.6)
                     + 0.25 * math.sin(s * 2.9 + i * 2.3)), 0.0)
    return jit

# =============================================================================
# 3. SET -- road cut into the cliff, one left-hand bend, stone wall, sea far below
# =============================================================================
sc = reset_scene()
sc.name = "CoastRoad"
bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
bpy.context.preferences.filepaths.save_version = 0
SET = new_collection("SET")
rnd = random.Random(7)
M = {k: mat(k) for k in ("road", "dash", "wall", "cliff", "drop", "cliff_far", "far", "sea")}
# near surfaces get gray-on-gray texture; distant masses (cliff top, headlands, sea) stay plain
for k_, kind_, tile_ in (("road", "asphalt", (4.0, 4.0)), ("wall", "stone", (2.0, 1.0)),
                         ("cliff", "rock", (6.0, 6.0)), ("drop", "rock", (9.0, 9.0))):
    textured(M[k_], kind_, tile_)

s0, s1 = S_ROAD
ribbon("Road", SET, s0, s1, 0.5, [(-HALF_W - 0.1, 0.0), (HALF_W + 0.05, 0.0)], M["road"])
# dashed centre line (3 m dash / 6 m gap), a shade lighter than the asphalt -- speed and scale read
k = 0
s_ = s0 + 2.0
while s_ < s1 - 4:
    ribbon(f"Dash{k}", SET, s_, s_ + 3.0, 0.5, [(-0.06, 0.004), (0.06, 0.004)], M["dash"])
    s_ += 9.0
    k += 1
# low stone wall on the sea side: inner face, cap, outer face
# SHOT 4 timing (shot-relative seconds): the car passes abeam of the lens, the camera whips left after it
# onto the sunset and holds. Its end position is the road s where the car is abeam at T_PASS.
S4_T0 = 7.5
S4_T_PASS = 1.30             # car centre abeam of the lens (film 8.80 s)
S4_S_CAM = road_coords(lane_at(dist_at(S4_T0 + S4_T_PASS))[0])[0]
CAR_NOSE = 2.05              # centre -> front bumper (m)
# the instant the car's NOSE passes the lens plane (lane distance CAR_NOSE short of the abeam distance)
S4_T_NOSE = float(np.interp(dist_at(S4_T0 + S4_T_PASS) - CAR_NOSE, _DS, _TS)) - S4_T0
S4_WHIP_LAG_FR = 2.5         # the whip starts 2-3 frames AFTER the nose passes: a follow, not an anticipation
S4_T_W0 = S4_T_NOSE + S4_WHIP_LAG_FR / FPS
S4_T_W1 = S4_T_W0 + 0.45     # the whip: 0.45 s, lagging the car then catching up, easing into a settle
S4_JOLT = dict(yaw_deg=-1.4, pitch_deg=0.9, push_m=0.04, lift_m=0.015, peak_frames=1.3)   # air-push nudge
# low stone wall on the sea side, with an open stretch (a viewpoint: no wall) where the shot-4 camera
# whips onto the sea, so the horizon is not blocked from tyre height
WALL_GAP = (S4_S_CAM - 12.0, S4_S_CAM + 130.0)
_wall_prof = [(WALL_IN, 0.0), (WALL_IN, WALL_H), (WALL_OUT, WALL_H), (WALL_OUT, 0.0)]
ribbon("Wall", SET, s0, WALL_GAP[0], 0.5, _wall_prof, M["wall"])
ribbon("Wall2", SET, WALL_GAP[1], s1, 0.5, _wall_prof, M["wall"])
ribbon("GapVerge", SET, WALL_GAP[0], WALL_GAP[1], 0.5, [(HALF_W + 0.04, 0.0), (WALL_OUT + 0.02, 0.0)], M["road"])
# the drop from the wall to the sea (rock, textured: it is the near cliff seen from the drone)
ribbon("SeaCliff", SET, s0, s1, 1.0,
       [(WALL_OUT, 0.0), (WALL_OUT + 0.6, -1.5), (6.5, -8.0), (10.0, -20.0), (14.0, -40.0), (18.0, -62.0),
        (22.0, SEA_Z - 0.5)], M["drop"], jitter=rock_jitter(1.4))
# the cliff face the road is cut into (near, textured) and the cliff top above it (far, plain)
CLIFF_PROFILE = [(-HALF_W - 0.1, 0.0), (-3.7, 0.5), (-4.1, 3.0), (-4.7, 7.5), (-5.8, 12.0), (-7.6, 16.0), (-10.0, 18.5)]
ribbon("CliffFace", SET, s0, s1, 1.0, CLIFF_PROFILE, M["cliff"], jitter=rock_jitter(0.5))
ribbon("CliffTop", SET, s0, s1, 1.0,
       [(-10.0, 18.5), (-16.0, 21.0), (-24.0, 24.0)], M["cliff_far"], jitter=rock_jitter(1.2))
# inland hills behind the cliff top (plain, far): big rough cones west of the road
def hill(nm, x, y, r, h, seed):
    rs = random.Random(seed)
    nv = 10
    verts = [(x, y, h)] + [(x + r * rs.uniform(0.8, 1.2) * math.cos(2 * math.pi * i / nv),
                            y + r * rs.uniform(0.8, 1.2) * math.sin(2 * math.pi * i / nv), 0.0) for i in range(nv)]
    faces = [(1 + i, 1 + (i + 1) % nv, 0) for i in range(nv)]
    me = bpy.data.meshes.new(nm)
    me.from_pydata(verts, [], faces)
    me.update()
    me.materials.append(M["cliff_far"])
    link(bpy.data.objects.new(nm, me), SET)
# well clear of the road on its cliff side (base radius up to 1.2 r), so no slope pokes into the sea views
for i, (x, y, r, h) in enumerate(((-200, -60, 120, 45), (-340, 50, 110, 60), (-170, -250, 100, 40),
                                  (-470, -170, 200, 75))):
    hill(f"Hill{i}", x, y, r, h, 31 + i)

# the sea: one big flat plane far below (plain, darker gray)
box("Sea", SET, -12000, 12000, -12000, 12000, SEA_Z - 1.0, SEA_Z, M["sea"], solid=False)   # big: its horizon sits ~0.2 deg below true

# distant headlands along the coast (plain masses, no texture): rough cones rising out of the sea
def headland(nm, x, y, r, h, seed):
    """A low ridged headland stretched along the coast: rings of falling radius with a jittered, sloping crest.
    No flat top (flat-topped masses rendered as slab islands)."""
    rs = random.Random(seed)
    nv, rings = 16, ((0.0, 1.0), (0.35, 0.72), (0.7, 0.42), (0.95, 0.14))   # (height frac, radius frac)
    top = SEA_Z + (h - SEA_Z) * 0.6                                          # 40% lower than before
    verts = []
    for ri, (hf, rf) in enumerate(rings):
        for i in range(nv):
            a = 2 * math.pi * i / nv
            rr = r * rf * rs.uniform(0.75, 1.2)
            ridge = 1.0 - 0.35 * abs(math.cos(a))                             # higher mid-ridge, falling to the ends
            z = SEA_Z - 1.0 if ri == 0 else SEA_Z + (top - SEA_Z) * hf * ridge * rs.uniform(0.85, 1.1)
            verts.append((x + rr * 1.8 * math.cos(a), y + rr * 0.55 * math.sin(a), z))
    faces = [(ri * nv + i, ri * nv + (i + 1) % nv, (ri + 1) * nv + (i + 1) % nv, (ri + 1) * nv + i)
             for ri in range(len(rings) - 1) for i in range(nv)]
    faces.append(tuple((len(rings) - 1) * nv + i for i in range(nv)))
    me = bpy.data.meshes.new(nm)
    me.from_pydata(verts, [], faces)
    me.update()
    me.materials.append(M["far"])
    link(bpy.data.objects.new(nm, me), SET)

# NNE-ENE of the road: seen in the aerial, never in the shot-4 sunset view (which looks north-north-west)
for i, (x, y, r, h) in enumerate(((150, 1100, 220, 20), (500, 800, 200, 25), (850, 450, 200, 0),
                                  (1000, 200, 180, -30))):
    headland(f"Headland{i}", x, y, r, h, 11 + i)

# distant masses and the sea do not cast shadows (long low-sun shadows on the huge sea plane banded)
for o in SET.objects:
    if o.type == "MESH" and (o.name.startswith(("Headland", "Hill", "Sea", "CliffTop"))):
        o.visible_shadow = False

# the sun: low over the sea ahead-right of the straight, the direction the car drives out of the bend
SUN_AZ, SUN_EL = 335.0, 4.0          # degrees: azimuth clockwise from +Y, elevation (just above the horizon)
TO_SUN = Vector((math.sin(math.radians(SUN_AZ)) * math.cos(math.radians(SUN_EL)),
                 math.cos(math.radians(SUN_AZ)) * math.cos(math.radians(SUN_EL)),
                 math.sin(math.radians(SUN_EL)))).normalized()
SUN_DIR = -TO_SUN                   # direction the light travels
sun_data = bpy.data.lights.new("Sun", "SUN")
sun_data.energy = 4.0
sun_data.color = (1.0, 0.72, 0.45)
sun = bpy.data.objects.new("Sun", sun_data)
sun.rotation_euler = SUN_DIR.to_track_quat("-Z", "Y").to_euler()
sun.location = tuple(TO_SUN * 200)
link(sun, SET)
# SUN MARKER: a flat white disc just above the horizon along the sun direction (readable sunset in the greybox)
SUN_MARK_DIST, SUN_MARK_DEG = 8000.0, 2.6            # distance m, angular diameter deg (bigger than the real 0.5)
SUN_MARK_R = SUN_MARK_DIST * math.tan(math.radians(SUN_MARK_DEG / 2))
bpy.ops.mesh.primitive_circle_add(vertices=48, radius=SUN_MARK_R, fill_type="NGON")
SUN_MARK = bpy.context.active_object
SUN_MARK.name = "SunMarker"
_adopt(SUN_MARK, SET, mat("sun_marker", (1.0, 1.0, 1.0, 1)), None, tuple(TO_SUN * SUN_MARK_DIST))
SUN_MARK.rotation_euler = (-TO_SUN).to_track_quat("-Z", "Y").to_euler()   # faces back along the sun ray

world = bpy.data.worlds.new("Sky")
world.color = C["sky"]
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
if bg:
    bg.inputs["Color"].default_value = (*C["sky"], 1)
    bg.inputs["Strength"].default_value = 1.0
sc.world = world

# =============================================================================
# 4. VEHICLE -- 1960s two-seat roadster proxy (cherry red, one colour) + ROSA (monolith) in the left seat
# =============================================================================
# Car-local frame: +Y forward, +X right, Z up, origin on the ground under the car's centre.
#   Car (root: position on the lane + heading)
#     Car_Body (roll pivot at z = BODY_PIVOT; rolls outward in the bend) -> hull, wings, deck, hood,
#               cowl, doors, windscreen frame, bumpers, seats, ROSA
#     Car_Steer_FL/FR (front wheel steer) -> Car_Spin_* (roll about local X) -> tyre, hub disc, spokes
#     Car_Spin_RL/RR (rear) -> tyre, hub disc, spokes
VEH = new_collection("CAR")
MC = {k: mat(k) for k in ("car", "tyre", "hub", "spoke", "chrome", "interior", "seat", "grille")}
BODY_PIVOT = 0.40
WHEEL_R, WHEEL_W = 0.31, 0.17
AXLE_F, AXLE_R = 1.15, -1.15          # 2.3 m wheelbase
TRACK_X = 0.64                        # wheel centre x
CAR_L, CAR_W = 3.90, 1.56

CAR_ROOT = empty("Car", VEH, size=0.6, kind="ARROWS")
CAR_ROOT.rotation_mode = "XYZ"
CAR_BODY = empty("Car_Body", VEH, (0, 0, BODY_PIVOT), CAR_ROOT, size=0.4)
CAR_BODY.rotation_mode = "XYZ"

def car_box(name, x0, x1, y0, y1, z0, z1, material, bevel=0.04, parent=None, pivot_z=BODY_PIVOT):
    """Beveled box given in car-local metres, parented to the body (coords shifted by the pivot)."""
    z0 -= pivot_z; z1 -= pivot_z
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
         (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(v, [], f)
    me.update()
    me.materials.append(material)
    ob = link(bpy.data.objects.new(name, me), VEH)
    ob.parent = parent or CAR_BODY
    if bevel:
        md = ob.modifiers.new("Bevel", "BEVEL")
        md.width = bevel
        md.segments = 3
        md.limit_method = "NONE"
    return ob

def arch_mesh(name, x0, x1, r_in, r_out, segs=18):
    """Wheel arch / wing: a thick half-ring over the wheel (angle 0 = front, pi = back), extruded x0..x1."""
    verts, faces = [], []
    for k in range(segs + 1):
        a = math.pi * k / segs
        cy, cz = math.cos(a), math.sin(a)
        for x in (x0, x1):
            verts.append((x, r_out * cy, r_out * cz))
        for x in (x0, x1):
            verts.append((x, r_in * cy, r_in * cz))
    for k in range(segs):
        a, b = 4 * k, 4 * (k + 1)
        faces += [(a, a + 1, b + 1, b),            # outer surface
                  (a + 2, b + 2, b + 3, a + 3),    # inner surface
                  (a, b, b + 2, a + 2),            # x0 side
                  (a + 1, a + 3, b + 3, b + 1)]    # x1 side
    faces += [(0, 2, 3, 1), (4 * segs, 4 * segs + 1, 4 * segs + 3, 4 * segs + 2)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    return me

# --- body (all cherry red except trim) ---
Z_SILL, Z_BELT = 0.22, 0.72
car_box("Car_HullFront", -0.54, 0.54, 0.55, 1.95, Z_SILL, 0.64, MC["car"], 0.06)       # under the hood
car_box("Car_HullRear", -0.54, 0.54, -1.95, -0.70, Z_SILL, 0.64, MC["car"], 0.06)      # under the deck
car_box("Car_HullFloor", -0.54, 0.54, -0.72, 0.58, Z_SILL, 0.36, MC["car"], 0.02)      # cabin tub floor
CAR_HOOD = car_box("Car_Hood", -0.53, 0.53, 0.52, 1.90, 0.60, 0.70, MC["car"], 0.05)
car_box("Car_HoodBulge", -0.22, 0.22, 0.70, 1.75, 0.66, 0.74, MC["car"], 0.04)
car_box("Car_Cowl", -0.60, 0.60, 0.38, 0.62, 0.36, 0.76, MC["car"], 0.04)               # scuttle in front of the cabin
car_box("Car_Deck", -0.60, 0.60, -1.92, -0.66, 0.60, 0.75, MC["car"], 0.06)            # rear deck
for sx, tag in ((-1, "L"), (1, "R")):
    x_in, x_out = sorted((sx * 0.52, sx * 0.78))
    car_box(f"Car_Door_{tag}", x_in, x_out, -0.72, 0.72, Z_SILL, Z_BELT, MC["car"], 0.04)
    car_box(f"Car_Nose_{tag}", *sorted((sx * 0.52, sx * 0.74)), 1.56, 1.95, 0.26, 0.62, MC["car"], 0.06)
    car_box(f"Car_Tail_{tag}", *sorted((sx * 0.52, sx * 0.76)), -1.95, -1.56, 0.26, 0.66, MC["car"], 0.06)
    for axle, wtag in ((AXLE_F, "F"), (AXLE_R, "R")):
        me = arch_mesh(f"Car_Wing_{wtag}{tag}", *sorted((sx * 0.50, sx * 0.80)), WHEEL_R + 0.05, WHEEL_R + 0.13)
        me.materials.append(MC["car"])
        ob = link(bpy.data.objects.new(f"Car_Wing_{wtag}{tag}", me), VEH)
        ob.parent = CAR_BODY
        ob.location = (0, axle, WHEEL_R - BODY_PIVOT)
# trim: grille, bumpers (chrome), seats and cabin (dark gray), windscreen frame (chrome)
car_box("Car_Grille", -0.26, 0.26, 1.93, 1.99, 0.32, 0.56, MC["grille"], 0.02)
car_box("Car_BumperF", -0.74, 0.74, 1.97, 2.05, 0.27, 0.34, MC["chrome"], 0.02)
car_box("Car_BumperR", -0.74, 0.74, -2.05, -1.97, 0.30, 0.37, MC["chrome"], 0.02)
car_box("Car_Cabin", -0.50, 0.50, -0.70, 0.40, 0.36, 0.40, MC["interior"], 0.0)
for sx, tag in ((-1, "L"), (1, "R")):
    cx = sx * 0.28
    car_box(f"Car_SeatCushion_{tag}", cx - 0.22, cx + 0.22, -0.55, -0.05, 0.40, 0.50, MC["seat"], 0.03)
    car_box(f"Car_SeatBack_{tag}", cx - 0.22, cx + 0.22, -0.66, -0.52, 0.45, 0.98, MC["seat"], 0.03)
car_box("Car_SteeringWheel", -0.44, -0.12, 0.26, 0.30, 0.70, 0.90, MC["interior"], 0.02)
# windscreen frame: two raked posts and a top rail (no glass: an open frame reads through the model)
WS_Y, WS_Z0, WS_H, WS_RAKE = 0.50, 0.74, 0.32, math.radians(25)
for sx, tag in ((-1, "L"), (1, "R")):
    post = cylinder(f"Car_WSPost_{tag}", VEH, 0.018, WS_H / math.cos(WS_RAKE),
                    (sx * 0.60, WS_Y - 0.5 * WS_H * math.tan(WS_RAKE), WS_Z0 + WS_H / 2 - BODY_PIVOT),
                    MC["chrome"], CAR_BODY, verts=8, rot=(WS_RAKE, 0, 0))
cylinder("Car_WSTop", VEH, 0.018, 1.22, (0, WS_Y - WS_H * math.tan(WS_RAKE), WS_Z0 + WS_H - BODY_PIVOT),
         MC["chrome"], CAR_BODY, verts=8, rot=(0, math.radians(90), 0))
cylinder("Car_WSBase", VEH, 0.014, 1.22, (0, WS_Y, WS_Z0 + 0.01 - BODY_PIVOT), MC["chrome"], CAR_BODY,
         verts=8, rot=(0, math.radians(90), 0))

# --- wheels: dark tyre, lighter hub disc, two mid-gray spoke bars so the roll reads ---
WHEELS = {}
for axle, wtag in ((AXLE_F, "F"), (AXLE_R, "R")):
    for sx, tag in ((-1, "L"), (1, "R")):
        key = wtag + tag
        steer = empty(f"Car_Steer_{key}", VEH, (sx * TRACK_X, axle, WHEEL_R), CAR_ROOT, size=0.2)
        steer.rotation_mode = "XYZ"
        spin = empty(f"Car_Spin_{key}", VEH, (0, 0, 0), steer, size=0.2)
        spin.rotation_mode = "XYZ"
        tyre = cylinder(f"Car_Tyre_{key}", VEH, WHEEL_R, WHEEL_W, (0, 0, 0), MC["tyre"], spin, verts=28,
                        rot=(0, math.radians(90), 0))
        hub_x = sx * (WHEEL_W / 2 + 0.004)
        cylinder(f"Car_Hub_{key}", VEH, 0.19, 0.01, (hub_x, 0, 0), MC["hub"], spin, verts=24,
                 rot=(0, math.radians(90), 0))
        for i in range(2):
            bar = cube(f"Car_Spoke_{key}{i}", VEH, (hub_x + sx * 0.007, 0, 0), (0.006, 0.36, 0.035), MC["spoke"], spin)
            bar.rotation_euler = (math.radians(90 * i), 0, 0)
        WHEELS[key] = dict(steer=steer, spin=spin, tyre=tyre)

# --- ROSA: the orientation-coded monolith cut to a seated torso in the LEFT seat ---
# front CYAN (the car is red, so the facing colour must differ), back black, sides + top green.
def monolith_mesh(name, w, d, z0, z1):
    """Upright box. Material index: 0 = front (+Y) CYAN, 1 = back (-Y) BLACK, 2 = sides + top GREEN, 3 = bottom."""
    x, y = w / 2, d / 2
    v = [(-x, -y, z0), (x, -y, z0), (x, y, z0), (-x, y, z0),
         (-x, -y, z1), (x, -y, z1), (x, y, z1), (-x, y, z1)]
    faces = [((3, 2, 6, 7), 0), ((0, 4, 5, 1), 1), ((1, 5, 6, 2), 2), ((0, 3, 7, 4), 2),
             ((4, 7, 6, 5), 2), ((0, 1, 2, 3), 3)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(v, [], [f for f, _ in faces])
    me.update()
    for poly, (_, mi) in zip(me.polygons, faces):
        poly.material_index = mi
    return me

MONO_FRONT_RGBA = (0.0, 0.62, 0.80, 1)
ROSA_SEAT = Vector((-0.28, -0.30, 0.48))       # car-local: left seat, on the cushion
ROSA_H = 0.88                                   # seat -> top of the head (the top stands for the head)
me = monolith_mesh("Rosa_Monolith", 0.40, 0.26, 0.0, ROSA_H)
for key, rgba in (("mono_front_cyan", MONO_FRONT_RGBA), ("mono_back", (0.005, 0.005, 0.005, 1)),
                  ("mono_side", (0.02, 0.70, 0.04, 1)), ("mono_bottom", (0.30, 0.30, 0.30, 1))):
    me.materials.append(mat(key, rgba))
ROSA = link(bpy.data.objects.new("Rosa_Monolith", me), VEH)
ROSA.parent = CAR_BODY
ROSA.location = (ROSA_SEAT.x, ROSA_SEAT.y, ROSA_SEAT.z - BODY_PIVOT)
ROSA.rotation_mode = "XYZ"

# contact shadow: a flat dark patch under the car (Workbench shadows are off, see RENDER)
_cs = car_box("Car_ContactShadow", -0.86, 0.86, -2.15, 2.15, 0.004, 0.006, mat("contact", (0.10, 0.10, 0.11, 1)),
              0.0, parent=CAR_ROOT, pivot_z=0.0)
CAR_MESHES = [o for o in VEH.objects if o.type == "MESH" and o is not ROSA and o.name != "Car_ContactShadow"]
CAR_BODY_MESHES = [o for o in CAR_MESHES if o.parent is CAR_BODY]
HERO_MESHES = CAR_MESHES + [ROSA]

# =============================================================================
# 5. ANIMATION -- the drive, pure functions of time, baked one key per frame
# =============================================================================
R = math.radians

def ft(f):
    return (f - 1) / FPS

def rosa_turn(t):
    """Degrees ROSA turns her front toward the bend (to her left, toward the lens): during shot 3 (5.0-7.5 s)."""
    return 22.0 * seg(t, 5.55, 6.25) - 8.0 * seg(t, 7.0, 7.45)

POS = {"car": {}, "rosa": {}, "wheelFL": {}}
CAR_MW, BODY_MW, SPEED, PSI, ROLL, STEER = {}, {}, {}, {}, {}, {}

def bake_car():
    roll_s = steer_s = 0.0
    a_roll = 1.0 - math.exp(-1.0 / (0.25 * FPS))       # 0.25 s lag: the body settles into the roll
    a_steer = 1.0 - math.exp(-1.0 / (0.10 * FPS))
    for f in range(FRAME_START, FRAME_END + 1):
        t = ft(f)
        d = dist_at(t)
        p, psi = lane_at(d)
        _, psi2 = lane_at(d + 0.5)
        _, psi1 = lane_at(d - 0.5)
        kappa = (psi2 - psi1) / 1.0                      # 1/m, positive = turning right
        v = v_of_t(t)
        roll_goal = -0.6 * v * v * kappa                  # degrees; body rolls outward (to the right in the left-hand bend)
        steer_goal = -math.degrees(math.atan(2.3 * kappa))
        roll_s += (roll_goal - roll_s) * a_roll
        steer_s += (steer_goal - steer_s) * a_steer
        CAR_ROOT.location = p
        CAR_ROOT.rotation_euler = (0, 0, -psi)
        CAR_BODY.rotation_euler = (0, R(roll_s), 0)
        spin = -d / WHEEL_R
        for key, w in WHEELS.items():
            w["spin"].rotation_euler = (spin, 0, 0)
            w["steer"].rotation_euler = (0, 0, R(steer_s) if key[0] == "F" else 0.0)
            w["spin"].keyframe_insert("rotation_euler", frame=f)
            w["steer"].keyframe_insert("rotation_euler", frame=f)
        ROSA.rotation_euler = (0, 0, R(TURN * -rosa_turn(t)))
        for ob in (CAR_ROOT, CAR_BODY, ROSA):
            ob.keyframe_insert("rotation_euler", frame=f)
        CAR_ROOT.keyframe_insert("location", frame=f)
        SPEED[f], PSI[f], ROLL[f], STEER[f] = v, psi, roll_s, steer_s
    for f in range(FRAME_START, FRAME_END + 1):
        sc.frame_set(f)
        CAR_MW[f] = CAR_ROOT.matrix_world.copy()
        BODY_MW[f] = CAR_BODY.matrix_world.copy()
        POS["car"][f] = CAR_ROOT.matrix_world @ Vector((0, 0, 0.55))
        POS["rosa"][f] = ROSA.matrix_world @ Vector((0, 0, 0.6))
        POS["wheelFL"][f] = WHEELS["FL"]["spin"].matrix_world.translation.copy()

def bbox_center(ob):
    local = sum((Vector(c) for c in ob.bound_box), Vector((0.0, 0.0, 0.0))) / 8
    return ob.matrix_world @ local

def car_local(f, v):
    """Car-local point (on the root, no roll) -> world at frame f."""
    return CAR_MW[f] @ Vector(v)

def body_local(f, v):
    """Car-local point carried by the rolling body (camera rigs mounted on the body) -> world."""
    v = Vector(v)
    return BODY_MW[f] @ Vector((v.x, v.y, v.z - BODY_PIVOT))

# =============================================================================
# 6. CAMERAS -- one per shot; aim baked into rotation so handheld noise can sit on it
# =============================================================================
CAMS = new_collection("CAMERAS")

def eo(t, t0, t1):
    """Ease-OUT ramp: slams in fast, settles into a hold."""
    u = clamp01((t - t0) / (t1 - t0))
    return 1 - (1 - u) ** 3

def ei(t, t0, t1):
    """Ease-IN ramp: starts slow, accelerates (into a cut or a snap)."""
    u = clamp01((t - t0) / (t1 - t0))
    return u ** 3

def aim_dir(yaw, pitch):
    """yaw = atan2(dx, dy) (azimuth, clockwise from +Y), pitch up in radians."""
    return Vector((math.sin(yaw) * math.cos(pitch), math.cos(yaw) * math.cos(pitch), math.sin(pitch)))

S4_CAM0 = S4_CAM1 = S4_CORNER = None     # set after baking (setup_derived_cameras)
S4_YAW_END = S4_PITCH_END = None

def cam_state(n, f):
    """(camera location, raw aim target, lens mm) for shot n at frame f (world space)."""
    t = t_in(f, n)
    if n == 1:
        # DRONE behind-left and high over the cliff edge, 24 mm: slow push (closes 24 -> 17 m, sinks 14 -> 9.5 m),
        # easing in and accelerating into the cut; aims ahead of the car so the road curves away ahead
        # and the sea fills the right of frame.
        u = 0.55 * seg(t, 0.0, 3.0) + 0.45 * ei(t, 1.2, 3.0)
        off = vlerp((-5.5, -19.0, 14.0), (-4.5, -13.5, 9.5), u)
        cam = car_local(f, off)
        tgt = car_local(f, vlerp((3.0, 19.0, -0.8), (2.0, 12.0, -0.8), u))
        return cam, tgt, lerp(24.0, 25.5, ei(t, 1.5, 3.0))
    if n == 2:
        # Low tracking vehicle alongside the LEFT front wheel, lens 30 cm off the wing at 30 cm height,
        # 35 mm looking forward past the wheel: wheel + wing big in the right third, the cliff streaking
        # past on the left, the wall across the road, the road running to the bend. The rig creeps forward along the car, then
        # accelerates toward the wheel into the cut; the lens creeps 35 -> 38 mm.
        y = lerp(-0.25, -0.05, 0.4 * seg(t, 0.0, 1.3) + 0.6 * ei(t, 1.3, 2.0))
        cam = car_local(f, (-1.08, y, 0.30))
        tgt = car_local(f, (-0.95, 4.2, 0.42))
        return cam, tgt, lerp(35.0, 38.0, seg(t, 0.3, 1.6))
    if n == 3:
        # Side-mounted on the car's left (driver's) side on an arm, on the body so it rolls with it, 50 mm:
        # ROSA in profile in the right third, facing screen-left, the wall and the sea behind her.
        cam = body_local(f, (-2.40, -0.22, 1.16))
        tgt = body_local(f, (ROSA_SEAT.x, ROSA_SEAT.y + 0.30, 1.07))
        return cam, tgt, lerp(50.0, 53.0, ei(t, 1.5, 2.45))       # creep in after her grin
    if n == 4:
        # Roadside ahead of the bend, cliff-side shoulder, looking back into the corner: starts ~3 m up and
        # SLOWLY pushes in while descending to tyre height (pedestal down + dolly in, eased in, done as the
        # car arrives); 28 mm creeping to 29 mm; the aim follows the car with a lag. As the car passes close
        # on screen-left the camera WHIPS left after it (0.45 s, fast then easing into a small overshoot and
        # settle) onto the sunset over the open sea, then holds with a gentle settle.
        e = seg(t, 0.0, S4_T_PASS) * 0.35 + ei(t, 0.0, S4_T_PASS) * 0.65          # ease-in pedestal + dolly
        cam = S4_CAM0.lerp(S4_CAM1, e)
        # AIR-PUSH JOLT as the nose passes: a quick nudge away from the car (peak ~1 frame, gone in ~5)
        tau = (t - S4_T_NOSE) * FPS / S4_JOLT["peak_frames"]
        jolt = tau * math.exp(1.0 - tau) if tau > 0 else 0.0
        psi4 = PSI[f]
        cam = cam - right_of(psi4) * (S4_JOLT["push_m"] * jolt) + Vector((0, 0, S4_JOLT["lift_m"] * jolt))
        fol = S4_FOLLOW[f] - cam
        yaw_f = math.atan2(fol.x, fol.y)
        pitch_f = math.atan2(fol.z, math.hypot(fol.x, fol.y))
        x = clamp01((t - S4_T_W0) / (S4_T_W1 - S4_T_W0))
        xw = x ** S4_WARP
        c1 = 0.6
        u = 1 + (c1 + 1) * (xw - 1) ** 3 + c1 * (xw - 1) ** 2 if x > 0 else 0.0   # ease-out-back: small overshoot
        yaw = lerp(yaw_f, S4_YAW_END, u) + R(-0.6) * seg(t, S4_T_W1, 2.5)      # gentle settle in the hold
        pitch = lerp(pitch_f, S4_PITCH_END, min(u, 1.0))
        yaw += R(S4_JOLT["yaw_deg"]) * jolt
        pitch += R(S4_JOLT["pitch_deg"]) * jolt
        lens = lerp(28.0, 29.0, seg(t, 0.0, S4_T_PASS - 0.5))
        lens = lerp(lens, 24.0, seg(t, S4_T_PASS - 0.5, S4_T_PASS))   # opens up as the descent ends
        return cam, cam + aim_dir(yaw, pitch) * 20.0, lens

S4_FOLLOW = {}
def setup_derived_cameras():
    """Shot 4: start / end camera spots, the lagging follow point on the car, the sunset aim."""
    global S4_CAM0, S4_CAM1, S4_CORNER, S4_YAW_END, S4_PITCH_END
    S4_CAM1 = road_point(S4_S_CAM, S4_OFF1, S4_Z1)                  # tyre height, abeam of the passing car
    S4_CAM0 = road_point(S4_S_CAM + S4_DOLLY, S4_OFF0, S4_Z0)       # 3 m up, further up the road
    S4_CORNER = road_point(BEND_S + 0.55 * ARC_L, LANE, 0.7)
    s4 = shot(4)
    a = 1.0 - math.exp(-1.0 / S4_FOLLOW_TAU)
    lag = None
    for f in range(s4["start"], s4["end"] + 1):
        goal = S4_CORNER.lerp(POS["car"][f], 0.90)
        lag = goal.copy() if lag is None else lag + (goal - lag) * a
        S4_FOLLOW[f] = lag.copy()
    S4_YAW_END = math.radians(SUN_AZ - 360.0 + S4_SUN_LEFT)           # sun sits S4_SUN_LEFT deg left of centre
    S4_PITCH_END = math.radians(S4_PITCH_END_DEG)

S4_OFF0, S4_Z0 = -2.4, 3.0     # start: cliff-side shoulder, ~3 m above the road
S4_OFF1, S4_Z1 = -0.10, 0.35   # end: tyre height, 0.7 m off the car's left wing (at +0.60) as it passes
S4_FOLLOW_TAU = float(os.environ.get("PREVIS_S4_TAU", "3.0"))   # follow lag (frames) before the whip
S4_WARP = float(os.environ.get("PREVIS_S4_WARP", "1.7"))   # whip time-warp: >1 = slow start (lags, then catches up)
S4_DOLLY = 5.0                 # dolly-in distance along the road toward the approaching car (m)
S4_SUN_LEFT = -14.0            # final framing: the sun 14 deg right of centre (the car heads away on the left)
S4_PITCH_END_DEG = 4.5         # final tilt up: horizon in the lower ~40 % of the frame

SWAY_FRAMES = 110.0     # noise feature size for the body sway (~4.6 s)
TREMOR_FRAMES = 7.0     # tiny tremor (~3 Hz features, sub-degree amplitude)

# per shot: (lag time constant in frames, lead ahead of the car in m, vertical offset m, lag space)
# "car": the aim lags in the car's own frame (mounted / chasing rigs); "world": a real pan lag.
FOLLOW = {1: (6.0, 0.0, 0.0, "car"), 2: (3.0, 0.0, 0.0, "car"), 3: (5.0, 0.0, 0.0, "car"),
          4: (0.0, 0.0, 0.0, "world")}

def build_cameras():
    cams = {}
    for s in SHOTS:
        n = s["n"]
        cd = bpy.data.cameras.new(f"Cam{n}")
        cd.sensor_width = 36.0
        cd.sensor_fit = "HORIZONTAL"
        # near planes as far out as each shot allows: the depth range (sea to 12 km) needs the precision
        cd.clip_start = {1: 1.0, 2: 0.1, 3: 0.3, 4: 0.2}[n]
        cd.clip_end = 15000.0
        cam = bpy.data.objects.new(f"Cam{n}", cd)
        cam.rotation_mode = "XYZ"
        link(cam, CAMS)
        tgt = empty(f"Cam{n}_Target", CAMS, size=0.15, kind="SPHERE")
        cams[n] = (cam, tgt)
        prev = None
        frames = list(range(max(FRAME_START, s["start"] - 1), min(FRAME_END, s["end"] + 1) + 1))
        tau, lead_m, dz, space = FOLLOW[n]
        a = 1.0 if tau <= 0 else 1.0 - math.exp(-1.0 / tau)       # tau 0: the shot computes its own lag
        lagged = []
        raw = []
        for i, f in enumerate(frames):
            ff = min(max(f, s["start"]), s["end"])
            c, g, lens = cam_state(n, ff)
            raw.append((c, lens))
            # OFFSET TARGET: the aim point drifts and breathes slowly (periods 3.9-5.3 s) and trails the
            # raw aim with an exponential lag, so the car drifts in frame instead of being pinned.
            tt = (ff - 1) / FPS
            br = s["hand"][3]
            breathe = Vector((br * math.sin(2 * math.pi * tt / 4.7 + n), br * math.sin(2 * math.pi * tt / 5.3 + 2 * n),
                              0.6 * br * math.sin(2 * math.pi * tt / 3.9 + 3 * n)))
            v = POS["car"][min(ff + 1, s["end"])] - POS["car"][max(ff - 1, s["start"])]
            v.z = 0.0
            lead = v.normalized() * lead_m if v.length > 1e-4 else Vector()
            goal = g + lead + Vector((0, 0, dz)) + breathe
            Mf = CAR_MW[ff] if space == "car" else Matrix.Identity(4)
            goal_rel = Mf.inverted() @ goal
            if i == 0 or f <= s["start"]:
                lagged.append(goal_rel.copy())
            else:
                lagged.append(lagged[-1] + (goal_rel - lagged[-1]) * a)
            raw[-1] = (c, lens, Mf @ lagged[-1])
        for f, (c, lens, g) in zip(frames, raw):
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
        # HANDHELD = slow body sway (noise with ~5 s features) + a tiny tremor; no fast jitter.
        # Restricted to the shot's own frames with no blend-in/out (clean cuts).
        sway_r, sway_l, trem, _ = s["hand"]
        add_noise(cam, "rotation_euler", sway_r, SWAY_FRAMES, 3.1 * n, s["start"], s["end"])
        add_noise(cam, "location", sway_l, SWAY_FRAMES * 1.2, 11.7 * n, s["start"], s["end"])
        add_noise(cam, "rotation_euler", trem, TREMOR_FRAMES, 5.3 * n, s["start"], s["end"])
    return cams

# ---- bake everything --------------------------------------------------------
bake_car()
setup_derived_cameras()
CAMS_BY_SHOT = build_cameras()
sc.camera = CAMS_BY_SHOT[1][0]

# ---- camera sanity checks ----------------------------------------------------
WARNINGS = []

GROUPS = {
    "CAR": CAR_MESHES,
    "ROSA": [ROSA],
    "WHEEL": [WHEELS["FL"]["tyre"]],
    "HERO": HERO_MESHES,
    "SUN": [SUN_MARK],
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
    if x1 - x0 < 0.005 or y1 - y0 < 0.005:
        return None, whole
    return (round(x0, 3), round(x1, 3), round(y0, 3), round(y1, 3)), whole

# per shot: subject group at first / mid / last
FRAME_SPEC = {1: ("CAR", "CAR", "CAR"), 2: ("WHEEL", "WHEEL", "WHEEL"), 3: ("ROSA", "ROSA", "ROSA"),
              4: ("CAR", "CAR", "SUN")}       # shot 4 ends on the sunset: the sun marker must be in frame
MIN_W = {1: 0.06}                     # "car too small": the car must span >= 6 % of the frame width in shot 1
MIN_H = {2: 0.40, 3: 0.55}            # wheel / ROSA height fraction at every sample

FRAMING = {}
for s in SHOTS:
    n = s["n"]
    cam = CAMS_BY_SHOT[n][0]
    mid = (s["start"] + s["end"]) // 2
    FRAMING[n] = {}
    for (label, f), sub in zip((("first", s["start"]), ("mid", mid), ("last", s["end"])), FRAME_SPEC[n]):
        sc.frame_set(f)
        bx, full = group_box(cam, sub)
        hf = round(bx[3] - bx[2], 3) if bx else 0.0
        wf = round(bx[1] - bx[0], 3) if bx else 0.0
        cx = round((bx[0] + bx[1]) / 2, 3) if bx else None
        FRAMING[n][label] = dict(subject=sub, box_x0x1y0y1=bx, width_frac=wf, height_frac=hf,
                                 centre_x=cx, whole_in_frame=full)
        if bx is None:
            WARNINGS.append(f"Cam{n} {label} (f{f}): {sub} out of frame")
        if n in MIN_W and wf < MIN_W[n]:
            WARNINGS.append(f"Cam{n} {label} (f{f}): {sub} only {wf:.3f} of frame width (< {MIN_W[n]})")
        if n in MIN_H and hf < MIN_H[n]:
            WARNINGS.append(f"Cam{n} {label} (f{f}): {sub} only {hf:.2f} of frame height (< {MIN_H[n]})")

# collisions and the action axis
for s in SHOTS:
    n = s["n"]
    cam = CAMS_BY_SHOT[n][0]
    for f in range(s["start"], s["end"] + 1):
        sc.frame_set(f)
        p = cam.matrix_world.translation.copy()
        rs_, off, _ = road_coords(p)
        if -HALF_W <= off <= WALL_IN and p.z < 0.12:
            WARNINGS.append(f"Cam{n} f{f}: below the road surface (z {p.z:.2f})")
        if WALL_IN - 0.03 <= off <= WALL_OUT + 0.03 and p.z < WALL_H + 0.03:
            WARNINGS.append(f"Cam{n} f{f}: inside the stone wall")
        if off < -HALF_W:
            h_cliff = float(np.interp(-off + 0.8, [-o for o, _ in CLIFF_PROFILE], [z for _, z in CLIFF_PROFILE]))
            if p.z < h_cliff + 1.0:          # 0.8 m lateral jitter margin + 1 m clearance
                WARNINGS.append(f"Cam{n} f{f}: inside / too close to the cliff face (offset {off:.1f}, z {p.z:.1f}, rock {h_cliff:.1f})")
        dmin = min((p - bbox_center(o)).length for o in CAR_BODY_MESHES + [ROSA])
        if dmin < 0.25:
            WARNINGS.append(f"Cam{n} f{f}: only {dmin:.2f} m from car geometry")
        # ACTION AXIS: every camera stays on the car's LEFT (cliff side), where the car travels screen
        # right -> left: shot 1 behind-left (bible), 2 and 3 on the driver's side, 4 on the left shoulder.
        car_p, psi = POS["car"][f], PSI[f]
        side = (p - car_p).dot(right_of(psi))
        if side > -0.2:
            WARNINGS.append(f"Cam{n} f{f}: crossed the action axis (camera {side:.2f} m right of the car)")

# HERO-IN-FRAME: every frame of every shot must show the car or the driver (fails the build)
def part_visible(cam, o):
    pts = [world_to_camera_view(sc, cam, o.matrix_world @ Vector(c)) for c in o.bound_box]
    front = [p for p in pts if p.z > 0]
    if not front:
        return False
    x0, x1 = max(0, min(p.x for p in front)), min(1, max(p.x for p in front))
    y0, y1 = max(0, min(p.y for p in front)), min(1, max(p.y for p in front))
    return x1 - x0 > 0.003 and y1 - y0 > 0.003

# OCCLUSION (warning): cast rays from the lens to points on the car; all blocked by the set = hidden
DEPS = bpy.context.evaluated_depsgraph_get()
HERO_NAMES = {o.name for o in HERO_MESHES}
PROBES = [(0, 1.3, 0.72), (0, -1.3, 0.76), (ROSA_SEAT.x, ROSA_SEAT.y, 1.25), (0.7, 1.15, 0.5), (-0.7, -1.15, 0.5)]
def hero_occluded(cam, f):
    p = cam.matrix_world.translation
    seen = tested = 0
    for pr in PROBES:
        q = body_local(f, pr)
        co = world_to_camera_view(sc, cam, q)
        if not (co.z > 0 and 0 <= co.x <= 1 and 0 <= co.y <= 1):
            continue
        tested += 1
        d = q - p
        hit, loc, nor, idx, ob, mw = sc.ray_cast(DEPS, p, d.normalized(), distance=d.length + 0.5)
        if not hit or ob.name in HERO_NAMES or (loc - p).length >= d.length - 0.3:
            seen += 1
    return tested > 0 and seen == 0

EMPTY, OCCLUDED, EXEMPT = [], [], []
S4_HOLD_FRAMES = [f for f in range(shot(4)["start"], shot(4)["end"] + 1) if t_in(f, 4) > S4_T_W1]
CAM_SWITCH_ERR = []
for s in SHOTS:
    cam = CAMS_BY_SHOT[s["n"]][0]
    for f in range(s["start"], s["end"] + 1):
        sc.frame_set(f)
        if sc.camera != cam:
            CAM_SWITCH_ERR.append(f"f{f}: active camera {sc.camera.name if sc.camera else None} != {cam.name}")
        if not any(part_visible(cam, o) for o in HERO_MESHES):
            if s["n"] == 4 and t_in(f, 4) > S4_T_W1:
                EXEMPT.append(f)           # the sunset hold after the whip may lose the car
            else:
                EMPTY.append(f)
        elif hero_occluded(cam, f):
            OCCLUDED.append(f)
print(f"[check] hero-in-frame: {len(EMPTY)} empty frames" + (f" -> {EMPTY}" if EMPTY else " (every frame shows the car or the driver)"))
print(f"[check] hero-in-frame exemption: shot-4 sunset hold f{S4_HOLD_FRAMES[0]}-f{S4_HOLD_FRAMES[-1]} "
      f"(after the whip ends at {S4_T0 + S4_T_W1:.2f} s); car actually absent on {len(EXEMPT)} of them"
      + (f": f{EXEMPT[0]}-f{EXEMPT[-1]}" if EXEMPT else ""))
if OCCLUDED:
    WARNINGS.append(f"car in frame but every probe ray blocked by the set on frames {OCCLUDED}")

# SHOT-4 PASS: how much of the frame the car covers around the drive-by (a 32 x 18 ray grid per frame).
# "widest" = frames at >= 60 % of the peak coverage (target 5-8: a punch, not a wall of red);
# "filled" = >= 95 % of the frame is car (at most 2 frames allowed, fails the build otherwise).
def car_coverage(cam, f, nx=32, ny=18):
    sc.frame_set(f)
    mw = cam.matrix_world
    o = mw.translation
    fr = cam.data.view_frame(scene=sc)            # camera-local corners: tr, br, bl, tl
    tr, br, bl, tl = fr
    hits = 0
    for j in range(ny):
        v = (j + 0.5) / ny
        for i in range(nx):
            u = (i + 0.5) / nx
            pl = bl.lerp(br, u).lerp(tl.lerp(tr, u), v)
            d = (mw.to_3x3() @ pl).normalized()
            hit, loc, nor, idx, ob, _ = sc.ray_cast(DEPS, o, d, distance=200.0)
            if hit and ob.name in HERO_NAMES:
                hits += 1
    return hits / (nx * ny)
_s4 = shot(4)
_f_nose = _s4["start"] + S4_T_NOSE * FPS
PASS_COVER = {f: round(car_coverage(CAMS_BY_SHOT[4][0], f), 3)
              for f in range(max(_s4["start"], int(_f_nose) - 14), min(_s4["end"], int(_f_nose) + 14) + 1)}
_peak = max(PASS_COVER.values())
WIDEST = [f for f, c in PASS_COVER.items() if c >= 0.6 * _peak]
FILLED = [f for f, c in PASS_COVER.items() if c >= 0.95]
_cams4 = CAMS_BY_SHOT[4][0]
PASS_DIST = []
for f in range(_s4["start"], _s4["end"] + 1):
    sc.frame_set(f)
    p = _cams4.matrix_world.translation
    PASS_DIST.append(min((p - (o.matrix_world @ Vector(c))).length for o in CAR_BODY_MESHES + [ROSA] for c in o.bound_box))
PASS = dict(
    closest_lens_to_car_bbox_m=round(min(PASS_DIST), 2),
    design_clearance_lens_to_left_wing_m=round(LANE - 0.80 - S4_OFF1, 2),
    speed_at_pass_mps=round(v_of_t(S4_T0 + S4_T_PASS), 1), peak_speed_mps=round(max(v_of_t(ft(f)) for f in range(_s4["start"], _s4["end"] + 1)), 1),
    nose_passes_lens_s=round(S4_T0 + S4_T_NOSE, 3), nose_passes_lens_frame=round(_f_nose, 1),
    centre_abeam_s=round(S4_T0 + S4_T_PASS, 2),
    whip_start_s=round(S4_T0 + S4_T_W0, 3), whip_end_s=round(S4_T0 + S4_T_W1, 3), whip_lag_after_nose_frames=S4_WHIP_LAG_FR,
    lens_mm="28 -> 29 creep, then opens to 24 over the last 0.5 s before the pass (8.30-8.80 s)",
    jolt=S4_JOLT,
    coverage_peak=_peak, widest_frames=WIDEST, widest_count=len(WIDEST), filled_frames=FILLED,
    coverage_by_frame=PASS_COVER)
print(f"[check] shot-4 pass: closest {PASS['closest_lens_to_car_bbox_m']} m, {PASS['speed_at_pass_mps']} m/s at the pass "
      f"(peak {PASS['peak_speed_mps']}), nose passes f{_f_nose:.1f}, whip f{_s4['start'] + S4_T_W0 * FPS:.1f}-f{_s4['start'] + S4_T_W1 * FPS:.1f}; "
      f"coverage peak {_peak:.2f}, widest frames {WIDEST} ({len(WIDEST)}), fully filled {FILLED} ({len(FILLED)})")
PASS_ERR = len(FILLED) > 2

# CLEAN CUTS: the active camera switches exactly on the cut frame, and no shot's first/last frame
# carries a blend (its step is not an outlier against the shot's own frame-to-frame motion).
def cam_sample(cam):
    mw = cam.matrix_world
    return mw.translation.copy(), mw.to_quaternion(), cam.data.lens
CUT_ERR = []
CUT_REPORT = []
for s in SHOTS:
    cam = CAMS_BY_SHOT[s["n"]][0]
    smp = []
    for f in range(s["start"], s["end"] + 1):
        sc.frame_set(f)
        smp.append(cam_sample(cam))
    steps = []
    for (p0, q0, l0), (p1, q1, l1) in zip(smp, smp[1:]):
        steps.append(((p1 - p0).length, math.degrees(q0.rotation_difference(q1).angle), abs(l1 - l0)))
    for label, st, nb in (("first", steps[0], steps[1]), ("last", steps[-1], steps[-2])):
        bad = st[0] > 3 * nb[0] + 0.03 or st[1] > 3 * nb[1] + 1.0 or st[2] > 3 * nb[2] + 0.5
        if bad:
            CUT_ERR.append(f"Cam{s['n']} {label} step {tuple(round(v, 3) for v in st)} vs neighbour {tuple(round(v, 3) for v in nb)}")
    CUT_REPORT.append(dict(shot=s["n"], cut_frame=s["start"], first_step=[round(v, 3) for v in steps[0]],
                           last_step=[round(v, 3) for v in steps[-1]],
                           second_step=[round(v, 3) for v in steps[1]], second_last_step=[round(v, 3) for v in steps[-2]]))
for s in SHOTS[1:]:
    sc.frame_set(s["start"] - 1); a_ = sc.camera
    sc.frame_set(s["start"]); b_ = sc.camera
    if a_ == b_:
        CUT_ERR.append(f"cut at f{s['start']}: camera did not switch ({a_.name})")
print(f"[check] clean cuts: {len(CUT_ERR) + len(CAM_SWITCH_ERR)} problems" +
      ("".join("\n   " + e for e in CUT_ERR + CAM_SWITCH_ERR[:10]) if (CUT_ERR or CAM_SWITCH_ERR) else
       " (camera switches on every cut frame; no blend frames at shot ends)"))
if (EMPTY or CUT_ERR or CAM_SWITCH_ERR or PASS_ERR) and os.environ.get("PREVIS_ALLOW_FAIL") != "1":
    raise SystemExit("[check] FAILED: hero-in-frame / clean-cut check (set PREVIS_ALLOW_FAIL=1 to render anyway)")

# drive facts for the log
DRIVE = dict(
    speed_mps={f"{ft(f):.1f}s": round(SPEED[f], 1) for f in range(1, FRAME_END + 1, 12)},
    bend=dict(road_s_start=round(BEND_S, 1), road_s_end=round(BEND_E, 1), radius_m=R_BEND, angle_deg=BEND_DEG,
              car_enters_s=BEND_T,
              car_exits_s=round(next((ft(f) for f in range(1, FRAME_END + 1) if abs(PSI[f]) >= abs(PSI_MAX) - 1e-3), -1), 2)),
    max_body_roll_deg=round(max(ROLL.values(), key=abs), 2), max_steer_deg=round(max(STEER.values(), key=abs), 2),
    roll_sign="positive = body leans right (outward in the left-hand bend)",
    distance_m=round(dist_at(ft(FRAME_END)), 1),
    wheel_roll="spin angle = -distance / 0.31 m (matches the speed, no slip)",
    rosa_turn_deg_max=22.0,
)
for w in WARNINGS[:40]:
    print("WARNING:", w)
print(f"[previs] camera sanity warnings: {len(WARNINGS)}")
print(f"[previs] framing: {json.dumps(FRAMING)}")
print(f"[previs] drive: {json.dumps(DRIVE)}")
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
sh.light = os.environ.get("PREVIS_LIGHT", "FLAT" if PROXY == "monolith" else "STUDIO")   # flat keeps the monolith faces saturated
sh.color_type = "TEXTURE"          # set materials carry gray pattern images; untextured ones show their flat colour
sh.background_type = "WORLD"
# Workbench shadow volumes flickered on the open ribbon meshes (a dark wedge over the sea on random frames),
# so shadows are off by default (PREVIS_SHADOWS=1 turns them on); the car carries a contact-shadow patch.
sh.show_shadows = os.environ.get("PREVIS_SHADOWS") == "1"
sh.shadow_intensity = 0.45
sh.show_cavity = True
sh.cavity_type = "BOTH"
sh.cavity_ridge_factor = 1.0
sh.cavity_valley_factor = 1.2
# Workbench shadow direction: same azimuth as the sun but steeper (PREVIS_SHADOW_EL, default 35 deg): at the
# true 8 deg the cliff threw shadows kilometres across the sea plane and they rendered as banded stripes.
_SEL = math.radians(float(os.environ.get("PREVIS_SHADOW_EL", "35")))
_TO_SUN_WB = Vector((math.sin(math.radians(SUN_AZ)) * math.cos(_SEL), math.cos(math.radians(SUN_AZ)) * math.cos(_SEL),
                     math.sin(_SEL)))
sc.display.light_direction = tuple(_TO_SUN_WB)
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
# PREVIS_DEPTH=disparity (default): near/depth, the near-bright smooth falloff depth estimators (Depth Anything)
# produce and depth-control models are trained on; PREVIS_DEPTH=linear: the old near..far linear ramp.
DEPTH_KIND = os.environ.get("PREVIS_DEPTH", "disparity")
if DEPTH_KIND == "disparity":
    DISP = comp.nodes.new("ShaderNodeMath"); DISP.operation = "DIVIDE"
    comp.links.new(rl.outputs["Depth"], DISP.inputs[1])
    comp.links.new(DISP.outputs[0], DEPTH_MAP.inputs["Value"])
    DEPTH_MAP.inputs["To Min"].default_value = 0.0
    DEPTH_MAP.inputs["To Max"].default_value = 1.0
else:
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
    if DEPTH_KIND == "disparity":
        DISP.inputs[0].default_value = s["near"]
        DEPTH_MAP.inputs["From Min"].default_value = s["near"] / (s["far"] * 4.0)
        DEPTH_MAP.inputs["From Max"].default_value = 1.0
    else:
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
    1: dict(move="Aerial chase: a drone behind-left of the car and high (about 14 m above the road, 20 m back, "
                 "95 m above the sea), 24 mm creeping to 25.5 mm, flying with the car and slowly pushing in and "
                 "sinking (to about 14 m back and 10 m up, easing in and accelerating into the cut) with a lazy float; the small red roadster "
                 "runs along the narrow road cut into the cliff, the cliff face close on the left, the low stone "
                 "wall and the drop on its right, the sea filling the right of frame to the horizon, the road "
                 "curving left ahead round the cliff.",
            beats=["high behind-left: the small red roadster on the cliff road, the sea filling the right of frame",
                   "the drone keeps pace and drifts closer, the road ahead curving left round the cliff",
                   "pushing in on the car as it starts to brake for the bend"]),
    2: dict(move="Tracking alongside the car's left front wheel, lens 30 cm off the red wing at 30 cm height, "
                 "35 mm creeping to 38 mm, looking forward past the wheel: the rolling wheel and the curved red "
                 "wing fill the right third, the road runs ahead with the cliff face streaking past on the left "
                 "and the low stone wall along the far side; slow road-vibration sway plus a tiny tremor, no "
                 "jitter. The rig creeps forward along the car and accelerates toward the wheel into the cut as "
                 "the car brakes and the bend opens ahead.",
            beats=["road level at the left front wheel, the cliff streaking past on the left, the wall across the road",
                   "the car brakes, the bend opening ahead, the rig creeping up to the wheel"]),
    3: dict(move="Side-mounted on the car's left (driver's) side, rolling with the body, 50 mm creeping to "
                 "53 mm: ROSA in profile in the left seat, framed from the door line to above her head in the right "
                 "third, facing screen-left, with the open cabin, the windscreen frame and beyond the stone wall "
                 "the sea behind her; as the car turns into the left-hand bend she turns her face toward the bend "
                 "(toward the lens) and grins; slow sway.",
            beats=["profile of ROSA at the wheel, the stone wall and the sea sliding past behind her",
                   "the car leans into the bend and she turns toward it, toward the lens, grinning",
                   "holding on her grin as the car sweeps round, the lens creeping in"]),
    4: dict(move="Roadside camera ahead of the bend on the cliff-side shoulder, looking back into the corner, "
                 "28 mm creeping to 29 mm, slow sway: it starts about 3 m above the road and slowly pushes in "
                 "while descending to tyre height (0.35 m) as the car sweeps out of the corner toward it (a "
                 "smooth pedestal-down plus dolly-in, eased in, landing at 8.8 s), the lens opening to 24 mm over "
                 "the last half second. The car, accelerating hard out of the bend (18 m/s at the pass, 20 m/s "
                 "by 9.0 s), whooshes past 0.7 m from the lens on screen-left, stretching with perspective and "
                 "crossing the frame in a few frames; the air-push nudges the camera (a 1-2 degree jolt, gone in "
                 "~5 frames) and 2-3 frames after the nose passes the camera whips left after it, lagging then "
                 "catching up (8.79-9.24 s, a small overshoot, easing into a settle) onto the sunset: open sea to the horizon, the low sun (white disc) just above it "
                 "right of centre, the horizon in the lower part of the frame, the car a small shape heading away "
                 "on the left; a gentle settle holds to the end (9.25-10.0 s).",
            beats=["3 m up at the roadside: the car sweeping out of the corner, sea on the left, the camera sinking and pushing in",
                   "tyre height, 24 mm: the car whooshes past 0.7 m from the lens, the camera jolts and whips after it onto the sea",
                   "the sunset: sea to the horizon, the low sun above it, the car small heading away on the left"]),
}
NOTES = [
    "ROSA's monolith front face is CYAN (not the usual red) because the car body is cherry red; back black, "
    "sides and top green as usual. In the prompt: the cyan side is her face/front.",
    "The car is the only saturated object: cherry red body; wheels dark gray with a lighter hub disc and two "
    "mid-gray spoke bars (so the roll reads); chrome-gray bumpers and windscreen frame; dark gray seats and cabin.",
    "Geography: the road runs north with the cliff on the left and the wall + sea on the right, then bends LEFT "
    "(inland round the cliff, 70 deg, 30 m radius) so the sea stays open on the right in every direction; "
    "a right-hand bend was tried first and enclosed the sea into a bay behind the post-bend cliff.",
    "Action axis: every camera is on the car's LEFT (cliff / driver side), where the car travels screen right -> "
    "left: shot 1 the bible's behind-left drone, shot 2 the left front wheel, shot 3 the driver's side, shot 4 "
    "the cliff-side shoulder (the whip turns left, after the car). Consequence: in shot 2 the cliff streaks past close and the stone wall is across "
    "the road (the bible's 'stone wall streaking past' would need a right-side camera, i.e. an axis cross).",
    "Sun: low (4 deg) at azimuth 335 (north-north-west), over the open sea beyond the bend: ahead-left of the "
    "aerial (just above the frame), off-frame camera-left in shot 3, from the sea side throughout; the car "
    "drives out of the bend toward it. A flat white SUN MARKER disc (2.6 deg) sits on that direction 8 km out "
    "and is the landing point of the shot-4 whip.",
    "Shot 4 viewpoint: the stone wall has an open stretch (road s 98-240) so the horizon is not blocked from "
    "tyre height; at 0.35 m the road edge still hides the sea close in, so the sea reads as a band below the "
    "horizon with the road in the foreground.",
    "Distant masses (cliff top, inland hills, far headlands, sea) are untextured; road, wall, cliff face and "
    "the drop carry light gray-on-gray texture (asphalt, stone courses, rock strata).",
]
log = dict(film="COAST ROAD", fps=FPS, resolution=[RES_X, RES_Y],
           units="metres, Z up; road starts along +Y (north), bends LEFT 70 deg; cliff on the left (-X), wall + sea on the right",
           total_frames=FRAME_END, total_s=FRAME_END / FPS, proxy_colours=dict(
               car="cherry red (0.62, 0.012, 0.03 linear)", rosa_front="CYAN " + str(MONO_FRONT_RGBA[:3]),
               rosa_back="black", rosa_sides_top="green"),
           notes=NOTES, drive=DRIVE, shots=[], per_second=[])
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
                   lens_mm=round(cam.data.lens, 1), car_speed_mps=round(SPEED[f], 1),
                   car_heading_deg=round(math.degrees(PSI[f]), 1), body_roll_deg=round(ROLL[f], 2),
                   beat=s["beat"], description=DESCRIPTIONS[n]["beats"][sec])
        samples.append(rec)
        log["per_second"].append(rec)
    log["shots"].append(dict(
        shot=n, name=s["name"], camera_object=cam.name, frame_range=[s["start"], s["end"]],
        start_s=s["t"], duration_s=round((s["end"] - s["start"] + 1) / FPS, 3),
        bible_cut_length_s=s["cut"], bible_camera=s["bible_camera"], beat=s["beat"],
        move=DESCRIPTIONS[n]["move"], depth_range_m=[s["near"], s["far"]],
        handheld=dict(sway_rot_rad=s["hand"][0], sway_loc_m=s["hand"][1], sway_period_frames=SWAY_FRAMES,
                      tremor_rot_rad=s["hand"][2], tremor_frames=TREMOR_FRAMES, target_breathe_m=s["hand"][3]),
        aim_lag=dict(tau_frames=FOLLOW[n][0], space=FOLLOW[n][3]),
        framing=FRAMING[n], per_second=samples))
s4c = CAMS_BY_SHOT[4][0]
def _yaw_at(f):
    sc.frame_set(f)
    d = s4c.matrix_world.to_quaternion() @ Vector((0, 0, -1))
    return round(math.degrees(math.atan2(d.x, d.y)) % 360, 1), round(math.degrees(math.asin(max(-1, min(1, d.z)))), 1)
_f_w0 = shot(4)["start"] + int(round(S4_T_W0 * FPS)); _f_w1 = shot(4)["start"] + int(round(S4_T_W1 * FPS))
log["shot4_pan"] = dict(
    push=dict(start_s=S4_T0, end_s=round(S4_T0 + S4_T_PASS, 2), start_height_m=S4_Z0, end_height_m=S4_Z1,
              dolly_m=S4_DOLLY, ease="ease-in (35 % smoothstep + 65 % cubic), landing at tyre height as the car arrives", lens_mm=[28.0, 29.0]),
    car_abeam_s=round(S4_T0 + S4_T_PASS, 2),
    whip=dict(start_s=round(S4_T0 + S4_T_W0, 2), end_s=round(S4_T0 + S4_T_W1, 2),
              duration_s=round(S4_T_W1 - S4_T_W0, 2), frames=[_f_w0, _f_w1], direction="left, after the car",
              yaw_pitch_deg_at_start=_yaw_at(_f_w0), yaw_pitch_deg_at_end=_yaw_at(_f_w1),
              ease="time-warped x^1.5 into ease-out-back (c1 0.6): fast, small overshoot, settle"),
    hold=dict(start_s=round(S4_T0 + S4_T_W1, 2), end_s=10.0, duration_s=round(2.5 - S4_T_W1, 2),
              frames=[S4_HOLD_FRAMES[0], S4_HOLD_FRAMES[-1]], settle_deg=0.6,
              framing="sun marker right of centre, horizon in the lower ~40 %, open sea, car heading away on the left"),
    wall_gap_road_s=[round(WALL_GAP[0], 1), round(WALL_GAP[1], 1)],
    yaw_pitch_deg_first_last=[_yaw_at(shot(4)["start"]), _yaw_at(shot(4)["end"])])
log["shot4_pass"] = PASS
log["sun_marker"] = dict(object="SunMarker", shape="flat white disc (48-gon), faces the camera side",
                         azimuth_deg=SUN_AZ, elevation_deg=SUN_EL, distance_m=SUN_MARK_DIST,
                         radius_m=round(SUN_MARK_R, 1), angular_diameter_deg=SUN_MARK_DEG,
                         note="light gray-white placeholder for the low sun just above the sea horizon; "
                              "the same azimuth drives the Workbench light direction")
log["camera_warnings"] = WARNINGS
log["checks"] = dict(hero_in_frame_empty_frames=EMPTY, hero_in_frame_exempt_hold_frames=S4_HOLD_FRAMES,
                     hero_absent_in_hold=EXEMPT, occluded_frames=OCCLUDED, clean_cut_errors=CUT_ERR,
                     cut_steps=CUT_REPORT)
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, "camera_log.json"), "w") as fh:
    json.dump(log, fh, indent=2)
# ---- continuity.json (from the reference; forward direction per shot because the road bends) ----
def write_continuity(shots, subjects, cam_for_shot, out_path, fps=FPS, ground_z=lambda x, y: 0.0,
                      forward=Vector((0.0, 1.0, 0.0))):
    # forward may be a vector or a callable shot -> vector (the road turns, so it is per shot here)
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
                mid = dict(cam=cam, cam_pos=cam_pos, subs=subs, lens=cam.data.lens,
                           fwd=cam.matrix_world.to_quaternion() @ Vector((0.0, 0.0, -1.0)))
        cam, cam_pos, subs = mid["cam"], mid["cam_pos"], mid["subs"]
        sc.frame_set(fm)    # FIX vs the reference: subject positions at the MID frame (the car moves ~12 m per shot)
        order = sorted((nm for nm in subs if subs[nm]["in_frame"]), key=lambda nm: subs[nm]["distance_m"])
        by_name = {sub["name"]: sub["ob"] for sub in subjects}
        ground = ground_z(cam_pos.x, cam_pos.y)
        primary = order[0] if order else subjects[0]["name"]
        primary_pos = bbox_center(by_name[primary])
        d = cam_pos - primary_pos
        fwd_s = forward(n) if callable(forward) else forward
        right_s = Vector((fwd_s.y, -fwd_s.x, 0.0))
        a, c = d.dot(fwd_s), d.dot(right_s)
        side = ("ahead" if a > 0 else "behind") if abs(a) >= abs(c) else ("right" if c > 0 else "left")
        cam_forward = mid["fwd"]            # mid-frame values (cam is re-evaluated at the last frame)
        looking = "forward" if cam_forward.dot(fwd_s) >= 0 else "back"
        alongs = {nm: fwd_s.dot(bbox_center(by_name[nm])) for nm in order}
        mean_along = sum(alongs.values()) / len(alongs) if alongs else 0.0
        entry.update(order_front_to_back=order, camera_height_m=round(cam_pos.z - ground, 2),
                     camera_side=side, lens_mm=round(mid["lens"], 1), primary_subject=primary,
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

    text(f"COAST ROAD - previs (car + {PROXY} driver, cyan = her front) - first / mid / last", GAP, 12, 28, True)
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


def cam_ground(x, y):
    return 0.0          # every camera height is measured from the road plane (z = 0)

CONTINUITY_SUBJECTS = [
    dict(name="CAR", ob=bpy.data.objects["Car_Cabin"]),          # centre of the car body
    dict(name="ROSA", ob=ROSA),
    dict(name="WHEEL", ob=WHEELS["FL"]["tyre"]),                  # left front wheel (shot 2)
]
CONT = write_continuity(SHOTS, CONTINUITY_SUBJECTS, lambda n: CAMS_BY_SHOT[n][0],
                        os.path.join(OUT, "continuity.json"), fps=FPS, ground_z=cam_ground,
                        forward=lambda n: fwd_of(PSI[(shot(n)["start"] + shot(n)["end"]) // 2]))
make_contact_sheet()        # after continuity: it changes the render resolution

# ---- the one sequence (the whole 10 s, cuts inside) + 5 s chunks split at the 5.0 s cut ----
SEQUENCES = [dict(name="seq", shots=[1, 2, 3, 4])]
CHUNKS = [("c1", 0.0, 5.0), ("c2", 5.0, 10.0)]
anchors = {e["shot"]: e["anchor_sentence"] for e in CONT["shots"]}
seq_report = dict(film="COAST ROAD", fps=FPS, resolution=[RES_X, RES_Y], proxy=PROXY,
                  proxy_note="car = cherry red; ROSA = monolith with a CYAN front (her face), black back, green sides/top",
                  sequences=[], chunks=[])
for sq in SEQUENCES:
    f0, f1 = shot(sq["shots"][0])["start"], shot(sq["shots"][-1])["end"]
    entry = dict(name=sq["name"], file=f"{sq['name']}.mp4", frame_range=[f0, f1],
                 film_start_s=round((f0 - 1) / FPS, 2), film_end_s=round(f1 / FPS, 2),
                 duration_s=round((f1 - f0 + 1) / FPS, 2), shots=[])
    for n in sq["shots"]:
        s_ = shot(n)
        entry["shots"].append(dict(
            shot=n, name=s_["name"], beat=s_["beat"],
            start_s=round((s_["start"] - f0) / FPS, 2), end_s=round((s_["end"] - f0 + 1) / FPS, 2),
            camera=DESCRIPTIONS[n]["move"], anchor_sentence=anchors[n]))
    seq_report["sequences"].append(entry)
for name, c0, c1 in CHUNKS:
    f0, f1 = int(round(c0 * FPS)) + 1, int(round(c1 * FPS))
    seq_report["chunks"].append(dict(
        name=name, file=f"chunks/{name}.mp4", window_s=[c0, c1], frame_range=[f0, f1],
        shots=[dict(shot=s_["n"], start_s=round(max(s_["start"], f0) / FPS - 1 / FPS - c0, 2),
                    end_s=round(min(s_["end"], f1) / FPS - c0, 2), anchor_sentence=anchors[s_["n"]])
               for s_ in SHOTS if s_["end"] >= f0 and s_["start"] <= f1]))
if MODE != "stills":
    shutil.copy(os.path.join(OUT, "playblast.mp4"), os.path.join(OUT, "seq.mp4"))
    os.makedirs(os.path.join(OUT, "chunks"), exist_ok=True)
    for name, c0, c1 in CHUNKS:
        f0, f1 = int(round(c0 * FPS)) + 1, int(round(c1 * FPS))
        ffmpeg("-i", os.path.join(OUT, "playblast.mp4"), "-vf",
               f"select='between(n\\,{f0 - 1}\\,{f1 - 1})',setpts=N/{FPS}/TB",
               "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-r", str(FPS),
               os.path.join(OUT, "chunks", f"{name}.mp4"))
with open(os.path.join(OUT, "sequences.json"), "w") as fh:
    json.dump(seq_report, fh, indent=2)

if not KEEP_FRAMES and MODE != "stills":
    shutil.rmtree(WORK, ignore_errors=True)

print("[previs] render times per shot (s):", RENDER_TIMES, f"total render {time.time() - T_RENDER:.1f}s")
print(f"[previs] done in {time.time() - T0:.1f}s")

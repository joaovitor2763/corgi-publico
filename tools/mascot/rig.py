# Rigs a generated plush-corgi mesh for real-time use and exports regi.glb.
#
#   blender -b -P tools/rig.py -- in.glb landmarks.json out.glb
#
# Landmarks are pixels picked on the front render made by turntable.py (same camera),
# ray-cast onto the mesh from the front and the back so joints sit inside the body.
# Pipeline: normalize (feet at origin, 0.30 m tall, facing glTF +Z) -> skeleton with the
# contract bone names -> distance weights gated by body region -> 3D eyes with a moving
# catchlight + eyelid morph targets -> subtle clips -> GLB. Mouth/brow morphs are not
# produced: the mouth and brows are painted in the texture of generated meshes.
import bpy, bmesh, json, math, sys
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, LANDMARKS, OUT = argv[0], argv[1], argv[2]
cfg = json.load(open(LANDMARKS))
HEIGHT = cfg.get("height", 0.30)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
body = bpy.context.view_layer.objects.active
body.name = "regi_body"
body.parent = None
body.matrix_world = body.matrix_world.copy()
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o.type == "EMPTY":
        bpy.data.objects.remove(o)

# --- landmarks: same camera as turntable.py front view -------------------------------
def bounds(obj):
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi

lo, hi = bounds(body)
center, size = (lo + hi) / 2, max(hi - lo)
res, lens, sensor = cfg["render"]["size"], cfg["render"]["lens"], 36.0
cam_loc = center + Vector((0, -size * 2.6, size * 0.15))
forward = (center - cam_loc).normalized()
right = forward.cross(Vector((0, 0, 1))).normalized()
up = right.cross(forward).normalized()
bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())

def pixel_ray(px, py):
    # Blender's default sensor fit is horizontal on a square frame.
    half = sensor / 2 / lens
    u, v = (px / res - 0.5) * 2 * half, (0.5 - py / res) * 2 * half
    return (forward + right * u + up * v).normalized()

def surface(name):
    # Hand-picked pixels can sit on an edge; search outward for the nearest one that hits.
    px, py = cfg["pixels"][name]
    for radius in range(0, 12):
        for dx in range(-radius, radius + 1):
            for dy in (-radius, radius) if abs(dx) != radius else range(-radius, radius + 1):
                hit = bvh.ray_cast(cam_loc, pixel_ray(px + dx, py + dy))[0]
                if hit is not None:
                    if radius:
                        cfg["pixels"][name] = [px + dx, py + dy]
                    print("LANDMARK", name, (px + dx, py + dy), tuple(round(c, 3) for c in hit))
                    return hit
    raise SystemExit(f"landmark {name} missed the mesh")

def inside(name, depth):
    """A fixed depth behind the landmark's surface point (fraction of the model height).
    Front-to-back midpoints fail on bodies that extend backwards, so depth is explicit."""
    front = surface(name)
    return front + pixel_ray(*cfg["pixels"][name]) * depth * (hi.z - lo.z)

P = {k: surface(k) for k in cfg["pixels"]}
head_c = (inside("eye.L", 0.2) + inside("eye.R", 0.2)) / 2
neck_c = inside("chin", 0.2)
chest_c = inside("chest", 0.22)

# --- normalize: feet on the ground, HEIGHT tall, centered; glTF export turns -Y into +Z --
scale = HEIGHT / (hi.z - lo.z)
shift = Vector((-center.x, -center.y, -lo.z))
T = Matrix.Scale(scale, 4) @ Matrix.Translation(shift)
body.data.transform(T)
body.data.update()
P = {k: T @ v for k, v in P.items()}
head_c, neck_c, chest_c = T @ head_c, T @ neck_c, T @ chest_c
lo, hi = bounds(body)
W, D = hi.x - lo.x, hi.y - lo.y
bvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())

# The 3D eye matches the painted one: about a fifth of the distance between the eyes.
eye_r = cfg.get("eye_radius") or (P["eye.L"] - P["eye.R"]).length * 0.2

# --- skeleton ---------------------------------------------------------------------------
arm_data = bpy.data.armatures.new("regi_rig")
rig = bpy.data.objects.new("regi_rig", arm_data)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones

def bone(name, head, tail, parent=None):
    b = eb.new(name)
    b.head, b.tail = head, tail
    if parent:
        b.parent = eb[parent]
    return b

back_y = lo.y + D * 0.78  # rear of a sitting corgi
hips_c = Vector((0, back_y - D * 0.18, HEIGHT * 0.20))
bone("root", Vector((0, 0, 0)), Vector((0, 0, HEIGHT * 0.08)))
bone("hips", hips_c, hips_c + Vector((0, -D * 0.1, HEIGHT * 0.08)), "root")
bone("spine", eb["hips"].tail, (eb["hips"].tail + chest_c) / 2, "hips")
bone("chest", eb["spine"].tail, chest_c, "spine")
bone("neck", chest_c, neck_c, "chest")
bone("head", neck_c, head_c + Vector((0, 0, HEIGHT * 0.12)), "neck")
for side in ("L", "R"):
    base, tip = P[f"ear.{side}.base"], P[f"ear.{side}.tip"]
    inner = base + (head_c - base) * 0.15
    bone(f"ear.{side}", inner, tip, "head")
    # The eye bone pivots at the eyeball's center so looking around rotates it in place.
    eye_center = P[f"eye.{side}"] + Vector((0, eye_r * 0.55, 0))
    bone(f"eye.{side}", eye_center, eye_center + Vector((0, -eye_r * 1.5, 0)), "head")
    sx = 1 if side == "L" else -1
    paw = P[f"paw.{side}"]
    shoulder = Vector((paw.x, chest_c.y + D * 0.02, chest_c.z - HEIGHT * 0.02))
    bone(f"frontLeg.{side}", shoulder, Vector((paw.x, paw.y + D * 0.04, 0.0)), "chest")
    rear = Vector((sx * W * 0.28, back_y - D * 0.05, HEIGHT * 0.16))
    bone(f"rearLeg.{side}", rear, Vector((sx * W * 0.3, back_y - D * 0.2, 0.0)), "hips")
tail_root = Vector((0, lo.y + D * 0.97, HEIGHT * 0.2))
bone("tail", tail_root, tail_root + Vector((0, D * 0.12, HEIGHT * 0.05)), "hips")
for b in eb:
    b.roll = 0
bpy.ops.object.mode_set(mode="OBJECT")

# --- weights: distance to bone segments, gated by region so the head never pulls a paw ---
def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length

bones = {b.name: (rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local) for b in arm_data.bones}
chin_z, head_top = neck_c.z, max(P["ear.L.base"].z, P["ear.R.base"].z)
groups = {name: body.vertex_groups.new(name=name) for name in bones if name not in ("root", "eye.L", "eye.R")}
sigma = {"head": 0.05, "neck": 0.035, "chest": 0.05, "spine": 0.05, "hips": 0.06, "tail": 0.025,
         "ear.L": 0.03, "ear.R": 0.03, "frontLeg.L": 0.03, "frontLeg.R": 0.03, "rearLeg.L": 0.035, "rearLeg.R": 0.035}
for v in body.data.vertices:
    p = v.co
    allowed = set(groups)
    if p.z > chin_z + 0.01:
        allowed &= {"head", "neck", "ear.L", "ear.R"}
    else:
        allowed -= {"head", "ear.L", "ear.R"}
    if p.z < head_top - 0.01:
        allowed -= {"ear.L", "ear.R"}
    if p.z > HEIGHT * 0.32:
        allowed -= {"frontLeg.L", "frontLeg.R", "rearLeg.L", "rearLeg.R", "tail"}
    # Ears only take their own side; legs likewise.
    allowed -= {"ear.R", "frontLeg.R", "rearLeg.R"} if p.x > 0.004 else set()
    allowed -= {"ear.L", "frontLeg.L", "rearLeg.L"} if p.x < -0.004 else set()
    scores = {n: math.exp(-(seg_dist(p, *bones[n]) / (sigma[n] * HEIGHT / 0.3)) ** 2) for n in allowed}
    best = sorted(scores.items(), key=lambda kv: -kv[1])[:3]
    total = sum(w for _, w in best)
    if total < 1e-6:
        near = min(allowed or groups, key=lambda n: seg_dist(p, *bones[n]))
        best, total = [(near, 1.0)], 1.0
    for n, w in best:
        groups[n].add([v.index], w / total, "REPLACE")

body.parent = rig
mod = body.modifiers.new("rig", "ARMATURE")
mod.object = rig

# --- eyes: glossy spheres with a catchlight that moves with the eye bone; eyelid morphs ---
lid_color = cfg.get("lid_color", (0.012, 0.011, 0.01, 1))

def material(name, color, rough, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        bsdf.inputs["Emission Color"].default_value = color
        bsdf.inputs["Emission Strength"].default_value = emit
    return m

eye_mat = material("eye", (0.018, 0.011, 0.008, 1), 0.12)
eye_mat.node_tree.nodes["Principled BSDF"].inputs["Specular IOR Level"].default_value = 0.35
glint_mat = material("glint", (1, 1, 1, 1), 0.2, 2.0)
lid_mat = material("eyelid", lid_color, 1.0)
# Fur is matte: no specular, or the studio light reads the lids as grey plastic.
lid_mat.node_tree.nodes["Principled BSDF"].inputs["Specular IOR Level"].default_value = 0.0

def attach(obj, bone_name):
    # Bone parenting is relative to the bone's tail in its own (rotated) space.
    world = obj.matrix_world.copy()
    b = rig.data.bones[bone_name]
    obj.parent = rig
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    obj.matrix_parent_inverse = (
        rig.matrix_world @ b.matrix_local @ Matrix.Translation((0, b.length, 0))
    ).inverted()
    obj.matrix_world = world

def sphere(name, radius, location, mat, segments=24):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=segments // 2, radius=radius)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.location = location
    me.materials.append(mat)
    return o

def lid(name, center, radius, upper):
    """Front half of a shell; each vertex keeps its angle around the eye. The basis bunches the
    lid against the brow (or cheek); shape keys slide it down to cover the eye."""
    bm = bmesh.new()
    rings, cols = 10, 16
    verts = []
    for i in range(rings + 1):
        row = []
        for j in range(cols + 1):
            row.append(bm.verts.new((0, 0, 0)))
        verts.append(row)
    for i in range(rings):
        for j in range(cols):
            bm.faces.new((verts[i][j], verts[i][j + 1], verts[i + 1][j + 1], verts[i + 1][j]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    me.materials.append(lid_mat)

    def place(cover):
        # cover: 0 = open (bunched), 1 = closed to the eye's equator line.
        pts = []
        for i in range(rings + 1):
            for j in range(cols + 1):
                phi = math.pi * (j / cols)  # left -> right across the front
                # Closed upper lid reaches past the eye's front dome; the lower lid rises a third.
                reach = 0.02 + cover * (0.9 if upper else 0.42)
                theta = (i / rings) * reach * math.pi
                if not upper:
                    theta = math.pi - theta
                x = math.sin(theta) * math.cos(phi)
                y = -math.sin(theta) * math.sin(phi)  # front is -Y before export
                z = math.cos(theta)
                pts.append(Vector((x, y, z)) * radius + center)
        return pts

    for v, p in zip(me.vertices, place(0.0)):
        v.co = p
    o.shape_key_add(name="Basis")
    return o, place

# Eyelids become part of the skinned body (weighted to the head) so every engine places them
# the same way; objects parented to bones were misplaced in three.js. Separate 3D eyeballs are
# off by default: generated textures already carry good painted eyes.
if not body.data.shape_keys:
    body.shape_key_add(name="Basis")
lids = []
for side in ("L", "R"):
    c = P[f"eye.{side}"] + Vector((0, eye_r * 0.55, 0))
    if cfg.get("eyes3d"):
        eye = sphere(f"eye_{side}", eye_r, c, eye_mat)
        glint = sphere(f"glint_{side}", eye_r * 0.16, c + Vector((-eye_r * 0.3, -eye_r * 0.9, eye_r * 0.35)), glint_mat, 12)
        for o in (eye, glint):
            attach(o, f"eye.{side}")
    upper, place_u = lid(f"lid_upper_{side}", c, eye_r * 1.08, True)
    for key, cover in ((f"blink_{side}", 1.0), ("eyes_sad", 0.4)):
        sk = upper.shape_key_add(name=key)
        for d, p in zip(sk.data, place_u(cover)):
            d.co = p
    lower, place_l = lid(f"lid_lower_{side}", c, eye_r * 1.08, False)
    sk = lower.shape_key_add(name="eyes_happy")
    for d, p in zip(sk.data, place_l(0.9)):
        d.co = p
    for o in (upper, lower):
        for poly in o.data.polygons:
            poly.use_smooth = True
        o.vertex_groups.new(name="head").add(list(range(len(o.data.vertices))), 1.0, "REPLACE")
        lids.append(o)
bpy.ops.object.select_all(action="DESELECT")
for o in lids:
    o.select_set(True)
body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
print("MORPHS", [k.name for k in body.data.shape_keys.key_blocks])

# --- clips: subtle; look-at, blinking, ears and tail wag are layered procedurally at runtime --
bpy.context.view_layer.objects.active = rig
rig.animation_data_create()
FPS = 30
bpy.context.scene.render.fps = FPS

def clip(name, seconds, keys):
    """keys: {bone: [(t, (rx, ry, rz) degrees, (lx, ly, lz) meters?)]}"""
    act = bpy.data.actions.new(name)
    rig.animation_data.action = act
    for pb in rig.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
    for bone_name, frames in keys.items():
        pb = rig.pose.bones[bone_name]
        for t, rot, *loc in frames:
            pb.rotation_euler = tuple(math.radians(a) for a in rot)
            pb.keyframe_insert("rotation_euler", frame=1 + t * FPS)
            if loc:
                pb.location = loc[0]
                pb.keyframe_insert("location", frame=1 + t * FPS)
    act.use_fake_user = True
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 1, act)
    rig.animation_data.action = None

z = (0, 0, 0)
breathe = lambda amp, period: [(0, z, z), (period / 2, (amp, 0, 0), (0, 0, 0.002 * amp)), (period, z, z)]
clip("idle", 4.0, {"chest": breathe(1.2, 4.0), "head": [(0, z), (2, (1.5, 0, 0)), (4, z)]})
clip("idle_breathing", 3.2, {"chest": breathe(1.6, 3.2)})
clip("thinking", 2.4, {"head": [(0, z), (0.6, (4, 0, 9)), (1.8, (4, 0, 9)), (2.4, z)], "ear.L": [(0, z), (0.6, (0, 0, -8)), (2.4, z)]})
clip("head_tilt", 1.4, {"head": [(0, z), (0.4, (0, 0, -14)), (1.0, (0, 0, -14)), (1.4, z)]})
clip("happy", 1.2, {"head": [(0, z), (0.3, (-6, 0, 0)), (0.6, z), (0.9, (-6, 0, 0)), (1.2, z)],
                    "tail": [(t / 10, (0, 0, 30 * (1 if i % 2 else -1))) for i, t in enumerate(range(0, 13))]})
clip("celebrate", 1.3, {"root": [(0, z, z), (0.25, z, (0, 0, 0.035)), (0.5, z, (0, 0, 0)), (0.75, z, (0, 0, 0.02)), (1.0, z, (0, 0, 0)), (1.3, z, (0, 0, 0))],
                        "frontLeg.L": [(0, z), (0.25, (-25, 0, 0)), (0.5, z), (1.3, z)], "frontLeg.R": [(0, z), (0.25, (-25, 0, 0)), (0.5, z), (1.3, z)],
                        "tail": [(t / 10, (0, 0, 35 * (1 if i % 2 else -1))) for i, t in enumerate(range(0, 14))]})
clip("wave", 1.6, {"frontLeg.R": [(0, z), (0.3, (-80, 0, -15)), (0.55, (-80, 0, 10)), (0.8, (-80, 0, -15)), (1.05, (-80, 0, 10)), (1.35, (-80, 0, 0)), (1.6, z)]})
clip("confused", 1.3, {"head": [(0, z), (0.35, (0, 0, 16)), (1.0, (0, 0, 16)), (1.3, z)], "ear.R": [(0, z), (0.35, (0, 0, 18)), (1.3, z)]})
clip("sleep", 4.0, {"head": [(0, (22, 0, 0)), (2, (24, 0, 0)), (4, (22, 0, 0))], "neck": [(0, (18, 0, 0)), (4, (18, 0, 0))],
                    "ear.L": [(0, (0, 0, -22)), (4, (0, 0, -22))], "ear.R": [(0, (0, 0, 22)), (4, (0, 0, 22))], "chest": breathe(2.2, 4.0)})
clip("wake_up", 1.2, {"head": [(0, (22, 0, 0)), (0.7, (-6, 0, 0)), (1.2, z)], "neck": [(0, (18, 0, 0)), (1.2, z)]})
clip("listening", 2.0, {"ear.L": [(0, z), (0.5, (-10, 0, 0)), (2, z)], "ear.R": [(0, z), (0.5, (-10, 0, 0)), (2, z)], "head": [(0, z), (0.5, (0, 0, -6)), (2, z)]})
clip("typing_watch", 3.0, {"head": [(0, (6, 0, 0)), (1.5, (8, 0, 4)), (3, (6, 0, 0))], "neck": [(0, (4, 0, 0)), (3, (4, 0, 0))]})

# glTF defaults metallic to 1 when a material omits it, and a metal plush with no environment
# to reflect renders black in three.js. Plush is fully dielectric and matte.
for m in body.data.materials:
    if m and m.node_tree:
        bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf:
            for link in list(bsdf.inputs["Metallic"].links):
                m.node_tree.links.remove(link)
            bsdf.inputs["Metallic"].default_value = 0.0
            bsdf.inputs["Roughness"].default_value = max(bsdf.inputs["Roughness"].default_value, 0.85)

# --- export -----------------------------------------------------------------------------
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_yup=True,
    export_apply=False,
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_force_sampling=True,
    export_morph=True,
    export_skins=True,
    export_image_format="WEBP",
)
print("EXPORTED", OUT, "height", HEIGHT, "bones", len(arm_data.bones))

# Paints an untextured generated mesh from the reference views themselves.
#
#   blender -b -P tools/mascot/texture.py -- shape.glb mv_dir out.glb [rot_z_degrees]
#
# mv_dir holds front/left/back/right.png (same scale, feet on the same line) and views.json
# with the model's height fraction in each square image. Each view becomes an orthographic
# projection; every surface point takes the views it faces, weighted by how squarely it
# faces them, and the result is baked into one 2K texture. Output: normalized mesh
# (0.30 m tall, feet at origin, facing -Y in Blender = +Z in glTF), UVs, PBR material.
import bpy, json, math, os, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, MV, OUT = argv[0], argv[1], argv[2]
ROT = math.radians(float(argv[3])) if len(argv) > 3 else 0.0
HEIGHT, TEX = 0.30, 2048
views = json.load(open(os.path.join(MV, "views.json")))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
obj.name = "regi_body"
obj.parent = None
obj.rotation_euler.z += ROT  # generators differ on which way is "front"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o.type == "EMPTY":
        bpy.data.objects.remove(o)

# Normalize: feet on the ground, HEIGHT tall, centered on the footprint.
pts = [v.co for v in obj.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
s = HEIGHT / (hi.z - lo.z)
for v in obj.data.vertices:
    v.co = Vector(((v.co.x - (lo.x + hi.x) / 2) * s, (v.co.y - (lo.y + hi.y) / 2) * s, (v.co.z - lo.z) * s))
for poly in obj.data.polygons:
    poly.use_smooth = True
print("NORMALIZED", "width", round((hi.x - lo.x) * s, 3), "depth", round((hi.y - lo.y) * s, 3))

# Real-time budget: generators emit hundreds of thousands of faces; ~25k keep the silhouette.
TARGET_FACES = 25000
if len(obj.data.polygons) > TARGET_FACES:
    dec = obj.modifiers.new("decimate", "DECIMATE")
    dec.ratio = TARGET_FACES / len(obj.data.polygons)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=dec.name)
    for poly in obj.data.polygons:
        poly.use_smooth = True
print("FACES", len(obj.data.polygons))

# UVs for the baked texture.
bpy.context.view_layer.objects.active = obj
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")
obj.data.uv_layers[0].name = "UVMap"

# One orthographic camera + UV projection per view.
ortho = HEIGHT / views["height_fraction"]
mat = bpy.data.materials.new("regi")
mat.use_nodes = True
nt = mat.node_tree
nodes, links = nt.nodes, nt.links
for n in list(nodes):
    nodes.remove(n)
out = nodes.new("ShaderNodeOutputMaterial")
geo = nodes.new("ShaderNodeNewGeometry")
total_color, total_weight = None, None
for i, (name, azimuth) in enumerate(views["views"].items()):
    a = math.radians(azimuth)
    # front (0) looks along +Y from -Y; left (90) from +X; back (180) from +Y; right (270) from -X.
    direction = Vector((-math.sin(a), math.cos(a), 0))  # camera view direction
    cam = bpy.data.objects.new(f"cam_{name}", bpy.data.cameras.new(f"cam_{name}"))
    bpy.context.scene.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = ortho
    cam.location = Vector((0, 0, HEIGHT / 2)) - direction * 2
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    uv = obj.data.uv_layers.new(name=f"proj_{name}")
    mod = obj.modifiers.new(f"proj_{name}", "UV_PROJECT")
    mod.uv_layer = uv.name
    mod.projector_count = 1
    mod.projectors[0].object = cam
    mod.aspect_x = mod.aspect_y = 1.0
    img = bpy.data.images.load(os.path.join(MV, f"{name}.png"))
    uvn = nodes.new("ShaderNodeUVMap")
    uvn.uv_map = uv.name
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.extension = "CLIP"
    links.new(uvn.outputs["UV"], tex.inputs["Vector"])
    # Weight: how squarely the surface faces this camera, sharpened, times the view's alpha.
    facing = nodes.new("ShaderNodeVectorMath")
    facing.operation = "DOT_PRODUCT"
    facing.inputs[1].default_value = -direction
    links.new(geo.outputs["Normal"], facing.inputs[0])
    clamp = nodes.new("ShaderNodeMath")
    clamp.operation = "MAXIMUM"
    clamp.inputs[1].default_value = 0.0
    links.new(facing.outputs["Value"], clamp.inputs[0])
    sharp = nodes.new("ShaderNodeMath")
    sharp.operation = "POWER"
    sharp.inputs[1].default_value = 4.0
    links.new(clamp.outputs[0], sharp.inputs[0])
    weight = nodes.new("ShaderNodeMath")
    weight.operation = "MULTIPLY"
    links.new(sharp.outputs[0], weight.inputs[0])
    links.new(tex.outputs["Alpha"], weight.inputs[1])
    scaled = nodes.new("ShaderNodeVectorMath")
    scaled.operation = "SCALE"
    links.new(tex.outputs["Color"], scaled.inputs[0])
    links.new(weight.outputs[0], scaled.inputs["Scale"])
    if total_color is None:
        total_color, total_weight = scaled.outputs[0], weight.outputs[0]
    else:
        add_c = nodes.new("ShaderNodeVectorMath")
        add_c.operation = "ADD"
        links.new(total_color, add_c.inputs[0])
        links.new(scaled.outputs[0], add_c.inputs[1])
        add_w = nodes.new("ShaderNodeMath")
        add_w.operation = "ADD"
        links.new(total_weight, add_w.inputs[0])
        links.new(weight.outputs[0], add_w.inputs[1])
        total_color, total_weight = add_c.outputs[0], add_w.outputs[0]
safe = nodes.new("ShaderNodeMath")
safe.operation = "MAXIMUM"
safe.inputs[1].default_value = 1e-4
links.new(total_weight, safe.inputs[0])
inv = nodes.new("ShaderNodeMath")
inv.operation = "DIVIDE"
inv.inputs[0].default_value = 1.0
links.new(safe.outputs[0], inv.inputs[1])
color = nodes.new("ShaderNodeVectorMath")
color.operation = "SCALE"
links.new(total_color, color.inputs[0])
links.new(inv.outputs[0], color.inputs["Scale"])
emit = nodes.new("ShaderNodeEmission")
links.new(color.outputs[0], emit.inputs["Color"])
links.new(emit.outputs[0], out.inputs["Surface"])
obj.data.materials.clear()
obj.data.materials.append(mat)

# Bake the blend into the real UV map.
baked = bpy.data.images.new("regi_albedo", TEX, TEX)
bake_uv = nodes.new("ShaderNodeUVMap")
bake_uv.uv_map = "UVMap"
target = nodes.new("ShaderNodeTexImage")
target.image = baked
links.new(bake_uv.outputs["UV"], target.inputs["Vector"])
nodes.active = target
obj.data.uv_layers.active = obj.data.uv_layers["UVMap"]
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 4
scene.cycles.device = "CPU"
scene.render.bake.margin = 8
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.ops.object.bake(type="EMIT")
print("BAKED")

# Final material: baked albedo, matte plush.
for m in list(obj.modifiers):
    obj.modifiers.remove(m)
for name in [u.name for u in obj.data.uv_layers if u.name != "UVMap"]:
    obj.data.uv_layers.remove(obj.data.uv_layers[name])
final = bpy.data.materials.new("regi_plush")
final.use_nodes = True
bsdf = final.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Metallic"].default_value = 0.0
bsdf.inputs["Roughness"].default_value = 0.92
tex = final.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = baked
final.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
obj.data.materials.clear()
obj.data.materials.append(final)
for o in list(scene.objects):
    if o.type == "CAMERA":
        bpy.data.objects.remove(o)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_image_format="WEBP")
print("EXPORTED", OUT)

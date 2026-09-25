# Renders a GLB from four angles on white, soft studio light. Usage:
# blender -b -P tools/turntable.py -- in.glb out_prefix
import bpy, sys, math, mathutils
argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
mins = mathutils.Vector((1e9,)*3); maxs = mathutils.Vector((-1e9,)*3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        mins = mathutils.Vector(map(min, mins, w)); maxs = mathutils.Vector(map(max, maxs, w))
center = (mins + maxs) / 2; size = max(maxs - mins)
print("BOUNDS", tuple(round(v, 3) for v in mins), tuple(round(v, 3) for v in maxs))
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = scene.render.resolution_y = 640
scene.render.film_transparent = False
world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
def light(name, loc, energy):
    l = bpy.data.lights.new(name, "AREA"); l.energy = energy; l.size = size * 3
    o = bpy.data.objects.new(name, l); o.location = center + mathutils.Vector(loc) * size
    o.rotation_euler = (center - o.location).to_track_quat("-Z", "Y").to_euler(); scene.collection.objects.link(o)
light("key", (1.5, -2, 2), 400 * size * size); light("rim", (-1.5, 2, 1.5), 250 * size * size)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scene.collection.objects.link(cam); scene.camera = cam
cam.data.lens = 60
for name, angle in [("front", 0), ("threequarter", 35), ("side", 90), ("back", 180)]:
    a = math.radians(angle); d = size * 2.6
    # glTF imports Y-up as Blender Z-up; model faces -Y after import.
    cam.location = center + mathutils.Vector((math.sin(a) * d, -math.cos(a) * d, size * 0.15))
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = f"{out}-{name}.png"
    bpy.ops.render.render(write_still=True)

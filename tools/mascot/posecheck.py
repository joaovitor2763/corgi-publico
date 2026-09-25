# Renders a rigged GLB at chosen clip times and morph values, front view, to check deformation.
#   blender -b -P tools/posecheck.py -- in.glb out_prefix
import bpy, sys, math, mathutils
argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
rig = next(o for o in scene.objects if o.type == "ARMATURE")
print("ACTIONS", sorted(a.name for a in bpy.data.actions))
meshes = [o for o in scene.objects if o.type == "MESH"]
print("MORPHS", sorted({k.name for o in meshes if o.data.shape_keys for k in o.data.shape_keys.key_blocks}))
scene.render.engine = "BLENDER_EEVEE"; scene.render.resolution_x = scene.render.resolution_y = 420
world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (1, 1, 1, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
H = 0.30
for name, loc, e in [("key", (0.4, -0.6, 0.6), 60), ("rim", (-0.4, 0.5, 0.5), 35)]:
    l = bpy.data.lights.new(name, "AREA"); l.energy = e; l.size = 0.8
    o = bpy.data.objects.new(name, l); o.location = loc
    o.rotation_euler = (mathutils.Vector((0, 0, H / 2)) - o.location).to_track_quat("-Z", "Y").to_euler(); scene.collection.objects.link(o)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scene.collection.objects.link(cam); scene.camera = cam
cam.data.lens = 50
def shoot(tag, action=None, t=0.0, morphs=None, angle=20):
    a = math.radians(angle)
    cam.location = (math.sin(a) * 0.75, -math.cos(a) * 0.75, H * 0.6)
    cam.rotation_euler = (mathutils.Vector((0, 0, H * 0.48)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    rig.animation_data.action = bpy.data.actions.get(action) if action else None
    if not action:
        for pb in rig.pose.bones: pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    scene.frame_set(1 + int(t * 30))
    for o in meshes:
        if o.data.shape_keys:
            for k in o.data.shape_keys.key_blocks[1:]:
                k.value = (morphs or {}).get(k.name, 0.0)
    scene.render.filepath = f"{out}-{tag}.png"; bpy.ops.render.render(write_still=True)
for track in list(rig.animation_data.nla_tracks): track.mute = True
shoot("rest")
shoot("blink", morphs={"blink_L": 1, "blink_R": 1})
shoot("happy_eyes", morphs={"eyes_happy": 1})
shoot("thinking", "thinking", 1.2)
shoot("wave", "wave", 0.3)
shoot("celebrate", "celebrate", 0.25)
shoot("sleep", "sleep", 1.0, {"blink_L": 1, "blink_R": 1})
shoot("side", angle=90)

import os
import bpy

scene = bpy.context.scene
OUT = "/home/ege/Blender-MCP/footballer"
wind = bpy.data.objects["Wind"]
wind.animation_data_clear()
wind.field.strength = 2.5
wind.field.noise = 0.5
for ob in bpy.data.objects:
    for m in ob.modifiers:
        if m.type == "CLOTH":
            m.point_cache.frame_end = scene.frame_end
bpy.ops.ptcache.free_bake_all()
scene.frame_set(1)
for f in range(1, scene.frame_end + 1):
    scene.frame_set(f)
scene.cycles.use_denoising = False
scene.cycles.samples = 48
for name, tag in (("cam_front", "on"), ("cam_back", "arka")):
    scene.camera = bpy.data.objects[name]
    scene.render.filepath = os.path.join(OUT, f"futbolcu_{tag}.png")
    bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "futbolcu.blend"))
print("DONE2")

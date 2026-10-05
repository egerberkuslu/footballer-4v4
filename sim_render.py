import os
import bpy

scene = bpy.context.scene
OUT = "/home/ege/Blender-MCP/footballer"
scene.cycles.use_denoising = False
scene.cycles.samples = 48
scene.frame_set(scene.frame_end)
for name, tag in (("cam_front", "on"), ("cam_back", "arka")):
    scene.camera = bpy.data.objects[name]
    scene.render.filepath = os.path.join(OUT, f"futbolcu_{tag}.png")
    bpy.ops.render.render(write_still=True)
# 3D gorunumu kameraya cevir, solid + kapsayici
for win in bpy.context.window_manager.windows:
    for area in win.screen.areas:
        if area.type == "VIEW_3D":
            area.spaces[0].shading.type = "MATERIAL"
            area.spaces[0].region_3d.view_perspective = "CAMERA"
print("DONE")

# glb'yi boş sahneye yükleyip render eder (dışa aktarım doğrulaması)
import bpy
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
bpy.ops.import_scene.gltf(filepath="/home/ege/Blender-MCP/footballer/viewer/public/futbolcu.glb")
arm = [o for o in bpy.data.objects if o.type == "ARMATURE"]
ms = [o for o in bpy.data.objects if o.type == "MESH"]
print("DBG kemik", len(arm[0].data.bones) if arm else 0, "mesh", len(ms), "img", len(bpy.data.images))
print("DBG skin", [(o.name, any(m.type == "ARMATURE" for m in o.modifiers)) for o in ms])
# kol pozunu oynat: deri bağı çalışıyor mu
pb = arm[0].pose.bones.get("upperarm_l")
import math
pb.rotation_mode = "XYZ"
pb.rotation_euler = (0, 0, math.radians(-50))

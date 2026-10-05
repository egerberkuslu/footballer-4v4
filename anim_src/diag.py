import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb"); src=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]
bpy.ops.wm.open_mainfile(filepath='retarget_test.blend') if False else None

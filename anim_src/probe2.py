import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb")
src=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]
bpy.ops.import_scene.gltf(filepath="../viewer/public/futbolcu.glb")
dst=[o for o in bpy.data.objects if o.type=='ARMATURE' and o!=src][0]
sn={b.name for b in src.data.bones}; dn={b.name for b in dst.data.bones}
print('ORTAK',len(sn&dn)); print('SADECE_KAYNAK',sorted(sn-dn)); print('SADECE_HEDEF',sorted(dn-sn))
import mathutils
for n in ('pelvis','thigh_l','calf_l','foot_l','upperarm_l','lowerarm_l'):
    s,d=src.data.bones.get(n),dst.data.bones.get(n)
    if s and d: print(n,'len src %.3f dst %.3f'%(s.length,d.length),'| rest-dir src',tuple(round(x,2) for x in (s.tail_local-s.head_local).normalized()),'dst',tuple(round(x,2) for x in (d.tail_local-d.head_local).normalized()))
print('clips',[a.name for a in bpy.data.actions if 'Jog' in a.name or 'Sprint' in a.name or 'Idle_Loop'==a.name.split('_Armature')[0]])

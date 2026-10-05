# Quaternius UAL -> futbolcu.glb (MPFB game_engine, kollar asagida dinlenme pozu): dunya-uzayi delta aktarimi.
# Kullanim: blender -b -P retarget_ual.py -- Jog_Fwd_Loop Sprint_Loop ...
import bpy, sys, json
from mathutils import Matrix
UAL = "ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb"
DST = "../viewer/public/futbolcu.glb"
RENAME = {'Head': 'head'}                 # kaynak -> hedef ad farki
ABS = {'thigh', 'calf', 'foot', 'ball'}
SKIP = {'root', 'Root'}                   # koke ait hareket oyun simulasyonunda
clips = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=UAL); src = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
bpy.ops.import_scene.gltf(filepath=DST); dst = [o for o in bpy.data.objects if o.type == 'ARMATURE' and o != src][0]
ratio = dst.data.bones['pelvis'].head_local.z / src.data.bones['pelvis'].head_local.z
pairs = []
for b in dst.data.bones:
    sn = next((k for k, v in RENAME.items() if v == b.name), b.name)
    if sn in src.data.bones and b.name not in SKIP: pairs.append((sn, b.name))
depth = lambda n: len(dst.data.bones[n].parent_recursive)
pairs.sort(key=lambda p: depth(p[1]))
for pb in dst.pose.bones: pb.rotation_mode = 'QUATERNION'
out = {}
for clip in clips:
    act = bpy.data.actions[clip + '_Armature']
    src.animation_data_create().action = act
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    new = bpy.data.actions.new(clip); new.use_fake_user = True; dst.animation_data_create().action = new
    sp0 = src.pose.bones['pelvis']; 
    bpy.context.scene.frame_set(f0); bpy.context.view_layer.update()
    rest_p = src.data.bones['pelvis'].head_local.copy()
    track = {}
    for f in range(f0, f1 + 1):
        bpy.context.scene.frame_set(f); bpy.context.view_layer.update()
        for sn, dn in pairs:
            sb, db = src.data.bones[sn], dst.data.bones[dn]
            Rs, Rd, Ps = sb.matrix_local.to_3x3(), db.matrix_local.to_3x3(), src.pose.bones[sn].matrix.to_3x3()
            if dn.split('_')[0] in ABS:   # bacak zinciri: kaynagin MUTLAK yonu (hedefin asimetrik dinlenme pozu tasinmaz), yalniz kemik rulosu duzeltilir
                q = Rd.col[1].rotation_difference(Rs.col[1]); Rd2 = q.to_matrix() @ Rd
                R = Ps @ (Rs.inverted() @ Rd2)
            else:
                R = (Ps @ Rs.inverted()) @ Rd
            pb = dst.pose.bones[dn]
            if dn == 'pelvis':
                t = db.head_local + (src.pose.bones['pelvis'].head - rest_p) * ratio
            else:
                bpy.context.view_layer.update(); t = pb.head.copy()
            pb.matrix = Matrix.Translation(t) @ R.to_4x4()
            pb.keyframe_insert('rotation_quaternion', frame=f - f0 + 1)
            if dn == 'pelvis': pb.keyframe_insert('location', frame=f - f0 + 1)
            bpy.context.view_layer.update()
        track[f - f0 + 1] = {n: [round(x, 4) for x in dst.pose.bones[n].head] for n in ('pelvis', 'foot_l', 'foot_r', 'ball_l', 'ball_r', 'hand_l', 'hand_r', 'head')}
    out[clip] = {'frames': f1 - f0 + 1, 'fps': 24, 'track': track}
    print('RETARGET', clip, f1 - f0 + 1, 'kare, olcek', round(ratio, 3))
json.dump(out, open('retarget_track.json', 'w'))
bpy.ops.wm.save_as_mainfile(filepath='retarget_test.blend')

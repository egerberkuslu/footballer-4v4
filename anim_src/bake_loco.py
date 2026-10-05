# Quaternius UAL jog/sprint -> futbolcu.glb iskeleti; calisma-zamani JSON (dinlenmeden SAPMA, model uzayi = glTF Y-yukari).
# Kullanim: blender -b -P bake_loco.py
import bpy, json, math
from mathutils import Matrix
UAL = "ual1/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb"
DST = "../viewer/public/futbolcu.glb"
CLIPS = {'walk': 'Walk_Loop', 'jog': 'Jog_Fwd_Loop', 'sprint': 'Sprint_Loop'}
RENAME = {'Head': 'head'}; ABS = {'thigh', 'calf', 'foot', 'ball'}; SKIP = {'root', 'Root'}; M = 24
ARM = {'upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky'}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=UAL); src = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
bpy.ops.import_scene.gltf(filepath=DST); dst = [o for o in bpy.data.objects if o.type == 'ARMATURE' and o != src][0]
ratio = dst.data.bones['pelvis'].head_local.z / src.data.bones['pelvis'].head_local.z
from mathutils import Vector
def rdir(arm, n):
    b = arm.data.bones[n]; v = b.tail_local - b.head_local; return Vector((v.x, 0.0, v.z)).normalized()
KARM = {s: rdir(dst, f'upperarm_{s}').rotation_difference(rdir(src, f'upperarm_{s}')) for s in ('l', 'r')}
pairs = []
for b in dst.data.bones:
    sn = next((k for k, v in RENAME.items() if v == b.name), b.name)
    if sn in src.data.bones and b.name not in SKIP: pairs.append((sn, b.name))
depth = lambda n: len(dst.data.bones[n].parent_recursive)
pairs.sort(key=lambda p: (depth(p[1]), p[1]))
for pb in dst.pose.bones: pb.rotation_mode = 'QUATERNION'
g = lambda v: [v[0], v[2], -v[1]]                      # Blender Z-yukari -> glTF Y-yukari
gq = lambda q: [q.x, q.z, -q.y, q.w]
ballZ = min(dst.data.bones['ball_l'].head_local.z, dst.data.bones['ball_r'].head_local.z)
out = {'bones': [d for _, d in pairs], 'clips': {}}
for key, clip in CLIPS.items():
    act = bpy.data.actions[clip + '_Armature']; src.animation_data_create().action = act
    f0, f1 = act.frame_range; L = f1 - f0                # dongu uzunlugu (kare, kesirli olabilir)
    frames = []
    for k in range(M):
        ft = f0 + L * k / M; fi = int(math.floor(ft))
        bpy.context.scene.frame_set(fi, subframe=ft - fi); bpy.context.view_layer.update()
        rest_p = src.data.bones['pelvis'].head_local
        pel_src = src.pose.bones['pelvis'].head.copy()
        qs, bz, fy = [], [], {}
        for sn, dn in pairs:
            sb, db = src.data.bones[sn], dst.data.bones[dn]
            Rs, Rd, Ps = sb.matrix_local.to_3x3(), db.matrix_local.to_3x3(), src.pose.bones[sn].matrix.to_3x3()
            if dn.split('_')[0] in ABS:
                q = Rd.col[1].rotation_difference(Rs.col[1]); Rd2 = q.to_matrix() @ Rd; R = Ps @ (Rs.inverted() @ Rd2)
            elif dn.split('_')[0] in ARM and dn.endswith(('_l', '_r')):
                R = (Ps @ Rs.inverted()) @ (KARM[dn[-1]].to_matrix() @ Rd)   # kol: T-pozuna cevrilmis sanal dinlenme
            else: R = (Ps @ Rs.inverted()) @ Rd
            pb = dst.pose.bones[dn]
            t = (db.head_local + (pel_src - rest_p) * ratio) if dn == 'pelvis' else pb.head.copy()
            pb.matrix = Matrix.Translation(t) @ R.to_4x4(); bpy.context.view_layer.update()
            qs.append(gq((pb.matrix.to_3x3() @ db.matrix_local.to_3x3().inverted()).to_quaternion()))
        pel = dst.pose.bones['pelvis'].head - dst.data.bones['pelvis'].head_local
        frames.append({'q': qs, 'pel': g(pel), 'fl': dst.pose.bones['foot_l'].head.copy(), 'fr': dst.pose.bones['foot_r'].head.copy(),
                       'bz': min(dst.pose.bones['ball_l'].head.z, dst.pose.bones['ball_r'].head.z)})
    # faz 0 = sol ayak en onde (basmaya hazir)
    k0 = max(range(M), key=lambda k: frames[k]['fl'].y); frames = frames[k0:] + frames[:k0]
    dur = L / 24.0
    # zemin: periyot boyunca en alcak ayak-parmagi dinlenme parmak yuksekligine otursun
    lift = ballZ - min(f['bz'] for f in frames)
    for f in frames: f['pel'][1] += lift
    # referans hiz: basma fazindaki ayagin geri kayma hizi (m/s)
    sp = []   # ileri = Blender -Y; basma fazinda ayak ZEMINDE +Y'ye kayar. Hiz: temas karelerinin medyani
    for k in range(M):
        a_, b_ = frames[k], frames[(k + 1) % M]; dt = dur / M
        for foot in ('fl', 'fr'):
            zm = min(f[foot].z for f in frames) + 0.06
            if a_[foot].z < zm and b_[foot].z < zm:
                v = (b_[foot].y - a_[foot].y) / dt
                if v > 0.3: sp.append(v)
    sp.sort(); top = sp[-1] if sp else 1.0
    sp = [v for v in sp if v > 0.5 * top]; vref = sp[len(sp) // 2] if sp else 1.0
    out['clips'][key] = {'dur': dur, 'n': M, 'vref': vref, 'lift': lift,
                         'q': [[round(c, 5) for q in f['q'] for c in q] for f in frames], 'pel': [[round(c, 4) for c in f['pel']] for f in frames]}
    print('BAKE', key, 'dur %.3f s' % dur, 'vref %.2f m/s' % vref, 'lift %.3f' % lift, 'basma ornegi', len(sp))
json.dump(out, open('../viewer/public/anim_loco.json', 'w'), separators=(',', ':'))

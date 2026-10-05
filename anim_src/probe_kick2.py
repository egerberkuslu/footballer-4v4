import bpy, sys
from mathutils import Vector
for name in sys.argv[sys.argv.index('--')+1:]:
    bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.fbx(filepath=f'cmu_pick/{name}.fbx')
    a=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]; act=a.animation_data.action; f0,f1=[int(x) for x in act.frame_range]
    H={};F={};L={}
    for f in range(f0,f1+1):
        bpy.context.scene.frame_set(f); bpy.context.view_layer.update()
        H[f]=a.pose.bones['hip'].head.copy(); F[f]=a.pose.bones['rFoot'].head.copy(); L[f]=a.pose.bones['lFoot'].head.copy()
    # ileri yon: kalcanin ilk-son yatay yer degisimi
    d=H[f1]-H[f0]; fwd=Vector((d.x,d.y,0)).normalized()
    print('CLIP',name,'kare',f0,f1,'ileri',[round(x,2) for x in fwd])
    row=[]
    for f in range(f0,f1+1,4):
        rel=F[f]-H[f]; relL=L[f]-H[f]
        sp=((F[min(f+1,f1)]-H[min(f+1,f1)])-(F[f]-H[f])).length*30/100
        row.append(f'{f}:R(f{rel.dot(fwd)/100:+.2f} z{F[f].z/100:.2f} v{sp:.1f}) L(f{relL.dot(fwd)/100:+.2f} z{L[f].z/100:.2f})')
    print('\n'.join('   '+' '.join(row[i:i+3]) for i in range(0,len(row),3)))

import bpy, sys
for name in sys.argv[sys.argv.index('--')+1:]:
    bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.fbx(filepath=f'cmu_pick/{name}.fbx')
    a=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]; act=a.animation_data.action; f0,f1=[int(x) for x in act.frame_range]
    P={k:{} for k in ('hip','rFoot','lFoot','head')}
    for f in range(f0,f1+1):
        bpy.context.scene.frame_set(f); bpy.context.view_layer.update()
        for k in P: P[k][f]=a.pose.bones[k].head.copy()
    sp=lambda k,f:(P[k][f+1]-P[k][f]).length*30/100
    pr=max(range(f0,f1),key=lambda f:sp('rFoot',f)); pl=max(range(f0,f1),key=lambda f:sp('lFoot',f))
    hz=[P['hip'][f].z/100 for f in range(f0,f1+1)]
    mz=[min(P['rFoot'][f].z,P['lFoot'][f].z)/100 for f in range(f0,f1+1)]
    print(f'CLIP {name} n={f1-f0+1} Rpeak {sp("rFoot",pr):.1f}m/s@{pr} Lpeak {sp("lFoot",pl):.1f}m/s@{pl} hip {min(hz):.2f}..{max(hz):.2f} footmin z max {max(mz):.2f} @{f0+mz.index(max(mz))} headmax {max(P["head"][f].z for f in P["head"])/100:.2f}')

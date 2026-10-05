import bpy, sys
def info(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if path.endswith('.fbx'): bpy.ops.import_scene.fbx(filepath=path)
    else: bpy.ops.import_scene.gltf(filepath=path)
    for o in bpy.data.objects:
        if o.type=='ARMATURE':
            a=o.animation_data.action if o.animation_data else None
            fr=a.frame_range if a else None
            print('FILE',path.split('/')[-1],'| arm',o.name,'| bones',len(o.data.bones),'| scale',tuple(round(x,3) for x in o.scale),'| action',a.name if a else None,'| frames',tuple(fr) if fr else None,'| fps',bpy.context.scene.render.fps)
            print('  bones:',[b.name for b in o.data.bones][:14])
            if a: print('  fcurves',len(a.fcurves))
            h=[b for b in o.data.bones if b.name.lower() in ('pelvis','hips','mixamorig:hips')]
            if h: print('  pelvis head z (rest):',round(h[0].head_local.z,3))
for p in sys.argv[sys.argv.index('--')+1:]: info(p)

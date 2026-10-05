import bpy, sys, math
def run(path):
    bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.fbx(filepath=path)
    a=[o for o in bpy.data.objects if o.type=='ARMATURE'][0]; act=a.animation_data.action
    f0,f1=[int(x) for x in act.frame_range]; names=[b.name for b in a.data.bones]
    if path.endswith('10_01.fbx'): print('BONES',names)
    h=a.data.bones['hip']; print('FILE',path.split('/')[-1],'frames',f0,f1,'| rest hip z %.2f'%h.head_local.z,'| rThigh len %.2f'%a.data.bones[[n for n in names if 'high' in n][0]].length)
    ft={'l':[n for n in names if n.lower() in ('lfoot',)][0],'r':[n for n in names if n.lower() in ('rfoot',)][0]}
    pos={k:[] for k in ft}; 
    for f in range(f0,f1+1):
        bpy.context.scene.frame_set(f); bpy.context.view_layer.update()
        for k,n in ft.items(): pos[k].append(a.pose.bones[n].head.copy())
    hipz=[]
    for k in ft:
        sp=[(pos[k][i+1]-pos[k][i]).length*30 for i in range(len(pos[k])-1)]; i=max(range(len(sp)),key=lambda j:sp[j])
        print('  foot',k,'max hiz %.1f (birim/s) kare %d | z min %.2f max %.2f'%(sp[i],f0+i,min(p.z for p in pos[k]),max(p.z for p in pos[k])))
for p in sys.argv[sys.argv.index('--')+1:]: run(p)

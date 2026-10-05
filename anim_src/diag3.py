import bpy
bpy.ops.wm.open_mainfile(filepath='retarget_test.blend')
arms=[o for o in bpy.data.objects if o.type=='ARMATURE']
src=[a for a in arms if a.data.bones.get('root')][0]; dst=[a for a in arms if a!=src][0]
sa=bpy.data.actions['Jog_Fwd_Loop_Armature']; da=bpy.data.actions['Jog_Fwd_Loop']
print('ACT src range',tuple(sa.frame_range),'dst range',tuple(da.frame_range))
src.animation_data.action=sa; dst.animation_data.action=da
ratio=1.084; err=[];dz=[]
for k in range(1,24):
    bpy.context.scene.frame_set(k+int(sa.frame_range[0])-1); bpy.context.view_layer.update(); sp=src.pose.bones['pelvis'].head.z
    sf=[src.pose.bones[n].head.copy() for n in ('foot_l','foot_r')]
    bpy.context.scene.frame_set(k); bpy.context.view_layer.update(); dp=dst.pose.bones['pelvis'].head.z
    df=[dst.pose.bones[n].head.copy() for n in ('foot_l','foot_r')]
    # ayak yuksekligi ve pelvise gore ileri konum karsilastirmasi (olcek duzeltmeli)
    sp_y=src.pose.bones['pelvis'].head.y; 
    dz.append(dp-sp)
    if k in (1,5,9,13,17,21): print('k',k,'pelvis z src %.3f dst %.3f'%(sp,dp),'| foot_l z src %.2f dst %.2f'%(sf[0].z,df[0].z),'| foot_r z src %.2f dst %.2f'%(sf[1].z,df[1].z))
print('pelvis z farki (dst-src) min/max %.3f/%.3f'%(min(dz),max(dz)))

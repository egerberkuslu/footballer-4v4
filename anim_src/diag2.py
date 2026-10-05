import bpy
bpy.ops.wm.open_mainfile(filepath='retarget_test.blend')
arms=[o for o in bpy.data.objects if o.type=='ARMATURE']
src=[a for a in arms if a.data.bones.get('root')][0]; dst=[a for a in arms if a!=src][0]
def show(tag,a,fr,clip=None):
    bpy.context.scene.frame_set(fr); bpy.context.view_layer.update()
    P=a.pose.bones
    print(tag,'f',fr,{k:tuple(round(x,2) for x in P[k].head) for k in ('pelvis','thigh_l','calf_l','foot_l','thigh_r','calf_r','foot_r')})
src.animation_data.action=bpy.data.actions['Idle_Loop_Armature']
dst.animation_data.action=bpy.data.actions['Idle_Loop']
show('SRC idle',src,1); show('DST idle',dst,1)
print('REST src',{k:tuple(round(x,2) for x in src.data.bones[k].head_local) for k in ('pelvis','thigh_l','thigh_r','foot_l','foot_r')})
print('REST dst',{k:tuple(round(x,2) for x in dst.data.bones[k].head_local) for k in ('pelvis','thigh_l','thigh_r','foot_l','foot_r')})
src.animation_data.action=bpy.data.actions["Jog_Fwd_Loop_Armature"]
dst.animation_data.action=bpy.data.actions['Jog_Fwd_Loop']
for f in (1,4,12): show('SRC jog',src,f); show('DST jog',dst,f)

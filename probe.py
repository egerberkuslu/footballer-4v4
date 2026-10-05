import bpy, time
scene = bpy.context.scene
bpy.data.objects["Wind"].field.strength = 0
bpy.ops.ptcache.free_bake_all()
scene.frame_set(1)
def stats(name):
    ob = bpy.data.objects[name].evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ob.to_mesh()
    import math
    rad = [math.hypot(v.co.x, v.co.y) for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    r = dict(zmin=round(min(zs),3), rmax=round(max(rad),3), rmean=round(sum(rad)/len(rad),3), nan=any(math.isnan(z) for z in zs))
    ob.to_mesh_clear(); return r
t=time.time(); out=[]
for f in range(1, 49):
    scene.frame_set(f)
    if f in (1,6,12,18,24,36,48):
        out.append((f, stats("jersey"), round(time.time()-t)))
print(out)

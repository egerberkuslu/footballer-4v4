import bpy, math, time
exec(open("/home/ege/Blender-MCP/footballer/build.py").read())
scene = bpy.context.scene
bpy.data.objects["Wind"].animation_data_clear()
bpy.data.objects["Wind"].field.strength = 0
bpy.ops.ptcache.free_bake_all()
def stats(name):
    ob = bpy.data.objects[name].evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ob.to_mesh()
    rad = [math.hypot(v.co.x, v.co.y) for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    r = dict(zmin=round(min(zs),3), rmax=round(max(rad),3), rmean=round(sum(rad)/len(rad),3))
    ob.to_mesh_clear(); return r
out = []
for f in range(1, 31):
    scene.frame_set(f)
    if f in (1, 6, 12, 24, 30):
        out.append((f, stats("jersey")))
print(out)

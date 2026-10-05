import bpy
for n,c in (("Forma",(0.9,0.6,0.05,1)),("Sort",(0.9,0.9,0.9,1)),("Tozluk",(0.6,0.02,0.02,1))):
    o=bpy.data.objects[n]; m=bpy.data.materials.new(n+"_dbg"); m.use_nodes=True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value=c
    o.data.materials.clear(); o.data.materials.append(m)

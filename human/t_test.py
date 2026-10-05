import bpy, addon_utils, sys

addon_utils.enable("mpfb", default_set=True, persistent=False)
from mpfb.services.humanservice import HumanService
from mpfb.services.locationservice import LocationService

print("USERDATA", LocationService.get_user_data(""))
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
h = HumanService.create_human()
print("HUMAN", h.name, len(h.data.vertices), h.dimensions[:])
rig = HumanService.add_builtin_rig(h, "game_engine")
print("RIG", rig.name, len(rig.data.bones), [b.name for b in rig.data.bones][:30])

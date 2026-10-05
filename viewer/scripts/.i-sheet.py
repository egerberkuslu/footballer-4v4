import sys
from PIL import Image
pre=sys.argv[1]; idx=[int(i) for i in sys.argv[3].split(',')]; out=sys.argv[2]
W=int(sys.argv[4]) if len(sys.argv)>4 else 640
ims=[Image.open(f'{pre}-{i}.png') for i in idx]
h=int(W*ims[0].height/ims[0].width)
cols=2; rows=(len(ims)+1)//2
S=Image.new('RGB',(W*cols,h*rows))
for k,m in enumerate(ims): S.paste(m.resize((W,h)),((k%2)*W,(k//2)*h))
S.save(out)

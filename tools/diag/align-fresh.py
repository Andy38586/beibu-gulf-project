# -*- coding: utf-8 -*-
"""align-fresh.py — 在"按当前位置新拉"的干净影像上量枢纽偏移（逐行重心 + 两端一致性）。
用法（venv，需 numpy/Pillow）：
  backend/algorithm-service/.venv/Scripts/python.exe tools/diag/align-fresh.py madao .local/3d-review/madao-r2
  # BASE 也可指盘上影像词干，如 backend/static/pinglu/imagery/qishi（读 <BASE>.jpg + <BASE>.json）
"""
import json, os, struct, sys, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from statistics import median

ROOT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HUB=sys.argv[1]; BASE=os.path.join(ROOT, sys.argv[2])
A_,F=6378137.0,1/298.257223563; E2=F*(2-F)
FEAT=('water',) if '--no-pool' in sys.argv else ('water','poolWater')
def read_glb(p):
    b=open(p,'rb').read(); off,js,bin_=12,None,None
    while off+8<=len(b):
        ln,ty=struct.unpack_from('<II',b,off); d=b[off+8:off+8+ln]
        if ty==0x4E4F534A: js=json.loads(d)
        elif ty==0x004E4942: bin_=d
        off+=8+ln+((4-ln%4)%4)
    return js,bin_
CS={5120:('b',1),5121:('B',1),5122:('h',2),5123:('H',2),5125:('I',4),5126:('f',4)}
NC={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}
def acc(j,b,i):
    a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]
    fmt,sz=CS[a['componentType']]; nc=NC[a['type']]
    st=bv.get('byteStride') or sz*nc; base=bv.get('byteOffset',0)+a.get('byteOffset',0)
    return [struct.unpack_from('<'+fmt*nc,b,base+k*st) for k in range(a['count'])]
def mul(a,b):
    o=[0.0]*16
    for i in range(4):
        for j in range(4): o[i*4+j]=sum(a[k*4+j]*b[i*4+k] for k in range(4))
    return o
def ap(m,p):
    return [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]]
def to_lnglat(p):
    x,y,z=p; lng=np.degrees(np.arctan2(y,x)); p2=np.hypot(x,y); lat=np.arctan2(z,p2*(1-E2))
    for _ in range(8):
        N=A_/np.sqrt(1-E2*np.sin(lat)**2); h=p2/np.cos(lat)-N
        lat=np.arctan2(z,p2*(1-E2*N/(N+h)))
    return lng,np.degrees(lat)

if os.path.exists(BASE+'.json'):
    meta=json.load(open(BASE+'.json')); w,s,e,n=meta['bbox']
    img=Image.open(BASE+'.jpg').convert('RGB')
else:
    idx=json.load(open(os.path.join(ROOT,'backend/static/pinglu/imagery/imagery.json'),encoding='utf-8'))
    ent=next(t for t in idx['tiles'] if t['name']==os.path.basename(BASE))
    w,s,e,n=ent['bbox']
    img=Image.open(os.path.join(ROOT,'backend/static/pinglu/imagery',ent['file'])).convert('RGB')
W,H=img.size
mperpx=(e-w)*111320*math.cos(math.radians((s+n)/2))/W
px=lambda lng,lat:((lng-w)/(e-w)*W,(n-lat)/(n-s)*H)
TILES=os.path.join(ROOT,'backend/static/pinglu/tiles')
ts=json.load(open(os.path.join(TILES,'tileset.json'),encoding='utf-8'))
tris=[]
def walk(node,M):
    Wm=mul(M,node['transform']) if node.get('transform') else M
    uri=(node.get('content') or {}).get('uri') or ''
    if uri.startswith(HUB+'-') and os.path.exists(os.path.join(TILES,uri)):
        j,bin_=read_glb(os.path.join(TILES,uri))
        for m in j['meshes']:
            for pr in m['primitives']:
                if (j.get('materials') or [{}])[pr.get('material',0)].get('name','') not in FEAT: continue
                pos=acc(j,bin_,pr['attributes']['POSITION'])
                ind=acc(j,bin_,pr['indices']) if 'indices' in pr else None
                order=[i[0] for i in ind] if ind else list(range(len(pos)))
                flat=[px(*to_lnglat(ap(Wm,[pos[k][0],-pos[k][2],pos[k][1]]))) for k in order]
                for k in range(0,len(flat)-2,3):
                    t=[flat[k],flat[k+1],flat[k+2]]
                    if max(abs(q[0]) for q in t)>1e6: continue
                    tris.append(t)
    for c in node.get('children',[]): walk(c,Wm)
walk(ts['root'],[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])
mi=Image.new('L',(W,H),0); [ImageDraw.Draw(mi).polygon(t,fill=255) for t in tris]
A=np.asarray(mi)>0
a=np.asarray(img,dtype=np.float32); br=a.mean(axis=2)
mx=a.max(axis=2); mn=a.min(axis=2); sat=(mx-mn)/np.maximum(mx,1e-6)
gm=np.asarray(Image.fromarray(br.astype(np.uint8)).filter(ImageFilter.BoxBlur(2)),dtype=np.float32)
g2=np.asarray(Image.fromarray((br*br/255.0).clip(0,255).astype(np.uint8)).filter(ImageFilter.BoxBlur(2)),dtype=np.float32)
tex=np.sqrt(np.maximum(g2-gm*gm/255.0,0))
ys,xs=np.nonzero(A)
samp=np.median(a[ys,xs],axis=0)
dist=np.sqrt(((a-samp)**2).sum(axis=2))
sc=8; k=max(3,(int(300/mperpx)//sc)|1)
small=Image.fromarray((A*255).astype(np.uint8)).resize((W//sc,H//sc),Image.NEAREST)
corr=np.asarray(small.filter(ImageFilter.MaxFilter(k)).resize((W,H),Image.NEAREST))>0
B=(dist<32)&(tex<4.5)&corr
rows=[]
for y in range(H):
    m=np.nonzero(A[y])[0]; b=np.nonzero(B[y])[0]
    if len(m)<12 or len(b)<12: continue
    rows.append((y,m.mean()-b.mean()))
if not rows: sys.exit('无可比行')
arr=np.array(rows); dx=arr[:,1]
kk=31
xs2=np.array([median(dx[max(0,i-kk//2):i+kk//2+1]) for i in range(len(dx))])
med=float(median(xs2)); mad=float(median(np.abs(xs2-med)))
h1=float(median(xs2[:len(xs2)//4])); h2=float(median(xs2[-len(xs2)//4:]))
print('%s | 模型水面 %d px / 影像水面 %d px | 逐行重心差 中位 %+.1f m（MAD %.1f m，行 %d）'
      % (HUB, A.sum(), B.sum(), med*mperpx, mad*mperpx, len(rows)))
print('   分段：%s' % ' | '.join('%+.1f m' % (median(xs2[i*len(xs2)//4:(i+1)*len(xs2)//4])*mperpx) for i in range(4)))
# 斜率拟合：模型与影像各自的中心线 x(y)，各取上下四分位的中位点 -> 斜率 -> 走向（与真北夹角）
ys_all=np.array([r[0] for r in rows]); mx_all=np.array([r for r in rows])
model_c=np.array([np.nonzero(A[y])[0].mean() for y in ys_all])
img_c=np.array([np.nonzero(B[y])[0].mean() for y in ys_all])
def slope(c):
    q=len(c)//4
    return (median(c[-q:])-median(c[:q]))/(ys_all[-q:].mean()-ys_all[:q].mean())
bm, bi = slope(model_c), slope(img_c)
db=bm-bi
theta=math.degrees(math.atan(db))          # 中心线斜率差 ≈ 转角（弧度小角）
gap_center=(median(model_c)-median(img_c))*mperpx
print('   中心线斜率：模型 %+.4f 影像 %+.4f -> Δ斜率 %+.4f => **转角 %+.2f°**（正=模型顺时针偏）' % (bm, bi, db, theta))
print('   整段横向差（中位）%+.1f m（负=模型偏西）' % gap_center)
print('   建议：先转 %+.2f°，再横向平移 %+.1f m' % (-theta, -gap_center))

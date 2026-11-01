"""Export Anny (Apache-2.0, CC0 MakeHuman assets) male/female bodies to a compact binary for Mettl Motion.
Output per body: <name>.bin  layout described by <name>.json-like header at start.
Also bakes muscle-group masks (16 groups) and kit masks as vertex attributes."""
import torch, anny, json, struct, numpy as np, sys, os
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
m = anny.Anny().to(dtype=torch.float32)
labels = list(m.bone_labels); B = m.bone_count
parents = [int(p) for p in m.bone_parents]
faces = m.faces.numpy().astype(np.uint32)
vbi = m.vertex_bone_indices.numpy(); vbw = m.vertex_bone_weights.numpy()
L = {n: i for i, n in enumerate(labels)}
MUSCLES = ['hamstrings','glutes','adductors','erectors','lats','traps','rhomboids','forearms',
           'abs','quads','calves','pecs','delts','biceps','triceps','obliques']

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0 + 1e-9), 0, 1); return t * t * (3 - 2 * t)
def band(x, a, b, f):  # 1 inside [a,b], soft edges width f
    return smoothstep(a - f, a + f, x) * (1 - smoothstep(b - f, b + f, x))

# adjacency for smoothing
V = m.template_vertices.shape[0]
import scipy.sparse as sp
r = np.concatenate([faces[:,0],faces[:,1],faces[:,2],faces[:,1],faces[:,2],faces[:,0]])
c = np.concatenate([faces[:,1],faces[:,2],faces[:,0],faces[:,0],faces[:,1],faces[:,2]])
A = sp.coo_matrix((np.ones(len(r)), (r, c)), shape=(V, V)).tocsr(); A.data[:] = 1
deg = np.asarray(A.sum(1)).ravel(); Dinv = sp.diags(1 / np.maximum(deg, 1))
def smooth(x, it=6):
    for _ in range(it): x = 0.5 * x + 0.5 * (Dinv @ (A @ x))
    return x

def bw(names):  # summed weight of bones whose label starts with any prefix
    ids = [i for i, n in enumerate(labels) if any(n.startswith(p) for p in names)]
    w = np.zeros(V)
    for k in range(vbi.shape[1]):
        w += np.where(np.isin(vbi[:, k], ids), vbw[:, k], 0)
    return w

def export(name, pheno):
    out = m(pose_parameters=torch.eye(4)[None, None].repeat(1, B, 1, 1), phenotype_kwargs=pheno)
    P = out['rest_vertices'][0].numpy().astype(np.float64)
    BP = out['rest_bone_poses'][0].numpy().astype(np.float64)
    H = out['rest_bone_heads'][0].numpy().astype(np.float64)
    head = lambda n: H[L[n]]
    # body frame (anny/blender: z up, body faces -y)
    fwd = np.array([0, -1, 0.]); up = np.array([0, 0, 1.])
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    ax = np.abs(x)
    zHipJ = (head('upperleg01.L')[2] + head('upperleg01.R')[2]) / 2
    zKnee = head('lowerleg01.L')[2]; zAnk = head('foot.L')[2]
    zSh = head('upperarm01.L')[2]; zNeck = head('neck01')[2]; zHead = head('head')[2]
    ytorso = head('spine03')[1]
    back = (y > ytorso).astype(float)  # behind spine-ish plane (y positive = back)
    front = 1 - back
    # normals for front/back tests
    F = faces
    fn = np.cross(P[F[:,1]] - P[F[:,0]], P[F[:,2]] - P[F[:,0]])
    N = np.zeros_like(P)
    for k in range(3): np.add.at(N, F[:, k], fn)
    N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
    nback = N[:, 1]  # +y = facing back
    torso = bw(['spine', 'pelvis', 'clavicle', 'neck']) 
    thigh = bw(['upperleg']); shank = bw(['lowerleg']); uarm = bw(['upperarm']); farm = bw(['lowerarm'])
    shoulderw = bw(['shoulder01'])
    # limb angular coordinate around axis: theta=0 front, +/-180 back; side = towards body midline (medial) positive
    def limb_coords(top, bot, side_sign_by_x=True):
        a = H[L[top]]; b = H[L[bot]]; axis = (b - a) / np.linalg.norm(b - a)
        rel = P - a; t = rel @ axis / np.linalg.norm(b - a)
        f = fwd - axis * (fwd @ axis); f /= np.linalg.norm(f)
        s = np.cross(axis, f)
        th = np.degrees(np.arctan2(rel @ s, rel @ f))
        return t, th, s
    M = np.zeros((V, 16))
    for side in ['L', 'R']:
        sgn = 1 if head('upperleg01.' + side)[0] > 0 else -1
        sidev = (np.sign(x) == sgn).astype(float)
        t, th, s = limb_coords('upperleg01.' + side, 'lowerleg01.' + side)
        medial_sign = -sgn if s[0] * sgn > 0 else sgn  # direction of s pointing medially
        thm = th * (1 if (s[0] * -sgn) > 0 else -1)  # +90 = medial
        tw = thigh * sidev
        M[:, 0] += tw * band(t, 0.12, 0.92, 0.07) * smoothstep(110, 135, np.abs(thm)) # hamstrings (posterior)
        M[:, 9] += tw * band(t, 0.08, 0.90, 0.06) * (1 - smoothstep(80, 105, np.abs(thm))) * (1 - smoothstep(55, 80, thm))  # quads front/lateral, not medial
        M[:, 2] += tw * band(t, 0.0, 0.62, 0.08) * band(thm, 55, 130, 15)  # adductors medial
        t2, th2, s2 = limb_coords('lowerleg01.' + side, 'foot.' + side)
        M[:, 10] += shank * sidev * band(t2, 0.05, 0.6, 0.07) * smoothstep(100, 130, np.abs(th2))  # calves
        # arms
        t3, th3, _ = limb_coords('upperarm01.' + side, 'lowerarm01.' + side)
        uw = uarm * sidev
        M[:, 13] += uw * band(t3, 0.25, 0.9, 0.08) * (1 - smoothstep(50, 75, np.abs(th3)))  # biceps front
        M[:, 14] += uw * band(t3, 0.2, 0.9, 0.08) * smoothstep(105, 130, np.abs(th3))  # triceps back
        t4, th4, _ = limb_coords('lowerarm01.' + side, 'wrist.' + side)
        M[:, 7] += farm * sidev * band(t4, 0.02, 0.75, 0.08)  # forearms (flexors+extensors for grip)
        M[:, 12] += (shoulderw + uarm * (1 - smoothstep(0.15, 0.32, t3))) * sidev * smoothstep(zSh - 0.09, zSh - 0.03, z)  # delts
    hipw = 0.5 * abs(head('upperleg01.L')[0] - head('upperleg01.R')[0])
    shw = abs(head('upperarm01.L')[0])
    # glutes: posterior pelvis, between hip-joint-0.1 and hip+0.13
    M[:, 1] = smoothstep(0.0, 0.25, nback) * band(z, zHipJ - 0.09, zHipJ + 0.11, 0.035) * band(ax, 0.015, hipw + 0.07, 0.03) * (1 - uarm - farm).clip(0)
    # erectors: posterior torso near spine
    M[:, 3] = torso * smoothstep(0.2, 0.5, nback) * band(z, zHipJ + 0.09, zSh - 0.06, 0.04) * (1 - smoothstep(0.035, 0.065, ax))
    # lats: posterior lateral, triangle widening upward
    zl0 = zHipJ + 0.16; frac = np.clip((z - zl0) / (zSh - 0.06 - zl0), 0, 1)
    M[:, 4] = torso * smoothstep(-0.1, 0.25, nback) * band(z, zl0, zSh - 0.07, 0.04) * band(ax, 0.05, 0.07 + frac * (shw - 0.05), 0.025) * (1 - uarm)
    # traps: upper back from neck to shoulders + mid traps down to mid thoracic
    up_tr = band(z, zSh - 0.03, zNeck + 0.06, 0.03) * (1 - smoothstep(shw - 0.06, shw - 0.01, ax))
    mid_tr = band(z, zSh - 0.17, zSh - 0.02, 0.03) * (1 - smoothstep(0.08, 0.11, ax))
    M[:, 5] = smoothstep(0.1, 0.4, nback) * np.maximum(up_tr, mid_tr) * (1 - uarm)
    M[:, 6] = torso * smoothstep(0.3, 0.6, nback) * band(z, zSh - 0.17, zSh - 0.05, 0.025) * band(ax, 0.035, 0.085, 0.015)
    # abs + obliques: anterior torso
    nfront = -N[:, 1]
    zabs0 = zHipJ + 0.02; zabs1 = zSh - 0.17
    M[:, 8] = torso * smoothstep(0.3, 0.6, nfront) * band(z, zabs0, zabs1, 0.03) * (1 - smoothstep(0.065, 0.085, ax))
    M[:, 15] = torso * smoothstep(-0.2, 0.2, nfront) * band(z, zabs0 + 0.03, zabs1, 0.03) * band(ax, 0.08, hipw + 0.08, 0.02) * (1 - uarm)
    # pecs
    M[:, 11] = torso * smoothstep(0.2, 0.5, nfront) * band(z, zSh - 0.17, zSh - 0.0, 0.03) * band(ax, 0.02, shw - 0.01, 0.02) * (1 - uarm)
    M = np.clip(M, 0, 1)
    for k in range(16): M[:, k] = np.clip(smooth(M[:, k], 8), 0, 1)
    # kit: 1 tee (torso + upper arm to mid), 2 shorts (pelvis to mid-thigh), 3 shoes (foot+toes), 4 hair cap
    # kit as soft masks (smoothed so edges are clean): 0 tee, 1 shorts, 2 shoes, 3 hair
    t_u, _, _ = limb_coords('upperarm01.L', 'lowerarm01.L')
    t_uR, _, _ = limb_coords('upperarm01.R', 'lowerarm01.R')
    sleeve = np.where(x > 0, t_u, t_uR)
    armw = uarm + farm
    zCollar = zNeck - 0.035
    tee = smoothstep(zHipJ + 0.02, zHipJ + 0.05, z) * (1 - smoothstep(zCollar - 0.01, zCollar + 0.01, z + 0.03 * (y < head('neck01')[1]))) \
        * (1 - smoothstep(0.35, 0.6, armw) * smoothstep(0.36, 0.44, sleeve)) * (1 - smoothstep(0.3, 0.6, farm))
    tl, _, _ = limb_coords('upperleg01.L', 'lowerleg01.L'); tr, _, _ = limb_coords('upperleg01.R', 'lowerleg01.R')
    tleg = np.where(x > 0, tl, tr)
    shorts = (1 - smoothstep(zHipJ + 0.10, zHipJ + 0.13, z)) * (1 - smoothstep(0.4, 0.6, thigh) * smoothstep(0.44, 0.52, tleg)) * (1 - smoothstep(0.3, 0.6, shank)) * smoothstep(zKnee - 0.05, zKnee, z)
    footw = bw(['foot', 'toe'])
    shoes = np.maximum(1 - smoothstep(zAnk + 0.02, zAnk + 0.05, z), smoothstep(0.3, 0.6, footw))
    zEar = head('head')[2] + 0.06
    hair = smoothstep(0.4, 0.7, bw(['head'])) * smoothstep(zEar - 0.01, zEar + 0.02, z + 0.04 * (y > head('head')[1])) * smoothstep(-0.02, 0.03, y - head('head')[1] + 0.05)
    K = np.stack([tee, shorts, shoes, hair], 1)
    for k in range(4): K[:, k] = np.clip(smooth(K[:, k], 3), 0, 1)
    K[:, 0] *= (1 - K[:, 1])
    # top-4 skin weights
    idx = np.argsort(-vbw, axis=1)[:, :4]
    wi = np.take_along_axis(vbi, idx, 1).astype(np.uint16); ww = np.take_along_axis(vbw, idx, 1).astype(np.float32)
    ww /= ww.sum(1, keepdims=True)
    # convert to three.js frame: X right(x), Y up(z), Z forward(-y)
    C = np.array([[1,0,0,0],[0,0,1,0],[0,-1,0,0],[0,0,0,1.]])
    Pt = (P @ C[:3,:3].T).astype(np.float32)
    BPt = np.einsum('ij,bjk->bik', C, BP).astype(np.float32)
    header = {'bones': labels, 'parents': parents, 'V': int(V), 'F': int(len(faces)), 'muscles': MUSCLES,
              'height': float(P[:,2].max() - P[:,2].min()), 'pheno': pheno}
    hb = json.dumps(header).encode(); hb += b' ' * ((4 - len(hb) % 4) % 4)
    with open(os.path.join(OUT, name + '.bin'), 'wb') as f:
        f.write(struct.pack('<I', len(hb))); f.write(hb)
        f.write(Pt.tobytes()); f.write(faces.astype(np.uint16 if V < 65536 else np.uint32).tobytes())
        f.write(wi.tobytes()); f.write(ww.tobytes())
        f.write(BPt.transpose(0, 2, 1).reshape(B, 16).tobytes())  # column-major for three.js
        f.write((M * 255).round().astype(np.uint8).tobytes()); f.write((K * 255).round().astype(np.uint8).tobytes())
    print(name, 'height', header['height'], 'bytes', os.path.getsize(os.path.join(OUT, name + '.bin')))
    

export('male', {'gender': 0.0, 'age': 0.5, 'muscle': 0.62, 'weight': 0.5, 'height': 0.55, 'proportions': 0.5})
export('female', {'gender': 1.0, 'age': 0.5, 'muscle': 0.58, 'weight': 0.45, 'height': 0.5, 'proportions': 0.5})

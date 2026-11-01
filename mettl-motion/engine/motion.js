// Mettl Motion engine: realistic skinned bodies posed from exercise data.
// Bodies: Anny (Apache-2.0) with MakeHuman CC0 assets, exported by tools/export_bodies.py.
import * as THREE from 'three';

const D2R = Math.PI / 180;
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const qAxis = (axis, deg) => new THREE.Quaternion().setFromAxisAngle(axis, deg * D2R);
const lerp = (a, b, t) => a + (b - a) * t;
export const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const easeSine = (x) => -(Math.cos(Math.PI * x) - 1) / 2;

// ---------- Body loading ----------
export async function loadBody(url) {
  let buf;
  if (url.endsWith('.txt')) { const b64 = await (await fetch(url)).text(); const bin = atob(b64.trim()); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); buf = u.buffer; }
  else buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  const hlen = dv.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hlen)));
  const { V, F } = header; const B = header.bones.length;
  let o = 4 + hlen;
  const take = (Ctor, n) => { const a = new Ctor(buf, o, n); o += n * Ctor.BYTES_PER_ELEMENT; return a; };
  const pos = take(Float32Array, V * 3);
  const idx = take(Uint16Array, F * 3);
  const skinIndex = take(Uint16Array, V * 4);
  const skinWeight = take(Float32Array, V * 4);
  const boneMats = take(Float32Array, B * 16);
  const muscles = take(Uint8Array, V * 16);
  const kit = take(Uint8Array, V * 4);
  return { header, V, F, B, pos, idx, skinIndex, skinWeight, boneMats, muscles, kit };
}

// ---------- Material (matte skin + kit + muscle highlight) ----------
export function makeBodyMaterial(muscleNames) {
  const n = muscleNames.length;
  const uniforms = {
    uAct: { value: new Array(n).fill(0) },
    uCol: { value: new Array(n).fill(0).map(() => new THREE.Color(0xffb84d)) },
    uPat: { value: new Array(n).fill(0) },
    uKit: { value: [0xb48a74, 0x3a3162, 0x262043, 0x3a3355, 0x2b2236].map((c) => new THREE.Color(c)) },
    uPulse: { value: 0 },
  };
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 mA; attribute vec4 mB; attribute vec4 mC; attribute vec4 mD; attribute vec4 kitW;
        varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vD; varying vec4 vKit; varying vec3 vN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vA = mA; vB = mB; vC = mC; vD = mD; vKit = kitW;`)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        vN = normalize(transformedNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uAct[${n}]; uniform vec3 uCol[${n}]; uniform float uPat[${n}]; uniform vec3 uKit[5]; uniform float uPulse;
        varying vec4 vA; varying vec4 vB; varying vec4 vC; varying vec4 vD; varying vec4 vKit; varying vec3 vN;
        float mk(int i){ vec4 v = i<4?vA:(i<8?vB:(i<12?vC:vD)); int j = i - (i/4)*4; return j==0?v.x:(j==1?v.y:(j==2?v.z:v.w)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 base = uKit[0];
        base = mix(base, uKit[1], vKit.x); base = mix(base, uKit[2], vKit.y); base = mix(base, uKit[3], vKit.z); base = mix(base, uKit[4], vKit.w);
        diffuseColor.rgb = base;
        float skinOnly = 1.0 - max(vKit.z, vKit.w);
        vec3 glow = vec3(0.0); float cover = 0.0;
        if (skinOnly > 0.01) {
          float dots = step(0.55, fract(gl_FragCoord.x/4.0)) * step(0.55, fract(gl_FragCoord.y/4.0));
          for (int i = 0; i < ${n}; i++) {
            float m = mk(i) * uAct[i];
            if (uPat[i] > 0.5) m *= 0.35 + 0.65 * dots;
            m *= skinOnly; glow += uCol[i] * m; cover = max(cover, m);
          }
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55 + glow * 0.45, clamp(cover, 0.0, 1.0));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += glow * (0.55 + 0.25 * uPulse);
        float rim = pow(1.0 - abs(dot(normalize(vN), vec3(0.0,0.0,1.0))), 3.0);
        totalEmissiveRadiance += vec3(0.66,0.61,1.0) * rim * 0.10;`);
  };
  mat.userData.uniforms = uniforms;
  return mat;
}

// ---------- Rig ----------
export class Body {
  constructor(data) {
    this.data = data;
    const { header, V, pos, idx, skinIndex, skinWeight, boneMats, muscles, kit } = data;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    const m4 = (k) => { const a = new Uint8Array(V * 4); for (let v = 0; v < V; v++) for (let c = 0; c < 4; c++) a[v * 4 + c] = muscles[v * 16 + k * 4 + c]; return new THREE.BufferAttribute(a, 4, true); };
    g.setAttribute('mA', m4(0)); g.setAttribute('mB', m4(1)); g.setAttribute('mC', m4(2)); g.setAttribute('mD', m4(3));
    g.setAttribute('kitW', new THREE.BufferAttribute(kit, 4, true));
    g.computeVertexNormals();
    this.muscleNames = header.muscles;
    this.material = makeBodyMaterial(this.muscleNames);
    const bones = []; const restW = [];
    header.bones.forEach((name, i) => {
      const b = new THREE.Bone(); b.name = name;
      const w = new THREE.Matrix4().fromArray(boneMats, i * 16);
      // drop scale from rest matrices (orthonormalise)
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      w.decompose(p, q, s); w.compose(p, q, new THREE.Vector3(1, 1, 1));
      restW.push(w); bones.push(b);
    });
    header.parents.forEach((p, i) => {
      const local = p < 0 ? restW[i].clone() : new THREE.Matrix4().copy(restW[p]).invert().multiply(restW[i]);
      local.decompose(bones[i].position, bones[i].quaternion, bones[i].scale);
      if (p >= 0) bones[p].add(bones[i]);
    });
    this.bones = bones; this.by = Object.fromEntries(bones.map((b, i) => [b.name, b]));
    this.restLocalQ = bones.map((b) => b.quaternion.clone());
    this.restLocalP = bones.map((b) => b.position.clone());
    this.restWorldQ = restW.map((w) => new THREE.Quaternion().setFromRotationMatrix(w));
    this.restWorldP = restW.map((w) => new THREE.Vector3().setFromMatrixPosition(w));
    this.index = Object.fromEntries(header.bones.map((n, i) => [n, i]));
    const mesh = new THREE.SkinnedMesh(g, this.material);
    mesh.add(bones[0]); mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.castShadow = true; mesh.frustumCulled = false;
    this.mesh = mesh;
    this.height = header.height;
    this._measure();
  }
  rp(name) { return this.restWorldP[this.index[name]].clone(); }
  _measure() {
    const r = (n) => this.rp(n);
    this.ankleMidRest = r('foot.L').add(r('foot.R')).multiplyScalar(0.5);
    const toe = r('toe3-1.L'); const heelZ = r('foot.L').z - 0.055;
    this.midfootZ = (heelZ + toe.z) / 2;
    this.hipHalf = Math.abs(r('upperleg01.L').x);
    this.shoulderHalf = Math.abs(r('upperarm01.L').x);
    this.kneeY = r('lowerleg01.L').y;
    this.floorY = Math.min(...Array.from({ length: this.data.V }, (_, i) => this.data.pos[i * 3 + 1]));
    const len = (a, b) => r(a).distanceTo(r(b));
    this.arm = { l1: len('upperarm01.L', 'lowerarm01.L'), l2: len('lowerarm01.L', 'wrist.L'), hand: len('wrist.L', 'finger3-1.L') * 0.62 };
    this.thighLen = len('upperleg01.L', 'lowerleg01.L');
    // hand frames at rest
    this.handRest = {};
    for (const s of ['L', 'R']) {
      const w = r('wrist.' + s), mid = r('metacarpal3.' + s).lerp(r('finger3-1.' + s), 0.5), th = r('finger1-1.' + s);
      const a = mid.clone().sub(w).normalize();
      const t = th.clone().sub(w); t.sub(a.clone().multiplyScalar(t.dot(a))).normalize();
      const palm = new THREE.Vector3().crossVectors(a, t).multiplyScalar(s === 'L' ? 1 : -1).normalize();
      this.handRest[s] = { a, palm, t };
    }
  }
  reset() {
    this.bones.forEach((b, i) => { b.quaternion.copy(this.restLocalQ[i]); b.position.copy(this.restLocalP[i]); });
  }
  // rotate a bone by a world-axis rotation D, relative to its parent (anatomical joint rotation)
  rotWorld(name, D) {
    const i = this.index[name]; if (i === undefined) return;
    const rw = this.restWorldQ[i];
    const delta = rw.clone().invert().multiply(D).multiply(rw);
    this.bones[i].quaternion.copy(this.restLocalQ[i]).multiply(delta);
  }
  setWorldQ(name, Qd) {
    const b = this.by[name]; b.parent.updateWorldMatrix(true, false);
    const pq = new THREE.Quaternion(); b.parent.getWorldQuaternion(pq);
    // account for mesh transform (identity rotation expected)
    b.quaternion.copy(pq.invert().multiply(Qd));
    b.updateWorldMatrix(false, true);
  }
  wp(name) { const v = new THREE.Vector3(); this.by[name].getWorldPosition(v); return this.mesh.worldToLocal(v); }
  wq(name) { const q = new THREE.Quaternion(); this.by[name].getWorldQuaternion(q); return q; }
}

// ---------- Pose solver ----------
// pose: { lean, hipFlex, kneeFlex, ankleDorsi, spineFlex, neckFlex } in degrees (sagittal)
export function applyPose(body, pose, load, grip) {
  body.reset();
  const root = body.bones[0];
  body.rotWorld('root', qAxis(X, pose.lean));
  const spine = ['spine05', 'spine04', 'spine03', 'spine02', 'spine01'];
  spine.forEach((s) => body.rotWorld(s, qAxis(X, (pose.spineFlex || 0) / spine.length)));
  for (const s of ['L', 'R']) {
    body.rotWorld('upperleg01.' + s, qAxis(X, -pose.hipFlex));
    body.rotWorld('lowerleg01.' + s, qAxis(X, pose.kneeFlex));
    body.rotWorld('foot.' + s, qAxis(X, -pose.ankleDorsi));
  }
  ['neck01', 'neck02', 'neck03'].forEach((n) => body.rotWorld(n, qAxis(X, (pose.neckFlex || 0) / 3)));
  // foot lock: keep ankles where they are at rest
  body.mesh.updateMatrixWorld(true);
  const mid = body.wp('foot.L').add(body.wp('foot.R')).multiplyScalar(0.5);
  root.position.add(body.ankleMidRest.clone().sub(mid));
  body.mesh.updateMatrixWorld(true);
  // hands on the load
  const sol = solveLoad(body, load, grip);
  for (const s of ['L', 'R']) armIK(body, s, sol.hands[s], sol.palm);
  curlFingers(body, grip.curl ?? 1);
  body.mesh.updateMatrixWorld(true);
  return sol;
}

// Where is the load? Arms hang straight (soft elbows); the load path is vertical over mid-foot
// but never passes through the legs.
function solveLoad(body, load, grip) {
  const S = { L: body.wp('upperarm01.L'), R: body.wp('upperarm01.R') };
  const reach = (body.arm.l1 + body.arm.l2) * 0.992 + body.arm.hand;
  const half = grip.half(body);
  const hip = body.wp('upperleg01.L'), knee = body.wp('lowerleg01.L'), ank = body.wp('foot.L');
  const frontAt = (y) => { // front surface z of the leg at height y (centreline + soft-tissue radius)
    if (y > knee.y) { const t = (hip.y - y) / (hip.y - knee.y); return lerp(hip.z, knee.z, t) + lerp(0.085, 0.06, t); }
    const t = (knee.y - y) / (knee.y - ank.y); return lerp(knee.z, ank.z, t) + lerp(0.055, 0.045, t);
  };
  let z = body.midfootZ + (load.zOffset || 0), y = 0;
  for (let it = 0; it < 4; it++) {
    const dz = z - S.L.z, dx = half - Math.abs(S.L.x);
    y = S.L.y - Math.sqrt(Math.max(0.01, reach * reach - dx * dx - dz * dz)) - (load.handDrop || 0);
    if (load.touchLegs) z = Math.max(body.midfootZ + (load.zOffset || 0), frontAt(y + (load.contactDy || 0)) + (load.contactR || 0.016));
  }
  const centre = new THREE.Vector3(0, y, z);
  return { centre, hands: { L: new THREE.Vector3(half, y, z), R: new THREE.Vector3(-half, y, z) }, palm: grip.palm || 'back' };
}

function armIK(body, s, grip, palmMode) {
  const { l1, l2, hand } = body.arm;
  const S = body.wp('upperarm01.' + s);
  let T = grip.clone();
  let fdir = T.clone().sub(S).normalize();
  let E;
  for (let it = 0; it < 3; it++) {
    const W = grip.clone().sub(fdir.clone().multiplyScalar(hand));
    const d = Math.min(W.distanceTo(S), l1 + l2 - 1e-4);
    const toW = W.clone().sub(S).normalize();
    const pole = new THREE.Vector3(0, 0, -1); // elbows point back
    const n = new THREE.Vector3().crossVectors(toW, pole).normalize();
    const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const up = toW.clone().applyAxisAngle(n, -Math.acos(cosA));
    E = S.clone().add(up.multiplyScalar(l1));
    fdir = W.clone().sub(E).normalize();
    T = W;
  }
  const i = (n) => body.index[n];
  // upper arm: swing rest direction onto S->E
  const restU = body.restWorldP[i('lowerarm01.' + s)].clone().sub(body.restWorldP[i('upperarm01.' + s)]).normalize();
  const qU = new THREE.Quaternion().setFromUnitVectors(restU, E.clone().sub(S).normalize());
  body.setWorldQ('upperarm01.' + s, qU.clone().multiply(body.restWorldQ[i('upperarm01.' + s)]));
  body.setWorldQ('upperarm02.' + s, qU.clone().multiply(body.restWorldQ[i('upperarm02.' + s)]));
  // forearm
  const restF = body.restWorldP[i('wrist.' + s)].clone().sub(body.restWorldP[i('lowerarm01.' + s)]).normalize();
  const Ecur = body.wp('lowerarm01.' + s);
  const qF = new THREE.Quaternion().setFromUnitVectors(restF, T.clone().sub(Ecur).normalize());
  // hand frame target
  const hr = body.handRest[s];
  const a = fdir.clone();
  const want = palmMode === 'in' ? new THREE.Vector3(s === 'L' ? -1 : 1, 0, 0) : new THREE.Vector3(0, 0, -1);
  const palm = want.sub(a.clone().multiplyScalar(want.dot(a))).normalize();
  const frame = (u, v) => new THREE.Matrix4().makeBasis(u, v, new THREE.Vector3().crossVectors(u, v));
  const R = frame(a, palm).multiply(frame(hr.a, hr.palm).invert());
  const qW = new THREE.Quaternion().setFromRotationMatrix(R);
  // split the forearm twist between the two forearm bones to avoid candy-wrapping
  const qFfull = qW; // rotation the hand needs from rest
  const twist = qF.clone().invert().multiply(qFfull); // residual after swing
  const half = new THREE.Quaternion().slerp(twist, 0.5);
  const hq = new THREE.Quaternion().identity().slerp(twist, 0.5);
  body.setWorldQ('lowerarm01.' + s, qF.clone().multiply(body.restWorldQ[i('lowerarm01.' + s)]));
  body.setWorldQ('lowerarm02.' + s, qF.clone().multiply(hq).multiply(body.restWorldQ[i('lowerarm02.' + s)]));
  body.setWorldQ('wrist.' + s, qW.clone().multiply(body.restWorldQ[i('wrist.' + s)]));
  void half;
}

function curlFingers(body, amt) {
  for (const s of ['L', 'R']) {
    const hr = body.handRest[s];
    const k = new THREE.Vector3().crossVectors(hr.a, hr.palm).normalize();
    for (const f of [2, 3, 4, 5]) {
      [62, 78, 52].forEach((deg, j) => body.rotWorld(`finger${f}-${j + 1}.${s}`, new THREE.Quaternion().setFromAxisAngle(k, deg * amt * D2R)));
    }
    const kt = new THREE.Vector3().crossVectors(hr.t, hr.palm).normalize();
    [25, 35, 30].forEach((deg, j) => body.rotWorld(`finger1-${j + 1}.${s}`, new THREE.Quaternion().setFromAxisAngle(kt, deg * amt * D2R)));
  }
}

// ---------- Equipment ----------
const steel = () => new THREE.MeshStandardMaterial({ color: 0x8e88a6, metalness: 0.8, roughness: 0.35 });
const plateMat = () => new THREE.MeshStandardMaterial({ color: 0x2a2342, roughness: 0.6, metalness: 0.1 });
const rimMat = () => new THREE.MeshStandardMaterial({ color: 0xa99bff, roughness: 0.5, emissive: 0x2a2060 });
function cyl(r, len, mat, axis = 'x', seg = 40) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  if (axis === 'x') m.rotation.z = Math.PI / 2; if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.castShadow = true; return m;
}
export const EQUIPMENT = {
  barbell: {
    label: 'Barbell', load: '100 kg',
    build() {
      const g = new THREE.Group();
      g.add(cyl(0.014, 1.31, steel()));
      for (const sx of [-1, 1]) {
        const sleeve = cyl(0.025, 0.445, steel()); sleeve.position.x = sx * (0.655 + 0.2225); g.add(sleeve);
        const collar = cyl(0.032, 0.03, steel()); collar.position.x = sx * 0.67; g.add(collar);
        for (let p = 0; p < 2; p++) {
          const x = sx * (0.69 + 0.033 + p * 0.068);
          const pm = plateMat(); pm.transparent = true; const rm = rimMat(); rm.transparent = true;
          const plate = cyl(0.225, 0.064, pm, 'x', 64); plate.position.x = x; plate.userData.side = sx; g.add(plate);
          const rim = new THREE.Mesh(new THREE.TorusGeometry(0.222, 0.004, 8, 64), rm);
          rim.rotation.y = Math.PI / 2; rim.position.x = x + sx * 0.033; rim.userData.side = sx; g.add(rim);
        }
      }
      return g;
    },
    grip: { half: (b) => Math.max(b.shoulderHalf * 0.98, b.hipHalf + 0.13), palm: 'back' },
    load_: { touchLegs: true, contactR: 0.016 },
    attach(obj, sol) { obj.position.copy(sol.centre); },
    width: 2.2,
  },
  dumbbells: {
    label: 'Dumbbells', load: '2 × 22.5 kg',
    build() {
      const g = new THREE.Group();
      const one = () => {
        const d = new THREE.Group(); d.add(cyl(0.017, 0.13, steel()));
        for (const sx of [-1, 1]) {
          const head = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.075, 6), plateMat());
          head.rotation.z = Math.PI / 2; head.rotation.x = Math.PI / 6; head.position.x = sx * 0.1025; head.castShadow = true; d.add(head);
        }
        return d;
      };
      g.userData.L = one(); g.userData.R = one(); g.add(g.userData.L, g.userData.R); return g;
    },
    grip: { half: (b) => b.hipHalf + 0.135, palm: 'in' },
    load_: { touchLegs: false, zOffset: 0.02 },
    attach(obj, sol) { for (const s of ['L', 'R']) { const d = obj.userData[s]; d.position.copy(sol.hands[s]); d.rotation.y = Math.PI / 2; } },
    width: 0.9,
  },
  kettlebell: {
    label: 'Kettlebell', load: '24 kg',
    build() {
      const g = new THREE.Group();
      const bell = new THREE.Mesh(new THREE.SphereGeometry(0.105, 48, 32), plateMat()); bell.position.y = -0.155; bell.castShadow = true;
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 16, 48, Math.PI), steel()); handle.position.y = -0.075; handle.castShadow = true;
      const base = cyl(0.07, 0.01, plateMat(), 'y'); base.position.y = -0.255;
      g.add(bell, handle, base); return g;
    },
    grip: { half: () => 0.045, palm: 'back' },
    load_: { touchLegs: false, zOffset: -0.02, handDrop: 0 },
    attach(obj, sol) { obj.position.copy(sol.centre); obj.position.y += 0.0; },
    width: 0.8,
  },
};

// ---------- Exercise player ----------
export class Exercise {
  constructor(def) { this.def = def; this.total = def.phases.reduce((s, p) => s + p.dur, 0); }
  sample(t) { // t seconds -> { pose, phase, k (0..1 through rep), progress in phase }
    t = ((t % this.total) + this.total) % this.total;
    let acc = 0;
    for (const ph of this.def.phases) {
      if (t < acc + ph.dur) {
        const u = (t - acc) / ph.dur; const e = ph.hold ? 0 : ease(u);
        const A = this.def.poses[ph.from], Bp = this.def.poses[ph.to];
        const pose = {}; for (const k of Object.keys(A)) pose[k] = lerp(A[k], Bp[k] ?? A[k], e);
        return { pose, phase: ph, u, depth: depthOf(this.def, pose) };
      }
      acc += ph.dur;
    }
  }
  muscles(t) { // activation per muscle at time t, interpolated across phase keys
    const s = this.sample(t); const ph = s.phase; const out = {};
    for (const [name, m] of Object.entries(this.def.muscles)) {
      const a = m.act[ph.actFrom] ?? 0, b = m.act[ph.actTo] ?? a;
      out[name] = { v: lerp(a, b, easeSine(s.u)), tier: m.tier };
    }
    return out;
  }
}
function depthOf(def, pose) { const a = def.poses.top.hipFlex, b = def.poses.bottom.hipFlex; return (pose.hipFlex - a) / (b - a); }

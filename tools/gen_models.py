#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_models.py — 程序化生成 1928 黑白橡皮管风格角色 GLB（带骨骼+动画）。
纯 Python3 标准库，手写 glTF 2.0 二进制（JSON chunk + BIN chunk）。

产出（assets/models/）：
  willie_mickey.glb   汽船水手米奇 1.65h
                      骨骼名 Root/Spine2/Head/ShoulderL/ArmL1/ArmL2/HandL/ShoulderR/ArmR1/ArmR2/HandR/HipL/KneeL/AnkleL/FootL/HipR/...
                      clips: idle/walk/run/jump/fall/land/die/whistle/steer/squash/stretch
  minnie1928.glb      1928 米妮（花帽+裙装）1.6h，同骨骼名，clips: idle/walk/run/.../talk
  blackcat_mate.glb   黑猫大副 2.4h，clips: idle/walk/run/attack/hit/die
  steam_parrot.glb    巨型蒸汽鹦鹉号 BOSS 55max，clips: fly/fast/taunt/headbutt/punch/hit/death

用法：python3 tools/gen_models.py
"""
import json
import math
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, 'assets', 'models')

DEG = math.pi / 180.0

# =====================================================================
# mat4（列主序，与 glTF/three.js 一致）
# =====================================================================
def m4_id():
    return [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]

def m4_mul(a, b):
    out = [0.0] * 16
    for c in range(4):
        for r in range(4):
            out[c * 4 + r] = (a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1]
                              + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3])
    return out

def m4_translate(x, y, z):
    m = m4_id()
    m[12], m[13], m[14] = x, y, z
    return m

def m4_scale(sx, sy, sz):
    m = m4_id()
    m[0], m[5], m[10] = sx, sy, sz
    return m

def m4_rot_x(a):
    c, s = math.cos(a), math.sin(a)
    m = m4_id()
    m[5], m[6], m[9], m[10] = c, s, -s, c
    return m

def m4_rot_y(a):
    c, s = math.cos(a), math.sin(a)
    m = m4_id()
    m[0], m[2], m[8], m[10] = c, -s, s, c
    return m

def m4_rot_z(a):
    c, s = math.cos(a), math.sin(a)
    m = m4_id()
    m[0], m[1], m[4], m[5] = c, s, -s, c
    return m

def m4_point(m, p):
    x, y, z = p
    return (m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14])

def m4_vec(m, v):
    x, y, z = v
    return (m[0] * x + m[4] * y + m[8] * z,
            m[1] * x + m[5] * y + m[9] * z,
            m[2] * x + m[6] * y + m[10] * z)

def m4_inv(m):
    a00, a01, a02, a03 = m[0], m[4], m[8], m[12]
    a10, a11, a12, a13 = m[1], m[5], m[9], m[13]
    a20, a21, a22, a23 = m[2], m[6], m[10], m[14]
    a30, a31, a32, a33 = m[3], m[7], m[11], m[15]
    b00 = a00 * a11 - a01 * a10; b01 = a00 * a12 - a02 * a10
    b02 = a00 * a13 - a03 * a10; b03 = a01 * a12 - a02 * a11
    b04 = a01 * a13 - a03 * a11; b05 = a02 * a13 - a03 * a12
    b06 = a20 * a31 - a21 * a30; b07 = a20 * a32 - a22 * a30
    b08 = a20 * a33 - a23 * a30; b09 = a21 * a32 - a22 * a31
    b10 = a21 * a33 - a23 * a31; b11 = a22 * a33 - a23 * a32
    det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
    if abs(det) < 1e-12:
        return m4_id()
    det = 1.0 / det
    out = [0.0] * 16
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det
    out[4] = (a02 * b10 - a01 * b11 - a03 * b09) * det
    out[8] = (a31 * b05 - a32 * b04 + a33 * b03) * det
    out[12] = (a22 * b04 - a21 * b05 - a23 * b03) * det
    out[1] = (a12 * b08 - a10 * b11 - a13 * b07) * det
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det
    out[9] = (a32 * b02 - a30 * b05 - a33 * b01) * det
    out[13] = (a20 * b05 - a22 * b02 + a23 * b01) * det
    out[2] = (a10 * b10 - a11 * b08 + a13 * b06) * det
    out[6] = (a01 * b08 - a00 * b10 - a03 * b06) * det
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det
    out[14] = (a21 * b02 - a20 * b04 - a23 * b00) * det
    out[3] = (a11 * b07 - a10 * b09 - a12 * b06) * det
    out[7] = (a00 * b09 - a01 * b07 + a02 * b06) * det
    out[11] = (a31 * b01 - a30 * b03 - a32 * b00) * det
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det
    return out

def euler_quat(rx, ry, rz):
    cx, sx = math.cos(rx / 2), math.sin(rx / 2)
    cy, sy = math.cos(ry / 2), math.sin(ry / 2)
    cz, sz = math.cos(rz / 2), math.sin(rz / 2)
    return (sx * cy * cz - cx * sy * sz,
            cx * sy * cz + sx * cy * sz,
            cx * cy * sz - sx * sy * cz,
            cx * cy * cz + sx * sy * sz)

# =====================================================================
# 基础几何（局部空间，y 向上）
# =====================================================================
def sh_sphere(rx, ry, rz, seg=18, rings=12):
    pos, nor, idx = [], [], []
    for r in range(rings + 1):
        phi = math.pi * r / rings
        sp, cp = math.sin(phi), math.cos(phi)
        for s in range(seg):
            th = 2 * math.pi * s / seg
            x, y, z = sp * math.cos(th), cp, sp * math.sin(th)
            pos.append((x * rx, y * ry, z * rz))
            nor.append((x, y, z))
    for r in range(rings):
        for s in range(seg):
            a = r * seg + s
            b = a + seg
            c = r * seg + (s + 1) % seg
            d = b + (s + 1) % seg
            if r > 0:
                idx += [a, b, c]
            if r < rings - 1:
                idx += [c, b, d]
    return pos, nor, idx

def sh_cyl(rt, rb, h, seg=16, cap_top=True, cap_bot=True):
    pos, nor, idx = [], [], []
    angs = [2 * math.pi * i / seg for i in range(seg + 1)]
    n = len(angs)
    for a in angs:
        x, z = math.cos(a), math.sin(a)
        pos.append((x * rt, h / 2, z * rt)); nor.append((x, 0, z))
        pos.append((x * rb, -h / 2, z * rb)); nor.append((x, 0, z))
    for i in range(n - 1):
        a, b, c, d = i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 3
        idx += [a, b, c, c, b, d]
    if cap_top:
        ctr = len(pos); pos.append((0, h / 2, 0)); nor.append((0, 1, 0))
        for i in range(n - 1):
            idx += [ctr, i * 2, (i + 1) * 2]
    if cap_bot:
        ctr = len(pos); pos.append((0, -h / 2, 0)); nor.append((0, -1, 0))
        for i in range(n - 1):
            idx += [ctr, (i + 1) * 2 + 1, i * 2 + 1]
    return pos, nor, idx

def sh_box(sx, sy, sz):
    x, y, z = sx / 2, sy / 2, sz / 2
    faces = [
        ((0, 0, 1), [(-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)]),
        ((0, 0, -1), [(x, -y, -z), (-x, -y, -z), (-x, y, -z), (x, y, -z)]),
        ((1, 0, 0), [(x, -y, z), (x, -y, -z), (x, y, -z), (x, y, z)]),
        ((-1, 0, 0), [(-x, -y, -z), (-x, -y, z), (-x, y, z), (-x, y, -z)]),
        ((0, 1, 0), [(-x, y, z), (x, y, z), (x, y, -z), (-x, y, -z)]),
        ((0, -1, 0), [(-x, -y, -z), (x, -y, -z), (x, -y, z), (-x, -y, z)]),
    ]
    pos, nor, idx = [], [], []
    for n, quad in faces:
        b = len(pos)
        pos += quad
        nor += [n] * 4
        idx += [b, b + 1, b + 2, b, b + 2, b + 3]
    return pos, nor, idx

def sh_disc(rx, ry, seg=16, a0=0.0, a1=2 * math.pi):
    """XY 平面内扇形圆盘，法线 +z。"""
    pos, nor, idx = [(0, 0, 0)], [(0, 0, 1)], []
    steps = max(3, int(seg * abs(a1 - a0) / (2 * math.pi)))
    for i in range(steps + 1):
        a = a0 + (a1 - a0) * i / steps
        pos.append((math.cos(a) * rx, math.sin(a) * ry, 0))
        nor.append((0, 0, 1))
    for i in range(1, steps + 1):
        idx += [0, i, i + 1]
    return pos, nor, idx

def sh_cap(rx, ry, rz, a0, a1, b0, b1, seg=14, rings=8):
    """椭球面贴片（贴合头骨的脸/嘴部）。a=水平方位角(0=+z)，b=自 +y 极角。"""
    pos, nor, idx = [], [], []
    for r in range(rings + 1):
        b = b0 + (b1 - b0) * r / rings
        sb, cb = math.sin(b), math.cos(b)
        for s in range(seg + 1):
            a = a0 + (a1 - a0) * s / seg
            x, y, z = sb * math.sin(a), cb, sb * math.cos(a)
            pos.append((x * rx, y * ry, z * rz))
            nor.append((x, y, z))
    row = seg + 1
    for r in range(rings):
        for s in range(seg):
            q = r * row + s
            idx += [q, q + row, q + 1, q + 1, q + row, q + row + 1]
    return pos, nor, idx

def sh_tube_path(pts, r, seg=10):
    """沿折线的软管（橡皮管四肢）。"""
    pos, nor, idx = [], [], []
    n = len(pts)
    for i, p in enumerate(pts):
        if i < n - 1:
            d = (pts[i + 1][0] - p[0], pts[i + 1][1] - p[1], pts[i + 1][2] - p[2])
        else:
            d = (p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2])
        L = math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2) or 1.0
        d = (d[0] / L, d[1] / L, d[2] / L)
        up = (0, 1, 0) if abs(d[1]) < 0.9 else (1, 0, 0)
        u = (d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0])
        Lu = math.sqrt(u[0] ** 2 + u[1] ** 2 + u[2] ** 2) or 1.0
        u = (u[0] / Lu, u[1] / Lu, u[2] / Lu)
        v = (d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0])
        for s in range(seg):
            a = 2 * math.pi * s / seg
            ca, sa = math.cos(a), math.sin(a)
            nx = u[0] * ca + v[0] * sa
            ny = u[1] * ca + v[1] * sa
            nz = u[2] * ca + v[2] * sa
            pos.append((p[0] + nx * r, p[1] + ny * r, p[2] + nz * r))
            nor.append((nx, ny, nz))
    for i in range(n - 1):
        for s in range(seg):
            a = i * seg + s
            b = (i + 1) * seg + s
            c = i * seg + (s + 1) % seg
            dd = (i + 1) * seg + (s + 1) % seg
            idx += [a, b, c, c, b, dd]
    c0 = len(pos); pos.append(pts[0]); nor.append((0, -1, 0))
    c1 = len(pos); pos.append(pts[-1]); nor.append((0, 1, 0))
    for s in range(seg):
        idx += [c0, (s + 1) % seg, s]
        idx += [c1, (n - 1) * seg + s, (n - 1) * seg + (s + 1) % seg]
    return pos, nor, idx

# =====================================================================
# GLB 写出器（glTF 2.0 二进制）
# =====================================================================
class GLB:
    def __init__(self):
        self.bin = bytearray()
        self.accessors = []
        self.bufferViews = []
        self.nodes = []
        self.meshes = []
        self.skins = []
        self.animations = []
        self.materials = []

    def material(self, rgb, rough=0.85, metal=0.0):
        self.materials.append({
            "pbrMetallicRoughness": {
                "baseColorFactor": [rgb[0], rgb[1], rgb[2], 1.0],
                "roughnessFactor": rough, "metallicFactor": metal},
            "doubleSided": True})
        return len(self.materials) - 1

    def _buf(self, data, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        off = len(self.bin)
        self.bin += data
        bv = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target:
            bv["target"] = target
        self.bufferViews.append(bv)
        return len(self.bufferViews) - 1

    def acc_f32(self, flat, type_='VEC3', target=34962, minmax=True):
        bv = self._buf(struct.pack('<%df' % len(flat), *flat), target)
        nc = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[type_]
        a = {"bufferView": bv, "componentType": 5126, "count": len(flat) // nc, "type": type_}
        if minmax:
            a["min"] = [min(flat[i::nc]) for i in range(nc)]
            a["max"] = [max(flat[i::nc]) for i in range(nc)]
        self.accessors.append(a)
        return len(self.accessors) - 1

    def acc_u16(self, vals, type_='SCALAR', target=34963):
        bv = self._buf(struct.pack('<%dH' % len(vals), *vals), target)
        nc = {'SCALAR': 1, 'VEC4': 4}[type_]
        self.accessors.append({"bufferView": bv, "componentType": 5123,
                               "count": len(vals) // nc, "type": type_})
        return len(self.accessors) - 1

    def node(self, name, t=(0, 0, 0), children=None, mesh=None, skin=None):
        nd = {"name": name, "translation": [float(t[0]), float(t[1]), float(t[2])]}
        if children:
            nd["children"] = list(children)
        if mesh is not None:
            nd["mesh"] = mesh
        if skin is not None:
            nd["skin"] = skin
        self.nodes.append(nd)
        return len(self.nodes) - 1

    def mesh(self, name, prims):
        mprims = []
        for p in prims:
            pos_flat = [c for v in p['pos'] for c in v]
            nor_flat = [c for v in p['nor'] for c in v]
            jnt_flat = [c for v in p['joints'] for c in v]
            wgt_flat = [c for v in p['weights'] for c in v]
            mprims.append({
                "attributes": {
                    "POSITION": self.acc_f32(pos_flat, 'VEC3'),
                    "NORMAL": self.acc_f32(nor_flat, 'VEC3'),
                    "JOINTS_0": self.acc_u16(jnt_flat, 'VEC4', target=34962),
                    "WEIGHTS_0": self.acc_f32(wgt_flat, 'VEC4', minmax=False),
                },
                "indices": self.acc_u16(list(p['idx'])),
                "material": p['material'],
            })
        self.meshes.append({"name": name, "primitives": mprims})
        return len(self.meshes) - 1

    def skin(self, joints, ibm_flat, skel_root):
        self.skins.append({
            "joints": list(joints),
            "inverseBindMatrices": self.acc_f32(ibm_flat, 'MAT4', target=None),
            "skeleton": skel_root})
        return len(self.skins) - 1

    def animation(self, name, channels):
        samplers, chans = [], []
        for node_idx, path, times, vals, interp in channels:
            acc_in = self.acc_f32(list(times), 'SCALAR', target=None)
            acc_out = self.acc_f32(list(vals),
                                   'VEC4' if path == 'rotation' else 'VEC3',
                                   target=None)
            samplers.append({"input": acc_in, "output": acc_out, "interpolation": interp})
            chans.append({"sampler": len(samplers) - 1,
                          "target": {"node": node_idx, "path": path}})
        self.animations.append({"name": name, "samplers": samplers, "channels": chans})

    def write(self, path):
        gltf = {
            "asset": {"version": "2.0", "generator": "willie-gen"},
            "scene": 0,
            "scenes": [{"nodes": [0]}],
            "nodes": self.nodes,
            "meshes": self.meshes,
            "skins": self.skins,
            "animations": self.animations,
            "materials": self.materials,
            "accessors": self.accessors,
            "bufferViews": self.bufferViews,
            "buffers": [{"byteLength": len(self.bin)}],
        }
        js = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
        while len(js) % 4:
            js += b' '
        binchunk = bytes(self.bin)
        while len(binchunk) % 4:
            binchunk += b'\x00'
        total = 12 + 8 + len(js) + 8 + len(binchunk)
        with open(path, 'wb') as f:
            f.write(struct.pack('<III', 0x46546C67, 2, total))
            f.write(struct.pack('<II', len(js), 0x4E4F534A))
            f.write(js)
            f.write(struct.pack('<II', len(binchunk), 0x004E4942))
            f.write(binchunk)
        print("  wrote %s  (%.1f KB, %d clips, %d nodes)" %
              (os.path.basename(path), total / 1024.0, len(self.animations), len(self.nodes)))

# =====================================================================
# 角色构建框架
# =====================================================================
def kf_eval(kfs, t):
    if t <= kfs[0][0]:
        return kfs[0][1]
    if t >= kfs[-1][0]:
        return kfs[-1][1]
    for i in range(len(kfs) - 1):
        t0, v0 = kfs[i]
        t1, v1 = kfs[i + 1]
        if t0 <= t <= t1:
            f = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
            return tuple(v0[j] + (v1[j] - v0[j]) * f for j in range(len(v0)))
    return kfs[-1][1]

class CharBuilder:
    """部件 + 骨骼（绝对坐标）+ 动画 -> 归一化蒙皮 GLB。"""

    def __init__(self, name, target_height=None, target_max=None):
        self.name = name
        self.target_h = target_height
        self.target_max = target_max
        self.glb = GLB()
        self.mats = {}
        self.parts = []   # (mat_idx, pos, nor, idx)
        self.rig = {}     # name -> (parent, abs_xyz)，插入顺序须父在前
        self.clips = {}   # name -> (dur, {joint: {path: [(t, vec)]}})

    def mat(self, key, rgb, rough=0.85):
        if key not in self.mats:
            self.mats[key] = self.glb.material(rgb, rough)
        return self.mats[key]

    def part(self, mat_key, shape, tf=None, rgb=(0.5, 0.5, 0.5), rough=0.85):
        pos, nor, idx = shape
        if tf is not None:
            pos = [m4_point(tf, p) for p in pos]
            nn = []
            for n0 in [m4_vec(tf, n) for n in nor]:
                l = math.sqrt(n0[0] ** 2 + n0[1] ** 2 + n0[2] ** 2) or 1.0
                nn.append((n0[0] / l, n0[1] / l, n0[2] / l))
            nor = nn
        m = self.mat(mat_key, rgb, rough)
        self.parts.append((m, pos, nor, idx))

    def bone(self, name, parent, abs_xyz):
        assert parent is None or parent in self.rig, "parent %s must be defined first" % parent
        self.rig[name] = (parent, abs_xyz)

    def clip(self, name, dur, spec):
        for jn in spec:
            assert jn in self.rig, "clip %s: unknown joint %s" % (name, jn)
        self.clips[name] = (dur, spec)

    def _weights(self, p, rig_world, order):
        best = []
        for i, name in enumerate(order):
            jp = rig_world[name]
            par = self.rig[name][0]
            if par is not None:
                a, b = rig_world[par], jp
            else:
                a = (jp[0], jp[1] - 0.3, jp[2])
                b = jp
            ab = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
            L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 or 1e-6
            t = max(0.0, min(1.0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / L2))
            c = (a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t)
            d2 = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2
            best.append((1.0 / (d2 + 0.015), i))
        best.sort(reverse=True)
        top = best[:4]
        tot = sum(w for w, _ in top) or 1.0
        js = [i for _, i in top] + [0] * (4 - len(top))
        ws = [w / tot for w, _ in top] + [0.0] * (4 - len(top))
        return js, ws

    def build(self, out_path, fps=12):
        allpos = [p for _, pp, _, _ in self.parts for p in pp]
        minx = min(p[0] for p in allpos); maxx = max(p[0] for p in allpos)
        miny = min(p[1] for p in allpos); maxy = max(p[1] for p in allpos)
        minz = min(p[2] for p in allpos); maxz = max(p[2] for p in allpos)
        h = maxy - miny
        md = max(maxx - minx, h, maxz - minz)
        if self.target_h:
            s = self.target_h / h
        elif self.target_max:
            s = self.target_max / md
        else:
            s = 1.0
        cx, cz = (minx + maxx) / 2, (minz + maxz) / 2

        def norm(p):
            return ((p[0] - cx) * s, (p[1] - miny) * s, (p[2] - cz) * s)

        self.parts = [(m, [norm(p) for p in pp], nn, ii) for m, pp, nn, ii in self.parts]
        order = list(self.rig.keys())
        rig_world = {n: norm(self.rig[n][1]) for n in order}

        # 场景根节点必须最先创建 => node index 0
        scene_root = self.glb.node(self.name + "_root")

        joint_idx = {}
        for n in order:
            par, _ = self.rig[n]
            w = rig_world[n]
            if par is None:
                rel = w
            else:
                pw = rig_world[par]
                rel = (w[0] - pw[0], w[1] - pw[1], w[2] - pw[2])
            joint_idx[n] = self.glb.node(n, t=rel)
        for n in order:
            par, _ = self.rig[n]
            if par is not None:
                self.glb.nodes[joint_idx[par]].setdefault("children", []).append(joint_idx[n])

        prims = []
        for m, pp, nn, ii in self.parts:
            js, ws = [], []
            for p in pp:
                j4, w4 = self._weights(p, rig_world, order)
                js.append(j4)
                ws.append(w4)
            prims.append({'pos': pp, 'nor': nn, 'idx': ii,
                          'joints': js, 'weights': ws, 'material': m})
        mesh_idx = self.glb.mesh(self.name, prims)

        ibm = []
        for n in order:
            w = rig_world[n]
            ibm += m4_inv(m4_translate(w[0], w[1], w[2]))
        root_name = order[0]
        skin_idx = self.glb.skin([joint_idx[n] for n in order], ibm, joint_idx[root_name])
        mesh_node = self.glb.node(self.name + "_mesh", mesh=mesh_idx, skin=skin_idx)
        self.glb.nodes[scene_root]["children"] = [mesh_node, joint_idx[root_name]]

        PATHMAP = {'r': 'rotation', 'rL': 'rotation', 't': 'translation', 's': 'scale'}
        for cname, (dur, spec) in self.clips.items():
            n = int(round(dur * fps)) + 1
            times = [i / fps for i in range(n)]
            channels = []
            for jname, paths in spec.items():
                for pk, kfs in paths.items():
                    path = PATHMAP[pk]
                    interp = 'LINEAR' if pk == 'rL' else 'STEP'
                    vals = []
                    for t in times:
                        v = kf_eval(kfs, t)
                        if path == 'rotation':
                            vals += list(euler_quat(v[0] * DEG, v[1] * DEG, v[2] * DEG))
                        else:
                            vals += list(v)
                    channels.append((joint_idx[jname], path, times, vals, interp))
            self.glb.animation(cname, channels)

        self.glb.write(out_path)

# =====================================================================
# 调色板（线性灰阶）
# =====================================================================
BLACK = (0.015, 0.015, 0.015)
WHITE = (0.90, 0.90, 0.87)
LGRAY = (0.55, 0.55, 0.55)
DGRAY = (0.22, 0.22, 0.22)
MGRAY = (0.38, 0.38, 0.38)

# =====================================================================
# 米奇 / 米妮（共用骨架与身体）
# =====================================================================
def mickey_rig(cb):
    cb.bone('Root', None, (0, 0, 0))
    cb.bone('Spine2', 'Root', (0, 0.72, 0))
    cb.bone('Head', 'Spine2', (0, 1.22, 0.01))
    cb.bone('ShoulderL', 'Spine2', (-0.30, 0.87, 0))
    cb.bone('ArmL1', 'ShoulderL', (-0.33, 0.70, 0.01))
    cb.bone('ArmL2', 'ArmL1', (-0.34, 0.56, 0.02))
    cb.bone('HandL', 'ArmL2', (-0.35, 0.45, 0.03))
    cb.bone('ShoulderR', 'Spine2', (0.30, 0.87, 0))
    cb.bone('ArmR1', 'ShoulderR', (0.33, 0.70, 0.01))
    cb.bone('ArmR2', 'ArmR1', (0.34, 0.56, 0.02))
    cb.bone('HandR', 'ArmR2', (0.35, 0.45, 0.03))
    cb.bone('HipL', 'Root', (-0.13, 0.47, 0))
    cb.bone('KneeL', 'HipL', (-0.14, 0.30, 0.01))
    cb.bone('AnkleL', 'KneeL', (-0.14, 0.16, 0.01))
    cb.bone('FootL', 'AnkleL', (-0.14, 0.05, 0.09))
    cb.bone('HipR', 'Root', (0.13, 0.47, 0))
    cb.bone('KneeR', 'HipR', (0.14, 0.30, 0.01))
    cb.bone('AnkleR', 'KneeR', (0.14, 0.16, 0.01))
    cb.bone('FootR', 'AnkleR', (0.14, 0.05, 0.09))

def mickey_body(cb, minnie=False):
    T = m4_translate
    cb.part('black', sh_sphere(0.26, 0.30, 0.22), T(0, 0.72, 0), BLACK)
    cb.part('black', sh_sphere(0.24, 0.24, 0.23), T(0, 1.22, 0), BLACK)
    cb.part('white', sh_cap(0.246, 0.246, 0.236, -1.25, 1.25, 0.62, 2.35), T(0, 1.22, 0), WHITE)
    cb.part('black', sh_sphere(0.135, 0.135, 0.05), m4_mul(T(-0.15, 1.45, -0.02), m4_rot_z(-0.25)), BLACK)
    cb.part('black', sh_sphere(0.135, 0.135, 0.05), m4_mul(T(0.15, 1.45, -0.02), m4_rot_z(0.25)), BLACK)
    for sx in (-1, 1):
        cb.part('white', sh_sphere(0.052, 0.125, 0.028), T(0.078 * sx, 1.335, 0.196), WHITE)
        cb.part('black', sh_disc(0.034, 0.072, a0=-2.6, a1=0.6), T(0.078 * sx, 1.31, 0.226), BLACK)
    cb.part('black', sh_sphere(0.062, 0.058, 0.07), T(0, 1.155, 0.262), BLACK)
    for sx in (-1, 1):
        cb.part('black', sh_tube_path(
            [(0.30 * sx, 0.87, 0), (0.33 * sx, 0.70, 0.01), (0.34 * sx, 0.56, 0.02), (0.35 * sx, 0.45, 0.03)],
            0.042), None, BLACK)
        cb.part('black', sh_sphere(0.075, 0.075, 0.075), T(0.35 * sx, 0.44, 0.03), BLACK)
    cb.part('lgray', sh_cyl(0.275, 0.24, 0.24, seg=18), T(0, 0.50, 0), LGRAY)
    for sx in (-1, 1):
        cb.part('white', sh_sphere(0.038, 0.038, 0.03), T(0.10 * sx, 0.545, 0.225), WHITE)
    for sx in (-1, 1):
        cb.part('black', sh_tube_path(
            [(0.13 * sx, 0.47, 0), (0.14 * sx, 0.30, 0.01), (0.14 * sx, 0.15, 0.01)], 0.048), None, BLACK)
        cb.part('dgray', sh_sphere(0.105, 0.075, 0.175), T(0.14 * sx, 0.05, 0.10), DGRAY)
    if minnie:
        cb.part('dgray', sh_cyl(0.24, 0.40, 0.5, seg=18), T(0, 0.66, 0), DGRAY)
        cb.part('mgray', sh_cyl(0.30, 0.30, 0.05, seg=18), m4_mul(T(0.03, 1.47, 0.02), m4_rot_z(0.2)), MGRAY)
        cb.part('lgray', sh_cyl(0.14, 0.16, 0.14, seg=14), m4_mul(T(0.05, 1.55, 0.02), m4_rot_z(0.2)), LGRAY)
        for i in range(6):
            a = i * math.pi / 3
            cb.part('white', sh_sphere(0.035, 0.035, 0.02),
                    T(0.05 + math.cos(a) * 0.09, 1.60, 0.02 + math.sin(a) * 0.09), WHITE)
        cb.part('white', sh_sphere(0.03, 0.03, 0.03), T(0.05, 1.60, 0.02), WHITE)

def mickey_clips(cb, minnie=False):
    cb.clip('idle', 1.0, {
        'Spine2': {'s': [(0, (1, 1, 1)), (0.5, (1, 1.035, 1)), (1, (1, 1, 1))]},
        'Head': {'t': [(0, (0, 0, 0)), (0.5, (0, 0.012, 0)), (1, (0, 0, 0))]},
        'ShoulderL': {'r': [(0, (3, 0, 0)), (0.5, (-3, 0, 0)), (1, (3, 0, 0))]},
        'ShoulderR': {'r': [(0, (-3, 0, 0)), (0.5, (3, 0, 0)), (1, (-3, 0, 0))]},
    })
    cb.clip('walk', 0.66, {
        'HipL': {'r': [(0, (25, 0, 0)), (0.33, (-25, 0, 0)), (0.66, (25, 0, 0))]},
        'HipR': {'r': [(0, (-25, 0, 0)), (0.33, (25, 0, 0)), (0.66, (-25, 0, 0))]},
        'KneeL': {'r': [(0, (0, 0, 0)), (0.16, (32, 0, 0)), (0.33, (0, 0, 0)), (0.66, (0, 0, 0))]},
        'KneeR': {'r': [(0, (0, 0, 0)), (0.49, (32, 0, 0)), (0.66, (0, 0, 0))]},
        'ShoulderL': {'r': [(0, (-20, 0, 0)), (0.33, (20, 0, 0)), (0.66, (-20, 0, 0))]},
        'ShoulderR': {'r': [(0, (20, 0, 0)), (0.33, (-20, 0, 0)), (0.66, (20, 0, 0))]},
        'Spine2': {'t': [(0, (0, 0, 0)), (0.165, (0, 0.015, 0)), (0.33, (0, 0, 0)),
                         (0.495, (0, 0.015, 0)), (0.66, (0, 0, 0))]},
    })
    cb.clip('run', 0.45, {
        'HipL': {'r': [(0, (48, 0, 0)), (0.225, (-48, 0, 0)), (0.45, (48, 0, 0))]},
        'HipR': {'r': [(0, (-48, 0, 0)), (0.225, (48, 0, 0)), (0.45, (-48, 0, 0))]},
        'KneeL': {'r': [(0, (10, 0, 0)), (0.11, (55, 0, 0)), (0.225, (0, 0, 0)), (0.45, (10, 0, 0))]},
        'KneeR': {'r': [(0, (0, 0, 0)), (0.335, (55, 0, 0)), (0.45, (0, 0, 0))]},
        'ShoulderL': {'r': [(0, (-40, 0, 0)), (0.225, (40, 0, 0)), (0.45, (-40, 0, 0))]},
        'ShoulderR': {'r': [(0, (40, 0, 0)), (0.225, (-40, 0, 0)), (0.45, (40, 0, 0))]},
        'Spine2': {'r': [(0, (12, 0, 0)), (0.45, (12, 0, 0))],
                   't': [(0, (0, 0, 0)), (0.11, (0, 0.035, 0)), (0.225, (0, 0, 0)),
                         (0.335, (0, 0.035, 0)), (0.45, (0, 0, 0))]},
    })
    cb.clip('jump', 0.8, {
        'Spine2': {'s': [(0, (1.1, 0.8, 1.1)), (0.2, (0.9, 1.15, 0.9)), (0.8, (0.95, 1.05, 0.95))]},
        'HipL': {'r': [(0, (-35, 0, 0)), (0.2, (20, 0, 0)), (0.8, (25, 0, 0))]},
        'HipR': {'r': [(0, (-35, 0, 0)), (0.2, (20, 0, 0)), (0.8, (25, 0, 0))]},
        'KneeL': {'r': [(0, (42, 0, 0)), (0.2, (0, 0, 0)), (0.8, (0, 0, 0))]},
        'KneeR': {'r': [(0, (42, 0, 0)), (0.2, (0, 0, 0)), (0.8, (0, 0, 0))]},
        'ShoulderL': {'r': [(0, (20, 0, 0)), (0.2, (-70, 0, 0)), (0.8, (-80, 0, 0))]},
        'ShoulderR': {'r': [(0, (20, 0, 0)), (0.2, (-70, 0, 0)), (0.8, (-80, 0, 0))]},
    })
    cb.clip('fall', 0.8, {
        'ShoulderL': {'r': [(0, (-130, 0, 25)), (0.8, (-130, 0, 25))]},
        'ShoulderR': {'r': [(0, (-130, 0, -25)), (0.8, (-130, 0, -25))]},
        'HipL': {'r': [(0, (10, 0, 14)), (0.8, (10, 0, 14))]},
        'HipR': {'r': [(0, (10, 0, -14)), (0.8, (10, 0, -14))]},
        'KneeL': {'r': [(0, (18, 0, 0)), (0.8, (18, 0, 0))]},
        'KneeR': {'r': [(0, (18, 0, 0)), (0.8, (18, 0, 0))]},
    })
    cb.clip('land', 0.5, {
        'Spine2': {'s': [(0, (1.35, 0.55, 1.35)), (0.25, (0.95, 1.08, 0.95)), (0.5, (1, 1, 1))]},
        'HipL': {'r': [(0, (-32, 0, 0)), (0.5, (0, 0, 0))]},
        'HipR': {'r': [(0, (-32, 0, 0)), (0.5, (0, 0, 0))]},
        'KneeL': {'r': [(0, (38, 0, 0)), (0.5, (0, 0, 0))]},
        'KneeR': {'r': [(0, (38, 0, 0)), (0.5, (0, 0, 0))]},
    })
    cb.clip('die', 1.2, {
        'Spine2': {'r': [(0, (0, 0, 0)), (0.6, (-85, 0, 0)), (1.2, (-85, 0, 0))]},
        'Head': {'r': [(0, (0, 0, 0)), (0.6, (-30, 0, 0)), (1.2, (-30, 0, 0))]},
        'ShoulderL': {'r': [(0, (0, 0, 0)), (0.6, (-40, 0, 10)), (1.2, (-40, 0, 10))]},
        'ShoulderR': {'r': [(0, (0, 0, 0)), (0.6, (-40, 0, -10)), (1.2, (-40, 0, -10))]},
        'HipL': {'r': [(0, (0, 0, 0)), (0.6, (25, 0, 0)), (1.2, (25, 0, 0))]},
        'HipR': {'r': [(0, (0, 0, 0)), (0.6, (25, 0, 0)), (1.2, (25, 0, 0))]},
    })
    cb.clip('whistle', 0.9, {
        'ShoulderR': {'r': [(0, (-95, 0, -25)), (0.45, (-95, 0, -16)), (0.9, (-95, 0, -25))]},
        'ArmR1': {'r': [(0, (0, 0, -30)), (0.9, (0, 0, -30))]},
        'ArmR2': {'r': [(0, (0, 0, -45)), (0.9, (0, 0, -45))]},
        'Head': {'r': [(0, (0, 0, 6)), (0.45, (0, 0, -6)), (0.9, (0, 0, 6))]},
        'ShoulderL': {'r': [(0, (-15, 0, 0)), (0.9, (-15, 0, 0))]},
    })
    cb.clip('steer', 1.0, {
        'ShoulderL': {'r': [(0, (-80, 0, 32)), (0.5, (-80, 0, 14)), (1.0, (-80, 0, 32))]},
        'ShoulderR': {'r': [(0, (-80, 0, -32)), (0.5, (-80, 0, -14)), (1.0, (-80, 0, -32))]},
        'Spine2': {'r': [(0, (0, 6, 0)), (0.5, (0, -6, 0)), (1.0, (0, 6, 0))]},
    })
    cb.clip('squash', 0.5, {
        'Root': {'s': [(0, (1, 1, 1)), (0.15, (1.35, 0.55, 1.35)), (0.5, (1, 1, 1))]},
    })
    cb.clip('stretch', 0.5, {
        'Root': {'s': [(0, (1, 1, 1)), (0.15, (0.75, 1.4, 0.75)), (0.5, (1, 1, 1))]},
    })
    if minnie:
        cb.clip('talk', 0.8, {
            'ShoulderR': {'r': [(0, (-30, 0, -12)), (0.4, (-65, 0, -35)), (0.8, (-30, 0, -12))]},
            'Head': {'r': [(0, (0, 0, 8)), (0.4, (0, 0, -8)), (0.8, (0, 0, 8))]},
            'Spine2': {'s': [(0, (1, 1, 1)), (0.4, (1, 1.05, 1)), (0.8, (1, 1, 1))]},
        })

def build_mickey(path):
    cb = CharBuilder('willieMickey', target_height=1.65)
    mickey_rig(cb)
    mickey_body(cb)
    mickey_clips(cb)
    cb.build(path)

def build_minnie(path):
    cb = CharBuilder('minnie1928', target_height=1.6)
    mickey_rig(cb)
    mickey_body(cb, minnie=True)
    mickey_clips(cb, minnie=True)
    cb.build(path)

# =====================================================================
# 黑猫大副
# =====================================================================
def build_cat(path):
    cb = CharBuilder('blackcatMate', target_height=2.4)
    cb.bone('Root', None, (0, 0, 0))
    cb.bone('Spine2', 'Root', (0, 0.95, 0))
    cb.bone('Head', 'Spine2', (0, 1.55, 0.02))
    cb.bone('ShoulderL', 'Spine2', (-0.42, 1.05, 0))
    cb.bone('ArmL1', 'ShoulderL', (-0.47, 0.82, 0.02))
    cb.bone('ArmL2', 'ArmL1', (-0.48, 0.62, 0.03))
    cb.bone('HandL', 'ArmL2', (-0.49, 0.46, 0.04))
    cb.bone('ShoulderR', 'Spine2', (0.42, 1.05, 0))
    cb.bone('ArmR1', 'ShoulderR', (0.47, 0.82, 0.02))
    cb.bone('ArmR2', 'ArmR1', (0.48, 0.62, 0.03))
    cb.bone('HandR', 'ArmR2', (0.49, 0.46, 0.04))
    cb.bone('HipL', 'Root', (-0.18, 0.55, 0))
    cb.bone('KneeL', 'HipL', (-0.19, 0.32, 0.01))
    cb.bone('FootL', 'KneeL', (-0.19, 0.06, 0.10))
    cb.bone('HipR', 'Root', (0.18, 0.55, 0))
    cb.bone('KneeR', 'HipR', (0.19, 0.32, 0.01))
    cb.bone('FootR', 'KneeR', (0.19, 0.06, 0.10))
    T = m4_translate
    cb.part('black', sh_sphere(0.42, 0.47, 0.36), T(0, 0.92, 0), BLACK)
    cb.part('black', sh_sphere(0.30, 0.28, 0.27), T(0, 1.55, 0), BLACK)
    for sx in (-1, 1):
        cb.part('black', sh_cyl(0.001, 0.10, 0.22, seg=8),
                m4_mul(T(0.13 * sx, 1.82, -0.02), m4_rot_z(-0.35 * sx)), BLACK)
    cb.part('white', sh_cap(0.305, 0.285, 0.275, -0.95, 0.95, 1.05, 2.35), T(0, 1.55, 0), WHITE)
    cb.part('black', sh_sphere(0.05, 0.045, 0.05), T(0, 1.51, 0.30), BLACK)
    for sx in (-1, 1):
        cb.part('white', sh_sphere(0.055, 0.10, 0.028), T(0.09 * sx, 1.63, 0.246), WHITE)
        cb.part('black', sh_sphere(0.025, 0.05, 0.02), T(0.09 * sx, 1.62, 0.272), BLACK)
    for sx in (-1, 1):
        for k in (-1, 1):
            cb.part('white', sh_box(0.12, 0.008, 0.008),
                    m4_mul(T(0.19 * sx, 1.48 + 0.03 * k, 0.21), m4_rot_z(0.25 * k * sx)), WHITE)
    cb.part('mgray', sh_cyl(0.26, 0.26, 0.06, seg=16), T(0, 1.81, 0), MGRAY)
    cb.part('mgray', sh_cyl(0.17, 0.19, 0.16, seg=14), T(0, 1.91, 0), MGRAY)
    for sx in (-1, 1):
        cb.part('lgray', sh_box(0.045, 0.75, 0.04),
                m4_mul(T(0.16 * sx, 1.02, 0.33), m4_rot_x(-0.15)), LGRAY)
    cb.part('white', sh_sphere(0.05, 0.05, 0.03), T(0, 0.85, 0.355), WHITE)
    for sx in (-1, 1):
        cb.part('black', sh_tube_path(
            [(0.42 * sx, 1.05, 0), (0.47 * sx, 0.82, 0.02), (0.48 * sx, 0.62, 0.03), (0.49 * sx, 0.46, 0.04)],
            0.085), None, BLACK)
        cb.part('black', sh_sphere(0.11, 0.10, 0.11), T(0.49 * sx, 0.44, 0.04), BLACK)
    for sx in (-1, 1):
        cb.part('black', sh_tube_path(
            [(0.18 * sx, 0.55, 0), (0.19 * sx, 0.32, 0.01), (0.19 * sx, 0.10, 0.02)], 0.075), None, BLACK)
        cb.part('dgray', sh_sphere(0.13, 0.09, 0.21), T(0.19 * sx, 0.05, 0.10), DGRAY)
    cb.part('black', sh_tube_path([(0, 0.75, -0.34), (0.05, 0.55, -0.5), (0.15, 0.45, -0.55)], 0.05), None, BLACK)
    cb.clip('idle', 1.2, {
        'Spine2': {'s': [(0, (1, 1, 1)), (0.6, (1.01, 1.03, 1.01)), (1.2, (1, 1, 1))]},
        'Head': {'t': [(0, (0, 0, 0)), (0.6, (0, 0.015, 0)), (1.2, (0, 0, 0))]},
    })
    cb.clip('walk', 0.7, {
        'HipL': {'r': [(0, (22, 0, 0)), (0.35, (-22, 0, 0)), (0.7, (22, 0, 0))]},
        'HipR': {'r': [(0, (-22, 0, 0)), (0.35, (22, 0, 0)), (0.7, (-22, 0, 0))]},
        'ShoulderL': {'r': [(0, (-15, 0, 0)), (0.35, (15, 0, 0)), (0.7, (-15, 0, 0))]},
        'ShoulderR': {'r': [(0, (15, 0, 0)), (0.35, (-15, 0, 0)), (0.7, (15, 0, 0))]},
        'Spine2': {'t': [(0, (0, 0, 0)), (0.175, (0, 0.03, 0)), (0.35, (0, 0, 0)),
                         (0.525, (0, 0.03, 0)), (0.7, (0, 0, 0))]},
    })
    cb.clip('run', 0.5, {
        'HipL': {'r': [(0, (42, 0, 0)), (0.25, (-42, 0, 0)), (0.5, (42, 0, 0))]},
        'HipR': {'r': [(0, (-42, 0, 0)), (0.25, (42, 0, 0)), (0.5, (-42, 0, 0))]},
        'ShoulderL': {'r': [(0, (-30, 0, 0)), (0.25, (30, 0, 0)), (0.5, (-30, 0, 0))]},
        'ShoulderR': {'r': [(0, (30, 0, 0)), (0.25, (-30, 0, 0)), (0.5, (30, 0, 0))]},
        'Spine2': {'t': [(0, (0, 0, 0)), (0.125, (0, 0.05, 0)), (0.25, (0, 0, 0)),
                         (0.375, (0, 0.05, 0)), (0.5, (0, 0, 0))]},
    })
    cb.clip('attack', 0.7, {
        'ShoulderR': {'r': [(0, (65, 0, 0)), (0.25, (-115, 0, 0)), (0.7, (0, 0, 0))]},
        'Spine2': {'r': [(0, (0, -22, 0)), (0.25, (0, 16, 0)), (0.7, (0, 0, 0))]},
    })
    cb.clip('hit', 0.4, {
        'Spine2': {'r': [(0, (0, 0, 9)), (0.4, (0, 0, 0))],
                   's': [(0, (1.06, 0.9, 1.06)), (0.4, (1, 1, 1))]},
    })
    cb.clip('die', 1.2, {
        'Spine2': {'r': [(0, (0, 0, 0)), (0.7, (-80, 0, 0)), (1.2, (-80, 0, 0))]},
        'ShoulderL': {'r': [(0, (0, 0, 0)), (0.7, (-50, 0, 15)), (1.2, (-50, 0, 15))]},
        'ShoulderR': {'r': [(0, (0, 0, 0)), (0.7, (-50, 0, -15)), (1.2, (-50, 0, -15))]},
    })
    cb.build(path)

# =====================================================================
# 巨型蒸汽鹦鹉号 BOSS
# =====================================================================
def build_parrot(path):
    cb = CharBuilder('steamParrot', target_max=55.0)
    cb.bone('Root', None, (0, 0, 0))
    cb.bone('Body', 'Root', (0, 8, 0))
    cb.bone('Head', 'Body', (0, 8.5, 9.5))
    cb.bone('Beak', 'Head', (0, 7.8, 12.5))
    cb.bone('WingL', 'Body', (-6.5, 8.5, 0))
    cb.bone('PropL', 'WingL', (-9.5, 9, 1.5))
    cb.bone('WingR', 'Body', (6.5, 8.5, 0))
    cb.bone('PropR', 'WingR', (9.5, 9, 1.5))
    cb.bone('Tail', 'Body', (0, 9, -8))
    T = m4_translate
    cb.part('iron', sh_cyl(5.5, 5.5, 16, seg=20), m4_mul(T(0, 8, 0), m4_rot_x(math.pi / 2)), (0.10, 0.10, 0.11), 0.6)
    for zz in (-6, 0, 6):
        cb.part('iron2', sh_cyl(5.75, 5.75, 0.7, seg=20), m4_mul(T(0, 8, zz), m4_rot_x(math.pi / 2)), (0.28, 0.28, 0.28), 0.5)
        for i in range(8):
            a = i * math.pi / 4
            cb.part('iron2', sh_sphere(0.32, 0.32, 0.32), T(math.cos(a) * 5.6, 8 + math.sin(a) * 5.6, zz), (0.30, 0.30, 0.30), 0.5)
    cb.part('iron2', sh_box(5, 2.2, 7), T(0, 5.2, 0), (0.24, 0.24, 0.24), 0.6)
    cb.part('iron', sh_sphere(4.0, 3.6, 3.8), T(0, 8.8, 9.5), (0.12, 0.12, 0.13), 0.6)
    cb.part('beak', sh_cyl(0.2, 1.7, 5.5, seg=10), m4_mul(T(0, 8.2, 13.8), m4_rot_x(math.pi / 2)), (0.05, 0.05, 0.05), 0.5)
    cb.part('beak', sh_cyl(0.15, 1.1, 3.2, seg=10), m4_mul(T(0, 7.0, 13.2), m4_rot_x(math.pi / 2)), (0.16, 0.16, 0.16), 0.5)
    for sx in (-1, 1):
        cb.part('white', sh_sphere(0.9, 0.9, 0.5), T(1.7 * sx, 9.9, 12.2), WHITE)
        cb.part('black', sh_sphere(0.4, 0.4, 0.3), T(1.7 * sx, 9.7, 12.6), BLACK)
        cb.part('beak', sh_box(1.7, 0.45, 0.5), m4_mul(T(1.7 * sx, 10.9, 12.3), m4_rot_z(0.5 * sx)), (0.05, 0.05, 0.05))
    for sx in (-1, 1):
        cb.part('iron2', sh_box(5.5, 0.7, 5.0), T(6.5 * sx, 8.5, 0), (0.26, 0.26, 0.26), 0.6)
        cb.part('iron', sh_cyl(0.9, 0.9, 1.4, seg=12), m4_mul(T(9.5 * sx, 9, 2.4), m4_rot_x(math.pi / 2)), (0.14, 0.14, 0.14), 0.5)
        for b in range(4):
            cb.part('iron2', sh_box(4.6, 0.3, 0.8),
                    m4_mul(T(9.5 * sx, 9, 1.9), m4_rot_z(b * math.pi / 2)), (0.32, 0.32, 0.32), 0.5)
    cb.part('iron', sh_cyl(1.3, 1.5, 6.5, seg=12), T(0, 12.5, -6.5), (0.09, 0.09, 0.09), 0.5)
    cb.part('iron2', sh_cyl(1.7, 1.7, 0.8, seg=12), T(0, 15.8, -6.5), (0.2, 0.2, 0.2), 0.5)
    cb.part('iron2', sh_box(0.5, 4.2, 3.0), T(0, 9.5, -8.8), (0.24, 0.24, 0.24), 0.6)
    cb.part('iron2', sh_box(5.5, 0.5, 2.6), T(0, 9, -8.8), (0.24, 0.24, 0.24), 0.6)
    for sx in (-1, 1):
        cb.part('beak', sh_tube_path([(2.2 * sx, 3.6, 1.5), (2.4 * sx, 2.2, 1.8)], 0.55, seg=8), None, (0.08, 0.08, 0.08))
        cb.part('beak', sh_box(1.8, 0.6, 2.6), T(2.4 * sx, 1.9, 2.3), (0.08, 0.08, 0.08))
    cb.clip('fly', 2.0, {
        'PropL': {'rL': [(0, (0, 0, 0)), (2.0, (0, 0, 1440))]},
        'PropR': {'rL': [(0, (0, 0, 0)), (2.0, (0, 0, 1440))]},
        'Body': {'t': [(0, (0, 0, 0)), (1.0, (0, 0.35, 0)), (2.0, (0, 0, 0))]},
        'WingL': {'r': [(0, (0, 0, 4)), (1.0, (0, 0, -4)), (2.0, (0, 0, 4))]},
        'WingR': {'r': [(0, (0, 0, -4)), (1.0, (0, 0, 4)), (2.0, (0, 0, -4))]},
    })
    cb.clip('fast', 1.0, {
        'PropL': {'rL': [(0, (0, 0, 0)), (1.0, (0, 0, 1080))]},
        'PropR': {'rL': [(0, (0, 0, 0)), (1.0, (0, 0, 1080))]},
        'Body': {'r': [(0, (8, 0, 0)), (1.0, (8, 0, 0))],
                 't': [(0, (0, 0, 0)), (0.5, (0, 0.5, 0)), (1.0, (0, 0, 0))]},
    })
    cb.clip('taunt', 1.5, {
        'Head': {'r': [(0, (0, -16, 0)), (0.5, (0, 16, 0)), (1.0, (0, -16, 0)), (1.5, (0, 0, 0))]},
        'Beak': {'r': [(0, (0, 0, 0)), (0.3, (28, 0, 0)), (0.6, (0, 0, 0)), (0.9, (28, 0, 0)), (1.5, (0, 0, 0))]},
        'Body': {'t': [(0, (0, 0, 0)), (0.75, (0, 0.6, 0)), (1.5, (0, 0, 0))]},
    })
    cb.clip('headbutt', 1.0, {
        'Body': {'t': [(0, (0, 0, 0)), (0.4, (0, -1.5, 4.5)), (1.0, (0, 0, 0))],
                 'r': [(0, (0, 0, 0)), (0.4, (18, 0, 0)), (1.0, (0, 0, 0))]},
        'Head': {'r': [(0, (0, 0, 0)), (0.4, (-22, 0, 0)), (1.0, (0, 0, 0))]},
    })
    cb.clip('punch', 1.0, {
        'WingL': {'r': [(0, (0, 0, 0)), (0.35, (0, -45, 20)), (1.0, (0, 0, 0))]},
        'Body': {'r': [(0, (0, 0, 0)), (0.35, (0, 12, 0)), (1.0, (0, 0, 0))]},
    })
    cb.clip('hit', 0.4, {
        'Body': {'r': [(0, (0, 0, 7)), (0.4, (0, 0, 0))],
                 's': [(0, (1.04, 0.95, 1.04)), (0.4, (1, 1, 1))]},
    })
    cb.clip('death', 3.0, {
        'PropL': {'rL': [(0, (0, 0, 0)), (3.0, (0, 0, 540))]},
        'PropR': {'rL': [(0, (0, 0, 0)), (3.0, (0, 0, 540))]},
        'Body': {'r': [(0, (0, 0, 0)), (1.5, (-45, 0, 12)), (3.0, (-75, 0, 25))],
                 't': [(0, (0, 0, 0)), (3.0, (0, -4, 0))]},
        'Head': {'r': [(0, (0, 0, 0)), (3.0, (30, 0, 0))]},
    })
    cb.build(path)

# =====================================================================
if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    print("generating character GLBs ->", OUT_DIR)
    build_mickey(os.path.join(OUT_DIR, 'willie_mickey.glb'))
    build_minnie(os.path.join(OUT_DIR, 'minnie1928.glb'))
    build_cat(os.path.join(OUT_DIR, 'blackcat_mate.glb'))
    build_parrot(os.path.join(OUT_DIR, 'steam_parrot.glb'))
    print("done.")

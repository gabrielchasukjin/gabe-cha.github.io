// Terrain: the shared engine behind the floating islands (island-scene.js) and the
// project stack (strata.js). A slab is a square heightmap colored by one of the styles
// below, drawn in a tilted top-down view: top surface back to front, rock walls on the
// edges that face you, an optional hanging rock underside, and a few loose fragments.
// prepare() does the expensive per-cell work once; draw() can then run every frame at
// any rotation, which is what lets the big island turn.

window.Terrain = (() => {
    // ---------- noise ----------
    const hash = (x, y, s) => {
        let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const smooth = t => t * t * (3 - 2 * t);
    const vnoise = (x, y, s) => {
        const xi = Math.floor(x), yi = Math.floor(y);
        const xf = smooth(x - xi), yf = smooth(y - yi);
        const a = hash(xi, yi, s), b = hash(xi + 1, yi, s);
        const c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
        return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
    };
    const fbm = (x, y, s, oct = 5) => {
        let sum = 0, amp = 0.5, norm = 0;
        for (let o = 0; o < oct; o++) {
            sum += amp * vnoise(x, y, s + o * 17);
            norm += amp; amp *= 0.5; x *= 2.03; y *= 2.03;
        }
        return sum / norm;
    };
    const ridged = (x, y, s, oct = 6) => {
        let sum = 0, amp = 0.5, norm = 0, prev = 1;
        for (let o = 0; o < oct; o++) {
            let n = 1 - Math.abs(2 * vnoise(x, y, s + o * 31) - 1);
            n *= n;
            sum += n * amp * (0.6 + 0.4 * prev);
            prev = n; norm += amp; amp *= 0.5; x *= 2.07; y *= 2.07;
        }
        return sum / norm;
    };

    // ---------- color ----------
    const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const ramp = (stops, t) => {
        t = Math.min(0.9999, Math.max(0, t));
        const f = t * (stops.length - 1), i = Math.floor(f);
        return mix(stops[i], stops[i + 1], f - i);
    };
    const clamp01 = x => Math.min(1, Math.max(0, x));
    const rgb = (c, k = 1) => `rgb(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0})`;

    // ---------- styles ----------
    // height(u, v, seed) -> 0..1 and color(cell) -> [r,g,b] before lighting; u, v in 0..1
    const ICE = hex('#cdc4f2'), ICE2 = hex('#9f93dc'), ROCK = hex('#16161c'), ROCK2 = hex('#3b3a46'), GOLD = hex('#e2bd72');
    const FRINGE = ['#7a35e0', '#c044d8', '#4f8cff', '#4fe3e6', '#c6f36b', '#f5ec5b', '#ff9a3c', '#7a35e0'].map(hex);
    const FOREST = hex('#1d3a2a'), MEADOW = hex('#3f6b43'), SCREE = hex('#5a5548'), SNOW = hex('#f3f5fb'), SNOWSH = hex('#b9c6e6');
    const MINERAL = ['#1a1212', '#c41f1a', '#f0611c', '#f7b733', '#fff0a8', '#e8452a', '#3ccfd0', '#1b6f7a', '#1a1212'].map(hex);
    const DEEP = ['#071c45', '#0f3f8f', '#2b7fd6', '#63c7f2', '#bff1ff'].map(hex);
    const GRANITE = hex('#b5ab9c'), GRANITE2 = hex('#ece4d4'), PINE = hex('#22402c'), PINE2 = hex('#355a35');
    const GRASS = hex('#9aa552'), GRASS2 = hex('#c9b765'), WATER = hex('#4f9fd4'), WATER2 = hex('#bfe6fa'), SUN = hex('#ffcf86');

    const faultV = u => 0.5 + 0.22 * Math.sin(u * 7.5 + 1) * (1 - u * 0.4);
    const riverV = u => 0.52 + 0.16 * Math.sin(u * 3.4 + 0.5);

    const STYLES = {
        range: {    // black range: sharp peaks, icy lavender valleys, metallic gold light
            seed: 11, relief: 0.15, spin: 4, wall: '#18171d', shade: [0.55, 0.75],
            height: (u, v, s) => Math.pow(ridged(u * 2.2, v * 2.2, s, 5), 1.9) * 1.2,
            color: c => {
                if (c.h < 0.16 + 0.05 * c.n) return mix(ICE2, ICE, clamp01(c.light * 1.1));
                const rock = mix(ROCK, ROCK2, c.n);
                return c.light > 0.82 && c.h > 0.38 ? mix(rock, GOLD, (c.light - 0.82) * 4.2) : rock;
            },
        },
        interferogram: {   // low relief, rainbow fringes, a fault line running through
            seed: 23, relief: 0.07, spin: -5, wall: '#3a2a6a', shade: [0.85, 0.3],
            height: (u, v, s) => {
                const d = v - faultV(u);
                return clamp01(0.55 + 0.35 * (fbm(u * 3, v * 3, s) - 0.5) - 0.5 * Math.exp(-d * d / 0.0016));
            },
            color: c => {
                const d = c.v - faultV(c.u);
                const f = fbm(c.u * 2.2, c.v * 2.2, 99) * 2.6 + 0.9 * Math.exp(-d * d / 0.012) + 0.08 * c.n;
                return ramp(FRINGE, f - Math.floor(f));
            },
        },
        alpine: {   // forest valleys, scree, snowfields on the high ground
            seed: 37, relief: 0.13, spin: -2, wall: '#24291f', shade: [0.68, 0.55],
            height: (u, v, s) => Math.pow(ridged(u * 2 + 3, v * 2, s, 5), 1.6) * 1.15,
            color: c => {
                if (c.h > 0.42 - 0.1 * c.n) return mix(SNOWSH, SNOW, clamp01(c.light * 1.2));
                if (c.h > 0.3 + 0.06 * c.n) return mix(SCREE, ROCK2, c.n * 0.6);
                return mix(FOREST, MEADOW, clamp01(c.h * 2.6 + 0.15 * c.n));
            },
        },
        mineral: {   // swirling ore bands, nearly flat
            seed: 41, relief: 0.05, spin: 6, wall: '#6e1810', shade: [0.8, 0.35],
            height: (u, v, s) => 0.5 + 0.5 * (fbm(u * 5, v * 5, s, 4) - 0.5) + 0.12 * (vnoise(u * 60, v * 60, s) - 0.5),
            color: c => {
                const wx = fbm(c.u * 2 + 5, c.v * 2, 7) * 1.6, wy = fbm(c.u * 2, c.v * 2 + 9, 8) * 1.6;
                const t = fbm(c.u * 1.4 + wx, c.v * 1.4 + wy, 5) * 3.2 + 0.05 * c.n;
                return ramp(MINERAL, t - Math.floor(t));
            },
        },
        bathymetry: {   // rolling seafloor with white contour lines
            seed: 53, relief: 0.1, spin: -4, wall: '#0a1f45', shade: [0.7, 0.45],
            height: (u, v, s) => Math.pow(fbm(u * 2.4, v * 2.4, s, 5), 1.4) * 1.3,
            color: c => {
                const base = ramp(DEEP, clamp01(c.h * 1.2));
                return c.contour ? mix(base, [255, 255, 255], 0.38) : base;
            },
        },
        valley: {   // golden-hour granite valley: a river, pine forest, one big monolith
            seed: 71, relief: 0.2, spin: 0, wall: '#6f6152', shade: [0.5, 0.72],
            height: (u, v, s) => {
                const d = v - riverV(u);
                const open = 1 - Math.exp(-d * d / 0.018);
                const hills = Math.pow(ridged(u * 2.1 + 7, v * 2.1, s, 5), 1.25);
                const mx = u - 0.3, my = v - (riverV(0.3) - 0.2);
                const dome = Math.max(0, 1 - Math.hypot(mx * 1.1, my * 1.5) / 0.15);
                const monolith = smooth(Math.min(1, dome * 2.2)) * 0.62;
                return clamp01(0.05 + 0.64 * hills * Math.pow(open, 0.9) + monolith + 0.03 * (vnoise(u * 40, v * 40, s) - 0.5));
            },
            color: c => {
                const d = c.v - riverV(c.u);
                if (Math.abs(d) < 0.016 && c.h < 0.14) return mix(WATER, WATER2, clamp01(c.light * 0.9 + 0.2 * c.n));
                let col;
                if (c.h > 0.78) col = mix(GRANITE2, SNOW, 0.6);
                else if (c.slope > 1.7 || c.h > 0.5 + 0.08 * c.n) col = mix(GRANITE, GRANITE2, clamp01(c.h * 0.8 + 0.2 * c.n));
                else if (c.h > 0.12 + 0.05 * c.n) col = mix(PINE, PINE2, clamp01(c.n * 0.7 + c.h));
                else col = mix(GRASS, GRASS2, c.n);
                return c.light > 0.78 ? mix(col, SUN, (c.light - 0.78) * 1.8) : col;
            },
        },
    };

    const LIGHT = (() => { const l = [-0.55, -0.65, 0.55], m = Math.hypot(...l); return l.map(x => x / m); })();
    const BASE_SPIN = 14 * Math.PI / 180;
    const SIZE = 1.12;   // half-diagonal room, so a square of width W fits

    // ---------- prepare: heights, base colors, slopes ----------
    function prepare(style, N) {
        const def = typeof style === 'string' ? STYLES[style] : style;
        const s = def.seed, M = N + 1;
        const hs = new Float32Array(M * M);
        for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) hs[j * M + i] = clamp01(def.height(i / N, j / N, s));
        const hAt = (i, j) => hs[Math.min(N, Math.max(0, j)) * M + Math.min(N, Math.max(0, i))];
        const k = def.relief * 9;
        const base = new Float32Array(N * N * 3), gx = new Float32Array(N * N), gy = new Float32Array(N * N);
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            const h00 = hAt(i, j), h10 = hAt(i + 1, j), h01 = hAt(i, j + 1), h11 = hAt(i + 1, j + 1);
            const ax = (hAt(i + 2, j) - hAt(i - 1, j)) / 3 * N * k, ay = (hAt(i, j + 2) - hAt(i, j - 1)) / 3 * N * k;
            const lam = Math.max(0, (-ax * LIGHT[0] - ay * LIGHT[1] + LIGHT[2]) / Math.hypot(ax, ay, 1));
            const lo = Math.min(h00, h10, h01, h11), hi = Math.max(h00, h10, h01, h11);
            const c = def.color({
                h: (h00 + h11) / 2, u: (i + 0.5) / N, v: (j + 0.5) / N, light: lam,
                slope: Math.hypot(ax, ay) / Math.max(0.2, k), n: hash(i, j, s + 5),
                contour: Math.floor(lo * 12) !== Math.floor(hi * 12),
            });
            const q = j * N + i;
            base[q * 3] = c[0]; base[q * 3 + 1] = c[1]; base[q * 3 + 2] = c[2];
            gx[q] = ax; gy[q] = ay;
        }
        // rough bottom edge, keyed to fixed perimeter positions so it holds still while turning
        const rough = new Float32Array(4 * M);
        for (let e = 0; e < 4; e++) for (let t = 0; t <= N; t++) rough[e * M + t] = 1 + 0.45 * (fbm(t / N * 4.6, 3.3 + e, s + 9, 3) - 0.5);
        return { def, N, hs, hAt, base, gx, gy, rough, order: null, orderTheta: NaN };
    }

    // ---------- draw ----------
    // o: { x, y, W, theta (radians, added to the style's own spin), tilt, underside (0..), fragments, dpr }
    function draw(g, p, o) {
        const { def, N, hAt, base, gx, gy, rough } = p, s = def.seed;
        const W = o.W, A = W / 2 / SIZE, B = A * (o.tilt || 0.4), H = def.relief * W, T = 0.055 * W;
        const th = BASE_SPIN + def.spin * Math.PI / 180 + (o.theta || 0), cs = Math.cos(th), sn = Math.sin(th);
        const X = o.x, Y = o.y;
        const P = (u, v, z) => [X + ((u * cs - v * sn) - (u * sn + v * cs)) * A, Y + ((u * cs - v * sn) + (u * sn + v * cs)) * B - z];
        const depth = (u, v) => (u * cs - v * sn) + (u * sn + v * cs);
        g.lineJoin = 'round';
        g.lineWidth = 0.9 / (o.dpr || 1);

        const poly = (pts, fill) => {
            g.beginPath();
            g.moveTo(pts[0][0], pts[0][1]);
            for (let q = 1; q < pts.length; q++) g.lineTo(pts[q][0], pts[q][1]);
            g.closePath();
            g.fillStyle = fill; g.strokeStyle = fill;
            g.fill(); g.stroke();
        };
        const wall = hex(def.wall);
        const gu = i => i / N - 0.5;

        // perimeter edges in fixed order; each knows its outward normal and grid walk
        const EDGES = [
            { id: 0, n: [0, -1], at: t => [t, 0] },
            { id: 1, n: [1, 0], at: t => [N, t] },
            { id: 2, n: [0, 1], at: t => [t, N] },
            { id: 3, n: [-1, 0], at: t => [0, t] },
        ];
        const faces = e => depth(e.n[0], e.n[1]) > 0;
        const bottomZ = (e, t) => -T * rough[e.id * (N + 1) + t];

        // hanging rock underside: a ring of facets narrowing to a point, drawn first
        if (o.underside) {
            const D = o.underside * W, seg = Math.max(4, Math.round(N / 7));
            const facets = [];
            const tip = [0, 0, -T - D];
            for (const e of EDGES) {
                for (let t0 = 0; t0 < N; t0 += seg) {
                    const t1 = Math.min(N, t0 + seg), tm = (t0 + t1) / 2;
                    const [ia, ja] = e.at(tm);
                    const r = 0.38 + 0.22 * hash(e.id, t0, s + 21);
                    const inner = [gu(ia) * r, gu(ja) * r, -T - D * (0.42 + 0.3 * hash(t0, e.id, s + 22))];
                    const rim = [];
                    for (let t = t0; t <= t1; t++) { const [i, j] = e.at(t); rim.push([gu(i), gu(j), bottomZ(e, t)]); }
                    const lit = 0.5 + 0.4 * Math.max(0, -(e.n[0] * cs - e.n[1] * sn) * 0.7 + 0.3);
                    facets.push({ pts: [...rim, inner], k: lit * (0.85 + 0.25 * hash(t0, e.id, s + 23)), d: depth(gu(ia), gu(ja)) });
                    facets.push({ pts: [rim[rim.length - 1], inner, tip], k: lit * 0.62, d: depth(gu(ia), gu(ja)) * 0.6 });
                    facets.push({ pts: [rim[0], inner, tip], k: lit * 0.55, d: depth(gu(ia), gu(ja)) * 0.6 });
                }
            }
            facets.sort((a, b) => a.d - b.d);
            for (const f of facets) poly(f.pts.map(q => P(q[0], q[1], q[2])), rgb(wall, f.k));
        }

        // top surface, back to front (re-sorted only when the angle changes)
        if (p.orderTheta !== th) {
            const idx = new Uint32Array(N * N), dep = new Float32Array(N * N);
            for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const q = j * N + i; idx[q] = q; dep[q] = depth(gu(i + 0.5), gu(j + 0.5)); }
            p.order = Array.from(idx).sort((a, b) => dep[a] - dep[b]);
            p.orderTheta = th;
        }
        const [s0, s1] = def.shade;
        for (const q of p.order) {
            const i = q % N, j = (q / N) | 0;
            const ax = gx[q] * cs - gy[q] * sn, ay = gx[q] * sn + gy[q] * cs;
            const lam = Math.max(0, (-ax * LIGHT[0] - ay * LIGHT[1] + LIGHT[2]) / Math.hypot(ax, ay, 1));
            const k = s0 + s1 * lam;
            const fill = `rgb(${Math.min(255, base[q * 3] * k) | 0},${Math.min(255, base[q * 3 + 1] * k) | 0},${Math.min(255, base[q * 3 + 2] * k) | 0})`;
            poly([
                P(gu(i), gu(j), hAt(i, j) * H), P(gu(i + 1), gu(j), hAt(i + 1, j) * H),
                P(gu(i + 1), gu(j + 1), hAt(i + 1, j + 1) * H), P(gu(i), gu(j + 1), hAt(i, j + 1) * H),
            ], fill);
        }

        // rock walls with strata bands on the edges that face you
        const front = EDGES.filter(faces);
        for (const e of front) {
            const right = (e.n[0] * cs - e.n[1] * sn) - (e.n[0] * sn + e.n[1] * cs);
            const lit = right < 0 ? 1.05 : 0.68;
            for (let t = 0; t < N; t++) {
                const [i0, j0] = e.at(t), [i1, j1] = e.at(t + 1);
                const za = hAt(i0, j0) * H, zb = hAt(i1, j1) * H, ba = bottomZ(e, t), bb = bottomZ(e, t + 1);
                const ci = Math.min(N - 1, i0), cj = Math.min(N - 1, j0), q = (cj * N + ci) * 3;
                const surface = [base[q], base[q + 1], base[q + 2]];
                for (let b = 0; b < 6; b++) {
                    const f0 = b / 6, f1 = (b + 1) / 6;
                    const col = b === 0 ? mix(surface, wall, 0.55) : mix(wall, [255, 255, 255], 0.05 * ((b * 7 + ((t / 9) | 0)) % 3));
                    poly([
                        P(gu(i0), gu(j0), za + (ba - za) * f0), P(gu(i1), gu(j1), zb + (bb - zb) * f0),
                        P(gu(i1), gu(j1), zb + (bb - zb) * f1), P(gu(i0), gu(j0), za + (ba - za) * f1),
                    ], rgb(col, lit * (0.82 + 0.3 * hash(t, b, s + 3))));
                }
            }
        }

        // a few fragments breaking away from the front edges
        const frags = o.fragments ?? 9;
        for (let f = 0; f < frags && front.length; f++) {
            const e = front[f % front.length];
            const t = Math.floor(hash(f, 1 + e.id, s) * N);
            const [i0, j0] = e.at(t);
            const out = 0.012 + 0.05 * hash(f, 2, s);
            const u = gu(i0) + e.n[0] * out, v = gu(j0) + e.n[1] * out;
            const z = -T * (0.2 + 1.5 * hash(f, 3, s)) - (o.underside ? o.underside * W * 0.4 * hash(f, 7, s) : 0);
            const r = 0.004 + 0.008 * hash(f, 4, s), hgt = r * W * 0.8;
            const ci = Math.min(N - 1, i0), cj = Math.min(N - 1, j0), q = (cj * N + ci) * 3;
            const surf = [base[q], base[q + 1], base[q + 2]];
            poly([P(u - r, v + r, z + hgt), P(u + r, v + r, z + hgt), P(u + r, v + r, z), P(u - r, v + r, z)], rgb(wall, 0.9));
            poly([P(u + r, v - r, z + hgt), P(u + r, v + r, z + hgt), P(u + r, v + r, z), P(u + r, v - r, z)], rgb(wall, 0.65));
            poly([P(u - r, v - r, z + hgt), P(u + r, v - r, z + hgt), P(u + r, v + r, z + hgt), P(u - r, v + r, z + hgt)], rgb(surf, 0.95));
        }
        return { P, H, T };
    }

    // ---------- bitmap: draw once into an offscreen canvas ----------
    function bitmap(p, W, dpr, o = {}) {
        const A = W / 2 / SIZE, B = A * (o.tilt || 0.4), H = p.def.relief * W, T = 0.055 * W;
        const D = (o.underside || 0) * W;
        const pad = 0.06 * W;
        const halfW = A * 1.02 + pad;
        const up = B * 1.02 + H * 1.1 + pad, down = B * 1.02 + T * 2 + D + pad;
        const c = document.createElement('canvas');
        c.width = Math.ceil(halfW * 2 * dpr);
        c.height = Math.ceil((up + down) * dpr);
        const g = c.getContext('2d', { willReadFrequently: true });
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw(g, p, { ...o, x: halfW, y: up, W, dpr });
        return { canvas: c, ctx: g, ox: halfW, oy: up, w: halfW * 2, h: up + down, rightX: A * 1.0 };
    }

    // is this pixel of a bitmap solid?
    const solid = (bm, x, y, dpr) => x >= 0 && y >= 0 && x < bm.w && y < bm.h &&
        bm.ctx.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data[3] > 40;

    return { STYLES, prepare, draw, bitmap, solid, hash, fbm, riverV, clamp01 };
})();

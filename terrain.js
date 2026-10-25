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
    const SAND = hex('#d6c493'), SAND2 = hex('#c2ad78'), STAIN = hex('#6d665c'), LICHEN = hex('#9aa06a'), SCREE2 = hex('#8f8676');
    const PINE3 = hex('#163024'), MOSS2 = hex('#7e9446'), TREE = hex('#2c5a36'), TREE2 = hex('#183424');

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
        harbor: {   // half deterministic (stacked container terraces), half organic terrain, joined by a seam of light
            seed: 83, relief: 0.12, spin: 0, wall: '#1d2a3a', shade: [0.62, 0.55],
            height: (u, v, s) => {
                const seam = 0.5 + 0.08 * Math.sin(v * 9 + 1);
                if (u < seam - 0.02) {
                    const bx = Math.floor(u * 9), by = Math.floor(v * 9);
                    return 0.12 + 0.12 * Math.floor(hash(bx, by, s) * 5);
                }
                const t = clamp01((u - seam) / 0.12);
                return 0.12 + t * 0.8 * Math.pow(fbm(u * 3, v * 3, s, 5), 1.4);
            },
            color: c => {
                const seam = 0.5 + 0.08 * Math.sin(c.v * 9 + 1);
                if (Math.abs(c.u - seam) < 0.018) return mix(SUN, [255, 255, 255], 0.4);
                if (c.u < seam) {
                    const bx = Math.floor(c.u * 9), by = Math.floor(c.v * 9);
                    const box = ['#e4572e', '#2f6690', '#3a7d44', '#f4a259', '#1b2a41', '#c9cba3'].map(hex)[Math.floor(hash(by, bx, 9) * 6)];
                    const edge = (c.u * 9) % 1 < 0.08 || (c.v * 9) % 1 < 0.08;
                    return edge ? mix(box, [20, 24, 32], 0.55) : box;
                }
                if (c.h < 0.2) return mix(WATER, WATER2, clamp01(c.light * 0.8));
                return c.h > 0.5 ? mix(GRANITE, GRANITE2, c.n) : mix(PINE2, GRASS, clamp01(c.h * 1.8 - 0.2 + 0.2 * c.n));
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
            cavity: 9, trees: true,
            wallBands: ['#5d7a3a', '#4a3424', '#6e4f35', '#8c6a48', '#7d766b', '#5c4a3a'].map(hex),
            color: c => {
                const d = c.v - riverV(c.u), ad = Math.abs(d);
                // river: brighter down the middle, a thin sandy bank on each side
                if (ad < 0.016 && c.h < 0.14) return mix(mix(WATER, WATER2, clamp01(c.light * 0.8 + 0.15 * c.n)), [235, 248, 255], Math.pow(1 - ad / 0.016, 3) * 0.45);
                if (ad < 0.026 && c.h < 0.16) return mix(SAND, SAND2, c.n);
                const patch = fbm(c.u * 16, c.v * 16, 73, 3), fine = vnoise(c.u * 70, c.v * 70, 74);
                let col;
                if (c.h > 0.66 && c.slope < 1.5 + 0.6 * patch) {
                    col = mix(SNOWSH, SNOW, clamp01(c.light * 1.1 + 0.2 * fine));          // snowfields on the tops
                } else if (c.slope > 1.7 || c.h > 0.5 + 0.08 * c.n) {
                    // granite: vertical streaks and darker water stains, with a little lichen
                    const streak = vnoise(c.u * 46 + c.v * 46, c.h * 6, 75);
                    col = mix(GRANITE, GRANITE2, clamp01(c.h * 0.7 + 0.35 * streak - 0.1));
                    if (streak < 0.28) col = mix(col, STAIN, 0.45);
                    if (fine > 0.8) col = mix(col, LICHEN, 0.35);
                } else if (c.h > 0.43 + 0.05 * c.n) {
                    col = mix(SCREE2, GRANITE, clamp01(patch));                              // scree below the cliffs
                } else if (c.h > 0.12 + 0.05 * c.n) {
                    // forest: clumps of darker and lighter pines; trees get drawn on top
                    col = mix(mix(PINE3, PINE, clamp01(patch * 1.4)), PINE2, clamp01(fine * 0.6 + c.h - 0.2));
                    c.tree = 0.2 + 0.26 * patch;
                } else {
                    // meadow: patchy greens and golds, a few flowers
                    col = mix(mix(GRASS, GRASS2, clamp01(patch * 1.3)), MOSS2, clamp01(0.5 - fine) * 0.5);
                    if (c.n > 0.975) col = [[248, 240, 196], [246, 214, 222], [255, 255, 245]][Math.floor(fine * 3) % 3];
                    else c.tree = 0.04;
                }
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
        const trees = new Map();        // cell -> tree size, for styles with trees
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            const h00 = hAt(i, j), h10 = hAt(i + 1, j), h01 = hAt(i, j + 1), h11 = hAt(i + 1, j + 1);
            const ax = (hAt(i + 2, j) - hAt(i - 1, j)) / 3 * N * k, ay = (hAt(i, j + 2) - hAt(i, j - 1)) / 3 * N * k;
            const lam = Math.max(0, (-ax * LIGHT[0] - ay * LIGHT[1] + LIGHT[2]) / Math.hypot(ax, ay, 1));
            const lo = Math.min(h00, h10, h01, h11), hi = Math.max(h00, h10, h01, h11);
            const ctxCell = {
                h: (h00 + h11) / 2, u: (i + 0.5) / N, v: (j + 0.5) / N, light: lam,
                slope: Math.hypot(ax, ay) / Math.max(0.2, k), n: hash(i, j, s + 5),
                contour: Math.floor(lo * 12) !== Math.floor(hi * 12),
            };
            const c = def.color(ctxCell);
            const q = j * N + i;
            const cell = { h: (h00 + h11) / 2 };
            let col = c;
            if (def.cavity) {
                // fake ambient occlusion: hollows a little darker, ridges a little brighter
                let sum = 0;
                for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) sum += hAt(i + di, j + dj);
                const cav = cell.h - sum / 25;
                const f = Math.min(1.16, Math.max(0.72, 1 + cav * def.cavity));
                col = [c[0] * f, c[1] * f, c[2] * f];
            }
            base[q * 3] = col[0]; base[q * 3 + 1] = col[1]; base[q * 3 + 2] = col[2];
            gx[q] = ax; gy[q] = ay;
            if (def.trees && ctxCell.tree && hash(i, j, s + 91) < ctxCell.tree) trees.set(q, 0.6 + 0.8 * hash(j, i, s + 92));
        }
        // rough bottom edge, keyed to fixed perimeter positions so it holds still while turning
        const rough = new Float32Array(4 * M);
        for (let e = 0; e < 4; e++) for (let t = 0; t <= N; t++) rough[e * M + t] = 1 + 0.45 * (fbm(t / N * 4.6, 3.3 + e, s + 9, 3) - 0.5);
        return { def, N, hs, hAt, base, gx, gy, rough, trees, order: null, orderTheta: NaN };
    }

    // ---------- underside mesh ----------
    // Built once per island in grid space (u, v in -0.5..0.5, z in units of W): rings that start
    // at the walls' rough bottom edge and close in toward a few hanging points. Each facet keeps
    // its own soil, clay or rock color; lighting and sorting happen per frame.
    const SOIL = ['#3b2a1e', '#5a3f2b', '#7a5638', '#94704d', '#6b5240', '#4a3a2e'].map(hex);
    const STONE = hex('#77736b'), STONE2 = hex('#a39d92'), ROOT = hex('#2a1d14'), MOSS = hex('#4f6b34');

    function buildUnderside(p, depth) {
        const { N, rough, def } = p, s = def.seed;
        const K = Math.max(14, Math.round(N * 0.8)), AR = 4 * K, RINGS = 18, T = 0.055;
        const verts = new Float32Array((RINGS + 1) * AR * 3);
        for (let i = 0; i < AR; i++) {
            const e = (i / K) | 0, f = (i % K) / K;
            let u, v, t;
            if (e === 0) { u = -0.5 + f; v = -0.5; t = Math.round(f * N); }
            else if (e === 1) { u = 0.5; v = -0.5 + f; t = Math.round(f * N); }
            else if (e === 2) { u = 0.5 - f; v = 0.5; t = Math.round((1 - f) * N); }
            else { u = -0.5; v = 0.5 - f; t = Math.round((1 - f) * N); }
            const z0 = -T * rough[e * (N + 1) + t];
            const len = Math.hypot(u, v), cu = u / len * 0.46, cv = v / len * 0.46;
            const a = i / AR * Math.PI * 2;
            // a few long drips and many short ones, set by where you are around the rim
            const lobes = 0.55 + 0.75 * Math.pow(fbm(Math.cos(a) * 1.6 + 5, Math.sin(a) * 1.6, s + 41, 3), 1.6) * 1.6;
            for (let j = 0; j <= RINGS; j++) {
                const r = j / RINGS, sr = smooth(r);
                const wob = 1 + 0.16 * (fbm(i / AR * 22, r * 5, s + 43, 3) - 0.5) * (0.4 + r);
                const sc = j === RINGS ? 0 : (0.03 + 0.97 * Math.pow(1 - r, 0.9)) * wob;   // last ring closes on the axis
                const q = (j * AR + i) * 3;
                verts[q] = (u + (cu - u) * sr) * sc;
                verts[q + 1] = (v + (cv - v) * sr) * sc;
                const bump = (vnoise(i / AR * 60, r * 14, s + 45) - 0.5) * 0.018 * (1 - r * 0.5);
                // the first ring tucks up inside the wall so no seam shows between them
                verts[q + 2] = j === 0 ? z0 + T * 0.6 : z0 + (-T - depth * lobes - z0) * Math.pow(r, 0.82) + bump;
            }
        }
        const quads = [];
        const V = (i, j) => ((j * AR + ((i + AR) % AR)) * 3);
        const normal = (i, j) => {
            const a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
            const ex = [verts[c] - verts[a], verts[c + 1] - verts[a + 1], verts[c + 2] - verts[a + 2]];
            const ey = [verts[d] - verts[b], verts[d + 1] - verts[b + 1], verts[d + 2] - verts[b + 2]];
            return [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
        };
        // the winding is the same everywhere, so one well-shaped facet decides which way is out
        const probe = normal(K >> 1, RINGS >> 1), pc = V(K >> 1, RINGS >> 1);
        const flip = probe[0] * verts[pc] + probe[1] * verts[pc + 1] < 0 ? -1 : 1;
        for (let j = 0; j < RINGS; j++) for (let i = 0; i < AR; i++) {
            const a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
            let n = normal(i, j).map(x => x * flip);
            const m = Math.hypot(...n) || 1;
            n = n.map(x => x / m);
            const r = (j + 0.5) / RINGS;
            // soil strata by depth, broken up by noise; stone outcrops, root lines, moss at the lip
            const band = r * 1.9 + 0.55 * fbm(i / AR * 9, r * 3, s + 47, 4);
            let col = ramp(SOIL, band - Math.floor(band));
            const rock = vnoise(i / AR * 26, r * 9, s + 49);
            if (rock > 0.66) col = mix(col, mix(STONE, STONE2, hash(i, j, s + 51)), clamp01((rock - 0.66) * 5));
            if (j < 4 && hash(i, j, s + 53) > 0.86) col = mix(col, ROOT, 0.7);
            if (j === 0 && hash(i, 3, s + 55) > 0.55) col = mix(col, MOSS, 0.6);
            const grain = 0.78 + 0.42 * hash(i, j, s + 57);
            quads.push({ a, b, c, d, n, col, k: grain * (1 - 0.28 * r), tri: j >= RINGS - 6 });
        }
        return { verts, quads, depth };
    }

    const FILL = (() => { const l = [-0.45, 0.8, 0.12], m = Math.hypot(...l); return l.map(x => x / m); })();

    function drawUnderside(g, p, depth, P, cs, sn, W, poly) {
        if (!p.under || p.under.depth !== depth) p.under = buildUnderside(p, depth);
        const { verts, quads } = p.under;
        const VIEW_Z = 0.357;     // view direction (1, 1, 0.357) in this projection
        const list = [];
        for (const f of quads) {
            const nx = f.n[0] * cs - f.n[1] * sn, ny = f.n[0] * sn + f.n[1] * cs, nz = f.n[2];
            const away = nx + ny + nz * VIEW_Z <= 0;                // drawn anyway (dark) so folds never show a gap
            const ax = verts[f.a] * cs - verts[f.a + 1] * sn, ay = verts[f.a] * sn + verts[f.a + 1] * cs;
            const cx = verts[f.c] * cs - verts[f.c + 1] * sn, cy = verts[f.c] * sn + verts[f.c + 1] * cs;
            const dep = (ax + ay + cx + cy) / 2 + (verts[f.a + 2] + verts[f.c + 2]) / 2 * VIEW_Z;
            const lit = away ? 0.22 : 0.3 + 0.78 * Math.max(0, nx * FILL[0] + ny * FILL[1] + nz * FILL[2]);
            list.push([dep, f, lit]);
        }
        list.sort((x, y) => x[0] - y[0]);
        const pt = q => P(verts[q], verts[q + 1], verts[q + 2] * W);
        for (const [, f, lit] of list) {
            const fill = rgb(f.col, lit * f.k);
            // near the tips the rings twist, so split those facets into triangles (no bow-ties)
            if (f.tri) { const A = pt(f.a), C = pt(f.c); poly([A, pt(f.b), C], fill); poly([A, C, pt(f.d)], fill); }
            else poly([pt(f.a), pt(f.b), pt(f.c), pt(f.d)], fill);
        }
        return list.length;
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

        // hanging underside: a textured mesh of earth and rock tapering to a few points
        let polys = 0;
        if (o.underside) polys += drawUnderside(g, p, o.underside, P, cs, sn, W, poly);

        // top surface, back to front (re-sorted only when the angle changes)
        if (p.orderTheta !== th) {
            const idx = new Uint32Array(N * N), dep = new Float32Array(N * N);
            for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const q = j * N + i; idx[q] = q; dep[q] = depth(gu(i + 0.5), gu(j + 0.5)); }
            p.order = Array.from(idx).sort((a, b) => dep[a] - dep[b]);
            p.orderTheta = th;
        }
        const [s0, s1] = def.shade;
        let treesDrawn = 0;
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
            const tree = p.trees.get(q);
            if (tree) {
                // a small pine, drawn upright in screen space: a lit half and a shaded half
                const [bx, by] = P(gu(i + 0.5), gu(j + 0.5), (hAt(i, j) + hAt(i + 1, j + 1)) / 2 * H);
                const th = W * 0.023 * tree, tw = W * 0.0078 * tree;
                g.beginPath(); g.moveTo(bx, by - th); g.lineTo(bx - tw, by); g.lineTo(bx, by + tw * 0.25); g.closePath();
                g.fillStyle = rgb(TREE, k * 1.05); g.fill();
                g.beginPath(); g.moveTo(bx, by - th); g.lineTo(bx + tw, by); g.lineTo(bx, by + tw * 0.25); g.closePath();
                g.fillStyle = rgb(TREE2, k); g.fill();
                treesDrawn++;
            }
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
                    let col;
                    if (def.wallBands) {
                        // layered cliff: a grassy lip, then soil, clay and rock bands that wander
                        const wv = fbm(t / N * 7 + e.id * 3, b * 0.7, s + 61, 3);
                        const band = Math.min(def.wallBands.length - 1, Math.max(0, Math.round(b + (wv - 0.5) * 1.6)));
                        col = b === 0 ? mix(surface, def.wallBands[0], 0.35) : def.wallBands[band];
                        if (b > 1 && hash(t, b, s + 62) > 0.9) col = mix(col, STONE2, 0.5);      // embedded stones
                        if (b > 0 && b < 3 && hash(t, b + 9, s + 63) > 0.93) col = mix(col, ROOT, 0.6);
                    } else col = b === 0 ? mix(surface, wall, 0.55) : mix(wall, [255, 255, 255], 0.05 * ((b * 7 + ((t / 9) | 0)) % 3));
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
        polys += N * N + front.length * N * 6 + frags * 3 + treesDrawn * 2;
        return { P, H, T, polys };
    }

    // ---------- bitmap: draw once into an offscreen canvas ----------
    function bitmap(p, W, dpr, o = {}) {
        const A = W / 2 / SIZE, B = A * (o.tilt || 0.4), H = p.def.relief * W, T = 0.055 * W;
        const D = (o.underside || 0) * W * 1.8;
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

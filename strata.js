// Strata: one floating slab of terrain per project, stacked like core samples.
// Each slab is a procedural heightmap drawn once to its own canvas in a false-color
// style (black range, interferogram, alpine, mineral scan, bathymetry); the stack then
// floats, separates on first view, and lifts the slab you point at. Clicking a slab
// jumps to its project card below.

(() => {
    const root = document.querySelector('.strata');
    if (!root) return;
    const canvas = root.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const labels = [...root.querySelectorAll('.strata-labels li')];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

    // ---------- color helpers ----------
    const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const ramp = (stops, t) => {
        t = Math.min(0.9999, Math.max(0, t));
        const f = t * (stops.length - 1), i = Math.floor(f);
        return mix(stops[i], stops[i + 1], f - i);
    };
    const clamp01 = x => Math.min(1, Math.max(0, x));

    // ---------- the five terrains ----------
    // height(u, v) -> 0..1, color(ctx) -> [r,g,b] before lighting; u, v in 0..1
    const ICE = hex('#cdc4f2'), ICE2 = hex('#9f93dc'), ROCK = hex('#16161c'), ROCK2 = hex('#3b3a46'), GOLD = hex('#e2bd72');
    const FRINGE = ['#7a35e0', '#c044d8', '#4f8cff', '#4fe3e6', '#c6f36b', '#f5ec5b', '#ff9a3c', '#7a35e0'].map(hex);
    const FOREST = hex('#1d3a2a'), MEADOW = hex('#3f6b43'), SCREE = hex('#5a5548'), SNOW = hex('#f3f5fb'), SNOWSH = hex('#b9c6e6');
    const MINERAL = ['#1a1212', '#c41f1a', '#f0611c', '#f7b733', '#fff0a8', '#e8452a', '#3ccfd0', '#1b6f7a', '#1a1212'].map(hex);
    const DEEP = ['#071c45', '#0f3f8f', '#2b7fd6', '#63c7f2', '#bff1ff'].map(hex);

    const SLABS = [
        {   // black range: sharp peaks, icy lavender valleys, metallic gold light
            seed: 11, relief: 0.15, spin: 4, wall: '#18171d',
            height: (u, v, s) => Math.pow(ridged(u * 2.2, v * 2.2, s, 5), 1.9) * 1.2,
            color: c => {
                if (c.h < 0.16 + 0.05 * c.n) return mix(ICE2, ICE, clamp01(c.light * 1.1));
                const rock = mix(ROCK, ROCK2, c.n);
                return c.light > 0.82 && c.h > 0.38 ? mix(rock, GOLD, (c.light - 0.82) * 4.2) : rock;
            },
            shade: [0.55, 0.75],
        },
        {   // interferogram: low relief, rainbow fringes, a fault line running through
            seed: 23, relief: 0.07, spin: -5, wall: '#3a2a6a',
            height: (u, v, s) => {
                const d = v - (0.5 + 0.22 * Math.sin(u * 7.5 + 1) * (1 - u * 0.4));
                return clamp01(0.55 + 0.35 * (fbm(u * 3, v * 3, s) - 0.5) - 0.5 * Math.exp(-d * d / 0.0016));
            },
            color: c => {
                const d = c.v - (0.5 + 0.22 * Math.sin(c.u * 7.5 + 1) * (1 - c.u * 0.4));
                const f = fbm(c.u * 2.2, c.v * 2.2, 99) * 2.6 + 0.9 * Math.exp(-d * d / 0.012) + 0.08 * c.n;
                return ramp(FRINGE, f - Math.floor(f));
            },
            shade: [0.85, 0.3],
        },
        {   // alpine: forest valleys, scree, snowfields on the high ground
            seed: 37, relief: 0.13, spin: -2, wall: '#24291f',
            height: (u, v, s) => Math.pow(ridged(u * 2 + 3, v * 2, s, 5), 1.6) * 1.15,
            color: c => {
                if (c.h > 0.42 - 0.1 * c.n) return mix(SNOWSH, SNOW, clamp01(c.light * 1.2));
                if (c.h > 0.3 + 0.06 * c.n) return mix(SCREE, ROCK2, c.n * 0.6);
                return mix(FOREST, MEADOW, clamp01(c.h * 2.6 + 0.15 * c.n));
            },
            shade: [0.68, 0.55],
        },
        {   // mineral scan: swirling ore bands, nearly flat
            seed: 41, relief: 0.05, spin: 6, wall: '#6e1810',
            height: (u, v, s) => 0.5 + 0.5 * (fbm(u * 5, v * 5, s, 4) - 0.5) + 0.12 * (vnoise(u * 60, v * 60, s) - 0.5),
            color: c => {
                const wx = fbm(c.u * 2 + 5, c.v * 2, 7) * 1.6, wy = fbm(c.u * 2, c.v * 2 + 9, 8) * 1.6;
                const t = fbm(c.u * 1.4 + wx, c.v * 1.4 + wy, 5) * 3.2 + 0.05 * c.n;
                return ramp(MINERAL, t - Math.floor(t));
            },
            shade: [0.8, 0.35],
        },
        {   // bathymetry: rolling seafloor with white contour lines
            seed: 53, relief: 0.1, spin: -4, wall: '#0a1f45',
            height: (u, v, s) => Math.pow(fbm(u * 2.4, v * 2.4, s, 5), 1.4) * 1.3,
            color: c => {
                const base = ramp(DEEP, clamp01(c.h * 1.2));
                return c.contour ? mix(base, [255, 255, 255], 0.38) : base;
            },
            shade: [0.7, 0.45],
        },
    ];

    const N = 110;                    // cells per side
    const TILT = 0.4;                // vertical squash of the top plane (view elevation)
    const BASE_SPIN = 14 * Math.PI / 180;
    const LIGHT = (() => { const l = [-0.55, -0.65, 0.55], m = Math.hypot(...l); return l.map(x => x / m); })();
    const css = (c, k = 1) => `rgb(${Math.round(Math.min(255, c[0] * k))},${Math.round(Math.min(255, c[1] * k))},${Math.round(Math.min(255, c[2] * k))})`;

    // ---------- draw one slab to its own canvas ----------
    function buildSlab(def, W, dpr) {
        const A = W / 2 / 1.12, B = A * TILT, H = def.relief * W, T = 0.055 * W;
        const th = BASE_SPIN + def.spin * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
        const s = def.seed;

        const hs = new Float32Array((N + 1) * (N + 1));
        for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) hs[j * (N + 1) + i] = clamp01(def.height(i / N, j / N, s));
        const hAt = (i, j) => hs[Math.min(N, Math.max(0, j)) * (N + 1) + Math.min(N, Math.max(0, i))];

        // grid (u,v in -0.5..0.5, z in px) -> screen, relative to slab center
        const P = (u, v, z) => {
            const ur = u * cs - v * sn, vr = u * sn + v * cs;
            return [(ur - vr) * A, (ur + vr) * B - z];
        };

        // bounds: corners at top and bottom, plus room for fragments and peaks
        const pts = [];
        for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) pts.push(P(u, v, H * 1.1), P(u, v, -T * 2));
        const pad = 0.06 * W;
        const minX = Math.min(...pts.map(p => p[0])) - pad, maxX = Math.max(...pts.map(p => p[0])) + pad;
        const minY = Math.min(...pts.map(p => p[1])) - pad, maxY = Math.max(...pts.map(p => p[1])) + pad;

        const c = document.createElement('canvas');
        c.width = Math.ceil((maxX - minX) * dpr);
        c.height = Math.ceil((maxY - minY) * dpr);
        const g = c.getContext('2d', { willReadFrequently: true });
        g.setTransform(dpr, 0, 0, dpr, -minX * dpr, -minY * dpr);
        g.lineJoin = 'round';
        g.lineWidth = 0.9 / dpr;

        const quad = (a, b, cc, d, fill) => {
            g.beginPath();
            g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(cc[0], cc[1]); g.lineTo(d[0], d[1]);
            g.closePath();
            g.fillStyle = fill; g.strokeStyle = fill;
            g.fill(); g.stroke();
        };

        // top surface, back to front
        const cells = [];
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
            const u = (i + 0.5) / N - 0.5, v = (j + 0.5) / N - 0.5;
            cells.push([u * sn + v * cs + u * cs - v * sn, i, j]);
        }
        cells.sort((a, b) => a[0] - b[0]);
        const k = def.relief * 9;     // how strongly slope shows in the light
        const topColor = new Array(N * N);
        for (const [, i, j] of cells) {
            const h00 = hAt(i, j), h10 = hAt(i + 1, j), h01 = hAt(i, j + 1), h11 = hAt(i + 1, j + 1);
            const gx = (hAt(i + 2, j) - hAt(i - 1, j)) / 3 * N * k, gy = (hAt(i, j + 2) - hAt(i, j - 1)) / 3 * N * k;
            const nm = Math.hypot(gx, gy, 1);
            const lam = Math.max(0, (-gx * LIGHT[0] - gy * LIGHT[1] + LIGHT[2]) / nm);
            const h = (h00 + h11) / 2, u = (i + 0.5) / N, v = (j + 0.5) / N;
            const contour = Math.floor(Math.min(h00, h10, h01, h11) * 12) !== Math.floor(Math.max(h00, h10, h01, h11) * 12);
            const base = def.color({ h, u, v, contour, light: lam, slope: Math.hypot(gx, gy) / Math.max(0.2, k), n: hash(i, j, s + 5) });
            const col = css(base, def.shade[0] + def.shade[1] * lam);
            topColor[j * N + i] = base;
            const x0 = i / N - 0.5, x1 = (i + 1) / N - 0.5, y0 = j / N - 0.5, y1 = (j + 1) / N - 0.5;
            quad(P(x0, y0, h00 * H), P(x1, y0, h10 * H), P(x1, y1, h11 * H), P(x0, y1, h01 * H), col);
        }

        // the two edges that face the viewer get rock walls with strata bands
        const wall = hex(def.wall);
        const edges = [
            { n: [0, 1], at: t => [t, N] },     // v = +0.5
            { n: [1, 0], at: t => [N, t] },     // u = +0.5
            { n: [0, -1], at: t => [t, 0] },
            { n: [-1, 0], at: t => [0, t] },
        ].filter(e => {
            const nu = e.n[0] * cs - e.n[1] * sn, nv = e.n[0] * sn + e.n[1] * cs;
            return nu + nv > 0;
        });
        const bottom = t => T * (1 + 0.45 * (fbm(t * 0.05, 3.3, s + 9, 3) - 0.5) );
        edges.forEach((e, ei) => {
            const facing = (e.n[0] * cs - e.n[1] * sn) - (e.n[0] * sn + e.n[1] * cs);   // >0 faces right
            const lit = facing < 0 ? 1.05 : 0.68;
            for (let t = 0; t < N; t++) {
                const [i0, j0] = e.at(t), [i1, j1] = e.at(t + 1);
                const a = [i0 / N - 0.5, j0 / N - 0.5], b = [i1 / N - 0.5, j1 / N - 0.5];
                const za = hAt(i0, j0) * H, zb = hAt(i1, j1) * H;
                const ba = -bottom(t + ei * 200), bb = -bottom(t + 1 + ei * 200);
                const bands = 6;
                for (let q = 0; q < bands; q++) {
                    const f0 = q / bands, f1 = (q + 1) / bands;
                    const top = q === 0;
                    const ya0 = top ? za : za + (ba - za) * f0, yb0 = top ? zb : zb + (bb - zb) * f0;
                    const ya1 = za + (ba - za) * f1, yb1 = zb + (bb - zb) * f1;
                    // top band picks up the surface color, lower bands are rock strata
                    const surface = topColor[Math.min(N - 1, j0 === N ? N - 1 : j0) * N + Math.min(N - 1, i0 === N ? N - 1 : i0)];
                    let col = q === 0 ? mix(surface, wall, 0.55) : mix(wall, [255, 255, 255], 0.05 * ((q * 7 + Math.floor(t / 9)) % 3));
                    const grain = 0.82 + 0.3 * hash(t, q, s + 3);
                    quad(P(a[0], a[1], ya0), P(b[0], b[1], yb0), P(b[0], b[1], yb1), P(a[0], a[1], ya1), css(col, lit * grain));
                }
            }
        });

        // a few fragments breaking away from the front edges
        const frags = 9;
        for (let f = 0; f < frags; f++) {
            const e = edges[f % edges.length];
            const t = Math.floor(hash(f, 1, s) * N);
            const [i0, j0] = e.at(t);
            const out = 0.012 + 0.05 * hash(f, 2, s);
            const u = i0 / N - 0.5 + e.n[0] * out, v = j0 / N - 0.5 + e.n[1] * out;
            const z = -T * (0.2 + 1.5 * hash(f, 3, s));
            const r = 0.004 + 0.008 * hash(f, 4, s);
            const hgt = r * W * 0.8;
            const surf = topColor[Math.min(N - 1, j0) * N + Math.min(N - 1, i0)] || wall;
            const c0 = P(u - r, v - r, z + hgt), c1 = P(u + r, v - r, z + hgt), c2 = P(u + r, v + r, z + hgt), c3 = P(u - r, v + r, z + hgt);
            const d1 = P(u + r, v - r, z), d2 = P(u + r, v + r, z), d3 = P(u - r, v + r, z);
            quad(c3, c2, d2, d3, css(wall, 0.9));
            quad(c1, c2, d2, d1, css(wall, 0.65));
            quad(c0, c1, c2, c3, css(surf, 0.95));
        }

        // where the slab's center sits within its canvas, in css px
        return { canvas: c, ctx: g, ox: -minX, oy: -minY, w: maxX - minX, h: maxY - minY, rightX: Math.max(...pts.map(p => p[0])) };
    }

    // ---------- layout ----------
    let slabs = [], labelX = 0, cssW = 0, cssH = 0, dpr = 1, step = 0, cx = 0, top0 = 0;
    const state = SLABS.map(() => ({ lift: 0 }));
    let hovered = -1, spread = reduced ? 1 : 0, started = false, visible = false, raf = 0, t0 = 0;

    function layout() {
        const w = root.clientWidth;
        if (!w || Math.abs(w - cssW) < 2 && slabs.length) return;
        cssW = w;
        dpr = Math.min(2, window.devicePixelRatio || 1);
        const narrow = w < 640;
        const W = narrow ? w * 0.66 : Math.min(520, w * 0.5);
        slabs = SLABS.map(d => buildSlab(d, W, dpr));
        step = W * (narrow ? 0.4 : 0.37);
        cx = narrow ? w * 0.38 : w * 0.31;
        top0 = W * 0.12 + slabs[0].oy * 0.6;
        cssH = Math.ceil(top0 + step * (SLABS.length - 1) + slabs[SLABS.length - 1].h - slabs[SLABS.length - 1].oy + 20);
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas.style.height = cssH + 'px';
        root.style.height = cssH + 'px';
        labels.forEach((li, k) => { li.style.top = (top0 + step * k) + 'px'; });
        labelX = narrow ? cx + W * 0.5 + 4 : cx + W * 0.58 + 20;
        root.style.setProperty('--label-x', labelX + 'px');
        draw(performance.now());
    }

    const ease = t => 1 - Math.pow(1 - clamp01(t), 3);

    function centerY(k, now) {
        const sp = reduced ? 1 : ease(spread * 1.25 - k * 0.06);
        const packed = top0 + step * 1.6 + k * step * 0.28;      // where the slabs start, nearly touching
        const bob = reduced ? 0 : Math.sin(now / 1100 + k * 1.3) * 3.2;
        return packed + (top0 + step * k - packed) * sp + bob - state[k].lift;
    }

    function draw(now) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);
        const lineX = labelX - 10, ink = getComputedStyle(root).color;
        // bottom slab first: the ones above sit nearer the eye
        for (let k = slabs.length - 1; k >= 0; k--) {
            const s = slabs[k], y = centerY(k, now);
            const dim = hovered >= 0 && hovered !== k;
            ctx.globalAlpha = dim ? 0.38 : 1;
            ctx.drawImage(s.canvas, cx - s.ox, y - s.oy, s.w, s.h);
            // leader line from the slab's right corner to its label
            ctx.globalAlpha = (hovered === k ? 0.9 : 0.35) * (0.4 + 0.6 * spread);
            ctx.strokeStyle = ink;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(cx + s.rightX + 8, y);
            ctx.lineTo(lineX, y);
            ctx.stroke();
            ctx.globalAlpha = 1;
            labels[k].style.transform = `translateY(${(y - (top0 + step * k)).toFixed(1)}px)`;
        }
    }

    function tick(now) {
        raf = 0;
        if (!t0) t0 = now;
        if (started && spread < 1) spread = Math.min(1, (now - t0) / 1600);
        let moving = false;
        state.forEach((st, k) => {
            const target = hovered === k ? 14 : 0;
            st.lift += (target - st.lift) * 0.16;
            if (Math.abs(target - st.lift) > 0.1) moving = true;
        });
        draw(now);
        if (visible && (!reduced || moving || spread < 1)) raf = requestAnimationFrame(tick);
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

    // ---------- interaction ----------
    function slabAt(x, y) {
        const now = performance.now();
        for (let k = 0; k < slabs.length; k++) {           // topmost first
            const s = slabs[k], lx = x - (cx - s.ox), ly = y - (centerY(k, now) - s.oy);
            if (lx < 0 || ly < 0 || lx >= s.w || ly >= s.h) continue;
            if (s.ctx.getImageData(Math.floor(lx * dpr), Math.floor(ly * dpr), 1, 1).data[3] > 40) return k;
        }
        return -1;
    }
    const setHover = k => {
        if (k === hovered) return;
        hovered = k;
        labels.forEach((li, i) => li.classList.toggle('active', i === k));
        canvas.style.cursor = k >= 0 ? 'pointer' : '';
        kick();
    };
    canvas.addEventListener('pointermove', e => {
        const r = canvas.getBoundingClientRect();
        setHover(slabAt(e.clientX - r.left, e.clientY - r.top));
    });
    canvas.addEventListener('pointerleave', () => setHover(-1));
    canvas.addEventListener('click', e => {
        const r = canvas.getBoundingClientRect();
        const k = slabAt(e.clientX - r.left, e.clientY - r.top);
        if (k >= 0) labels[k].querySelector('a').click();
    });
    labels.forEach((li, k) => {
        const a = li.querySelector('a');
        a.addEventListener('pointerenter', () => setHover(k));
        a.addEventListener('pointerleave', () => setHover(-1));
        a.addEventListener('focus', () => setHover(k));
        a.addEventListener('blur', () => setHover(-1));
    });

    new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
        if (visible && !started && e.intersectionRatio > 0.2) { started = true; t0 = 0; }
        if (visible) kick();
    }, { threshold: [0, 0.2] }).observe(root);

    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(layout, 150); });
    new MutationObserver(kick).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    layout();
})();

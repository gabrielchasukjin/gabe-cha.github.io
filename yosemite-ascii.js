// Yosemite in ASCII: El Capitan at golden hour, the living background of the homepage.
// The valley is painted as a flat poster on a hidden canvas, then redrawn as
// characters: outlines become / | \ _ strokes, fills become texture. Below it a
// river runs on forever: as the page scrolls, the view drifts down from the cliffs
// into the water (reflections, current, glints, floating leaves).
// CSS sets the scene's opacity via --scene-opacity. In dark mode (html.night, set by
// theme.js) the same valley is drawn by moonlight: a starry sky, a full moon, fireflies
// over the meadow and silver glints on the water.

(() => {
    const canvas = document.getElementById('yosemite-ascii');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const FONT = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
    let NIGHT = document.documentElement.classList.contains('night');

    // ---------- helpers ----------

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
    const scale = (c, k) => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
    const lum = c => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

    function rng(seed) {
        return () => {
            seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function hash(x, y) {
        let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }

    // ---------- palette (from the poster) ----------

    // Set for the current hour; rebuilt when the light/dark toggle flips.
    let P, SKY_TOP, SKY_LOW, BIRD_INK;
    function setPalette() {
        P = NIGHT ? {
            water: hex('#26365a'), waterLight: hex('#8fa6d8'),
            spark: hex('#eef2ff'),
            deep: hex('#141c36'),
            leaves: ['#7a4a2c', '#8a6532', '#6b3320', '#7d5a2e'].map(hex),
            bird: hex('#3a2c22'),
            star: hex('#fff8e1'), firefly: hex('#ffec8c'), moonlight: hex('#c8d6ff'),
        } : {
            water: hex('#56687a'), waterLight: hex('#2f4a63'),
            spark: hex('#d9901f'),
            deep: hex('#8f8d98'),
            leaves: ['#d9772a', '#e8a33a', '#b8471c', '#c9862f'].map(hex),
            bird: hex('#3a2c22'),
        };
        // the sky, top to horizon
        SKY_TOP = hex(NIGHT ? '#050816' : '#efaa78');
        SKY_LOW = hex(NIGHT ? '#2a3260' : '#f9d8ad');
        // the bird that follows the pointer: dark by day, pale (a bat) by night
        BIRD_INK = hex(NIGHT ? '#e8ecf8' : '#1f1610');
    }
    setPalette();

    // Day-for-night: desaturate, darken and push the poster's colours toward moonlight blue
    const nightGrade = (c, k = 1) => {
        const l = lum(c) * 255;
        const n = mix(c, [l, l, l], 0.55);
        return [n[0] * 0.5 * k, n[1] * 0.58 * k, n[2] * 0.82 * k];
    };

    // Materials, in painting order (later = in front)
    const SKY = 1, RIDGE_FAR = 2, RIDGE = 3, ROCK = 4, PINE = 5, TREE = 6, MEADOW = 7, WATER = 8, BRANCH = 10, CLOUD = 11, MOON = 12;
    // How much of a cell's colour glows behind its glyph
    const TINT = { [SKY]: 0.6, [RIDGE_FAR]: 0.42, [RIDGE]: 0.36, [ROCK]: 0.36, [PINE]: 0.26, [TREE]: 0.34, [MEADOW]: 0.36, [WATER]: 0.3, [BRANCH]: 0.04, [CLOUD]: 0.56, [MOON]: 0.85 };
    const OUTLINED = new Set([RIDGE_FAR, RIDGE, ROCK, PINE, TREE, BRANCH, CLOUD, MOON]);
    const MIRROR = { '/': '\\', '\\': '/', '^': 'v', 'v': '^', ',': "'", "'": ',', '`': ',', '_': '-', 'A': 'V', '!': 'i' };
    const STROKES = new Set(['/', '\\', '|', '-', '_', '(', ')', '^']);

    // A bird that follows the pointer while it is over the scene, drawn in the classic
    // /^v^\ style. Frames are anchored on the body 'v' (row 1, col 2).
    const BIRD = [
        ['\\   /', ' \\v/ '],
        ['     ', '/^v^\\'],
        ['     ', '_/v\\_'],
    ];
    const BIRD_FLAP = [0, 1, 2, 1];

    // ---------- state ----------

    const PARALLAX = 0.35;    // the world scrolls at this fraction of the page

    let W, H, VW, offX, cw, chh, cols, rows, vrows, dpr, fontPx;
    let sceneAlpha = 0.6;     // from --scene-opacity in CSS
    let base;                 // static valley cells: {g, c, k, m}
    let cloudCells, cloudCols;
    let valley;               // valley rows with clouds and birds, rebuilt each frame
    let cells;                // the visible window, composited each frame
    let tint, tintCtx, tintImg;
    let glints = [], birds = [], leaves = [], stars = [], fireflies = [];
    let meteor = null, nextMeteor = 3;   // the occasional shooting star (night)
    let rWater, span;         // world row of the far bank; height of the near-bank water
    let off = 0, frac = 0;    // scroll position in world rows
    const pointer = { cx: 0, cy: 0, present: false, overScene: false };
    let px = -999, py = -999, inside = false;   // pointer in visible cell units, refreshed every frame
    const ripples = [];
    const companion = { x: 0, y: 0, on: false, flap: 0 };
    let lastT = 0;

    function layout() {
        const rect = canvas.getBoundingClientRect();
        W = Math.max(200, Math.round(rect.width));
        H = Math.max(150, Math.round(rect.height));
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        // On tall, narrow screens paint a wider scene and crop to El Capitan
        VW = Math.max(W, H * 1.2);
        offX = (VW - W) * 0.62;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);

        fontPx = clamp(W / 110, 8, 13);
        sceneAlpha = parseFloat(getComputedStyle(canvas).getPropertyValue('--scene-opacity')) || 0.6;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.font = `500 ${fontPx}px ${FONT}`;
        cw = ctx.measureText('M').width;
        chh = fontPx * 1.15;
        cols = Math.ceil(W / cw);
        rows = Math.ceil(H / chh);
        vrows = rows + 1;     // one extra row for smooth sub-cell scrolling
        rWater = Math.round(0.745 * rows);
        span = Math.max(1, rows - rWater);

        tint = document.createElement('canvas');
        tint.width = cols; tint.height = vrows;
        tintCtx = tint.getContext('2d');
        tintImg = tintCtx.createImageData(cols, vrows);
        cells = new Array(cols * vrows);
        valley = new Array(cols * rWater);

        const geo = geometry();
        base = toCells(W, H, cols, (g, matMode) => paintScene(g, matMode, geo));
        cloudCols = cols * 2;
        cloudCells = toCells(W * 2, H, cloudCols, (g, matMode) => paintClouds(g, matMode, geo), 5);
        buildActors();
    }

    // ---------- the poster ----------

    function geometry() {
        const rnd = rng(1890);
        const g = { streaks: [], pines: [], tallPines: [], trees: [], clouds: [] };
        for (let i = 0; i < 110; i++) {
            g.streaks.push({ x: 0.33 + rnd() * 0.68, y: rnd() * 0.12, len: 0.12 + rnd() * 0.42, w: 0.6 + rnd() * 2.2, bend: (rnd() - 0.5) * 0.02, light: rnd() < 0.3 });
        }
        for (let x = -0.02; x < 1.02; x += 0.016 + rnd() * 0.02) {
            g.pines.push({ x, h: 0.06 + rnd() * 0.08, w: 0.3 + rnd() * 0.1, c: rnd() });
        }
        for (let x = 0.865; x < 1.04; x += 0.028 + rnd() * 0.025) {
            g.tallPines.push({ x, h: 0.3 + rnd() * 0.16, w: 0.2 + rnd() * 0.05, c: rnd() });
        }
        const leaves = ['#e8892c', '#f2b13a', '#c7581f', '#f6cc5c', '#dc742b', '#b8471c', '#eaa035'];
        for (let i = 0; i < 22; i++) {
            const x = 0.02 + rnd() * 0.8;
            g.trees.push({ x, y: 0.63 + rnd() * 0.05 - (rnd() < 0.25 ? 0.05 : 0), r: 0.035 + rnd() * 0.035, c: leaves[(rnd() * leaves.length) | 0], lobes: Array.from({ length: 6 }, () => [rnd() - 0.5, rnd() - 0.5, 0.45 + rnd() * 0.4]) });
        }
        g.trees.sort((a, b) => a.y - b.y);
        // clouds live on a strip twice as wide as the view so they can drift and wrap
        const cloudSpots = [[0.08, 0.13, 0.17], [0.36, 0.07, 0.12], [0.63, 0.18, 0.1], [0.86, 0.1, 0.16], [1.18, 0.14, 0.14], [1.52, 0.08, 0.18], [1.8, 0.17, 0.11]];
        for (const [x, y, w] of cloudSpots) {
            const puffs = [];
            const n = 5 + ((rnd() * 4) | 0);
            for (let i = 0; i < n; i++) {
                const f = i / (n - 1);
                puffs.push([x + (f - 0.5) * w, y - Math.sin(f * Math.PI) * w * (0.22 + rnd() * 0.12), w * (0.16 + Math.sin(f * Math.PI) * 0.16 + rnd() * 0.05)]);
            }
            g.clouds.push({ x, y, w, puffs });
        }
        return g;
    }

    // Paints the poster. In matMode every shape is filled with its material id instead.
    function paintScene(g, matMode, geo) {
        const fill = (mat, style) => { g.fillStyle = matMode ? `rgb(${mat * 20},0,0)` : style; };
        const stroke = (mat, style) => { g.strokeStyle = matMode ? `rgb(${mat * 20},0,0)` : style; };
        const X = f => f * VW - offX, Y = f => f * H;
        const lin = (x0, y0, x1, y1, stops) => {
            const gr = g.createLinearGradient(X(x0), Y(y0), X(x1), Y(y1));
            stops.forEach(([o, c]) => gr.addColorStop(o, c));
            return gr;
        };

        // sky
        fill(SKY, NIGHT ? lin(0, 0, 0, 0.62, [[0, '#050816'], [0.6, '#121a3a'], [1, '#2a3260']]) : lin(0, 0, 0, 0.62, [[0, '#efaa78'], [1, '#f9d8ad']]));
        g.fillRect(0, 0, W, H);

        if (NIGHT) {
            // a full moon, in screen space and clear of the buttons in the top corners:
            // low on the right behind El Capitan's shoulder, or on the left on narrow screens
            const narrow = W < 700;
            const mx = W * (narrow ? 0.13 : 0.93), my = H * (narrow ? 0.1 : 0.17);
            const mr = clamp(Math.min(W, H) * 0.065, 18, 58);
            if (!matMode) {
                const halo = g.createRadialGradient(mx, my, mr, mx, my, mr * 5);
                halo.addColorStop(0, 'rgba(150,170,235,0.3)');
                halo.addColorStop(1, 'rgba(150,170,235,0)');
                g.fillStyle = halo; g.fillRect(0, 0, W, H);
            }
            const face = g.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, 0, mx, my, mr);
            face.addColorStop(0, '#fbf8ec'); face.addColorStop(1, '#d6d1bf');
            fill(MOON, face);
            g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
            if (!matMode) {
                g.fillStyle = 'rgba(150,145,128,0.55)';
                for (const [dx, dy, rr] of [[-0.32, -0.18, 0.24], [0.28, 0.12, 0.17], [-0.06, 0.42, 0.14], [0.36, -0.36, 0.1]]) {
                    g.beginPath(); g.arc(mx + dx * mr, my + dy * mr, rr * mr, 0, Math.PI * 2); g.fill();
                }
            }
        }

        // far ridge, behind everything on the left
        g.beginPath();
        g.moveTo(X(0), Y(0.36));
        [[0.07, 0.31], [0.13, 0.27], [0.18, 0.3], [0.25, 0.235], [0.31, 0.27], [0.37, 0.25], [0.44, 0.31], [0.5, 0.4]].forEach(([x, y]) => g.lineTo(X(x), Y(y)));
        g.lineTo(X(0.5), Y(0.8)); g.lineTo(X(0), Y(0.8)); g.closePath();
        fill(RIDGE_FAR, lin(0, 0.24, 0, 0.6, [[0, '#a3a3b8'], [1, '#7a7d93']]));
        g.fill();
        if (!matMode) {
            // a couple of lit facets
            g.fillStyle = 'rgba(214,196,190,0.35)';
            g.beginPath(); g.moveTo(X(0.25), Y(0.235)); g.lineTo(X(0.31), Y(0.27)); g.lineTo(X(0.27), Y(0.36)); g.closePath(); g.fill();
            g.beginPath(); g.moveTo(X(0.13), Y(0.27)); g.lineTo(X(0.18), Y(0.3)); g.lineTo(X(0.15), Y(0.38)); g.closePath(); g.fill();
        }

        // near ridge
        g.beginPath();
        g.moveTo(X(0), Y(0.47));
        [[0.06, 0.43], [0.12, 0.45], [0.19, 0.41], [0.26, 0.45], [0.33, 0.48], [0.38, 0.55]].forEach(([x, y]) => g.lineTo(X(x), Y(y)));
        g.lineTo(X(0.4), Y(0.8)); g.lineTo(X(0), Y(0.8)); g.closePath();
        fill(RIDGE, lin(0, 0.42, 0, 0.7, [[0, '#686b80'], [1, '#4c4f60']]));
        g.fill();

        // El Capitan
        const cap = new Path2D();
        cap.moveTo(X(0.305), Y(0.74));
        cap.bezierCurveTo(X(0.33), Y(0.56), X(0.34), Y(0.33), X(0.4), Y(0.205));
        cap.bezierCurveTo(X(0.43), Y(0.135), X(0.5), Y(0.105), X(0.58), Y(0.1));
        cap.bezierCurveTo(X(0.68), Y(0.095), X(0.75), Y(0.125), X(0.82), Y(0.185));
        cap.bezierCurveTo(X(0.9), Y(0.25), X(0.96), Y(0.3), X(1.02), Y(0.33));
        cap.lineTo(X(1.02), Y(0.8)); cap.lineTo(X(0.305), Y(0.8)); cap.closePath();
        fill(ROCK, lin(0.3, 0, 1, 0, [[0, '#5d6069'], [0.16, '#878991'], [0.36, '#c9c6bf'], [0.62, '#ebe4d5'], [1, '#bdb6aa']]));
        g.fill(cap);
        if (!matMode) {
            g.save();
            g.clip(cap);
            // shadowed buttress on the prow
            g.fillStyle = 'rgba(42,44,56,0.32)';
            g.beginPath();
            g.moveTo(X(0.305), Y(0.74)); g.lineTo(X(0.4), Y(0.205)); g.lineTo(X(0.455), Y(0.15));
            g.bezierCurveTo(X(0.44), Y(0.3), X(0.43), Y(0.5), X(0.47), Y(0.74)); g.closePath(); g.fill();
            // warm light on the upper face
            const glow = g.createRadialGradient(X(0.7), Y(0.17), 0, X(0.7), Y(0.17), 0.36 * VW);
            glow.addColorStop(0, 'rgba(247,178,70,0.85)');
            glow.addColorStop(0.55, 'rgba(240,160,64,0.35)');
            glow.addColorStop(1, 'rgba(240,160,64,0)');
            g.fillStyle = glow; g.fillRect(0, 0, W, H);
            // haze at the base
            g.fillStyle = lin(0, 0.5, 0, 0.72, [[0, 'rgba(240,214,180,0)'], [1, 'rgba(240,214,180,0.35)']]);
            g.fillRect(0, 0, W, H);
            // vertical water streaks
            for (const s of geo.streaks) {
                g.strokeStyle = s.light ? 'rgba(255,246,228,0.32)' : 'rgba(52,52,62,0.4)';
                g.lineWidth = s.w;
                g.beginPath();
                g.moveTo(X(s.x), Y(s.y));
                g.quadraticCurveTo(X(s.x + s.bend), Y(s.y + s.len / 2), X(s.x - s.bend * 0.5), Y(s.y + s.len));
                g.stroke();
            }
            g.restore();
        }

        // back row of pines along the valley floor
        for (const p of geo.pines) {
            const top = 0.705 - p.h;
            g.beginPath();
            g.moveTo(X(p.x), Y(top));
            g.lineTo(X(p.x) + Y(p.h) * p.w, Y(0.705));
            g.lineTo(X(p.x) - Y(p.h) * p.w, Y(0.705));
            g.closePath();
            fill(PINE, p.c < 0.5 ? '#2c4535' : p.c < 0.8 ? '#36533f' : '#46684b');
            g.fill();
        }

        // autumn trees
        for (const t of geo.trees) {
            const R = Y(t.r) * 1.2;
            if (!matMode) {
                g.strokeStyle = '#4a3426'; g.lineWidth = 1.6;
                g.beginPath(); g.moveTo(X(t.x), Y(t.y)); g.lineTo(X(t.x), Y(0.715)); g.stroke();
            }
            const gr = g.createLinearGradient(0, Y(t.y) - R, 0, Y(t.y) + R);
            const c = hex(t.c);
            gr.addColorStop(0, `rgb(${scale(c, 1.12).join(',')})`);
            gr.addColorStop(1, `rgb(${scale(c, 0.7).join(',')})`);
            fill(TREE, gr);
            g.beginPath();
            for (const [dx, dy, rr] of t.lobes) {
                g.moveTo(X(t.x) + dx * R * 1.3 + rr * R, Y(t.y) + dy * R);
                g.arc(X(t.x) + dx * R * 1.3, Y(t.y) + dy * R, rr * R, 0, Math.PI * 2);
            }
            g.fill();
        }

        // tall pines on the right
        for (const p of geo.tallPines) {
            const baseY = 0.75, top = baseY - p.h;
            g.beginPath();
            g.moveTo(X(p.x), Y(top));
            const tiers = 7;
            for (let i = 1; i <= tiers; i++) {
                const y = Y(top + (p.h * i) / tiers);
                const half = Y(p.h) * p.w * (i / tiers);
                g.lineTo(X(p.x) + half, y);
                g.lineTo(X(p.x) + half * 0.55, y);
            }
            for (let i = tiers; i >= 1; i--) {
                const y = Y(top + (p.h * i) / tiers);
                const half = Y(p.h) * p.w * (i / tiers);
                g.lineTo(X(p.x) - half * 0.55, y);
                g.lineTo(X(p.x) - half, y);
            }
            g.closePath();
            fill(PINE, p.c < 0.6 ? '#243b2e' : '#2f4a38');
            g.fill();
        }

        // meadow on the far bank
        g.beginPath();
        g.moveTo(0, Y(0.712));
        for (let x = 0; x <= 1.0001; x += 0.05) g.lineTo(X(x), Y(0.708 + 0.006 * Math.sin(x * 23)));
        g.lineTo(W, Y(0.75)); g.lineTo(0, Y(0.75)); g.closePath();
        fill(MEADOW, lin(0, 0.7, 0, 0.75, [[0, '#d39a48'], [1, '#a26d2e']]));
        g.fill();

        // river
        fill(WATER, lin(0, 0.745, 0, 1, [[0, '#7a8a96'], [1, '#4b5c6c']]));
        g.fillRect(0, Y(0.745), W, H);

        // bare branch reaching in from the top-left
        stroke(BRANCH, '#2a2019');
        g.lineCap = 'round';
        const limb = (pts, w0, w1) => {
            for (let i = 1; i < pts.length; i++) {
                g.lineWidth = lerp(w0, w1, i / (pts.length - 1));
                g.beginPath(); g.moveTo(X(pts[i - 1][0]), Y(pts[i - 1][1])); g.lineTo(X(pts[i][0]), Y(pts[i][1])); g.stroke();
            }
        };
        limb([[-0.02, 0.0], [0.05, 0.05], [0.11, 0.075], [0.17, 0.085], [0.21, 0.08]], 9, 2);
        limb([[0.05, 0.05], [0.07, 0.11], [0.065, 0.16]], 4, 1.5);
        limb([[0.11, 0.075], [0.14, 0.12], [0.18, 0.14]], 3.5, 1.2);
        limb([[0.0, 0.02], [0.0, 0.1], [0.02, 0.15]], 5, 1.5);
    }

    function paintClouds(g, matMode, geo) {
        g.clearRect(0, 0, W * 2, H);
        for (const cl of geo.clouds) {
            const top = (cl.y - cl.w * 0.5) * H, bot = cl.y * H + cl.w * 0.1 * H;
            const gr = g.createLinearGradient(0, top, 0, bot);
            gr.addColorStop(0, '#fdf6ea');
            gr.addColorStop(0.55, '#f1e6d8');
            gr.addColorStop(1, '#a7b4c4');
            g.fillStyle = matMode ? `rgb(${CLOUD * 20},0,0)` : gr;
            g.beginPath();
            for (const [x, y, r] of cl.puffs) {
                g.moveTo(x * W + r * W, y * H);
                g.arc(x * W, y * H, r * W, 0, Math.PI * 2);
            }
            g.fill();
            // flat underside
            g.clearRect((cl.x - cl.w) * W, cl.y * H + cl.w * 0.06 * W, cl.w * 2 * W, cl.w * W);
        }
    }

    // ---------- poster -> characters ----------

    function toCells(pw, ph, ncols, paint, minVotes = 1) {
        const colorCv = document.createElement('canvas');
        colorCv.width = pw; colorCv.height = ph;
        const cg = colorCv.getContext('2d', { willReadFrequently: true });
        paint(cg, false);
        const matCv = document.createElement('canvas');
        matCv.width = pw; matCv.height = ph;
        const mg = matCv.getContext('2d', { willReadFrequently: true });
        paint(mg, true);
        const cd = cg.getImageData(0, 0, pw, ph).data;
        const md = mg.getImageData(0, 0, pw, ph).data;

        const n = ncols * rows;
        const color = new Array(n), mat = new Uint8Array(n), L = new Float32Array(n), alpha = new Float32Array(n);
        const votes = new Uint8Array(16);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < ncols; c++) {
                let R = 0, G = 0, B = 0, A = 0, cnt = 0;
                votes.fill(0);
                for (let sy = 0; sy < 3; sy++) {
                    for (let sx = 0; sx < 3; sx++) {
                        const px = Math.min(pw - 1, Math.floor((c + (sx + 0.5) / 3) * cw));
                        const py = Math.min(ph - 1, Math.floor((r + (sy + 0.5) / 3) * chh));
                        const o = (py * pw + px) * 4;
                        const a = cd[o + 3] / 255;
                        R += cd[o] * a; G += cd[o + 1] * a; B += cd[o + 2] * a; A += a; cnt++;
                        if (md[o + 3] > 127) votes[Math.round(md[o] / 20)]++;
                    }
                }
                const i = r * ncols + c;
                let best = 0, bestV = 0;
                for (let m = 1; m < 16; m++) if (votes[m] > bestV) { bestV = votes[m]; best = m; }
                mat[i] = bestV >= minVotes ? best : 0;
                alpha[i] = A / cnt;
                color[i] = A > 0 ? [R / A, G / A, B / A] : [0, 0, 0];
                L[i] = lum(color[i]);     // glyphs are picked from the daylight poster either way
                if (NIGHT && mat[i] !== SKY && mat[i] !== MOON) color[i] = nightGrade(color[i], mat[i] === CLOUD ? 0.85 : 1);
            }
        }

        const at = (arr, r, c, fallback) => (r < 0 || r >= rows || c < 0 || c >= ncols ? fallback : arr[r * ncols + c]);
        const out = new Array(n);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < ncols; c++) {
                const i = r * ncols + c;
                const m = mat[i];
                if (!m) { out[i] = null; continue; }
                let g = fillGlyph(m, L[i], at(L, r, c - 1, L[i]), at(L, r, c + 1, L[i]), c, r);

                if (OUTLINED.has(m)) {
                    // solid = this material or anything painted in front of it
                    const solid = (rr, cc) => { const mm = at(mat, rr, cc, m); return mm >= m ? 1 : 0; };
                    const boundary = !solid(r - 1, c) || !solid(r + 1, c) || !solid(r, c - 1) || !solid(r, c + 1);
                    if (boundary) g = edgeGlyph(m, solid, r, c);
                }
                const cell = { g, c: color[i], k: TINT[m], m, a: alpha[i] };
                if (m === BRANCH) {
                    cell.c = NIGHT ? [70, 78, 112] : [42, 32, 25];
                    cell.bgc = mix(SKY_TOP, SKY_LOW, clamp((r + 0.5) / rows / 0.62, 0, 1));
                    cell.k = TINT[SKY];
                }
                out[i] = cell;
            }
        }
        return out;
    }

    function edgeGlyph(m, solid, r, c) {
        if (m === BRANCH) {
            // thin strokes: follow the direction of the solid neighbours
            let sxx = 0, syy = 0, sxy = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                if ((dx || dy) && solid(r + dy, c + dx)) { const x = dx * cw, y = dy * chh; sxx += x * x; syy += y * y; sxy += x * y; }
            }
            const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
            return angleGlyph(Math.cos(ang), Math.sin(ang), 0);
        }
        // sobel on the solid mask; the gradient points into the shape
        const s = (dy, dx) => solid(r + dy, c + dx);
        const gx = (s(-1, 1) + 2 * s(0, 1) + s(1, 1)) - (s(-1, -1) + 2 * s(0, -1) + s(1, -1));
        const gy = (s(1, -1) + 2 * s(1, 0) + s(1, 1)) - (s(-1, -1) + 2 * s(-1, 0) + s(-1, 1));
        const nx = -gx / cw, ny = -gy / chh;           // outward normal, in pixels
        if (!nx && !ny) return '.';
        const g = angleGlyph(-ny, nx, ny);
        if (m === CLOUD || m === TREE || m === MOON) {
            if (g === '|' || (g !== '-' && g !== '_')) return nx < 0 ? '(' : ')';
            return ny > 0 ? '_' : (m === TREE ? '~' : '-');
        }
        if (m === PINE && ny < 0 && Math.abs(nx) < 0.02) return '^';
        return g;
    }

    // glyph for a stroke running along (tx, ty); ny < 0 means the outside is above
    function angleGlyph(tx, ty, ny) {
        const a = Math.abs(Math.atan2(ty, tx) * 180 / Math.PI);
        const deg = a > 90 ? 180 - a : a;
        if (deg < 24) return ny > 0 ? '_' : '-';
        if (deg > 68) return '|';
        return tx * ty < 0 ? '/' : '\\';
    }

    function fillGlyph(m, L, Ll, Lr, c, r) {
        const h = hash(c * 7 + 3, r * 13 + 1);
        switch (m) {
            case SKY: return h < 0.06 ? '.' : h < 0.085 ? '`' : ' ';
            case RIDGE_FAR: return h < 0.3 ? '.' : h < 0.42 ? ':' : ' ';
            case RIDGE: return L > 0.38 ? (h < 0.5 ? ':' : ';') : h < 0.55 ? '.' : ':';
            case ROCK: {
                const side = (Ll + Lr) / 2;
                if (L < side - 0.06) return '|';
                if (L > side + 0.06) return '!';
                const v = (L - 0.3) / 0.55 + (h - 0.5) * 0.3;
                return v < 0.2 ? '.' : v < 0.5 ? ':' : v < 0.8 ? ';' : 'i';
            }
            case PINE: return h < 0.5 ? 'A' : h < 0.75 ? '^' : '*';
            case TREE: {
                if (L < 0.42) return h < 0.6 ? 'o' : '%';
                return h < 0.3 ? '@' : h < 0.55 ? '&' : h < 0.75 ? '%' : '*';
            }
            case MEADOW: return h < 0.3 ? ',' : h < 0.55 ? "'" : h < 0.72 ? '"' : '.';
            case BRANCH: return '#';
            case CLOUD: return L > 0.82 ? (h < 0.35 ? 'o' : h < 0.5 ? '.' : ' ') : (h < 0.5 ? '~' : '-');
            case MOON: return L > 0.86 ? '@' : L > 0.76 ? '0' : 'o';
            default: return ' ';
        }
    }

    // ---------- moving parts ----------

    function buildActors() {
        const rnd = rng(42);
        // sun glints riding the current, thickest near the bank
        glints = [];
        for (let i = 0; i < 120; i++) {
            glints.push({ x: rnd() * cols, wr: rWater + 1 + Math.pow(rnd(), 1.6) * span * 8, speed: 0.6 + rnd() * 1.4, phase: rnd() * Math.PI * 2 });
        }
        // autumn leaves floating downstream
        leaves = [];
        for (let i = 0; i < 40; i++) {
            leaves.push({ x: rnd() * cols, wr: rWater + 2 + rnd() * span * 8, speed: 0.8 + rnd() * 1.6, phase: rnd() * Math.PI * 2, c: P.leaves[(rnd() * P.leaves.length) | 0], g: rnd() < 0.5 ? '*' : rnd() < 0.5 ? '@' : '&' });
        }

        birds = [];
        stars = [];
        fireflies = [];
        if (!NIGHT) {
            for (let i = 0; i < 7; i++) {
                birds.push({ x: cols * (0.55 + rnd() * 0.25) + i * 2.5, y: rows * (0.04 + rnd() * 0.1), phase: rnd() * 6, speed: 0.9 + rnd() * 0.25 });
            }
            return;
        }
        // twinkling stars wherever the sky shows, thinning toward the horizon
        const nStars = Math.round(cols * rows * 0.012);
        for (let i = 0; i < nStars; i++) {
            stars.push({ c: (rnd() * cols) | 0, r: (Math.pow(rnd(), 1.5) * rows * 0.55) | 0, phase: rnd() * 6.3, speed: 0.6 + rnd() * 2.2, big: rnd() < 0.18 });
        }
        // fireflies drifting over the meadow and the trees
        for (let i = 0; i < 30; i++) {
            fireflies.push({ x: rnd() * cols, y: rows * (0.6 + rnd() * 0.13), phase: rnd() * 6.3, speed: 0.7 + rnd() * 1.1, drift: 1 + rnd() * 3 });
        }
    }

    // ---------- per-frame compositing ----------

    function frame(t) {
        const dt = clamp(t - lastT, 0, 0.1);
        lastT = t;
        const scrolled = reduceMotion ? 0 : window.scrollY * PARALLAX / chh;
        off = Math.floor(scrolled);
        frac = scrolled - off;
        inside = pointer.present && pointer.overScene;
        px = inside ? pointer.cx / cw : -999;
        py = inside ? pointer.cy / chh + frac : -999;

        // 1. the valley with drifting clouds (kept whole: the river reflects it even when scrolled away)
        const shift = Math.floor(t * 0.35);
        for (let r = 0; r < rWater; r++) {
            for (let c = 0; c < cols; c++) {
                const i = r * cols + c;
                const s = base[i];
                let cell = s;
                if (s.m === SKY && !NIGHT) {          // a clear sky at night, so the stars show
                    const cc = cloudCells[r * cloudCols + ((c + shift) % cloudCols)];
                    if (cc && cc.a > 0.5) cell = cc;
                }
                if (s.m === TREE && s.g !== '(' && s.g !== ')' && hash(c + Math.floor(t * 2) * 31, r) < 0.04) cell = { ...s, g: '*' };
                valley[i] = cell;
            }
        }

        if (NIGHT) nightSky(t);

        // birds crossing the sky
        for (const bd of birds) {
            const c = Math.round(((bd.x + t * bd.speed * 0.7) % (cols * 1.4)) - cols * 0.2);
            const r = Math.round(bd.y + Math.sin(t * 0.8 + bd.phase) * 0.6);
            if (c < 0 || c >= cols || r < 0 || r >= rWater) continue;
            const i = r * cols + c;
            const flap = Math.sin(t * 5 + bd.phase);
            const g3 = flap > 0.3 ? '\\v/' : flap < -0.3 ? '/v\\' : '^v^';
            for (let j = 0; j < 3; j++) {
                const k2 = i - 1 + j;
                if (c - 1 + j < 0 || c - 1 + j >= cols || valley[k2].m !== SKY) continue;   // behind clouds and cliffs
                valley[k2] = { g: g3[j], c: P.bird, k: valley[k2].k, m: SKY, bgc: valley[k2].c };
            }
        }

        // 2. the visible window: valley above the bank, river below it
        for (let vr = 0; vr < vrows; vr++) {
            const wr = off + vr;
            if (wr < rWater) {
                for (let c = 0; c < cols; c++) cells[vr * cols + c] = valley[wr * cols + c];
                continue;
            }
            const d = Math.min(1, (wr - rWater) / span);              // 0 at the far bank, 1 nearest the viewer
            const far = Math.max(0, wr - rWater - span);               // rows of open water beyond the view at rest
            const reflect = clamp(1 - far / (span * 1.5), 0, 1);       // the mirror fades out in open water
            const rowShift = Math.sin(wr * 0.8 - t * 1.1) * (0.3 + d * 1.6);
            const mr = clamp(Math.round(rWater - 1 - (wr - rWater) * 1.35), 0, rWater - 1);
            const lineAt = far > 0 ? 1.14 + 0.22 * Math.sin(wr * 0.23) : 1.25 - d * 0.35;
            for (let c = 0; c < cols; c++) {
                let wob = rowShift + Math.sin(c * 0.11 + wr * 0.45 - t * 0.9) * (0.2 + d * 0.9);
                for (const rp of ripples) {
                    const age = t - rp.t0;
                    const dist = Math.hypot((c - rp.x) * (cw / chh), wr - rp.y);
                    const front = age * 8;
                    if (Math.abs(dist - front) < 2) wob += Math.sin((dist - front) * 2.6) * 2.5 * Math.max(0, 1 - age / 2.2);
                }
                const src = valley[mr * cols + clamp(Math.round(c + wob), 0, cols - 1)];
                const mirrored = reflect > hash(c * 7, wr);
                const flow = Math.sin(c * (0.2 - d * 0.1) - t * (1.6 + d * 1.2) + wr * 2.1) + 0.7 * Math.sin(c * 0.05 - t * 0.6 + wr * 1.3);
                const tone = mix(mix(src.bgc || src.c, P.water, 0.25 + d * 0.25), P.deep, 1 - reflect);
                let col = mix(mix(scale(src.c, 0.8), P.water, 0.22 + d * 0.28), P.deep, 1 - reflect);
                let g;
                if (wr === rWater) g = flow > 0 ? '~' : '-';
                else if (flow > lineAt + 0.3) { g = '~'; col = mix(col, P.waterLight, 0.5); }
                else if (flow > lineAt) { g = '-'; col = mix(col, P.waterLight, 0.3); }
                else if (!mirrored || src.g === ' ' || hash(c, wr) < d * 0.3) g = ' ';
                else if (STROKES.has(src.g) || src.g === '!') g = MIRROR[src.g] || src.g;     // outlines stay crisp
                else g = flow > lineAt - 0.7 ? '~' : hash(c * 3, wr) < 0.25 ? '=' : '-';   // fills become ripples
                cells[vr * cols + c] = { g, c: col, k: 0.42 - d * 0.1, m: WATER, bgc: tone };
            }
        }

        // 3. glints and leaves carried along by the current
        for (const gl of glints) {
            const b = Math.sin(t * gl.speed + gl.phase);
            const vr = Math.round(gl.wr) - off;
            if (b < 0.45 || vr < 0 || vr >= vrows) continue;
            const c = Math.round((((gl.x + t * (1.2 + Math.min(1, (gl.wr - rWater) / span) * 2.5)) % cols) + cols) % cols);
            const i = vr * cols + c;
            if (c >= cols || cells[i].m !== WATER) continue;
            cells[i] = { g: b > 0.9 ? '*' : b > 0.7 ? '+' : '.', c: P.spark, k: cells[i].k, m: -1, bgc: cells[i].bgc };
        }
        for (const lf of leaves) {
            const vr = Math.round(lf.wr + Math.sin(t * 0.7 + lf.phase) * 0.4) - off;
            if (vr < 0 || vr >= vrows) continue;
            const c = Math.round((((lf.x + t * lf.speed) % cols) + cols) % cols);
            const i = vr * cols + c;
            if (c >= cols || cells[i].m !== WATER) continue;
            cells[i] = { g: lf.g, c: lf.c, k: cells[i].k, m: -1, bgc: cells[i].bgc };
        }

        // 4. the bird that follows the pointer over open scenery
        moveCompanion(dt);

        draw();
    }

    // Stars, fireflies and shooting stars, written into the valley so the river reflects them too.
    function nightSky(t) {
        for (const st of stars) {
            if (st.r >= rWater) continue;
            const i = st.r * cols + st.c, under = valley[i];
            if (under.m !== SKY) continue;                       // hidden by clouds, the moon and the cliffs
            const b = 0.5 + 0.5 * Math.sin(t * st.speed + st.phase);
            if (b < 0.2) continue;
            const g = st.big && b > 0.75 ? '*' : b > 0.6 ? '+' : '.';
            valley[i] = { g, c: mix(P.moonlight, P.star, b), k: under.k, m: -1, bgc: under.c };
        }
        for (const ff of fireflies) {
            const b = Math.sin(t * ff.speed + ff.phase);
            if (b < 0.15) continue;
            const c = Math.round(((ff.x + Math.sin(t * 0.3 + ff.phase) * ff.drift) % cols + cols) % cols);
            const r = Math.round(ff.y + Math.sin(t * 0.5 + ff.phase * 1.3));
            if (r < 0 || r >= rWater) continue;
            const i = r * cols + c, under = valley[i];
            valley[i] = { g: b > 0.7 ? '*' : '.', c: P.firefly, k: 0.35 + 0.5 * b, m: -1, bgc: P.firefly, pop: 1 };
        }
        // a shooting star every few seconds, sliding down and to the right
        if (!meteor && t > nextMeteor) meteor = { t0: t, c0: cols * (0.1 + Math.random() * 0.5), r0: rows * (0.03 + Math.random() * 0.16), len: cols * (0.18 + Math.random() * 0.12) };
        if (meteor) {
            const p = (t - meteor.t0) / 1.1;
            if (p > 1) { meteor = null; nextMeteor = t + 4 + Math.random() * 7; return; }
            const head = p * meteor.len;
            for (let k = 0; k < 9; k++) {
                const dist = head - k * 1.4;
                if (dist < 0) break;
                const c = Math.round(meteor.c0 + dist), r = Math.round(meteor.r0 + dist * 0.22);
                if (c < 0 || c >= cols || r < 0 || r >= rWater) continue;
                const i = r * cols + c, under = valley[i];
                if (under.m !== SKY && under.m !== -1) continue;
                const fade = (1 - k / 9) * Math.sin(Math.PI * Math.min(1, p * 1.15));
                valley[i] = { g: k === 0 ? '*' : k < 3 ? '-' : '.', c: mix(under.c, P.star, fade), k: under.k, m: -1, bgc: under.c };
            }
        }
    }

    // Draws a sprite into the cell grid at full strength (pop 2 = bold), clearing the
    // scene's glyphs between the first and last stroke of each row so it reads cleanly.
    function stamp(sprite, x0, y0, ink, pop) {
        for (let rr = 0; rr < sprite.length; rr++) {
            const row = sprite[rr], r = y0 + rr;
            const first = row.search(/\S/), last = row.trimEnd().length - 1;
            if (r < 0 || r >= vrows || first < 0) continue;
            for (let j = first; j <= last; j++) {
                const c = x0 + j;
                if (c < 0 || c >= cols) continue;
                const i = r * cols + c, under = cells[i];
                cells[i] = { g: row[j], c: ink, k: under.k, m: -1, bgc: under.bgc || under.c, pop };
            }
        }
    }

    function moveCompanion(dt) {
        let tx, ty;
        if (inside) {
            if (!companion.on) {
                // swoop in from above
                companion.on = true;
                companion.x = px + 18;
                companion.y = -3;
            }
            tx = px + 4;              // hover up and to the right of the cursor
            ty = py - 2;
        } else if (companion.on) {
            tx = companion.x + 30;    // fly off
            ty = -8;
        } else {
            return;
        }
        const ease = 1 - Math.pow(0.015, dt);
        const vx = (tx - companion.x) * ease, vy = (ty - companion.y) * ease;
        companion.x += vx;
        companion.y += vy;
        if (!inside && companion.y < -3) { companion.on = false; return; }
        const speed = Math.hypot(vx, vy) / Math.max(dt, 0.001);
        companion.flap += dt * (5 + Math.min(speed, 40) * 0.25);
        const sprite = BIRD[BIRD_FLAP[Math.floor(companion.flap) % 4]];
        stamp(sprite, Math.round(companion.x) - 2, Math.round(companion.y + Math.sin(companion.flap * 0.7) * 0.3) - 1, BIRD_INK, 2);
    }

    function draw() {
        // background glow: one pixel per cell, scaled up smoothly behind the glyphs
        const d = tintImg.data;
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            const b = cell.bgc || cell.c;
            d[i * 4] = b[0];
            d[i * 4 + 1] = b[1];
            d[i * 4 + 2] = b[2];
            d[i * 4 + 3] = cell.k * 255;
        }
        tintCtx.putImageData(tintImg, 0, 0);
        const y0 = -frac * chh;
        ctx.clearRect(0, 0, W, H);
        ctx.imageSmoothingEnabled = true;
        ctx.globalAlpha = sceneAlpha;
        ctx.drawImage(tint, 0, y0, cols * cw, vrows * chh);

        // the scene is faded; the hover bird draws on top at full strength
        ctx.textBaseline = 'middle';
        let last = '';
        const pops = [];
        for (let r = 0; r < vrows; r++) {
            const y = y0 + r * chh + chh * 0.5;
            for (let c = 0; c < cols; c++) {
                const cell = cells[r * cols + c];
                if (cell.g === ' ') continue;
                if (cell.pop) { pops.push(c, y, cell); continue; }
                const col = cell.m === BRANCH || cell.m === -1 ? cell.c
                    : NIGHT ? mix(scale(cell.c, 1.45), P.moonlight, cell.m === SKY ? 0.3 : 0.12)     // glyphs glow against the dark
                    : scale(cell.c, cell.m === SKY || cell.m === CLOUD ? 0.8 : 0.62);
                const fs = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
                if (fs !== last) { ctx.fillStyle = fs; last = fs; }
                ctx.fillText(cell.g, c * cw, y);
            }
        }
        ctx.globalAlpha = 1;
        if (pops.length) {
            let weight = 500;
            for (let j = 0; j < pops.length; j += 3) {
                const cell = pops[j + 2];
                const w = cell.pop === 2 ? 700 : 500;
                if (w !== weight) { ctx.font = `${w} ${fontPx}px ${FONT}`; weight = w; }
                ctx.fillStyle = `rgb(${cell.c[0] | 0},${cell.c[1] | 0},${cell.c[2] | 0})`;
                ctx.fillText(cell.g, pops[j] * cw, pops[j + 1]);
            }
            if (weight !== 500) ctx.font = `500 ${fontPx}px ${FONT}`;
        }
    }

    // ---------- loop ----------

    let ready = false, running = false, visible = true, start = performance.now(), lastDraw = 0, raf = 0;
    const stats = (window.__asciiStats = { frames: 0, ms: 0, cols: 0, rows: 0 });

    let lastScroll = -1;
    function tick(now) {
        raf = requestAnimationFrame(tick);
        // 24 fps for the scenery, but every frame while scrolling so the parallax stays smooth
        if (now - lastDraw < 1000 / 24 && window.scrollY === lastScroll) return;
        lastDraw = now;
        lastScroll = window.scrollY;
        const t0 = performance.now();
        frame((now - start) / 1000);
        stats.frames++;
        stats.ms = Math.round((stats.ms * 0.9 + (performance.now() - t0) * 0.1) * 100) / 100;
    }

    function play() {
        if (!ready || running || reduceMotion || !visible) return;
        running = true;
        raf = requestAnimationFrame(tick);
    }
    function pause() { running = false; cancelAnimationFrame(raf); }

    function init() {
        layout();
        stats.cols = cols; stats.rows = rows;
        ready = true;
        frame(reduceMotion ? 12 : 0);
        play();
    }

    // rest once the page has slid up over the whole scene
    new IntersectionObserver(entries => {
        visible = entries[0].isIntersecting;
        visible ? play() : pause();
    }).observe(document.querySelector('.landing') || canvas);

    // follow the light/dark toggle: fade out, repaint the valley for the new hour, fade back in
    new MutationObserver(() => {
        const night = document.documentElement.classList.contains('night');
        if (night === NIGHT) return;
        NIGHT = night;
        setPalette();
        if (!ready) return;
        const swap = () => { layout(); frame(reduceMotion ? 12 : (performance.now() - start) / 1000); canvas.style.opacity = ''; };
        if (reduceMotion) { swap(); return; }
        canvas.style.transition = 'opacity 0.25s ease';
        canvas.style.opacity = '0';
        setTimeout(swap, 250);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    let resizeTimer, lastW = 0, lastH = 0;
    new ResizeObserver(() => {
        const b = canvas.getBoundingClientRect();
        const w = Math.round(b.width), h = Math.round(b.height);
        if (!lastW) { lastW = w; lastH = h; return; }
        if (w === lastW && Math.abs(h - lastH) < 80) return;
        lastW = w; lastH = h;
        clearTimeout(resizeTimer);
        if (!ready) return;
        resizeTimer = setTimeout(() => { layout(); frame((performance.now() - start) / 1000); }, 150);
    }).observe(canvas);

    // The bird and the ripples answer only when the pointer is over open scenery, not over the page.
    window.addEventListener('pointermove', e => {
        pointer.cx = e.clientX; pointer.cy = e.clientY; pointer.present = true;
        pointer.overScene = !(e.target.closest && e.target.closest('.main-wrapper, a, button'));
        if (!ready || !pointer.overScene) return;
        const wr = e.clientY / chh + (reduceMotion ? 0 : window.scrollY * PARALLAX / chh);
        if (wr > rWater) {
            const now = (performance.now() - start) / 1000;
            const lastR = ripples[ripples.length - 1];
            if (!lastR || now - lastR.t0 > 0.3) ripples.push({ x: e.clientX / cw, y: wr, t0: now });
            while (ripples.length && now - ripples[0].t0 > 2.2) ripples.shift();
        }
    });
    if (reduceMotion) window.addEventListener('scroll', () => ready && frame(12), { passive: true });
    const pointerGone = () => { pointer.present = false; };
    document.documentElement.addEventListener('pointerleave', pointerGone);
    window.addEventListener('blur', pointerGone);
    window.addEventListener('pointerup', e => { if (e.pointerType === 'touch') pointerGone(); });
    window.addEventListener('pointercancel', pointerGone);

    const fontReady = document.fonts && document.fonts.load ? document.fonts.load(`500 10px "JetBrains Mono"`) : Promise.resolve();
    fontReady.then(init, init);
})();

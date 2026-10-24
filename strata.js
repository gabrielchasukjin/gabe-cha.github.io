// Strata: one floating slab of terrain per project, stacked like core samples.
// Each slab is drawn once by terrain.js in its own false-color style (black range,
// interferogram, alpine, mineral scan, bathymetry); the stack then
// floats, separates on first view, and lifts the slab you point at. Clicking a slab
// jumps to its project card below.

(() => {
    const root = document.querySelector('.strata');
    if (!root) return;
    const canvas = root.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const labels = [...root.querySelectorAll('.strata-labels li')];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const STYLES = ['range', 'interferogram', 'alpine', 'mineral', 'bathymetry'];
    const N = 110;                                   // cells per side
    const preps = STYLES.map(st => Terrain.prepare(st, N));
    const clamp01 = Terrain.clamp01;
    const buildSlab = (p, W, dpr) => Terrain.bitmap(p, W, dpr);

    // ---------- layout ----------
    let slabs = [], labelX = 0, cssW = 0, cssH = 0, dpr = 1, step = 0, cx = 0, top0 = 0;
    const state = STYLES.map(() => ({ lift: 0 }));
    let hovered = -1, spread = reduced ? 1 : 0, started = false, visible = false, raf = 0, t0 = 0;

    function layout() {
        const w = root.clientWidth;
        if (!w || Math.abs(w - cssW) < 2 && slabs.length) return;
        cssW = w;
        dpr = Math.min(2, window.devicePixelRatio || 1);
        const narrow = w < 640;
        const W = narrow ? w * 0.66 : Math.min(520, w * 0.5);
        slabs = preps.map(p => buildSlab(p, W, dpr));
        step = W * (narrow ? 0.4 : 0.37);
        cx = narrow ? w * 0.38 : w * 0.31;
        top0 = W * 0.12 + slabs[0].oy * 0.6;
        cssH = Math.ceil(top0 + step * (STYLES.length - 1) + slabs[STYLES.length - 1].h - slabs[STYLES.length - 1].oy + 20);
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

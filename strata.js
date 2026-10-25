// Strata: one floating slab of terrain per project, stacked like core samples.
// Each slab is drawn once by terrain.js in its own false-color style (black range,
// interferogram, alpine, mineral scan, bathymetry); the stack floats, separates on first
// view, and lifts the slab you point at. Clicking a slab (or its label) dissolves it into
// pixels and the project's details assemble in its place, pixel by pixel; close (×, Esc,
// or a click outside) runs it backwards.

(() => {
    const root = document.querySelector('.strata');
    if (!root) return;
    const canvas = root.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const labels = [...root.querySelectorAll('.strata-labels li')];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const docEl = document.documentElement;

    const STYLES = ['range', 'interferogram', 'alpine', 'mineral', 'bathymetry'];
    const N = 110;                                   // cells per side
    const preps = STYLES.map(st => Terrain.prepare(st, N));
    const clamp01 = Terrain.clamp01;
    const hash = Terrain.hash;

    // ---------- project details, read from the cards further down the page ----------
    const tpl = document.getElementById('project-data');
    const projects = labels.map(li => {
        const a = li.querySelector('a'), id = a.dataset.project;
        const card = tpl ? tpl.content.getElementById(id) : document.getElementById(id);
        const q = sel => card && card.querySelector(sel);
        const media = q('.work-card-image img') || q('.work-card-image video');
        return {
            id,
            href: q('a.work-card')?.getAttribute('href') || a.getAttribute('href'),
            img: media ? (media.tagName === 'VIDEO' ? media.poster : media.getAttribute('src')) : '',
            alt: media?.getAttribute('alt') || media?.getAttribute('aria-label') || '',
            meta: (() => {
                const m = q('.work-meta');
                if (!m) return '';
                const c = m.cloneNode(true), idx = c.querySelector('.work-index');
                const n = idx ? idx.textContent.trim() : '';
                if (idx) idx.remove();
                return (n ? n + ' · ' : '') + c.textContent.replace(/\s+/g, ' ').trim();
            })(),
            honor: q('.work-honor')?.textContent.trim() || '',
            title: (q('.work-card-title')?.textContent || li.textContent).replace('↗', '').trim(),
            authors: q('.work-authors')?.textContent.trim() || '',
            blurb: q('.work-card-blurb')?.textContent.trim() || '',
        };
    });

    // ---------- the detail panel ----------
    const panel = document.createElement('div');
    panel.className = 'strata-detail';
    panel.hidden = true;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-live', 'polite');
    panel.innerHTML = `
        <button class="strata-close" type="button" aria-label="Back to the stack">×</button>
        <div class="sd-media"><img alt=""></div>
        <div class="sd-body">
            <p class="sd-meta"></p>
            <p class="sd-honor"></p>
            <h3 class="sd-title"></h3>
            <p class="sd-authors"></p>
            <p class="sd-blurb"></p>
            <p class="sd-links"><a class="sd-open" target="_blank" rel="noopener">Open project <span aria-hidden="true">↗</span></a></p>
        </div>
        <canvas class="sd-veil" aria-hidden="true"></canvas>`;
    root.appendChild(panel);
    const veil = panel.querySelector('.sd-veil'), vctx = veil.getContext('2d');
    const $ = sel => panel.querySelector(sel);

    function fillPanel(k) {
        const p = projects[k];
        $('.sd-media img').src = p.img;
        $('.sd-media img').alt = p.alt;
        $('.sd-meta').textContent = p.meta;
        $('.sd-honor').textContent = p.honor;
        $('.sd-honor').hidden = !p.honor;
        $('.sd-title').textContent = p.title;
        $('.sd-authors').textContent = p.authors;
        $('.sd-authors').hidden = !p.authors;
        $('.sd-blurb').textContent = p.blurb;
        $('.sd-open').href = p.href;
    }

    // ---------- layout ----------
    let slabs = [], labelX = 0, cssW = 0, cssH = 0, dpr = 1, step = 0, cx = 0, top0 = 0;
    const state = STYLES.map(() => ({ lift: 0, dis: 0, fade: 0 }));
    let hovered = -1, spread = reduced ? 1 : 0, started = false, visible = false, raf = 0, t0 = 0;
    let open = -1, anim = null;                      // anim: { k, dir: 1 open | -1 close, t0 }
    const BS = 6;                                    // pixel size of the dissolve, css px

    // per slab: the non-empty blocks of its bitmap, each with a dissolve order
    function blocksFor(s, seed) {
        const cols = Math.ceil(s.w / BS), rows = Math.ceil(s.h / BS);
        const data = s.ctx.getImageData(0, 0, s.canvas.width, s.canvas.height).data;
        const W = s.canvas.width, list = [];
        for (let by = 0; by < rows; by++) for (let bx = 0; bx < cols; bx++) {
            const px = Math.min(W - 1, Math.floor((bx + 0.5) * BS * dpr)), py = Math.min(s.canvas.height - 1, Math.floor((by + 0.5) * BS * dpr));
            if (data[(py * W + px) * 4 + 3] < 20) continue;
            list.push({ bx, by, o: 0.7 * hash(bx, by, seed) + 0.3 * (bx / cols) });
        }
        return list;
    }

    function layout() {
        const w = root.clientWidth;
        if (!w || Math.abs(w - cssW) < 2 && slabs.length) return;
        cssW = w;
        dpr = Math.min(2, window.devicePixelRatio || 1);
        const narrow = w < 640;
        const W = narrow ? w * 0.66 : Math.min(520, w * 0.5);
        slabs = preps.map((p, k) => { const s = Terrain.bitmap(p, W, dpr); s.blocks = blocksFor(s, 300 + k); return s; });
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
        if (open >= 0) placePanel(open);
        draw(performance.now());
    }

    const ease = t => 1 - Math.pow(1 - clamp01(t), 3);

    function centerY(k, now) {
        const sp = reduced ? 1 : ease(spread * 1.25 - k * 0.06);
        const packed = top0 + step * 1.6 + k * step * 0.28;      // where the slabs start, nearly touching
        const bob = reduced ? 0 : Math.sin(now / 1100 + k * 1.3) * 3.2;
        return packed + (top0 + step * k - packed) * sp + bob - state[k].lift;
    }

    function drawSlab(s, k, y) {
        const dis = state[k].dis, x0 = cx - s.ox, y0 = y - s.oy;
        if (dis <= 0) { ctx.drawImage(s.canvas, x0, y0, s.w, s.h); return; }
        if (dis >= 1) return;
        // pixel dissolve: blocks past the threshold are gone; ones just past it drift up and fade
        const src = BS * dpr;
        for (const b of s.blocks) {
            const left = b.o - dis;
            if (left < -0.12) continue;
            let a = 1, dy = 0;
            if (left < 0) { const f = -left / 0.12; a = 1 - f; dy = -f * 14; }
            ctx.globalAlpha = a * (1 - 0.92 * state[k].fade);
            ctx.drawImage(s.canvas, b.bx * src, b.by * src, src, src, x0 + b.bx * BS, y0 + b.by * BS + dy, BS, BS);
        }
        ctx.globalAlpha = 1;
    }

    function draw(now) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);
        const lineX = labelX - 10, ink = getComputedStyle(root).color;
        // bottom slab first: the ones above sit nearer the eye
        for (let k = slabs.length - 1; k >= 0; k--) {
            const s = slabs[k], y = centerY(k, now), st = state[k];
            const dim = open < 0 && hovered >= 0 && hovered !== k;
            ctx.globalAlpha = (dim ? 0.38 : 1) * (1 - 0.92 * st.fade);
            drawSlab(s, k, y);
            // leader line from the slab's right corner to its label
            ctx.globalAlpha = (hovered === k ? 0.9 : 0.35) * (0.4 + 0.6 * spread) * (1 - st.fade) * (1 - st.dis);
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

    // ---------- the panel's pixel veil ----------
    let veilOrder = null;
    function drawVeil(cover) {               // cover 1: fully hidden behind pixels, 0: clear
        const w = panel.clientWidth, h = panel.clientHeight;
        if (veil.width !== Math.round(w * dpr) || veil.height !== Math.round(h * dpr) || !veilOrder) {
            veil.width = Math.round(w * dpr); veil.height = Math.round(h * dpr);
            const cols = Math.ceil(w / 8), rows = Math.ceil(h / 8);
            veilOrder = { cols, rows, o: Float32Array.from({ length: cols * rows }, (_, i) => 0.7 * hash(i % cols, (i / cols) | 0, 77) + 0.3 * ((i % cols) / cols)) };
        }
        vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        vctx.clearRect(0, 0, w, h);
        if (cover <= 0) return;
        vctx.fillStyle = getComputedStyle(docEl).getPropertyValue('--bg').trim() || '#fff';
        const { cols, o } = veilOrder;
        for (let i = 0; i < o.length; i++) if (o[i] < cover) vctx.fillRect((i % cols) * 8, ((i / cols) | 0) * 8, 8, 8);
    }

    function placePanel(k) {
        const h = panel.offsetHeight;
        const y = (top0 + step * k) - h / 2;
        panel.style.top = Math.max(0, Math.min(cssH - h, y)) + 'px';
    }

    // ---------- animation ----------
    const OPEN_MS = 1300, CLOSE_MS = 1000;
    function step_anim(now) {
        if (!anim) return false;
        const { k, dir } = anim, t = now - anim.t0;
        if (dir > 0) {
            state[k].dis = clamp01(t / 620);
            state.forEach((st, i) => { if (i !== k) st.fade = ease(t / 500); });
            // the slab breaks up first; then the details assemble where it was
            if (t >= 480 && panel.style.visibility) panel.style.visibility = '';
            drawVeil(1 - clamp01((t - 500) / 760));
            if (t >= 1000) panel.classList.add('sd-ready');
            if (t >= OPEN_MS) { drawVeil(0); anim = null; }
        } else {
            drawVeil(clamp01(t / 380));
            if (t >= 380 && !panel.hidden) { panel.hidden = true; root.classList.remove('is-open'); }
            state[k].dis = 1 - clamp01((t - 380) / 620);
            state.forEach((st, i) => { if (i !== k) st.fade = 1 - ease((t - 380) / 520); });
            if (t >= CLOSE_MS) { state.forEach(st => { st.dis = 0; st.fade = 0; }); anim = null; open = -1; }
        }
        return true;
    }

    function openSlab(k) {
        if (open === k || anim) return;
        if (open >= 0) { state[open].dis = 0; }
        open = k;
        hovered = -1;
        labels.forEach(li => li.classList.remove('active'));
        fillPanel(k);
        panel.classList.remove('sd-ready');
        panel.hidden = false;
        root.classList.add('is-open');
        veilOrder = null;
        placePanel(k);
        if (reduced) {
            state.forEach((st, i) => { st.dis = i === k ? 1 : 0; st.fade = i === k ? 0 : 1; });
            drawVeil(0);
            panel.classList.add('sd-ready');
        } else {
            drawVeil(1);
            panel.style.visibility = 'hidden';
            anim = { k, dir: 1, t0: performance.now() };
        }
        canvas.style.cursor = '';
        $('.strata-close').focus({ preventScroll: true });
        kick();
    }

    function closeSlab() {
        if (open < 0 || anim) return;
        const k = open;
        if (reduced) {
            panel.hidden = true; root.classList.remove('is-open');
            state.forEach(st => { st.dis = 0; st.fade = 0; });
            open = -1; draw(performance.now());
            labels[k].querySelector('a').focus({ preventScroll: true });
            return;
        }
        panel.classList.remove('sd-ready');
        anim = { k, dir: -1, t0: performance.now() };
        labels[k].querySelector('a').focus({ preventScroll: true });
        kick();
    }

    function tick(now) {
        raf = 0;
        if (!t0) t0 = now;
        if (started && spread < 1) spread = Math.min(1, (now - t0) / 1600);
        let moving = step_anim(now);
        state.forEach((st, k) => {
            const target = open < 0 && hovered === k ? 14 : 0;
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
        if (open >= 0) k = -1;
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
        if (open >= 0) { closeSlab(); return; }          // a click outside the panel closes it
        const r = canvas.getBoundingClientRect();
        const k = slabAt(e.clientX - r.left, e.clientY - r.top);
        if (k >= 0) openSlab(k);
    });
    labels.forEach((li, k) => {
        const a = li.querySelector('a');
        a.addEventListener('click', e => { e.preventDefault(); openSlab(k); });
        a.addEventListener('pointerenter', () => setHover(k));
        a.addEventListener('pointerleave', () => setHover(-1));
        a.addEventListener('focus', () => setHover(k));
        a.addEventListener('blur', () => setHover(-1));
    });
    $('.strata-close').addEventListener('click', closeSlab);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && open >= 0) closeSlab(); });

    new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
        if (visible && !started && e.intersectionRatio > 0.2) { started = true; t0 = 0; }
        if (visible) kick();
    }, { threshold: [0, 0.2] }).observe(root);

    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(layout, 150); });
    new MutationObserver(kick).observe(docEl, { attributes: true, attributeFilter: ['class'] });
    layout();
})();

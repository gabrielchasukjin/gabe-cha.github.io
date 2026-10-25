// Dither: one dot language across the page, borrowed from ordered (Bayer) dithering.
//  1. Project images sit as one-color dot patterns until you hover (or, on touch, until the
//     card is in view), then the real image shows through.
//  2. The portrait arrives as coarse color dots that sharpen into the illustration.
// Everything is drawn once per size and theme; nothing here runs per frame except the
// portrait's short reveal.

(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    // 8x8 Bayer matrix, thresholds in 0..1
    const BAYER = (() => {
        const m = [[0, 2], [3, 1]];
        let b = m;
        for (let n = 2; n < 8; n *= 2) {
            const next = [];
            for (let y = 0; y < n * 2; y++) {
                next.push([]);
                for (let x = 0; x < n * 2; x++) next[y].push(4 * b[y % n][x % n] + m[(y / n) | 0][(x / n) | 0]);
            }
            b = next;
        }
        return b.map(r => r.map(v => (v + 0.5) / 64));
    })();
    const bayer = (x, y) => BAYER[y & 7][x & 7];
    const css = name => getComputedStyle(root).getPropertyValue(name).trim();

    // ---------- shared: sample an image at one value per dot ----------
    // fit: 'cover' crops like object-fit: cover; returns RGBA for a cols x rows grid
    function sample(img, cols, rows, fit) {
        const c = document.createElement('canvas');
        c.width = cols; c.height = rows;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.imageSmoothingQuality = 'high';
        const iw = img.naturalWidth || img.videoWidth, ih = img.naturalHeight || img.videoHeight;
        let sx = 0, sy = 0, sw = iw, sh = ih;
        if (fit === 'cover') {
            const k = Math.max(cols / iw, rows / ih);
            sw = cols / k; sh = rows / k; sx = (iw - sw) / 2; sy = (ih - sh) / 2;
        }
        g.drawImage(img, sx, sy, sw, sh, 0, 0, cols, rows);
        return g.getImageData(0, 0, cols, rows).data;
    }
    const whenLoaded = img => img.complete && img.naturalWidth ? Promise.resolve() :
        new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); });

    // ---------- 2. project images: one-color dots until hover ----------
    const cards = [];
    function drawCard(entry) {
        const { box, img, canvas } = entry;
        const w = box.clientWidth, h = box.clientHeight;
        if (!w || !h || !(img.naturalWidth)) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const B = 3;                                 // css px per dot
        const cols = Math.ceil(w / B), rows = Math.ceil(h / B);
        const data = sample(img, cols, rows, 'cover');
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
        const g = canvas.getContext('2d');
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.fillStyle = css('--dot-paper') || '#f4f3ef';
        g.fillRect(0, 0, w, h);
        g.fillStyle = css('--dot-ink') || '#1a1a1a';
        // stretch each image's own contrast, and flip dark images (a terminal) so the
        // background reads as paper and the content as dots, like the light ones
        const n = cols * rows, lum = new Float32Array(n);
        for (let i = 0; i < n; i++) lum[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
        const sorted = Float32Array.from(lum).sort();
        const lo = sorted[(n * 0.04) | 0], hi = sorted[(n * 0.96) | 0], mean = sorted[n >> 1];
        const flip = mean < 0.42, span = Math.max(0.08, hi - lo);
        for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
            let v = Math.min(1, Math.max(0, (lum[y * cols + x] - lo) / span));
            if (flip) v = 1 - v;
            const dark = Math.pow(1 - v, 0.85);
            if (dark > bayer(x, y)) g.fillRect(x * B + 0.4, y * B + 0.4, B - 0.8, B - 0.8);
        }
    }
    function setupCards() {
        document.querySelectorAll('.work-card-image').forEach(box => {
            const img = box.querySelector('img') || (() => {
                // Cloi's card is a video: dither its poster frame
                const v = box.querySelector('video');
                if (!v || !v.poster) return null;
                const p = new Image(); p.src = v.poster; return p;
            })();
            if (!img) return;
            const canvas = document.createElement('canvas');
            canvas.className = 'dither-layer';
            canvas.setAttribute('aria-hidden', 'true');
            box.appendChild(canvas);
            const entry = { box, img, canvas };
            cards.push(entry);
            whenLoaded(img).then(() => drawCard(entry));
            const card = box.closest('.work-card');
            const show = on => box.classList.toggle('dither-off', on);
            if (canHover) {
                card.addEventListener('pointerenter', () => show(true));
                card.addEventListener('pointerleave', () => show(false));
            } else {
                new IntersectionObserver(([e]) => show(e.isIntersecting), { threshold: 0.6 }).observe(card);
            }
            card.addEventListener('focusin', () => show(true));
            card.addEventListener('focusout', () => show(false));
        });
    }

    // ---------- 3. portrait: coarse color dots that sharpen, then the illustration ----------
    function setupPortrait() {
        const wrap = document.querySelector('.hero-portrait');
        const img = wrap && wrap.querySelector('img');
        if (!img || reduced) return;
        const canvas = document.createElement('canvas');
        canvas.className = 'dither-layer portrait-dots';
        canvas.setAttribute('aria-hidden', 'true');
        wrap.appendChild(canvas);
        wrap.classList.add('has-dots');

        const draw = B => {
            const w = img.clientWidth, h = img.clientHeight;
            if (!w || !h) return;
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            const cols = Math.ceil(w / B), rows = Math.ceil(h / B);
            const data = sample(img, cols, rows, 'fill');
            canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
            const g = canvas.getContext('2d');
            g.setTransform(dpr, 0, 0, dpr, 0, 0);
            g.clearRect(0, 0, w, h);
            const L = 4;                             // levels per channel
            for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
                const q = (y * cols + x) * 4, t = bayer(x, y) - 0.5;
                const ch = v => Math.round(Math.min(L - 1, Math.max(0, v / 255 * (L - 1) + t)) ) * 255 / (L - 1);
                g.fillStyle = `rgb(${ch(data[q])},${ch(data[q + 1])},${ch(data[q + 2])})`;
                const r = B * 0.46;
                g.beginPath();
                g.arc(x * B + B / 2, y * B + B / 2, r, 0, Math.PI * 2);
                g.fill();
            }
        };

        whenLoaded(img).then(() => {
            draw(14);
            const steps = [14, 10, 7, 5, 3.5];
            new IntersectionObserver(([e], obs) => {
                if (!e.isIntersecting) return;
                obs.disconnect();
                steps.forEach((B, k) => setTimeout(() => draw(B), 180 + k * 170));
                setTimeout(() => wrap.classList.add('dots-done'), 180 + steps.length * 170 + 60);
            }, { threshold: 0.45 }).observe(wrap);
        });
    }

    // ---------- go ----------
    setupCards();
    setupPortrait();
    let rt;
    const redrawCards = () => cards.forEach(drawCard);
    addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(redrawCards, 200); });
    new MutationObserver(redrawCards).observe(root, { attributes: true, attributeFilter: ['class'] });
})();

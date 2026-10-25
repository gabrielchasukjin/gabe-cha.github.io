// The landing scene: one granite valley floating in open space, turning slowly, with a
// waterfall pouring off its edge and a textured earth-and-rock underside. Drag anywhere
// on the scene to spin it. Everything is drawn live by terrain.js on one fixed canvas
// that the page then slides up over.

(() => {
    const canvas = document.getElementById('island-scene');
    if (!canvas || !window.Terrain) return;
    const ctx = canvas.getContext('2d');
    const stage = document.querySelector('.landing');
    const countEl = document.querySelector('[data-poly-count]');
    const besideCopy = !!document.querySelector('.hero-copy');   // homepage: island sits right of the text
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const root = document.documentElement;

    const MAIN_N = innerWidth < 700 ? 46 : 56;
    const main = Terrain.prepare('valley', MAIN_N);

    const rand = (i, k) => Terrain.hash(i, k, 404);
    const stars = Array.from({ length: 140 }, (_, i) => ({ x: rand(i, 1), y: rand(i, 2) * 0.75, r: 0.4 + rand(i, 3) * 1.1, tw: rand(i, 4) * 6 }));

    let w = 0, h = 0, dpr = 1, mainW = 0, mainX = 0, mainY = 0;
    let theta = -0.5, spinVel = 0, dragging = null;
    let mx = 0, my = 0, tmx = 0, tmy = 0;
    let raf = 0, last = 0, running = false;
    let polys = 0;
    const drops = [];

    function layout() {
        w = canvas.clientWidth; h = canvas.clientHeight;
        if (!w || !h) return;
        dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const narrow = w < 700;
        mainW = narrow ? Math.min(w * 0.78, h * 0.34) : Math.min(w * 0.46, h * 0.8, 680);
        mainX = narrow || !besideCopy ? w * 0.5 : w * 0.64;
        mainY = narrow ? h * 0.2 : besideCopy ? h * 0.38 : h * 0.34;
        frame(performance.now(), true);
    }

    function sky(night, t) {
        // a flat backdrop that matches the page, so the island floats on plain space
        ctx.fillStyle = night ? '#0b1022' : '#ffffff';
        ctx.fillRect(0, 0, w, h);
        if (!night) return;
        ctx.fillStyle = '#e8edff';
        for (const s of stars) {
            ctx.globalAlpha = 0.35 + 0.45 * (reduced ? 1 : 0.5 + 0.5 * Math.sin(t / 900 + s.tw));
            ctx.fillRect(s.x * w, s.y * h, s.r, s.r);
        }
        ctx.globalAlpha = 1;
    }

    function waterfall(P, H, T, dt) {
        // the river leaves the island at its u = +0.5 edge; only draw it when that edge faces us
        const N = MAIN_N, vExit = Terrain.riverV(1) - 0.5;
        const zExit = main.hAt(N, Math.round((vExit + 0.5) * N)) * H;
        const th = 14 * Math.PI / 180 + theta;
        const facing = Math.cos(th) + Math.sin(th) > 0.05;
        if (!reduced) {
            for (let q = 0; q < 7; q++) drops.push({ u: 0.5, v: vExit + (Math.random() - 0.5) * 0.034, z: zExit, vu: 0.03 + Math.random() * 0.03, vz: -10 * Math.random() });
        }
        const floor = -T - mainW * 0.5;
        ctx.fillStyle = root.classList.contains('night') ? '#eaf6ff' : '#6fb3e0';
        for (let q = drops.length - 1; q >= 0; q--) {
            const d = drops[q];
            d.vz -= mainW * 0.9 * dt; d.u += d.vu * dt; d.z += d.vz * dt;
            if (d.z < floor) { drops.splice(q, 1); continue; }
            if (!facing) continue;
            const [x, y] = P(d.u, d.v, d.z);
            ctx.globalAlpha = 0.75 * Math.min(1, (d.z - floor) / (mainW * 0.12));
            ctx.fillRect(x, y, 1.6, 2.6);
        }
        ctx.globalAlpha = 1;
        if (drops.length > 900) drops.splice(0, drops.length - 900);
    }

    function frame(now, still) {
        const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
        last = now;
        mx += (tmx - mx) * 0.06; my += (tmy - my) * 0.06;
        if (!dragging && !still) {
            theta += ((reduced ? 0 : 0.06) + spinVel) * dt;
            spinVel *= Math.pow(0.12, dt);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        sky(root.classList.contains('night'), now);
        const bob = reduced ? 0 : Math.sin(now / 1700) * 6;
        const out = Terrain.draw(ctx, main, {
            x: mainX + mx * 16, y: mainY + my * 9 + bob, W: mainW, theta, underside: 0.42, fragments: 12, dpr,
        });
        waterfall(out.P, out.H, out.T, still ? 0 : dt);
        if (countEl && out.polys !== polys) { polys = out.polys; countEl.textContent = polys.toLocaleString('en-US'); }
    }

    function tick(now) {
        raf = 0;
        if (!running) return;
        frame(now);
        if (!needsLoop()) { running = false; return; }
        raf = requestAnimationFrame(tick);
    }
    const start = () => { if (!running) { running = true; last = 0; raf = requestAnimationFrame(tick); } };
    const stop = () => { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; };
    const needsLoop = () => !reduced || dragging || Math.abs(spinVel) > 0.002;

    // only animate while the scene is on screen
    const sync = () => {
        const onScreen = scrollY < innerHeight * 1.05 && !document.hidden;
        if (onScreen && needsLoop()) start(); else { stop(); if (onScreen) frame(performance.now(), true); }
    };
    addEventListener('scroll', sync, { passive: true });
    document.addEventListener('visibilitychange', sync);
    new MutationObserver(() => frame(performance.now(), true)).observe(root, { attributes: true, attributeFilter: ['class'] });

    // drag to spin; the pointer also nudges the island a little (parallax)
    if (stage) {
        stage.style.cursor = 'grab';
        stage.addEventListener('pointermove', e => {
            if (e.target.closest('a, button')) return;
            tmx = e.clientX / w * 2 - 1; tmy = e.clientY / h * 2 - 1;
            if (dragging) {
                const dx = e.clientX - dragging.x;
                theta += dx * 0.006;
                spinVel = dx * 0.006 / Math.max(0.008, (e.timeStamp - dragging.t) / 1000);
                dragging.x = e.clientX; dragging.t = e.timeStamp;
                if (!running) frame(performance.now(), true);
            } else if (!running && !reduced) start();
        });
        stage.addEventListener('pointerleave', () => { tmx = tmy = 0; });
        stage.addEventListener('pointerdown', e => {
            if (e.target.closest('a, button') || e.button !== 0) return;
            dragging = { x: e.clientX, t: e.timeStamp };
            spinVel = 0;
            stage.setPointerCapture(e.pointerId);
            stage.style.cursor = 'grabbing';
            start();
        });
        const release = () => {
            if (!dragging) return;
            dragging = null;
            stage.style.cursor = 'grab';
            spinVel = Math.max(-3, Math.min(3, spinVel));
            if (!needsLoop()) stop();
        };
        stage.addEventListener('pointerup', release);
        stage.addEventListener('pointercancel', release);
    }

    let rt;
    addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(layout, 150); });
    layout();
    sync();
})();

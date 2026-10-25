// The landing scene: a granite valley floating in open space, turning slowly,
// with a waterfall pouring off its edge and a textured earth-and-rock underside. Around it drift smaller islands, one per
// project, each in that project's terrain style; point at one to see which, click to
// jump to it. Drag anywhere on the scene to spin the big island. Everything is drawn
// live by terrain.js on one fixed canvas that the page then slides up over.

(() => {
    const canvas = document.getElementById('island-scene');
    if (!canvas || !window.Terrain) return;
    const ctx = canvas.getContext('2d');
    const stage = document.querySelector('.landing');
    const tip = document.querySelector('.island-tip');
    const countEl = document.querySelector('[data-poly-count]');
    const withProjects = canvas.dataset.islands === 'projects';
    const besideCopy = !!document.querySelector('.hero-copy');   // homepage: island sits right of the text
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const root = document.documentElement;

    // ---------- the islands ----------
    const narrowAtLoad = innerWidth < 700;
    const MAIN_N = narrowAtLoad ? 48 : 62;
    const main = Terrain.prepare('valley', MAIN_N);

    // x, y: center as a fraction of the viewport; size: width relative to the big island;
    // depth: parallax strength, and whether it floats behind (< 0.6) or in front
    const PROJECTS = !withProjects ? [] : [
        { style: 'range',         idx: '01', name: 'SIGCSE 2026 paper',                href: '#work-01', d: [0.28, 0.12, 0.28, 0.45, 0.4],  m: [0.13, 0.11, 0.26, 0.45, 0.4] },
        { style: 'interferogram', idx: '02', name: 'Cloi',                      href: '#work-02', d: [0.87, 0.19, 0.32, 0.4, -0.5], m: [0.87, 0.15, 0.28, 0.4, -0.5] },
        { style: 'alpine',        idx: '03', name: 'Speech emotion recognition', href: '#work-03', d: [0.9, 0.47, 0.34, 0.55, 0.9], m: [0.1, 0.25, 0.2, 0.55, 0.9] },
        { style: 'mineral',       idx: '04', name: 'DSC 80: Loan Applications', href: '#work-04', d: [0.47, 0.8, 0.26, 0.85, -0.3], m: [0.9, 0.27, 0.2, 0.85, -0.3] },
        { style: 'bathymetry',    idx: '05', name: 'N-gram language model',     href: '#work-05', d: [0.5, 0.07, 0.2, 0.3, 1.4],  m: [0.45, 0.1, 0.22, 0.3, 1.4] },
    ].map(p => ({ ...p, prep: Terrain.prepare(p.style, 56), bm: null, x: 0, y: 0 }));

    // ---------- sky dressing ----------
    const rand = (i, k) => Terrain.hash(i, k, 404);
    const stars = Array.from({ length: 140 }, (_, i) => ({ x: rand(i, 1), y: rand(i, 2) * 0.75, r: 0.4 + rand(i, 3) * 1.1, tw: rand(i, 4) * 6 }));

    // ---------- state ----------
    let w = 0, h = 0, dpr = 1, mainW = 0, mainX = 0, mainY = 0;
    let theta = -0.5, spinVel = 0, dragging = null, hover = -1;
    let mx = 0, my = 0, tmx = 0, tmy = 0;
    let raf = 0, last = 0, running = false;
    const drops = [];
    let shownPolys = 0;

    function layout() {
        w = canvas.clientWidth; h = canvas.clientHeight;
        if (!w || !h) return;
        dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const narrow = w < 700;
        mainW = narrow ? Math.min(w * (withProjects ? 0.6 : 0.78), h * (withProjects ? 0.3 : 0.34)) : Math.min(w * 0.46, h * 0.8, 680);
        mainX = narrow || !besideCopy ? w * 0.5 : w * 0.64;
        mainY = narrow ? h * (withProjects ? 0.17 : 0.2) : besideCopy ? h * 0.38 : h * 0.34;
        for (const p of PROJECTS) {
            const [fx, fy, size, depth, spin] = narrow ? p.m : p.d;
            p.depth = depth;
            p.x = fx * w; p.y = fy * h;
            p.bm = Terrain.bitmap(p.prep, mainW * size, dpr, { theta: spin, underside: 0.3, fragments: 5 });
        }
        frame(performance.now(), true);
    }

    // ---------- drawing ----------
    function sky(night, t) {
        // a flat backdrop that matches the page, so the islands float on plain space
        ctx.fillStyle = night ? '#0b1022' : '#ffffff';
        ctx.fillRect(0, 0, w, h);
        if (night) {
            for (const s of stars) {
                ctx.globalAlpha = 0.35 + 0.45 * (reduced ? 1 : 0.5 + 0.5 * Math.sin(t / 900 + s.tw));
                ctx.fillStyle = '#e8edff';
                ctx.fillRect(s.x * w, s.y * h, s.r, s.r);
            }
            ctx.globalAlpha = 1;
        }
    }

    function islandAt(p, t) {
        const bob = reduced ? 0 : Math.sin(t / 1400 + p.depth * 9) * 5;
        return [p.x + mx * 36 * p.depth, p.y + my * 18 * p.depth + bob];
    }

    function drawProject(p, k, t) {
        const [x, y] = islandAt(p, t);
        ctx.globalAlpha = hover >= 0 && hover !== k ? 0.55 : 1;
        const lift = hover === k ? 8 : 0;
        ctx.drawImage(p.bm.canvas, x - p.bm.ox, y - p.bm.oy - lift, p.bm.w, p.bm.h);
        ctx.globalAlpha = 1;
    }

    function waterfall(P, H, T, dt) {
        // the river leaves the island at its u = +0.5 edge; only draw it when that edge faces us
        const N = MAIN_N, vExit = Terrain.riverV(1) - 0.5;
        const zExit = main.hAt(N, Math.round((vExit + 0.5) * N)) * H;
        const th = 14 * Math.PI / 180 + theta;
        const facing = Math.cos(th) + Math.sin(th) > 0.05;
        if (!reduced) {
            for (let q = 0; q < 7; q++) drops.push({ u: 0.5, v: vExit + (Math.random() - 0.5) * 0.034, z: zExit, vu: 0.03 + Math.random() * 0.03, vz: -10 * Math.random(), life: 0 });
        }
        const floor = -T - mainW * 0.5;
        ctx.fillStyle = root.classList.contains('night') ? '#eaf6ff' : '#6fb3e0';
        for (let q = drops.length - 1; q >= 0; q--) {
            const d = drops[q];
            d.vz -= mainW * 0.9 * dt; d.u += d.vu * dt; d.z += d.vz * dt; d.life += dt;
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
        const night = root.classList.contains('night');
        mx += (tmx - mx) * 0.06; my += (tmy - my) * 0.06;
        if (!dragging && !still) {
            theta += ((reduced ? 0 : 0.06) + spinVel) * dt;
            spinVel *= Math.pow(0.12, dt);
        }

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        sky(night, now);
        PROJECTS.forEach((p, k) => { if (p.depth < 0.6) drawProject(p, k, now); });

        const bob = reduced ? 0 : Math.sin(now / 1700) * 6;
        const { P, H, T, polys } = Terrain.draw(ctx, main, {
            x: mainX + mx * 16, y: mainY + my * 9 + bob, W: mainW, theta, underside: 0.42, fragments: 12, dpr,
        });
        waterfall(P, H, T, still ? 0 : dt);
        if (countEl && polys !== shownPolys) { shownPolys = polys; countEl.textContent = polys.toLocaleString('en-US'); }

        PROJECTS.forEach((p, k) => { if (p.depth >= 0.6) drawProject(p, k, now); });
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
    let onScreen = true;
    const sync = () => {
        onScreen = scrollY < innerHeight * 1.05 && !document.hidden;
        if (onScreen && needsLoop()) start(); else { stop(); if (onScreen) frame(performance.now(), true); }
    };
    addEventListener('scroll', sync, { passive: true });
    document.addEventListener('visibilitychange', sync);
    new MutationObserver(() => frame(performance.now(), true)).observe(root, { attributes: true, attributeFilter: ['class'] });

    // ---------- interaction ----------
    function projectAt(x, y) {
        const now = performance.now();
        // front islands first
        const order = PROJECTS.map((p, k) => k).sort((a, b) => PROJECTS[b].depth - PROJECTS[a].depth);
        for (const k of order) {
            const p = PROJECTS[k], [ix, iy] = islandAt(p, now);
            if (Terrain.solid(p.bm, x - (ix - p.bm.ox), y - (iy - p.bm.oy), dpr)) return k;
        }
        return -1;
    }
    function setHover(k) {
        if (k === hover) return;
        hover = k;
        stage.style.cursor = k >= 0 ? 'pointer' : 'grab';
        if (!tip) return;
        if (k < 0) { tip.hidden = true; return; }
        const p = PROJECTS[k], [ix, iy] = islandAt(p, performance.now());
        tip.innerHTML = `<span>${p.idx}</span>${p.name}`;
        tip.hidden = false;
        tip.style.left = ix + 'px';
        tip.style.top = (iy - p.bm.oy + p.bm.h * 0.12 - stage.getBoundingClientRect().top) + 'px';
        if (!running) frame(performance.now(), true);
    }

    if (stage) {
        stage.style.cursor = 'grab';
        stage.addEventListener('pointermove', e => {
            if (e.target.closest('a, button')) { setHover(-1); return; }
            tmx = e.clientX / w * 2 - 1; tmy = e.clientY / h * 2 - 1;
            if (dragging) {
                const dx = e.clientX - dragging.x;
                theta += dx * 0.006;
                spinVel = dx * 0.006 / Math.max(0.008, (e.timeStamp - dragging.t) / 1000);
                dragging.moved += Math.abs(dx);
                dragging.x = e.clientX; dragging.t = e.timeStamp;
                if (!running) frame(performance.now(), true);
                return;
            }
            setHover(projectAt(e.clientX, e.clientY));
            if (!running && !reduced) start();
        });
        stage.addEventListener('pointerleave', () => { tmx = tmy = 0; setHover(-1); });
        stage.addEventListener('pointerdown', e => {
            if (e.target.closest('a, button') || e.button !== 0) return;
            dragging = { x: e.clientX, t: e.timeStamp, moved: 0, k: projectAt(e.clientX, e.clientY) };
            spinVel = 0;
            stage.setPointerCapture(e.pointerId);
            stage.style.cursor = 'grabbing';
            start();
        });
        const release = e => {
            if (!dragging) return;
            const { moved, k } = dragging;
            dragging = null;
            stage.style.cursor = 'grab';
            if (e.type === 'pointerup' && moved < 6 && k >= 0) {
                spinVel = 0;
                document.querySelector(PROJECTS[k].href)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
            }
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

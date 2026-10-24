// The small island beside "What I care about": containers stacked in a grid on one
// half (deterministic code), open terrain on the other (agentic reasoning), with a
// seam of light where they meet. It turns slowly while it's on screen.

(() => {
    const canvas = document.querySelector('.now-island');
    if (!canvas || !window.Terrain) return;
    const ctx = canvas.getContext('2d');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const prep = Terrain.prepare('harbor', 54);
    let w = 0, h = 0, dpr = 1, theta = -0.35, raf = 0, last = 0, visible = false;

    function size() {
        w = canvas.clientWidth; h = canvas.clientHeight;
        dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
        draw(performance.now());
    }
    function draw(now) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        const W = Math.min(w * 0.9, h * 1.15);
        const bob = reduced ? 0 : Math.sin(now / 1600) * 5;
        Terrain.draw(ctx, prep, { x: w / 2, y: h * 0.38 + bob, W, theta, underside: 0.34, fragments: 10, dpr });
    }
    function tick(now) {
        raf = 0;
        if (!visible) return;
        theta += Math.min(0.05, last ? (now - last) / 1000 : 0) * 0.12;
        last = now;
        draw(now);
        raf = requestAnimationFrame(tick);
    }
    new IntersectionObserver(([e]) => {
        visible = e.isIntersecting && !reduced;
        last = 0;
        if (visible && !raf) raf = requestAnimationFrame(tick);
    }).observe(canvas);
    let rt;
    addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(size, 150); });
    size();
})();

// Project cards: panels rise into place as they first appear, and a card's video
// plays while you hover it (or, on touch screens, while it is in view).

(() => {
    const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    // rise into place on first sight
    const rise = new IntersectionObserver(entries => {
        for (const e of entries) {
            if (!e.isIntersecting) continue;
            e.target.classList.add('in');
            rise.unobserve(e.target);
        }
    }, { threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach(el => rise.observe(el));

    document.querySelectorAll('.work-card').forEach(card => {
        const video = card.querySelector('video');
        if (!video) return;
        const play = on => (on ? video.play().catch(() => {}) : video.pause());
        if (canHover) {
            card.addEventListener('pointerenter', () => play(true));
            card.addEventListener('pointerleave', () => play(false));
        } else {
            new IntersectionObserver(([e]) => play(e.isIntersecting), { threshold: 0.6 }).observe(card);
        }
        card.addEventListener('focusin', () => play(true));
        card.addEventListener('focusout', () => play(false));
    });
})();

// Light or dark: the visitor's saved choice, else their system setting. Loaded in <head>
// so the right theme paints first; the toggle flips it and remembers the choice.
// Dark mode is html.night, which also tells yosemite-ascii.js to draw the valley by moonlight.

(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    let saved = null;
    try { saved = localStorage.getItem('theme'); } catch (e) {}

    const apply = dark => {
        root.classList.toggle('night', dark);
        document.querySelectorAll('.theme-toggle').forEach(b => {
            b.setAttribute('aria-pressed', String(dark));
            b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
            b.title = dark ? 'Light mode' : 'Dark mode';
        });
    };

    apply(saved ? saved === 'dark' : media.matches);

    // follow the system setting until the visitor picks one
    const onSystem = e => { if (!saved) apply(e.matches); };
    if (media.addEventListener) media.addEventListener('change', onSystem);
    else if (media.addListener) media.addListener(onSystem);

    document.addEventListener('DOMContentLoaded', () => {
        apply(root.classList.contains('night'));
        document.querySelectorAll('.theme-toggle').forEach(b => b.addEventListener('click', () => {
            const dark = !root.classList.contains('night');
            saved = dark ? 'dark' : 'light';
            try { localStorage.setItem('theme', saved); } catch (e) {}
            apply(dark);
        }));
    });
})();

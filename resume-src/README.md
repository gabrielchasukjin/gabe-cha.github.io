# Resume source

LaTeX source for `../assests/resume.pdf`. Reconstructed to match the original
Overleaf-compiled resume (Lexend font, navy `#1A3C5A` headings).

## Compile

Uses XeLaTeX (fontspec + the Lexend `.ttf` files in this folder).

With [tectonic](https://tectonic-typesetting.github.io/) (self-contained, recommended):

```bash
tectonic -X compile resume.tex
```

Or with a normal TeX install:

```bash
xelatex resume.tex
```

Output: `resume.pdf`. Copy it to `../assests/resume.pdf` to update the site.

## Fonts

`Lexend-400/600/700.ttf` are static instances of the Lexend variable font
(Google Fonts, SIL Open Font License), referenced by `resume.tex` via fontspec.

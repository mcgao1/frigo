# Frigo — waste no

Hand-drawn, space-themed prototype for a food-waste website (EN + NL).

**Live site:** https://mcgao1.github.io/frigo/

## What this is

A single self-contained `index.html` — the homepage feel-prototype:
opening crumble transition → a floating fridge in space with an orbiting
"asteroid belt" of food. Drag food onto the fridge (edible = gulp,
inedible = the purple arm flings it to the trash). Scroll / click the
fridge to dive into the menu.

Everything is embedded in the one file. The only things it loads from the
internet are Google Fonts and the Rive animation runtime (unpkg CDN), so
it needs a network connection to look right.

## Testing notes

- Best viewed on desktop Chrome / Edge, full-screen.
- First load is a little slow (~2 MB of animation runtime + art).
- `?tune` in the URL, or press **T**, opens a small panel to drag the
  fridge's position/size (dev tool — ignore for normal testing).

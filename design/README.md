# Index page design directions

Three candidate treatments for `public/index.html`, built with the
`frontend-design` plugin. Open any file directly in a browser — each one is a
complete, standalone page.

**Direction C shipped.** `public/index.html` is now the Keyholder direction,
rebuilt against `/dungeon.css` so it reuses `.wrap`, `.topbar`, `.brand`,
`.topnav`, `.label`, `.btn`, `.steps`, `.rows` and the footer rather than
redefining them. These three files stay as a record of the exploration; A and
B were not shipped.

| File | Direction | Signature |
|---|---|---|
| `index-a-doorplate.html` | Door plate | Status plate + spec-sheet ledger, hairlines only |
| `index-b-marquee.html` | Marquee | Instrument Serif display, apps set as a cinema bill |
| `index-c-keyholder.html` | Keyholder | The membership as a physical key card |

All three share the same baseline fixes over the current page:

- The radial `.glow` blob is gone. Nothing replaces it in A; B uses a neutral
  wash from above; C puts the light on the card instead of the background.
- A real desktop composition. The current page is a 600px column centred on a
  1440px screen, which is the clearest tell that it was never laid out for
  desktop.
- A type scale with a display size, rather than a 40px cap on every viewport.
- Page CSS no longer redefines `.btn`, `.card`, `.label`, `.steps` and `.glow`
  on top of `/dungeon.css`.
- Keyboard focus is visible, `prefers-reduced-motion` is respected, and no FAQ
  entry is arbitrarily open on load.

Each file inlines its own copy of the `/dungeon.css` tokens so it can be opened
without a server. When a direction is chosen, that block comes out and the page
links `/dungeon.css` again, as the rest of the site does.

## Art and motion

Each direction gets one piece of generated art and one orchestrated moment,
rather than effects scattered across the page.

**A — guilloché engraving.** Three nested hypotrochoids, the curve family a
rose engine cuts into a share certificate or a banknote, drawn on canvas
behind the hero. It cuts itself over 2.4s on load and then holds still. Drawn
incrementally — each frame strokes only the newly cut span, so the cost is the
length of that span rather than the whole figure. Ledger rows light their rule
from the left on hover.

**B — projector.** A 140px noise tile redrawn at 12fps over the hero with the
lamp brightness wandering on the same clock, so grain and flicker read as one
projector rather than two effects. The headline comes up through the gate word
by word; titles on the bill strike their rule across on hover. The loop stops
when the hero scrolls out of view or the tab is hidden.

**C — the key is issued.** The card is placed onto the page rather than
already sitting there: it rises, a foil band crosses it, and the serial rolls
into place. The pointer tilt now carries the hex watermark with it at a lag,
which is what sells the card as a solid object. Faint register rails give the
empty half of the hero structure.

Everything is off under `prefers-reduced-motion`, the canvases are decorative
and `aria-hidden`, and every reveal is applied from script so the page reads
in full without JavaScript.

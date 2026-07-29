# Index page design directions

Three candidate treatments for `public/index.html`, built with the
`frontend-design` plugin. Open any file directly in a browser — each one is a
complete, standalone page.

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

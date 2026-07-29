# Index page design

`public/index.html` is the Keyholder direction, built against `/dungeon.css` so
it reuses `.wrap`, `.topbar`, `.brand`, `.topnav`, `.label`, `.btn`, `.steps`,
`.rows`, `.rails` and the footer rather than redefining them. Page CSS is only
what is genuinely specific to the landing page: the hero grid, the key card,
the reveal and the FAQ.

`index-c-keyholder.html` is the standalone candidate the page came from. It
inlines its own copy of the tokens so it opens in a browser without a server,
which also means it will drift — read `public/index.html` for the truth. Two
other directions, Door plate and Marquee, were explored and dropped.

## What changed from the old page

- The radial glow is gone, here and everywhere else on the site. See below.
- A real desktop composition. The old page was a 600px column centred on a
  1440px screen, the clearest tell that it was never laid out for desktop.
- A type scale with a display size, rather than a 40px cap at every viewport.
- Page CSS no longer redefines `.btn`, `.card`, `.label` and `.steps` on top of
  the design system.
- Copy in active voice, and no FAQ entry open on load.

## The signature: the key is issued

The membership is drawn as a physical key card rather than described. It is
placed onto the page rather than already sitting there — it rises, a foil band
crosses it once, and the serial rolls into place. The pointer tilt carries the
house mark with it at a lag, which is what sells the card as a solid object
instead of a rectangle that rotates.

Everything around it stays quiet. That is the whole idea: one memorable thing,
nothing competing with it.

Motion is off under `prefers-reduced-motion`, the card is `aria-hidden`
decoration, and reveals are applied from script so the page reads in full
without JavaScript.

## Register rails, site-wide

The emerald radial wash used to appear under two names: a `.glow` component in
`dungeon.css` used by three pages, and the same gradient copy-pasted as
`body::before` into twenty self-contained pages.

It is replaced everywhere by `.rails` — vertical hairlines at a 92px pitch,
masked at both ends. Structure rather than atmosphere, and no accent colour, so
it cannot read as a wash sitting on top of the page. It also carries the
printing-plate idea behind the key card, so the site shares one ambient
treatment.

`admin.html` is the exception: its sidebar is too narrow to fit more than two
rails, so it takes neutral light down its top edge instead.

## Link preview

`public/og.png` is generated, not hand-made. The source is
`design/og-card.html` — open it at exactly 1200×630 and screenshot at 2x. Both
`index.html` and `apply.html` point at it. Regenerate it whenever the hero copy
changes, or the preview will quietly describe a page that no longer exists.

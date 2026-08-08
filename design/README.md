# Design

`public/dungeon.css` is the design system. Every page in `public/` links it
before its own `<style>` block, and page CSS is only what is genuinely
specific to that page — a hero grid, a phone drawing, a two-pane inbox.
If a rule could be useful twice, it belongs in `dungeon.css` instead.

Two shared scripts sit alongside it:

- `public/dungeon-nav.js` — the chrome every signed-in page needs: point
  the logo at the dashboard, badge the unread count, append the staff
  links to the footer, sign out. It reads the markup rather than writing
  it, so a page still renders in full without JavaScript.
- `public/notif-bell.js` — the floating staff notification bell.
  **There are two copies of this file**, one at the repo root and one in
  `public/`, and they are not identical: the root one also gates the
  Guides footer link. `public/` is the one that is served.

## The rebuild

The site used to be thirty-odd self-contained pages. Each carried its own
copy of the tokens, DM Sans, emerald-tinted hairlines on every edge, a
pixel-font heading shrunk to 10px, and a 520–600px column that stayed a
column on a 1440px screen. They had drifted apart, and the same four
blocks of chrome JavaScript were pasted into twenty of them.

What changed, everywhere:

- **A real desktop composition.** The clearest tell was a phone column
  centred on a wide screen. Pages now use `.band-split` to put a section
  label out in the margin, or a genuine two-column layout: the form and
  what to check before writing it, the inbox and the message, the profile
  and the subscriptions.
- **A type scale.** `h1` is a heading, not a pixel-font badge. `.title-lg`
  for pages that front a section, `.page-title` for the rest.
- **No emoji standing in for icons.** Line icons on one grid, matching the
  house mark.
- **Copy in active voice**, and shorter.

`admin.html`, `mod.html` and `dealer.html` are the exception to the "use
the system's classes" rule. They are dense tools — hundreds of rows,
tables and dialogs — and their markup was not what dated them. Each keeps
its own class names, with its variables redefined in terms of the
system's (`--bdr` → `var(--line)`, `--g` → `var(--accent)`). Names the
system already owns are dropped rather than redefined, because
`--bg:var(--bg)` is a cycle that resolves to nothing and takes the colour
with it.

## The index page

`public/index.html` is the Sealed Gate direction: an ominous, minimal
threshold rather than a sales page. It supersedes the earlier Keyholder
direction, whose standalone candidate still sits here as
`index-c-keyholder.html` for reference (it inlines its own tokens, so it
will drift — read `public/index.html` for the truth). Keyholder came from
two dropped explorations, Door plate and Marquee.

### The signature: the seal

The house hexagon is rebuilt as a seal — three concentric hexagon rings,
cold grey on the outside, warming to emerald at the core, with a lit ember
at the centre that breathes. It reads as a sealed door with something alive
behind it. On load the seal *ignites*: the rings fade in from the core
outward and the hero copy rises under them, one orchestrated moment; after
that the ember just breathes.

Everything else stays quiet and greyscale. Emerald appears only in the
ember and the single primary button — the lit way in — so the accent is
withheld rather than sprayed around. That restraint is the point: one
memorable thing, nothing competing with it. No interior page has a
signature; they are meant to be got through, not admired.

The seal is `aria-hidden` decoration, motion is off under
`prefers-reduced-motion` (rings, ember and copy all resolve to their
resting state), and the questions below the fold reveal from script so the
page reads in full without JavaScript.

## Register rails, site-wide

The emerald radial wash used to appear under two names: a `.glow`
component in `dungeon.css` used by three pages, and the same gradient
copy-pasted as `body::before` into twenty self-contained pages.

It is replaced everywhere by `.rails` — vertical hairlines at a 92px
pitch, masked at both ends. Structure rather than atmosphere, and no
accent colour, so it cannot read as a wash sitting on top of the page. It
also carries the printing-plate idea behind the key card, so the site
shares one ambient treatment.

Two pages are exceptions. `admin.html`'s sidebar is too narrow to fit more
than two rails, so it takes neutral light down its top edge instead.
`index.html` drops the rails for its own atmosphere — an edge vignette that
pulls the corners into black around the seal, plus a faint grain — since
the landing is the one page allowed a signature of its own.

## Link preview

`public/og.png` is generated, not hand-made. The source is
`design/og-card.html` — open it at exactly 1200×630 and screenshot at 2x.
Both `index.html` and `apply.html` point at it. Regenerate it whenever the
hero copy changes, or the preview will quietly describe a page that no
longer exists.

The Sealed Gate redesign kept the landing's headline built around "one
key, everything worth watching," so the existing key-card preview still
reads true and the OG tags are unchanged. The card art no longer matches
the on-page seal, though; when `og-card.html` is next redrawn it should
carry the seal instead.

## Checking a change

There is no build step. Serve `public/` and look at the page at 390px and
1440px. The two things a static read will not catch are horizontal
overflow and console errors, and both are worth checking on every page you
touch — several live overflow bugs turned up that way during the rebuild:
a footer nav that could not fit seven staff links on a phone, a top nav
that pushed the page sideways under 430px, and an ellipsis on an inline
span that never had a chance of working.

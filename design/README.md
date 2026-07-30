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

`public/index.html` is the Keyholder direction. `index-c-keyholder.html`
is the standalone candidate it came from; it inlines its own copy of the
tokens so it opens in a browser without a server, which also means it
will drift — read `public/index.html` for the truth. Two other
directions, Door plate and Marquee, were explored and dropped.

### The signature: the key is issued

The membership is drawn as a physical key card rather than described. It
is placed onto the page rather than already sitting there — it rises, a
foil band crosses it once, and the serial rolls into place. The pointer
tilt carries the house mark with it at a lag, which is what sells the card
as a solid object instead of a rectangle that rotates.

Everything around it stays quiet. That is the whole idea: one memorable
thing, nothing competing with it. No other page has a signature; interior
pages are meant to be got through, not admired.

Motion is off under `prefers-reduced-motion`, the card is `aria-hidden`
decoration, and reveals are applied from script so the page reads in full
without JavaScript.

## Register rails, site-wide

The emerald radial wash used to appear under two names: a `.glow`
component in `dungeon.css` used by three pages, and the same gradient
copy-pasted as `body::before` into twenty self-contained pages.

It is replaced everywhere by `.rails` — hairlines at a 92px pitch, masked
at both ends. Structure rather than atmosphere, and no accent colour, so
it cannot read as a wash sitting on top of the page.

The guides are drawn from the thing the site is for. Three treatments
live in `dungeon.css`, all on that same pitch and that same weight, so a
page swaps one for another with a single class and nothing else moves:

- **The strip**, `.rails` — 35mm stock standing on end. Perforations ride
  the rails and a frame line crosses every fourth one, which is how film
  is actually pulled. This is the default, and the smallest step from the
  plain hairlines it replaces: the rhythm of the page does not change,
  only what the rhythm is made of. The perfs are an inline SVG because a
  rounded rectangle is not a shape a gradient can draw — two half-perfs
  per tile, so the one straddling the rail comes out whole.
- **The aperture**, `.rails--aperture` — the same spacing bent round a
  lens. Rings out from the iris, six blades closing on it, and the blades
  masked to the iris itself, because a spoke that runs to the edge of the
  page is a starburst rather than a lens. It carries its own falloff; the
  default one cuts the top off the lens. A page moves the lens off centre
  with `--iris-x`/`--iris-y`.
- **The gate**, `.rails--gate` — the ground glass. Thirds, crop marks at
  the corners, a focus bracket in the middle, and the frame counter
  ticking along the top edge at the house pitch. Inset to the content
  column and unmasked, because a frame that runs off the screen is not a
  frame, and a fade would take the counter and the top two crop marks
  with it. It reads as a composition rather than a texture, which suits a
  hero and would be too loud behind a form.

`design/rails-film.html` is the specimen sheet: each treatment on its own,
then behind the landing hero, with the plain hairlines at the foot to
compare against. It links `../public/dungeon.css` by relative path, so it
can only ever show what the site actually renders — open it off disk.

`admin.html` is the exception: its sidebar is too narrow to fit more than
two rails, so it takes neutral light down its top edge instead.

## Link preview

`public/og.png` is generated, not hand-made. The source is
`design/og-card.html` — open it at exactly 1200×630 and screenshot at 2x.
Both `index.html` and `apply.html` point at it. Regenerate it whenever the
hero copy changes, or the preview will quietly describe a page that no
longer exists.

## Checking a change

There is no build step. Serve `public/` and look at the page at 390px and
1440px. The two things a static read will not catch are horizontal
overflow and console errors, and both are worth checking on every page you
touch — several live overflow bugs turned up that way during the rebuild:
a footer nav that could not fit seven staff links on a phone, a top nav
that pushed the page sideways under 430px, and an ellipsis on an inline
span that never had a chance of working.

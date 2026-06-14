DUNGEON hexagon favicons
========================

FILES:
  favicon.ico          - multi-size .ico (16/32/48/64) for browser tabs
  favicon-16.png       - 16x16 tab icon
  favicon-32.png       - 32x32 tab icon
  apple-touch-icon.png - 180x180 for iOS home-screen bookmarks
  preview.png          - large preview (not for deployment)

ENTERDUNGEON (already done in the site zip):
  These are placed in public/ and the pages already reference them.
  Just upload the 4 icon files to your repo's public/ folder.

DUNGEONCAST (Jellyfin):
  Jellyfin's favicon lives in the web client files on the server.
  Easiest method that survives updates is NOT available via CSS alone,
  so to change the Jellyfin tab icon you replace the favicon in the
  web root on the VPS. Ask and I'll give you the exact commands
  (it's a couple of lines over SSH to drop favicon.ico into
  /usr/share/jellyfin/web/ or your Docker web volume).

/* ============================================================
   Dungeon · shared page chrome
   <script src="/dungeon-nav.js" defer></script>

   Every signed-in page was carrying its own copy of the same four
   things: point the logo at the dashboard, badge the unread count,
   add the staff links to the footer, sign out. They drifted. This is
   the one copy.

   It reads the markup rather than writing it, so a page still renders
   in full without JavaScript:
     #logoLink        anchor whose href moves to /dashboard.html
     #msgCount        .count-badge shown when there is unread mail
     #footNav         footer nav that staff links are appended to
     [data-requires-auth]  redirect to /login.html when signed out
   ============================================================ */
(function () {
  var STAFF = ['mod', 'admin', 'warden'];

  // One /me for the whole page. Pages that need the member themselves
  // await window.dungeonMe rather than firing a second request.
  var me = fetch('/api/member/me')
    .then(function (r) { return r.json(); })
    .catch(function () { return {}; });

  window.dungeonMe = me;

  me.then(function (d) {
    var authed = !!(d && d.authenticated);
    var tier = authed && d.member && d.member.profile && d.member.profile.tier;

    if (!authed && document.querySelector('[data-requires-auth]')) {
      location.href = '/login.html';
      return;
    }

    var logo = document.getElementById('logoLink');
    if (logo && authed) logo.setAttribute('href', '/dashboard.html');

    if (authed && STAFF.indexOf(tier) !== -1) {
      var nav = document.getElementById('footNav');
      if (nav) {
        nav.appendChild(link('/mod.html', 'Mod'));
        if (tier !== 'mod') nav.appendChild(link('/admin.html', 'Admin'));
      }
    }

    if (!authed) return;
    fetch('/api/messages/unread')
      .then(function (r) { return r.json(); })
      .then(function (u) {
        var badge = document.getElementById('msgCount');
        if (!badge || !u || !u.count) return;
        badge.textContent = u.count > 99 ? '99+' : u.count;
        badge.style.display = 'block';
      })
      .catch(function () {});
  });

  function link(href, text) {
    var a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    return a;
  }

  window.signOut = function () {
    fetch('/api/member/logout', { method: 'POST' })
      .catch(function () {})
      .then(function () { location.href = '/login.html'; });
  };
  // Older pages called it by other names.
  window.logout = window.doSignOut = window.signOut;
})();

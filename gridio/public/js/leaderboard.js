// GRIDIO - leaderboard page
init();

async function init() {
  const me = await api('/api/me');
  document.getElementById('user-chip').textContent = me.displayName;

  const urlSeason = parseInt(new URLSearchParams(location.search).get('season'), 10);
  const lb = await api('/api/leaderboard' + (urlSeason ? '?season=' + urlSeason : ''));
  document.getElementById('hero-status').innerHTML =
    '<b>' + lb.season + '</b> season' + (lb.archived ? ' <span class="tag-archive">ARCHiVE</span>' : '') +
    ' &middot; ' + lb.weeks.length + ' of ' + lb.totalWeeks + ' weeks scored';

  const sel = document.getElementById('season-sel');
  if (lb.seasons && lb.seasons.length > 1) {
    sel.hidden = false;
    sel.innerHTML = lb.seasons.map((s) =>
      '<option value="' + s.season + '">' + s.season + '</option>'
    ).join('');
    sel.value = String(lb.season);
    sel.onchange = () => {
      location.href = '/leaderboard.html?season=' + sel.value;
    };
  }

  renderStandings(lb);
  renderCrowns(lb);
  renderGrid(lb);
}

function renderStandings(lb) {
  const t = document.getElementById('standings');
  if (!lb.standings.length) {
    t.innerHTML = '<tr><td class="empty">No players yet.</td></tr>';
    return;
  }
  let html =
    '<tr><th>#</th><th>PLAYER</th><th>WEEKLY WiNS</th><th>CORRECT</th><th>PCT</th></tr>';
  html += lb.standings.map((s) =>
    '<tr class="' + (s.rank === 1 && s.weeklyWins > 0 ? 'top' : '') + '">' +
      '<td class="rank">' + s.rank + '</td>' +
      '<td class="name">' + esc(s.name) + '</td>' +
      '<td class="wins">' + (s.weeklyWins > 0 ? '&#9819; '.repeat(Math.min(s.weeklyWins, 6)) + (s.weeklyWins > 6 ? 'x' + s.weeklyWins : '') : '0') + '</td>' +
      '<td class="num">' + s.correct + (s.total ? ' / ' + s.total : '') + '</td>' +
      '<td class="num">' + (s.total ? s.pct + '%' : '-') + '</td>' +
    '</tr>'
  ).join('');
  t.innerHTML = html;
}

function renderCrowns(lb) {
  const box = document.getElementById('crowns');
  if (!lb.weeks.length) {
    box.innerHTML = '<div class="empty">First crown goes up after week 1 finals.</div>';
    return;
  }
  box.innerHTML = lb.weeks.map((w) => {
    const names = w.winners.map((x) => esc(x.name)).join(' + ') || 'No winner';
    const score = w.winners.length ? w.winners[0].correct + '/' + w.total : '';
    return '<span class="winner-pill"><span class="w">W' + w.week + '</span> ' +
           names + (score ? ' <span class="s">' + score + '</span>' : '') + '</span>';
  }).join('');
}

function renderGrid(lb) {
  const t = document.getElementById('grid');
  if (!lb.weeks.length) {
    t.innerHTML = '';
    return;
  }
  const weeksScored = lb.weeks.map((w) => w.week);
  const byUserWeek = new Map();
  for (const w of lb.weeks) {
    for (const r of w.results) {
      byUserWeek.set(r.userId + ':' + w.week, r);
    }
  }
  let html = '<tr><th>PLAYER</th>' + weeksScored.map((w) => '<th>W' + w + '</th>').join('') + '</tr>';
  html += lb.standings.map((s) =>
    '<tr><td class="name">' + esc(s.name) + '</td>' +
    weeksScored.map((w) => {
      const r = byUserWeek.get(s.userId + ':' + w);
      if (!r) return '<td class="blank">-</td>';
      return '<td class="num' + (r.isWinner ? ' win' : '') + '">' + r.correct + '</td>';
    }).join('') +
    '</tr>'
  ).join('');
  t.innerHTML = html;
}

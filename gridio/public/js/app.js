// GRIDIO - picks page
let ME = null;
let STATE = null;
let SEASONS = [];
let SEASON = null;
let WEEK = null;
let DATA = null;
let EDITING = false; // reopened picks after a submit, save pending

const $ = (id) => document.getElementById(id);

init();

async function init() {
  ME = await api('/api/me');
  $('user-chip').textContent = ME.displayName;
  if (ME.isAdmin) {
    const btn = $('btn-refresh');
    btn.hidden = false;
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await api('/api/admin/refresh', { method: 'POST', body: JSON.stringify({ week: WEEK }) });
        await loadWeek(WEEK, true);
        toast('Scores refreshed.');
      } catch (e) {
        toast(e.message, true);
      } finally {
        btn.disabled = false;
      }
    };
  }

  STATE = await api('/api/state');
  SEASONS = STATE.seasons && STATE.seasons.length
    ? STATE.seasons
    : [{ season: STATE.season, totalWeeks: STATE.totalWeeks }];
  const params = new URLSearchParams(location.search);
  const urlSeason = parseInt(params.get('season'), 10);
  SEASON = SEASONS.some((s) => s.season === urlSeason) ? urlSeason : STATE.season;
  renderSeasonSel();
  if (STATE.champ) {
    const c = STATE.champ;
    $('champ-label').textContent = 'WEEK ' + c.week + ' CHAMP' + (c.names.length > 1 ? 'S' : '');
    $('champ-who').textContent = c.names.join(' + ');
    $('champ-score').textContent = c.correct + '/' + c.total;
    const el = $('champ');
    el.href = '?week=' + c.week;
    el.onclick = (e) => {
      e.preventDefault();
      SEASON = STATE.season;
      const sel = $('season-sel');
      if (sel) sel.value = String(SEASON);
      WEEK = c.week;
      history.replaceState(null, '', pageQuery(c.week));
      renderWeekStrip();
      loadWeek(c.week);
    };
    el.hidden = false;
  }
  const urlWeek = parseInt(params.get('week'), 10);
  const fallbackWeek = SEASON === STATE.season ? STATE.currentWeek : 1;
  WEEK = urlWeek >= 1 && urlWeek <= seasonTotal() ? urlWeek : fallbackWeek;
  renderWeekStrip();
  await loadWeek(WEEK);

  setInterval(() => {
    if (!document.hidden) loadWeek(WEEK, true);
  }, 60000);
  setInterval(tickCountdowns, 1000);
}

function seasonTotal() {
  const entry = SEASONS.find((s) => s.season === SEASON);
  return (entry && entry.totalWeeks) || STATE.totalWeeks;
}

function pageQuery(week) {
  return '?week=' + week + (SEASON !== STATE.season ? '&season=' + SEASON : '');
}

function renderSeasonSel() {
  const sel = $('season-sel');
  if (!sel) return;
  if (SEASONS.length < 2) {
    sel.hidden = true;
    return;
  }
  sel.hidden = false;
  sel.innerHTML = SEASONS.map((s) =>
    '<option value="' + s.season + '">' + s.season + (s.season === STATE.season ? ' (LiVE)' : '') + '</option>'
  ).join('');
  sel.value = String(SEASON);
  sel.onchange = () => {
    SEASON = parseInt(sel.value, 10);
    WEEK = SEASON === STATE.season ? STATE.currentWeek : 1;
    history.replaceState(null, '', pageQuery(WEEK));
    renderWeekStrip();
    loadWeek(WEEK);
  };
}

function renderWeekStrip() {
  const strip = $('week-strip');
  strip.innerHTML = '';
  const isLive = SEASON === STATE.season;
  for (let w = 1; w <= seasonTotal(); w++) {
    const b = document.createElement('button');
    b.className = 'week-pill' + (w === WEEK ? ' active' : '') + (isLive && w === STATE.currentWeek ? ' now' : '');
    b.textContent = 'W' + w;
    b.onclick = () => {
      WEEK = w;
      history.replaceState(null, '', pageQuery(w));
      renderWeekStrip();
      loadWeek(w);
    };
    strip.appendChild(b);
  }
  const active = strip.querySelector('.active');
  if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
}

async function loadWeek(w, quiet = false) {
  if (!quiet) {
    EDITING = false;
    $('slate').innerHTML = '<div class="empty">Pulling the slate...</div>';
  }
  try {
    DATA = await api('/api/week/' + w + '?season=' + SEASON);
  } catch (e) {
    $('slate').innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    return;
  }
  if (DATA.week !== WEEK || DATA.season !== SEASON) return; // user moved on
  renderHero();
  renderTally();
  renderSlate();
  renderBoard();
}

// Players x games matrix for the selected week.
function renderBoard() {
  const head = $('board-head');
  const wrap = $('board-wrap');
  const t = $('picks-board');
  const games = DATA.games;
  const players = new Map();
  for (const gid in DATA.allPicks) {
    for (const p of DATA.allPicks[gid]) players.set(p.userId, p.name);
  }
  if (!games.length || !players.size) {
    head.hidden = true;
    wrap.hidden = true;
    return;
  }
  head.hidden = false;
  wrap.hidden = false;
  head.textContent = 'LEAGUE PiCKS - WEEK ' + DATA.week;

  const pickOf = new Map();
  for (const gid in DATA.allPicks) {
    for (const p of DATA.allPicks[gid]) pickOf.set(p.userId + ':' + gid, p.pick);
  }
  const list = [...players.entries()].map(([id, name]) => ({ id, name }));
  list.sort((a, b) =>
    a.id === ME.id ? -1 : b.id === ME.id ? 1 : a.name.localeCompare(b.name)
  );

  let html =
    '<tr><th>Player</th>' +
    games.map((g) => '<th>' + esc(g.away.abbr) + '@' + esc(g.home.abbr) + '</th>').join('') +
    '<th>&#10003;</th></tr>';
  html += list.map((pl) => {
    let correct = 0;
    const cells = games.map((g) => {
      const pk = pickOf.get(pl.id + ':' + g.id);
      if (!pk) return '<td class="blank">-</td>';
      let cls = 'num';
      if (g.status.completed && g.winner) {
        if (pk === g.winner) {
          cls += ' hit';
          correct += 1;
        } else {
          cls += ' miss';
        }
      }
      return '<td class="' + cls + '">' + esc(pk) + '</td>';
    }).join('');
    return (
      '<tr><td class="name">' + esc(pl.id === ME.id ? 'You' : pl.name) + '</td>' +
      cells + '<td class="num">' + correct + '</td></tr>'
    );
  }).join('');
  t.innerHTML = html;
}

function renderHero() {
  $('hero-week').textContent = DATA.week;
  const g = DATA.games;
  const el = $('hero-status');
  if (!g.length) {
    el.innerHTML = 'Schedule for this week is not posted yet. Check back soon.';
    return;
  }
  const total = g.length;
  const picked = Object.keys(DATA.myPicks).length;
  const live = g.filter((x) => x.status.state === 'in').length;
  const done = DATA.completedCount;
  const inPot = picked === total;
  let right = '';
  if (DATA.finalized) {
    const winners = DATA.tally.filter((t) => t.isWinner);
    right = winners.length
      ? '<span class="amber">Week winner' + (winners.length > 1 ? 's' : '') + ': ' +
        esc(winners.map((x) => x.name).join(', ')) + ' (' + winners[0].correct + '/' + total + ')</span>'
      : 'Final. Nobody took the pot this week.';
  } else if (!DATA.locked && DATA.lockAt) {
    const pot = inPot
      ? (DATA.submitted
          ? '<span class="in">submitted &#10003;</span>'
          : '<span class="in">you are in the pot</span>')
      : '<span class="amber">' + (total - picked) + ' more to enter the pot</span>';
    right = pot + ' &middot; picks lock <b class="count" data-kick="' + DATA.lockAt + '">' +
      countdownStr(new Date(DATA.lockAt) - Date.now()) + '</b>';
  } else {
    const pot = inPot
      ? '<span class="in">in the pot</span>'
      : '<span class="out">out this week</span>';
    right = pot +
      (live ? ' &middot; <span class="amber">' + live + ' live</span>' : '') +
      ' &middot; ' + done + '/' + total + ' final';
  }
  el.innerHTML = '<b>' + picked + '/' + total + '</b> picked &middot; ' + right;
}

function renderTally() {
  const box = $('tally');
  if (!DATA.tally.length || !weekLocked()) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  $('tally-title').textContent = DATA.finalized
    ? 'WEEK ' + DATA.week + ' FiNAL'
    : 'WEEK ' + DATA.week + ' SO FAR (' + DATA.completedCount + '/' + DATA.games.length + ' GAMES FiNAL)';
  $('tally-rows').innerHTML = DATA.tally.map((t) =>
    '<span class="tally-chip' + (t.isWinner ? ' winner' : '') + '">' +
      (t.isWinner ? '<span class="crown">&#9819;</span>' : '') +
      esc(t.name) + ' <span class="n">' + t.correct + '</span>' +
      (t.complete ? '' : ' <span class="out-tag">OUT</span>') +
    '</span>'
  ).join('');
}

function weekLocked() {
  if (DATA.locked) return true;
  if (DATA.lockAt) return Date.now() >= new Date(DATA.lockAt).getTime();
  return false;
}

function renderSlate() {
  const slate = $('slate');
  if (!DATA.games.length) {
    slate.innerHTML = '<div class="empty">No games posted for week ' + DATA.week + ' yet.</div>';
    return;
  }
  // group by local calendar day
  const groups = new Map();
  for (const g of DATA.games) {
    const key = fmtDayHeader(g.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  let html = '';
  for (const [day, games] of groups) {
    html += '<div class="day-head">' + esc(px(day)) + '</div><div class="games">';
    html += games.map(cardHtml).join('');
    html += '</div>';
  }
  slate.innerHTML = html;

  slate.querySelectorAll('.seg[data-pick]').forEach((btn) => {
    btn.addEventListener('click', () => makePick(btn.dataset.game, btn.dataset.pick));
  });

  renderSubmitBar();
}

// Submit -> (Edit -> Save) flow for the week's picks.
function renderSubmitBar() {
  const bar = $('submit-bar');
  const total = DATA.games.length;
  const picked = Object.keys(DATA.myPicks).length;
  const open = total > 0 && !DATA.archived && !weekLocked();
  bar.hidden = !open;
  if (!open) return;

  if (DATA.submitted && !EDITING) {
    bar.innerHTML =
      '<div class="submit-note in">PiCKS SUBMiTTED &#10003;</div>' +
      '<button class="btn-bar ghost" id="btn-editpicks">EDiT PiCKS</button>';
    $('btn-editpicks').onclick = startEdit;
  } else if (EDITING) {
    bar.innerHTML =
      '<div class="submit-note amber">EDiTiNG &mdash; save when you are done</div>' +
      '<button class="btn-bar" id="btn-savepicks">SAVE PiCKS</button>';
    $('btn-savepicks').onclick = submitWeek;
  } else if (picked === total) {
    bar.innerHTML = '<button class="btn-bar" id="btn-submitpicks">SUBMiT PiCKS</button>';
    $('btn-submitpicks').onclick = submitWeek;
  } else {
    const left = total - picked;
    bar.innerHTML =
      '<div class="submit-note">' + left + ' pick' + (left === 1 ? '' : 's') +
      ' to go before you can submit</div>';
  }
}

async function submitWeek() {
  try {
    await api('/api/submit', { method: 'POST', body: JSON.stringify({ week: WEEK }) });
    DATA.submitted = true;
    EDITING = false;
    toast('Week ' + WEEK + ' picks submitted.');
  } catch (e) {
    toast(e.message, true);
  }
  renderHero();
  renderSlate();
}

async function startEdit() {
  try {
    await api('/api/unsubmit', { method: 'POST', body: JSON.stringify({ week: WEEK }) });
    DATA.submitted = false;
    EDITING = true;
  } catch (e) {
    toast(e.message, true);
  }
  renderHero();
  renderSlate();
}

function teamRow(t, g, side) {
  const won = g.status.completed && g.winner === t.abbr;
  const lost = g.status.completed && g.winner && g.winner !== 'TIE' && g.winner !== t.abbr;
  return (
    '<div class="team-row' + (won ? ' won' : '') + (lost ? ' lost' : '') + '">' +
      '<img src="' + esc(t.logo) + '" alt="" loading="lazy">' +
      '<div class="t-meta">' +
        '<div class="t-name">' + esc(t.displayName || t.name) + '</div>' +
        '<div class="t-rec">' + esc(t.record || (side === 'away' ? 'Away' : 'Home')) + '</div>' +
      '</div>' +
      (t.score != null ? '<div class="t-score">' + t.score + '</div>' : '') +
    '</div>'
  );
}

function stateChip(g) {
  if (g.status.state === 'in') return '<span class="state-chip live">LiVE ' + esc(px(g.status.detail)) + '</span>';
  if (g.status.completed) return '<span class="state-chip final">' + esc(px(g.status.detail || 'FINAL')) + '</span>';
  const ms = new Date(g.date) - Date.now();
  if (ms < 48 * 3600 * 1000) {
    return '<span class="state-chip soon count" data-kick="' + g.date + '">' + countdownStr(ms) + '</span>';
  }
  return '<span class="state-chip">OPEN</span>';
}

function segClasses(g, pickVal, myPick) {
  let cls = 'seg';
  if (pickVal === 'TIE') cls += ' tie';
  if (myPick === pickVal) {
    cls += ' on';
    if (g.status.completed && g.winner) {
      cls += pickVal === g.winner ? ' hit' : ' miss';
    }
  }
  return cls;
}

function cardHtml(g) {
  const my = DATA.myPicks[g.id] || null;
  const submittedHold = DATA.submitted && !EDITING; // submitted picks stay frozen until EDIT
  const locked = weekLocked() || g.status.state !== 'pre' || submittedHold;
  const seg = (t, val, label) =>
    '<button class="' + segClasses(g, val, my) + '" style="--tc:#' + esc(t ? t.color : '') + '"' +
      (locked ? ' disabled' : ' data-game="' + esc(g.id) + '" data-pick="' + esc(val) + '"') + '>' +
      (t ? '<img src="' + esc(t.logo) + '" alt="">' : '') + esc(label) +
    '</button>';

  let rail =
    '<div class="rail">' +
      seg(g.away, g.away.abbr, g.away.abbr) +
      seg(null, 'TIE', 'TIE') +
      seg(g.home, g.home.abbr, g.home.abbr) +
    '</div>';

  let note = '';
  if (!locked) {
    note = my
      ? '<div class="rail-note">Your pick: <b>' + esc(my === 'TIE' ? 'Tie' : my) + '</b>. ' +
        (EDITING ? 'Hit SAVE PICKS below when you are done.' : 'Submit when you have picked every game.') + '</div>'
      : '<div class="rail-note">Tap a side. Pick every game to enter the pot.</div>';
  } else if (submittedHold && !weekLocked()) {
    note = '<div class="rail-note">Submitted. Hit EDIT PICKS below to change.</div>';
  } else if (!my) {
    note = '<div class="rail-note">No pick submitted for this one.</div>';
  }

  let reveal = '';
  const others = DATA.allPicks[g.id] || [];
  if (others.length) {
    reveal = '<div class="reveal">' + others.map((p) => {
      const mine = p.userId === ME.id;
      let cls = 'who' + (mine ? ' me' : '');
      if (g.status.completed && g.winner) cls += p.pick === g.winner ? ' right' : ' wrong';
      return '<span class="' + cls + '">' + esc(mine ? 'You' : p.name) +
             ' <span class="p">' + esc(p.pick) + '</span></span>';
    }).join('') + '</div>';
  }

  return (
    '<div class="card">' +
      '<div class="card-top">' +
        '<span class="kick">' + esc(fmtKick(g.date)) +
          (g.broadcast ? ' <span class="net">' + esc(g.broadcast) + '</span>' : '') + '</span>' +
        stateChip(g) +
      '</div>' +
      teamRow(g.away, g, 'away') +
      '<div class="at-divider">AT</div>' +
      teamRow(g.home, g, 'home') +
      rail + note + reveal +
    '</div>'
  );
}

async function makePick(gameId, pick) {
  const prev = DATA.myPicks[gameId];
  DATA.myPicks[gameId] = pick;
  renderHero();
  renderSlate();
  try {
    await api('/api/pick', {
      method: 'POST',
      body: JSON.stringify({ week: WEEK, gameId, pick })
    });
  } catch (e) {
    if (prev) DATA.myPicks[gameId] = prev;
    else delete DATA.myPicks[gameId];
    renderHero();
    renderSlate();
    toast(e.message, true);
    loadWeek(WEEK, true);
  }
}

function tickCountdowns() {
  document.querySelectorAll('.count[data-kick]').forEach((el) => {
    const ms = new Date(el.dataset.kick) - Date.now();
    el.textContent = countdownStr(ms);
    if (ms <= 0) loadWeek(WEEK, true);
  });
}

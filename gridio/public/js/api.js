// GRIDIO shared helpers
async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (res.status === 401 && !location.pathname.includes('login')) {
    location.href = '/login.html';
    return new Promise(() => {});
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function fmtKick(iso) {
  const d = new Date(iso);
  return d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function fmtDayHeader(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function countdownStr(ms) {
  if (ms <= 0) return 'kickoff';
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d > 0) return `in ${d}d ${h}h`;
  if (h > 0) return `in ${h}h ${mm}m`;
  return `in ${mm}m`;
}

let toastTimer;
function toast(msg, isErr = false) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle('err', isErr);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

async function logout() {
  await api('/api/logout', { method: 'POST' });
  location.href = '/login.html';
}

// PWA: register the service worker (no-op where unsupported).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

/* ============================================================
   Dungeon · shared notification bell component
   Include on any page with:  <script src="/notif-bell.js"></script>
   - Self-injects a fixed-position bell (top-right) ONLY for mod+ users
   - Reads /api/admin/notifications (same backend as the admin panel)
   - Clicking a notification jumps to /admin.html
   ============================================================ */
(function(){
  // Avoid double-inject if a page already has the inline admin bell
  if (document.getElementById('bellBtn') || document.getElementById('dgBell')) return;

  const MODS = ['mod','admin','warden'];

  fetch('/api/member/me').then(r=>r.json()).then(d=>{
    // Gate the "Guides" footer link - only active subscribers should see it,
    // since the guides reveal service setup specifics.
    try {
      const m = (d && d.member) || {};
      const tier = m.profile && m.profile.tier;
      const now = new Date();
      const pe = v => v ? new Date(String(v).indexOf('T')>-1 ? v : v + 'T00:00:00Z') : null;
      const se = pe(m.stremio_end), ce = pe(m.iptv_end);
      const perm = ['family','dealer','mod','admin','warden'].indexOf(tier) > -1;
      const hasAccess = perm || (se && se > now) || (ce && ce > now);
      if (!hasAccess) {
        document.querySelectorAll('footer a[href="/guides.html"]').forEach(a => {
          const sep = a.nextElementSibling;
          if (sep && sep.classList && sep.classList.contains('sep')) sep.remove();
          else { const prev = a.previousElementSibling; if (prev && prev.classList && prev.classList.contains('sep')) prev.remove(); }
          a.remove();
        });
      }
    } catch(e){}

    const tier = d && d.authenticated && d.member && d.member.profile && d.member.profile.tier;
    if (!tier || !MODS.includes(tier)) return;   // only staff see the bell
    inject();
  }).catch(()=>{});

  function inject(){
    // --- styles ---
    const css = document.createElement('style');
    css.textContent = `
      /* The bell floats over whatever page it lands on, so it carries its
         own rules - but every value comes from /dungeon.css, with a
         literal fallback for the few pages that do not load it. */
      /* Docked in the top bar. .floating is the fallback for a page
         with no .topnav to sit in. */
      #dgBell{position:relative;display:flex;align-items:center}
      #dgBell.floating{position:fixed;top:68px;right:16px;z-index:9000}
      #dgBellBtn{position:relative;display:flex;align-items:center;justify-content:center;
        width:32px;height:32px;flex:none;padding:0;border-radius:9px;
        background:transparent;border:1px solid transparent;
        cursor:pointer;color:var(--muted,#8A9A93);font:inherit;
        transition:color .18s,border-color .18s,background .18s}
      #dgBellBtn:hover{color:var(--text,#EAF1ED);border-color:var(--line,rgba(255,255,255,.07));
        background:var(--surface,#0C120F)}
      #dgBell.floating #dgBellBtn{width:38px;height:38px;border-radius:11px;
        background:rgba(12,18,15,.92);border-color:var(--line2,rgba(255,255,255,.13));
        backdrop-filter:blur(10px)}
      #dgBellBtn svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.7;
        stroke-linecap:round;stroke-linejoin:round}
      #dgBellBadge{position:absolute;top:-2px;right:-2px;min-width:16px;height:16px;padding:0 4px;
        border-radius:9px;background:var(--accent,#34D399);color:var(--accent-ink,#04150E);
        font-family:var(--mono,ui-monospace,monospace);font-size:9.5px;font-weight:600;line-height:16px;
        text-align:center;border:1.5px solid #0C120F;display:none}
      #dgBellPanel{position:absolute;top:calc(100% + 10px);right:0;width:344px;z-index:9000;max-width:calc(100vw - 28px);
        background:#0A100D;border:1px solid var(--line2,rgba(255,255,255,.13));border-radius:14px;
        box-shadow:0 16px 44px rgba(0,0,0,.55);overflow:hidden;display:none}
      #dgBellPanel.open{display:block}
      .dgb-head{display:flex;align-items:center;justify-content:space-between;gap:12px;
        padding:14px 16px;border-bottom:1px solid var(--line,rgba(255,255,255,.07))}
      .dgb-head-title{font-family:var(--mono,ui-monospace,monospace);font-size:10px;font-weight:600;
        letter-spacing:.2em;text-transform:uppercase;color:var(--faint,#6B7F77)}
      .dgb-clear{background:none;border:0;padding:0;cursor:pointer;
        font-family:var(--sans,system-ui);font-size:12.5px;font-weight:500;color:var(--muted,#8A9A93);
        transition:color .18s}
      .dgb-clear:hover{color:var(--red,#F87171)}
      .dgb-list{max-height:380px;overflow-y:auto}
      .dgb-item{display:flex;gap:11px;padding:13px 16px;cursor:pointer;text-decoration:none;
        border-bottom:1px solid var(--line,rgba(255,255,255,.07));transition:background .15s}
      .dgb-item:last-child{border-bottom:none}
      .dgb-item:hover{background:rgba(255,255,255,.03)}
      .dgb-item.unseen{background:rgba(52,211,153,.05)}
      .dgb-dot{width:6px;height:6px;border-radius:50%;flex:none;margin-top:6px}
      .dgb-body{flex:1;min-width:0}
      .dgb-titlerow{display:flex;align-items:baseline;gap:10px}
      .dgb-title{font-size:13.5px;font-weight:500;color:var(--text,#EAF1ED)}
      .dgb-time{font-family:var(--mono,ui-monospace,monospace);font-size:10.5px;
        color:var(--faint,#6B7F77);flex:none;margin-left:auto}
      .dgb-text{font-size:12.5px;line-height:1.55;color:var(--muted,#8A9A93);
        word-break:break-word;margin-top:3px}
      .dgb-empty{padding:30px 16px;text-align:center;font-size:13px;color:var(--muted,#8A9A93)}
    `;
    document.head.appendChild(css);

    // --- markup ---
    const wrap = document.createElement('div');
    wrap.id = 'dgBell';
    wrap.innerHTML = `
      <button id="dgBellBtn" type="button" title="Notifications" aria-label="Notifications">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8.5a6 6 0 0 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5"/><path d="M13.7 19.5a2 2 0 0 1-3.4 0"/></svg>
        <span id="dgBellBadge">0</span>
      </button>
      <div id="dgBellPanel">
        <div class="dgb-head">
          <span class="dgb-head-title">Notifications</span>
          <button class="dgb-clear" id="dgbClear">Clear</button>
        </div>
        <div class="dgb-list" id="dgbList"><div class="dgb-empty">Nothing new.</div></div>
      </div>`;
    // Sit in the top bar if there is one, ahead of Sign out; otherwise
    // fall back to floating over the page.
    const nav = document.querySelector('.topnav');
    if (nav) {
      const signOut = nav.querySelector('button');
      nav.insertBefore(wrap, signOut || null);
    } else {
      wrap.className = 'floating';
      document.body.appendChild(wrap);
    }

    const DOT = {application:'#34D399',support:'#FBBF24',demo:'#60A5FA',dealer:'#34D399',redemption:'#FBBF24',test:'#6B7F77',info:'#6B7F77'};
    let open = false;

    function timeAgo(dt){
      if(!dt)return'';
      try{ if(!dt.endsWith('Z')&&!dt.includes('+'))dt=dt.replace(' ','T')+'Z';
        const s=Math.floor((Date.now()-new Date(dt))/1000);
        if(s<60)return'now'; if(s<3600)return Math.floor(s/60)+'m';
        if(s<86400)return Math.floor(s/3600)+'h'; if(s<604800)return Math.floor(s/86400)+'d';
        return Math.floor(s/604800)+'w';
      }catch{return''}
    }
    function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}

    async function load(){
      const d = await fetch('/api/admin/notifications?limit=25').then(r=>r.json()).catch(()=>({notifications:[],unseen:0}));
      const badge = document.getElementById('dgBellBadge');
      if(d.unseen>0){ badge.textContent = d.unseen>99?'99+':d.unseen; badge.style.display='block'; }
      else badge.style.display='none';
      const list = document.getElementById('dgbList');
      if(!d.notifications || !d.notifications.length){ list.innerHTML='<div class="dgb-empty">Nothing new.</div>'; return; }
      list.innerHTML = d.notifications.map(n=>{
        const dot = DOT[n.kind]||'#6B7F77';
        const cls = n.seen?'':' unseen';
        return `<div class="dgb-item${cls}" onclick="location.href='/admin.html'">
          <div class="dgb-dot" style="background:${dot}"></div>
          <div class="dgb-body">
            <div class="dgb-titlerow"><span class="dgb-title">${esc(n.title||'')}</span><span class="dgb-time">${timeAgo(n.created_at)}</span></div>
            <div class="dgb-text">${esc(n.body||'')}</div>
          </div></div>`;
      }).join('');
    }

    document.getElementById('dgBellBtn').addEventListener('click', e=>{
      e.stopPropagation();
      open = !open;
      document.getElementById('dgBellPanel').classList.toggle('open', open);
      if(open){
        fetch('/api/admin/notifications/seen',{method:'POST'}).then(()=>{
          document.getElementById('dgBellBadge').style.display='none';
        }).catch(()=>{});
      }
    });
    document.getElementById('dgbClear').addEventListener('click', async e=>{
      e.stopPropagation();
      await fetch('/api/admin/notifications',{method:'DELETE'}).catch(()=>{});
      load();
    });
    document.addEventListener('click', e=>{
      if(open && !wrap.contains(e.target)){ open=false; document.getElementById('dgBellPanel').classList.remove('open'); }
    });

    load();
    setInterval(load, 30000);
  }
})();

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
    const tier = d && d.authenticated && d.member && d.member.profile && d.member.profile.tier;
    if (!tier || !MODS.includes(tier)) return;   // only staff see the bell
    inject();
  }).catch(()=>{});

  function inject(){
    // --- styles ---
    const css = document.createElement('style');
    css.textContent = `
      #dgBell{position:fixed;top:68px;right:16px;z-index:9000}
      #dgBellBtn{position:relative;width:42px;height:42px;border-radius:11px;
        background:rgba(13,19,17,.92);border:1px solid rgba(52,211,153,.25);
        cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;
        backdrop-filter:blur(8px);box-shadow:0 4px 16px rgba(0,0,0,.4);transition:border-color .15s,transform .15s}
      #dgBellBtn:hover{border-color:#34d399;transform:translateY(-1px)}
      #dgBellBadge{position:absolute;top:-5px;right:-5px;background:#f87171;color:#fff;
        font-size:10px;font-weight:700;font-family:'JetBrains Mono',monospace;min-width:18px;height:18px;
        border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 4px;border:2px solid #0d1311}
      #dgBellPanel{position:absolute;top:50px;right:0;width:340px;max-width:calc(100vw - 28px);
        background:#0d1311;border:1px solid rgba(52,211,153,.28);border-radius:12px;
        box-shadow:0 12px 40px rgba(0,0,0,.55),0 0 24px rgba(52,211,153,.06);overflow:hidden;display:none}
      #dgBellPanel.open{display:block}
      .dgb-head{display:flex;align-items:center;justify-content:space-between;padding:13px 15px;border-bottom:1px solid rgba(52,211,153,.1)}
      .dgb-head-title{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#8fa89e}
      .dgb-clear{background:none;border:none;color:#4d6b62;font-family:'JetBrains Mono',monospace;font-size:10px;cursor:pointer}
      .dgb-clear:hover{color:#f87171}
      .dgb-list{max-height:380px;overflow-y:auto}
      .dgb-item{display:flex;gap:11px;padding:12px 15px;border-bottom:1px solid rgba(52,211,153,.1);cursor:pointer;text-decoration:none;transition:background .15s}
      .dgb-item:hover{background:rgba(52,211,153,.06)}
      .dgb-item.unseen{background:rgba(52,211,153,.05)}
      .dgb-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-top:5px}
      .dgb-body{flex:1;min-width:0}
      .dgb-titlerow{display:flex;align-items:baseline;gap:8px}
      .dgb-title{font-size:13px;font-weight:600;color:#dce8e3}
      .dgb-time{font-family:'JetBrains Mono',monospace;font-size:10px;color:#4d6b62;flex-shrink:0;margin-left:auto}
      .dgb-text{font-size:12px;color:#8fa89e;line-height:1.5;word-break:break-word;margin-top:2px}
      .dgb-empty{padding:28px 15px;text-align:center;font-size:12px;color:#4d6b62;font-family:'JetBrains Mono',monospace}
    `;
    document.head.appendChild(css);

    // --- markup ---
    const wrap = document.createElement('div');
    wrap.id = 'dgBell';
    wrap.innerHTML = `
      <button id="dgBellBtn" title="Notifications">🔔<span id="dgBellBadge" style="display:none">0</span></button>
      <div id="dgBellPanel">
        <div class="dgb-head">
          <span class="dgb-head-title">Notifications</span>
          <button class="dgb-clear" id="dgbClear">Clear all</button>
        </div>
        <div class="dgb-list" id="dgbList"><div class="dgb-empty">No notifications yet</div></div>
      </div>`;
    document.body.appendChild(wrap);

    const DOT = {application:'#34d399',support:'#fbbf24',demo:'#60a5fa',dealer:'#34d399',redemption:'#fbbf24',test:'#4d6b62',info:'#4d6b62'};
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
      if(d.unseen>0){ badge.textContent = d.unseen>99?'99+':d.unseen; badge.style.display='flex'; }
      else badge.style.display='none';
      const list = document.getElementById('dgbList');
      if(!d.notifications || !d.notifications.length){ list.innerHTML='<div class="dgb-empty">No notifications yet</div>'; return; }
      list.innerHTML = d.notifications.map(n=>{
        const dot = DOT[n.kind]||'#4d6b62';
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

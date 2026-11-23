(() => {
  const id = key => document.getElementById(key);
  const notice = document.createElement('dialog');
  notice.className = 'club-dialog';
  document.body.append(notice);
  function display(title, message, buttons) {
    notice.replaceChildren();
    notice.oncancel = null;
    const heading = document.createElement('h2');
    heading.textContent = title;
    const copy = document.createElement('p');
    copy.textContent = message;
    notice.append(heading, copy);
    for (const [label, action] of buttons) {
      const button = document.createElement('button');
      button.className = 'pill-btn';
      button.textContent = label;
      button.onclick = action;
      if (label === '×') {
        button.classList.add('club-close');
        button.setAttribute('aria-label','Close notice');
      }
      notice.append(button);
    }
    if (!notice.open) notice.showModal();
  }
  let checking;
  async function health() {
    const cfg = window.SUPABASE_CONFIG;
    for (let attempt = 0; navigator.onLine && attempt < 2; attempt++) {
      try {
        const response = await fetch(cfg.url + '/auth/v1/settings', {headers:{apikey:cfg.anonKey}, cache:'no-store', signal:AbortSignal.timeout(2200)});
        if (response.ok) return true;
      } catch {}
    }
    display('Connection notice', navigator.onLine ? 'The server is temporarily unavailable. Please try again later.' : 'Your device is offline. Check your connection.', [['×', () => notice.close()]]);
    return false;
  }
  window.checkClubHealth = () => checking ||= health().finally(() => checking = null);
  window.checkClubHealth();
  window.clubPlaying = () => {
    if (typeof currentMode === 'undefined' || typeof game === 'undefined' || !game || game.game_over()) return false;
    return !!(window.bchessTournamentActive || (currentMode === 'friend' && friendRoomData?.guestId && !friendRoomData.gameOver) || (isOnlineMatchActive && !quickBot?.over) || (currentMode === 'bot' && !quickBot?.over));
  };
  for (const event of ['pointerdown','keydown','visibilitychange','scroll']) document.addEventListener(event, () => window.clubActivity = Date.now(), {passive:true});
  let match;
  id('clubUser').oninput = () => {match = null; id('clubActions').hidden = true; id('clubMatch').textContent = '';};
  id('clubSearch').onclick = async () => {
    const wanted = id('clubUser').value.trim();
    id('clubUser').oninput();
    const {data,error} = await sb.rpc('club_lookup',{wanted});
    if (wanted !== id('clubUser').value.trim()) return;
    match = data?.length === 1 && data[0];
    id('clubMatch').textContent = error ? error.message : match ? 'Selected profile: ' + match.username : 'No unique matching profile.';
    id('clubActions').hidden = !match;
  };
  for (const [key,enabled] of [['clubApply',true],['clubRemove',false]]) id(key).onclick = async () => {
    if (!match) return;
    const selected = match;
    const {error} = await sb.rpc('club_set_gold',{target:selected.uid,enabled});
    if (selected === match) id('clubMatch').textContent = error ? error.message : selected.username + (enabled ? ' · Gold applied' : ' · Gold removed');
    paint();
  };
  async function paint() {
    const name = document.querySelector('[data-club-profile]');
    if (!name || !window.sb) return;
    const {data} = await sb.from('club_gold').select('uid').eq('uid',name.dataset.clubProfile).maybeSingle();
    name.classList.toggle('club-gold',!!data);
  }
  new MutationObserver(paint).observe(id('playerProfileBody'),{childList:true});
  async function counts() {
    if (!id('clubCounts').open || !id('adminDashboard').getClientRects().length || document.hidden) return;
    try {
      const {data,error} = await sb.rpc('club_counts').abortSignal(AbortSignal.timeout(5000));
      if (error) throw error;
      id('clubTotals').textContent = 'Online Now: ' + data.online + ' · Playing Now: ' + data.playing;
    } catch { id('clubTotals').textContent = 'Temporarily unavailable'; }
  }
  id('clubCounts').ontoggle = counts;
  setInterval(counts,10000);
  let latest, checked = 0, busy = false;
  async function update() {
    if (busy || window.clubPlaying()) return;
    busy = true;
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) {
        await reg.update();
        const installing = reg.installing;
        if (installing) await new Promise((resolve,reject) => {
          installing.onstatechange = () => {
            if (installing.state === 'installed' || installing.state === 'activated') resolve();
            if (installing.state === 'redundant') reject(Error());
          };
        });
        if (reg.waiting) {
          const activated = new Promise((resolve,reject) => {
            const timer = setTimeout(() => reject(Error()),12000);
            navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timer);resolve(); },{once:true});
          });
          reg.waiting.postMessage({type:'SKIP_WAITING'});
          await activated;
        }
      }
      sessionStorage.setItem('clubExpected',latest.version);
      location.reload();
    } catch { busy = false; display('Update failed','Please try again.',[['Retry',update],['Later',later]]); }
  }
  function later() {sessionStorage.setItem('clubLater',latest.version);notice.close();}
  async function releases() {
    if (!window.firebase?.auth().currentUser || document.hidden || notice.open || busy || window.clubPlaying()) return;
    if (Date.now()-checked > 60000) {
      checked = Date.now();
      try {
        const r = await fetch('./release.js?releaseCheck=1',{cache:'no-store'});
        latest = JSON.parse((await r.text()).match(/^self\.BCHESS_RELEASE = (.+);\s*$/)[1]);
      } catch {return;}
    }
    if (!latest || latest.version === BCHESS_RELEASE.version || sessionStorage.getItem('clubLater') === latest.version) return;
    const failed = sessionStorage.getItem('clubExpected') === latest.version;
    display(failed ? 'Update failed' : 'New Update Available', 'Version ' + latest.version + ' · What’s New: ' + latest.notes, [[failed ? 'Retry' : 'Update Now',update],['Later',later]]);
    notice.oncancel = later;
  }
  setInterval(releases,3000);
})();

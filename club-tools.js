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
  const vipPanel = id('clubVipPanel');
  const vipList = id('clubVipMembers');
  const vipStatus = id('clubVipStatus');
  let listRequest = 0;
  let changingVip = false;
  let listedMembers = null;

  async function loadVipMembers() {
    const request = ++listRequest;
    const { data, error } = await sb.rpc('club_vip_members');
    if (request !== listRequest || !id('adminDashboard').getClientRects().length) return;
    if (error) {
      vipStatus.textContent = 'Could not load VIP members. ' + error.message;
      return;
    }
    renderVipMembers(data);
    vipStatus.textContent = data.length ? '' : 'No current VIP members.';
  }

  function renderVipMembers(members) {
    listedMembers = members;
    const rows = members.map(member => {
      const row = document.createElement('li');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'pill-btn';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Remove VIP from ' + member.username);
      remove.disabled = changingVip;
      remove.onclick = () => setGold(member, false, vipStatus);
      row.append(document.createTextNode(member.username), remove);
      return row;
    });
    vipList.replaceChildren(...rows);
    id('clubVipCount').textContent = '(' + members.length + ')';
  }

  function disableVipActions(disabled) {
    id('clubApply').disabled = disabled;
    id('clubRemove').disabled = disabled;
    vipList.querySelectorAll('button').forEach(button => { button.disabled = disabled; });
  }

  async function setGold(selected, enabled, output) {
    if (!selected || changingVip) return;
    changingVip = true;
    ++listRequest;
    disableVipActions(true);
    try {
      const { error } = await sb.rpc('club_set_gold', { target: selected.uid, enabled });
      if (error) throw error;
      ++vipRequest;
      vipKnown.set(selected.uid, enabled);
      document.querySelectorAll('[data-vip-user]').forEach(updateVipBadge);
      if (output !== vipStatus && selected === match) {
        output.textContent = selected.username + (enabled ? ' · Gold applied' : ' · Gold removed');
      }
      if (listedMembers) {
        const members = listedMembers.filter(member => member.uid !== selected.uid);
        if (enabled) members.push(selected);
        members.sort((a, b) => a.username.localeCompare(b.username));
        renderVipMembers(members);
      }
      if (vipPanel.open && id('adminDashboard').getClientRects().length) await loadVipMembers();
    } catch (error) {
      output.textContent = error.message;
    } finally {
      changingVip = false;
      disableVipActions(false);
    }
  }

  id('clubApply').onclick = () => setGold(match, true, id('clubMatch'));
  id('clubRemove').onclick = () => setGold(match, false, id('clubMatch'));
  vipPanel.addEventListener('toggle', () => {
    if (vipPanel.open && id('adminDashboard').getClientRects().length) loadVipMembers();
  });
  document.addEventListener('bchess-admin-open', () => { if (vipPanel.open) loadVipMembers(); });
  document.addEventListener('bchess-admin-close', () => {
    ++listRequest;
    listedMembers = null;
    vipList.replaceChildren();
    id('clubVipCount').textContent = '';
    vipStatus.textContent = '';
  });

  const vipKnown = new Map();
  let vipChannel;
  let vipRefreshTimer;
  let vipRequest = 0;

  function updateVipBadge(element) {
    const enabled = !!vipKnown.get(element.dataset.vipUser);
    element.classList.toggle('club-vip', enabled);
    if (element.id === 'ownVipName') element.hidden = !enabled;
    const existing = element.querySelector('.club-vip-badge');
    if (!enabled) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const name = element.querySelector('.club-username');
    if (!name) return;
    const badge = document.createElement('span');
    badge.className = 'club-vip-badge';
    const image = document.createElement('img');
    image.src = 'icons/vip-badge.png';
    image.width = 2172;
    image.height = 724;
    image.alt = 'VIP';
    badge.append(image);
    name.after(badge);
  }

  async function refreshVipBadges() {
    const request = ++vipRequest;
    const elements = Array.from(document.querySelectorAll('[data-vip-user]'));
    const users = [...new Set(elements.map(element => element.dataset.vipUser).filter(Boolean))];
    if (!users.length || !auth.currentUser) return;
    const { data, error } = await sb.from('club_gold').select('uid').in('uid', users);
    if (error || request !== vipRequest) return;
    const enabled = new Set(data.map(row => row.uid));
    users.forEach(uid => vipKnown.set(uid, enabled.has(uid)));
    document.querySelectorAll('[data-vip-user]').forEach(updateVipBadge);
  }

  function queueVipRefresh() {
    clearTimeout(vipRefreshTimer);
    vipRefreshTimer = setTimeout(refreshVipBadges, 50);
  }
  function vipChanged() {
    ++vipRequest;
    queueVipRefresh();
  }
  window.BChessVip = {
    paint(element) {
      updateVipBadge(element);
      if (element.dataset.vipUser) queueVipRefresh();
    }
  };
  auth.onAuthStateChanged(user => {
    if (!user) {
      if (vipChannel) sb.removeChannel(vipChannel);
      vipChannel = null;
      ++vipRequest;
      vipKnown.clear();
      document.querySelectorAll('[data-vip-user]').forEach(updateVipBadge);
      return;
    }
    if (!vipChannel) {
      vipChannel = sb.channel('club-vip-updates')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'club_gold' }, vipChanged)
        .subscribe(status => { if (status === 'SUBSCRIBED') vipChanged(); });
    }
    queueVipRefresh();
  });
  setInterval(() => {
    if (!document.hidden && (currentRoomCode || quickBot || window.bchessTournamentActive ||
        id('profileModal').getClientRects().length || id('playerProfileModal').getClientRects().length)) refreshVipBadges();
  }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) queueVipRefresh(); });
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

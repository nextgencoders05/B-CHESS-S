/* Scoped move input and friend-request UI. Gameplay authority remains on the server. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let enabled = localStorage.getItem('bChessPremove') === 'on';
  let queued = null, selected = null, dragging = false, scheduled = false, generation = 0;
  function color() {
    if (document.body.classList.contains('puzzle-mode') || window.bchessTournamentActive) return null;
    if (currentMode === 'friend' && currentRoomCode && friendRoomData?.guestId && !friendRoomData.gameOver) return myOnlineColor;
    if (currentMode === 'bot' && !quickBot?.over) return playerColor;
    return null;
  }
  function waiting() { return enabled && color() && !isWaitingForOpponent && !pendingOnlineMove && !game.game_over() && game.turn() !== color(); }
  function paint() {
    document.querySelectorAll('#myBoard .premove-square').forEach(el => el.classList.remove('premove-square'));
    [selected, queued?.from, queued?.to].filter(Boolean).forEach(s => document.querySelector('#myBoard [data-square="' + s + '"]')?.classList.add('premove-square'));
    const status = $('premoveStatus');
    if (status) { status.hidden = !queued && !selected; status.firstChild.textContent = queued ? 'Premove: ' + queued.from + ' → ' + queued.to + ' ' : 'Select a premove destination '; }
  }
  function clear() { generation++; queued = null; selected = null; dragging = false; paint(); }
  function queue(from, to) {
    if (!waiting() || !/^[a-h][1-8]$/.test(to) || from === to || game.get(from)?.color !== color()) { clear(); return; }
    const token = ++generation;
    queued = null; selected = null;
    const save = promotion => {
      if (token !== generation || !waiting()) return;
      queued = {from, to, promotion, mode: currentMode, room: currentRoomCode, ply: game.history().length}; paint();
    };
    if (isPromotionMove(from, to)) showPromotionModal(from, to, save); else save('q');
    paint();
  }
  function click(square) {
    if (!waiting()) return false;
    const own = game.get(square)?.color === color();
    if (selected === square) clear();
    else if (own) { queued = null; selected = square; generation++; paint(); }
    else if (selected) queue(selected, square);
    else clear();
    return true;
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!queued) { if (selected && !waiting()) clear(); return; }
      const q = queued;
      if (!enabled || !color() || game.game_over() || q.mode !== currentMode || q.room !== currentRoomCode || game.history().length < q.ply) { clear(); return; }
      if (game.turn() !== color() || pendingOnlineMove || isBotThinking) return;
      clear();
      const probe = new Chess(game.fen());
      if (probe.move({from:q.from,to:q.to,promotion:q.promotion})) applyHumanMove(q.from,q.to,q.promotion);
    });
  }
  window.BChessPremove = {waiting, click, clear, paint, schedule,
    drag(from,piece) { if (!waiting() || piece[0] !== color()) return false; dragging = true; selected = from; paint(); return true; },
    drop(from,to) { if (!dragging) return false; dragging = false; if (from === to) { selected = from; paint(); } else queue(from,to); return true; }
  };

  let owner = null, inboxRef = null, poll = null, inbox = {}, toastKey = null, toastTimer = null, shown = new Set();
  const busy = new Set();
  const requestKey = (id,r) => id + ':' + (r.id || r.createdAt || 'legacy');
  const seenKey = () => 'bChessFriendPopups:' + owner;
  function hideToast() { clearInterval(toastTimer); toastTimer = null; toastKey = null; $('friendRequestToast')?.remove(); }
  function render() {
    const list = $('challengeNotificationList'); if (!list) return;
    list.querySelectorAll('[data-friend-notice]').forEach(el=>el.remove());
    if (Object.keys(inbox).length) list.querySelector('.friend-empty')?.remove();
    for (const [id,req] of Object.entries(inbox)) {
      const row = document.createElement('div'); row.className='challenge-notification-row'; row.dataset.friendNotice=id;
      const label=document.createElement('span'); label.textContent=(req.fromName||'Player')+' • Friend request';
      row.append(label,actionButton('Accept',id,'accept',req),actionButton('Decline',id,'decline',req)); list.append(row);
    }
    const n = Object.keys(inbox).length + Object.keys(challengeNotificationMap || {}).length;
    if ($('challengeBadge')) { $('challengeBadge').textContent=n; $('challengeBadge').style.display=n?'inline-flex':'none'; }
  }
  function actionButton(label,id,action,req) {
    const button=document.createElement('button'); button.type='button'; button.className='pill-btn';button.textContent=label;button.disabled=busy.has(id);
    button.onclick=()=>respond(id,action,req);return button;
  }
  function nextToast() {
    if (toastKey || !owner) return;
    const item=Object.entries(inbox).find(([id,r])=>!shown.has(requestKey(id,r)));
    if (!item) return;
    const [id,req]=item, key=requestKey(id,req);toastKey=key;shown.add(key);
    try { localStorage.setItem(seenKey(),JSON.stringify([...shown].slice(-500))); } catch (_) {}
    const toast=document.createElement('section');toast.id='friendRequestToast';toast.setAttribute('aria-label','New friend request');
    const info=document.createElement('div'); info.className='friend-toast-info';
    if (req.fromPhoto && /^(https:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(req.fromPhoto)) {
      const img=document.createElement('img');img.src=req.fromPhoto;img.alt='';img.width=36;img.height=36;info.append(img);
    }
    const name=document.createElement('strong');name.textContent=(req.fromName||'Player')+' sent you a friend request';info.append(name);
    const actions=document.createElement('div');actions.className='friend-toast-actions';
    const count=document.createElement('span');count.setAttribute('role','timer');
    actions.append(actionButton('Accept',id,'accept',req),actionButton('Decline',id,'decline',req),count);
    const feedback=document.createElement('span');feedback.id='friendRequestFeedback';feedback.setAttribute('role','status');
    toast.append(info,actions,feedback);
    // A normal-flow banner pushes content down instead of covering the board or microphones.
    document.querySelector('.top-bar').after(toast);
    const end=Date.now()+10000;
    const tick=()=>{const left=Math.max(0,Math.ceil((end-Date.now())/1000));count.textContent=left+'s';if(!left){hideToast();nextToast();}};
    tick();toastTimer=setInterval(tick,250);
  }
  function receive(data,uid) {
    if (owner!==uid) return;
    inbox=data||{};
    if (toastKey && !Object.entries(inbox).some(([id,r])=>requestKey(id,r)===toastKey)) hideToast();
    render();nextToast();
  }
  async function refresh() {
    const uid=owner; if (!uid || !inboxRef) return;
    const result=await inboxRef.once('value'); receive(result.val(),uid);
  }
  async function respond(id,action,req) {
    if (!owner || busy.has(id)) return;
    const uid=owner;busy.add(id);render();
    $('friendRequestToast')?.querySelectorAll('button').forEach(b=>b.disabled=true);
    try {
      await window.sbCall('bchess_friend_request',{p_other:id,p_action:action,p_request:String(req.id||req.createdAt||'legacy')});
      if (owner!==uid) return;
      // Refresh both the pending inbox and existing friends UI through the versioned adapter.
      await refresh();loadFriendsData();loadFriendRequests();
    } catch(err) {
      if(owner===uid) { if($('friendRequestFeedback')) $('friendRequestFeedback').textContent=err.message;else alert('Could not update request: '+err.message); }
    } finally {busy.delete(id);render();$('friendRequestToast')?.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  function connect(user) {
    const uid=user?.uid||null;if(owner===uid)return;
    inboxRef?.off();clearInterval(poll);hideToast();inbox={};busy.clear();owner=uid;shown=new Set();
    if(uid) {
      try{shown=new Set(JSON.parse(localStorage.getItem(seenKey())||'[]'));}catch(_){}
      inboxRef=database.ref('users/'+uid+'/friendRequests/incoming');
      inboxRef.on('value',snap=>receive(snap.val(),uid));
      refresh().catch(()=>{});
      poll=setInterval(()=>{if(document.visibilityState!=='hidden')refresh().catch(()=>{});},10000);
    } else inboxRef=null;
    render();
  }
  window.BChessFriends={render,refresh,respond};
  function init() {
    const button=document.createElement('button');button.id='premoveToggleBtn';button.className='pill-btn';button.type='button';button.setAttribute('role','switch');
    function sync(){button.textContent='Premove — '+(enabled?'On':'Off');button.setAttribute('aria-checked',String(enabled));}
    button.onclick=()=>{enabled=!enabled;localStorage.setItem('bChessPremove',enabled?'on':'off');clear();sync();};sync();$('settingsPanel').append(button);
    const status=document.createElement('div');status.id='premoveStatus';status.hidden=true;status.append(document.createTextNode(''));
    const cancel=document.createElement('button');cancel.type='button';cancel.className='pill-btn';cancel.textContent='Cancel premove';cancel.onclick=clear;status.append(cancel);$('myBoard').after(status);
    $('myBoard').addEventListener('contextmenu',e=>{if(queued||selected){e.preventDefault();clear();}});
    document.addEventListener('keydown',e=>{if(e.key==='Escape')clear();});
    $('cancelPromotionBtn')?.addEventListener('click',()=>{if(waiting())clear();});
    auth.onAuthStateChanged(user=>{clear();connect(user);});connect(auth.currentUser);
    window.addEventListener('storage',e=>{if(e.key===seenKey()){try{shown=new Set(JSON.parse(e.newValue||'[]'));}catch(_){}if(toastKey&&shown.has(toastKey))hideToast();}if(e.key==='bChessPremove'){enabled=e.newValue==='on';clear();sync();}});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh().catch(()=>{});});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

(function(){
 'use strict';const $=id=>document.getElementById(id),rpc=(n,a={})=>sbCall(n,a),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const st={active:false,id:null,data:null,board:null,game:null,model:null,selected:null,busy:false,polling:false,generation:0,offset:0,list:[],admin:[],inTouch:false,lastTouchEnd:0,lastDrop:0,lastDropSquare:null,lastDropWasMove:false,dragFrom:null};
 const date=value=>new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium',timeStyle:'short'})+' IST';
 const tc=t=>(t.base_seconds/60)+'+'+t.increment;
 function tell(text){$('tourMessage').textContent=text;}
 function allowed(){return !currentRoomCode&&!isOnlineMatchActive&&!(quickBot&&!quickBot.over);}
 function highlightTour(square){
  document.querySelectorAll('#tournamentBoard .square-selected, #tournamentBoard .legal-dest-dot, #tournamentBoard .legal-dest-capture').forEach(el=>el.classList.remove('square-selected','legal-dest-dot','legal-dest-capture'));
  if(square&&st.model){
   document.querySelector('#tournamentBoard [data-square="'+square+'"]')?.classList.add('square-selected');
   for(const m of st.model.moves({square,verbose:true})){
    document.querySelector('#tournamentBoard [data-square="'+m.to+'"]')?.classList.add(m.captured||st.model.get(m.to)?'legal-dest-capture':'legal-dest-dot');
   }
  }
 }
 function selectTour(square){st.selected=square||null;highlightTour(st.selected);}
 async function open(){if(!allowed())return alert('Finish your current match first.');if(!currentUserId)return triggerGoogleLogin();if(!requireTermsAccepted())return;
  if(!st.active){setGameMode('quick');qmCancelActiveSearch();window.closePuzzleMode?.();st.active=true;st.generation++;document.body.classList.add('tournament-mode');$('tournamentPanel').hidden=false;document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));$('modeTournamentBtn').classList.add('active');}
  await list();if(st.id)await view();
 }
 window.closeTournamentMode=()=>{if(window.bchessTournamentActive)return;selectTour(null);st.active=false;st.generation++;$('tournamentPanel').hidden=true;document.body.classList.remove('tournament-mode');$('modeTournamentBtn').classList.remove('active');};
 async function list(){try{st.list=await rpc('tournament_list');if(!st.id||!st.list.some(t=>t.id===st.id))st.id=st.list.find(t=>t.status==='live')?.id||st.list[0]?.id;
  $('tourList').innerHTML=st.list.length?st.list.filter(t=>t.status!=='draft').map(t=>`<article class="tour-card"><strong>${esc(t.name)}</strong><p>${esc(t.category)} ${tc(t)} • ${esc(t.status)} • ${t.players} players</p><p>${esc(date(t.starts_at))}</p><button class="pill-btn" data-tour="${t.id}">View tournament</button></article>`).join(''):'No published tournaments yet.';
  $('tourList').querySelectorAll('[data-tour]').forEach(b=>b.onclick=async()=>{if(window.bchessTournamentActive&&st.id!==b.dataset.tour)return tell('Finish your active tournament first.');st.id=b.dataset.tour;st.generation++;await view();});
 }catch(e){tell(e.message);}}
 function standings(data){const t=data.tournament;const body=data.standings.map((e,i)=>`<tr><td>${i===0?(t.status==='completed'?'🏆 Winner':'★ Leader'):i+1}</td><td>${/^(data:image\/(png|jpeg|webp);base64,|https:\/\/)/.test(e.photo)?`<img src="${esc(e.photo)}" alt="" />`:`<span class="tour-avatar-fallback">${esc(e.name.slice(0,1).toUpperCase())}</span>`}${esc(e.name)}</td><td>${e.points}</td><td>${e.wins}</td><td>${e.draws}</td></tr>`).join('');
  $('tourLeaderboard').innerHTML=`<h3>${esc(t.name)} — Leaderboard</h3><table><thead><tr><th>Rank</th><th>Player</th><th>Points</th><th>Wins</th><th>Draws</th></tr></thead><tbody>${body}</tbody></table><small>Win 1 • draw ½ • loss / rest bye 0. Ties: wins, then earlier registration, then user ID. Tournament points do not change Elo.</small>`;
 }
 async function view(){if(!st.active||!st.id||st.polling)return;st.polling=true;const gen=st.generation,id=st.id;
  try{const data=await rpc('tournament_view',{p_id:id});if(!st.active||gen!==st.generation||id!==st.id)return;st.data=data;st.offset=Date.parse(data.serverNow)-Date.now();standings(data);const t=data.tournament,registered=data.entries.some(e=>e.user_id===currentUserId);
   window.bchessTournamentActive=t.status==='live'&&registered;
   $('tourDetails').innerHTML=`<h3>${esc(t.category)} ${tc(t)} • ${esc(t.status)}</h3><p>Start: ${esc(date(t.starts_at))}</p><p>Registration: ${esc(date(t.registration_opens))} → ${esc(date(t.registration_closes))}</p><p>Single round-robin (at least 2 players): everyone plays everyone once. Planned rounds: ${data.entries.length<2?'waiting for players':data.entries.length%2?data.entries.length:data.entries.length-1}. Odd-player byes are rest rounds. Admin starts at or after the scheduled time.</p><p>Each active round allows 60 seconds to connect/reconnect. Clocks start when both players connect. Both absent: double forfeit (0 points each). Stay on this page while playing.</p>`;
   const now=Date.now()+st.offset;if(t.status==='open'&&!registered){const b=document.createElement('button');b.className='pill-btn highlight-btn';b.textContent='Join tournament';b.disabled=now<Date.parse(t.registration_opens)||now>=Date.parse(t.registration_closes);b.onclick=async()=>{b.disabled=true;try{await rpc('tournament_join',{p_id:id});tell('Registered successfully.');await list();}catch(e){tell(e.message);}finally{st.polling=false;await view();}};$('tourDetails').append(b);}
   if(registered){const p=document.createElement('p');p.textContent='You are registered.';$('tourDetails').append(p);}
   const mine=data.games.filter(g=>g.white_id===currentUserId||g.black_id===currentUserId),active=mine.find(g=>g.status==='active');
   if(active){const live=await rpc('tournament_game_action',{p_game:active.id,p_action:'heartbeat'});if(gen!==st.generation)return;renderGame(live);}
   else{const recent=mine.filter(g=>g.status==='finished').at(-1);if(recent)renderGame(recent);else $('tourGamePanel').hidden=true;}
   const rounds=document.createElement('div');rounds.className='tour-rounds';const names=Object.fromEntries(data.entries.map(e=>[e.user_id,e.name]));rounds.innerHTML='<h4>Rounds & results</h4>'+mine.map(g=>`<p>Round ${g.round}: ${esc(names[g.white_id]||'Rest')} vs ${esc(names[g.black_id]||'Rest')} — ${esc(g.result||g.status)}${g.winner?' • Winner: '+esc(names[g.winner]):''}</p>`).join('');$('tourDetails').append(rounds);
   if(t.status==='cancelled'){window.bchessTournamentActive=false;tell('This tournament was cancelled by the admin.');$('tourGamePanel').hidden=true;}
  }catch(e){tell(e.message);}finally{st.polling=false;}
 }
 function renderGame(g){const changed=!st.game||st.game.id!==g.id||st.game.version!==g.version;st.game=g;st.model=new Chess(g.fen);$('tourGamePanel').hidden=false;
  if(!st.board)st.board=createPlayBoard('tournamentBoard',{draggable:true,position:g.fen,pieceTheme:PIECE_IMG_URL,
   onDragStart:(from,piece)=>{if(!st.inTouch&&Date.now()-st.lastTouchEnd<450)return false;if(!canMove()||piece[0]!==st.model.turn())return false;st.dragFrom=from;if(st.selected!==from)highlightTour(from);return true;},
   onDrop:(from,to)=>{st.dragFrom=null;if(st.inTouch){st.inTouch=false;st.lastTouchEnd=Date.now();}if(!canMove()||!to||to==='offboard'){selectTour(st.selected);return 'snapback';}st.lastDrop=Date.now();st.lastDropSquare=to;if(from===to){st.lastDropWasMove=false;selectTour(st.selected===from?null:from);return 'snapback';}if(st.model.get(to)?.color===st.model.turn()){st.lastDropWasMove=false;selectTour(to);return 'snapback';}st.lastDropWasMove=true;selectTour(null);move(from,to);return 'snapback';},
   onSnapbackEnd:()=>{if(st.game)st.board.position(st.game.fen,false);selectTour(st.selected);},
   onSnapEnd:()=>{if(st.game)st.board.position(st.game.fen,false);selectTour(st.selected);}});
  if(changed){
    selectTour(null);
    const side=g.white_id===currentUserId?'white':'black';
    if(st.board.orientation()!==side)st.board.orientation(side);
    st.board.resize();
    st.board.position(g.fen);
  }
  selectTour(st.selected);
  $('tourGameTitle').textContent='Round '+g.round+' — You play '+(g.white_id===currentUserId?'White':'Black');
  const entries = st.data?.entries || [];
  $('tourPlayerNames').hidden = g.status !== 'active';
  if (g.status === 'active') {
    for (const [side, uid] of [['White', g.white_id], ['Black', g.black_id]]) {
      const player = entries.find(entry => entry.user_id === uid);
      renderPlayerIdentity($('tour' + side + 'Name'), { id: uid, name: player?.name || side });
    }
  }
  $('tourGameStatus').textContent=g.status!=='active'?'Match finished: '+g.result:g.clock_at?(canMove()?'Your turn':'Opponent to move'):'Waiting for both players to connect…';
  $('tourMoves').textContent=g.moves.join(' ');$('tourResign').disabled=g.status!=='active';$('tourDraw').disabled=g.status!=='active';$('tourAcceptDraw').hidden=!(g.status==='active'&&g.draw_offer&&g.draw_offer!==currentUserId);clocks();
 }
 function canMove(){return st.active&&!st.busy&&st.game?.status==='active'&&!!st.game.clock_at&&currentUserId===(st.game.turn==='w'?st.game.white_id:st.game.black_id);}
 function clocks(){const g=st.game;if(!g||!st.active)return;const elapsed=g.status==='active'&&g.clock_at?Math.max(0,(Date.now()+st.offset-Date.parse(g.clock_at))/1000):0;const fmt=(sec)=>{sec=Math.max(0,Math.ceil(sec));return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');};$('tourClocks').textContent='White '+fmt(g.white_left-(g.turn==='w'?elapsed:0))+'   •   Black '+fmt(g.black_left-(g.turn==='b'?elapsed:0));}
 async function move(from,to){if(!canMove()||from===to)return;const saved=st.game;st.busy=true;try{
  let promotion='q';if(st.model.get(from)?.type==='p'&&/[18]$/.test(to)){promotion=await new Promise(resolve=>{const cancel=()=>resolve(null);$('cancelPromotionBtn').addEventListener('click',cancel,{once:true});showPromotionModal(from,to,p=>{$('cancelPromotionBtn').removeEventListener('click',cancel);resolve(p);});});if(!promotion)return;}
  if(st.game.id!==saved.id||st.game.version!==saved.version)return;
  const c=new Chess(saved.fen);if(!c.move({from,to,promotion})){tell('Illegal move.');return;}
  const result=await bchessSecure({action:'move',game:saved.id,version:saved.version,move:{from,to,promotion}});if(st.game.id===saved.id)renderGame(result);playSound('move');tell('');
 }catch(e){tell(e.message);}finally{st.busy=false;await view();}}
 async function action(name){if(!st.game)return;if(name==='resign'&&!confirm('Resign this tournament match?'))return;
  try{renderGame(await rpc('tournament_game_action',{p_game:st.game.id,p_action:name}));await view();}catch(e){tell(e.message);}}
 const inputDate=value=>new Date(Date.parse(value)+19800000).toISOString().slice(0,16);
 function resetForm(){$('adminTournamentForm').reset();$('adminTourId').value='';}
 async function adminRefresh(){try{st.admin=await rpc('tournament_list');$('adminTourList').innerHTML=st.admin.map(t=>`<article class="tour-card"><strong>${esc(t.name)}</strong><p>${esc(t.status)} • ${tc(t)} • ${t.players} players • ${esc(date(t.starts_at))}</p>${['draft','open'].includes(t.status)?`<button class="pill-btn" data-edit="${t.id}">Edit</button>`:''}${t.status==='open'?`<button class="pill-btn" data-action="start" data-id="${t.id}">Start</button>`:''}${t.status==='live'?`<button class="pill-btn" data-action="finish" data-id="${t.id}">Finish</button>`:''}${['draft','open','live'].includes(t.status)?`<button class="pill-btn" data-action="cancel" data-id="${t.id}">Cancel tournament</button>`:''}</article>`).join('');
  $('adminTourList').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{const t=st.admin.find(x=>x.id===b.dataset.edit);$('adminTourId').value=t.id;$('adminTourName').value=t.name;$('adminTourCategory').value=t.category;$('adminTourBase').value=t.base_seconds/60;$('adminTourIncrement').value=t.increment;$('adminTourOpens').value=inputDate(t.registration_opens);$('adminTourCloses').value=inputDate(t.registration_closes);$('adminTourStarts').value=inputDate(t.starts_at);$('adminTourPublished').checked=t.status==='open';$('adminTournamentForm').scrollIntoView({block:'start'});});
  $('adminTourList').querySelectorAll('[data-action]').forEach(b=>b.onclick=async()=>{if(b.dataset.action==='cancel'&&!confirm('Cancel this tournament and stop unfinished matches?'))return;b.disabled=true;try{await rpc('tournament_admin_action',{p_id:b.dataset.id,p_action:b.dataset.action});$('adminTourStatus').textContent='Tournament updated.';await adminRefresh();}catch(e){$('adminTourStatus').textContent=e.message;b.disabled=false;}});
 }catch(e){$('adminTourStatus').textContent=e.message;}}
 async function adminSave(e){e.preventDefault();const form=$('adminTournamentForm'),button=form.querySelector('button[type="submit"]');button.disabled=true;try{
  const config={name:$('adminTourName').value.trim(),category:$('adminTourCategory').value,base_seconds:Number($('adminTourBase').value)*60,increment:Number($('adminTourIncrement').value),registration_opens:new Date($('adminTourOpens').value+'+05:30').toISOString(),registration_closes:new Date($('adminTourCloses').value+'+05:30').toISOString(),starts_at:new Date($('adminTourStarts').value+'+05:30').toISOString(),published:$('adminTourPublished').checked};
  if(config.registration_opens>=config.registration_closes||config.registration_closes>config.starts_at)throw new Error('Registration must open before it closes, and close no later than the start.');
  await rpc('tournament_admin_save',{p_id:$('adminTourId').value||null,p_config:config});resetForm();$('adminTourStatus').textContent='Tournament saved.';await adminRefresh();
 }catch(e){$('adminTourStatus').textContent=e.message;}finally{button.disabled=false;}}
 function handleTourSquare(square){
  if(!square||!canMove()||st.dragFrom)return;
  const now=Date.now();
  if(st.lastDropWasMove&&now-st.lastDrop<400)return;
  if(!st.lastDropWasMove&&square===st.lastDropSquare&&now-st.lastDrop<400)return;
  if(st.selected===square){selectTour(null);return;}
  if(st.model.get(square)?.color===st.model.turn()){selectTour(square);return;}
  if(st.selected){const from=st.selected;selectTour(null);move(from,square);}
 }
 function init(){
  $('modeTournamentBtn').onclick=open;$('adminTournamentForm').onsubmit=adminSave;$('adminTourNew').onclick=resetForm;$('adminTourRefresh').onclick=adminRefresh;
  document.addEventListener('bchess-admin-open',adminRefresh);document.addEventListener('bchess-admin-close',()=>{$('adminTourList').replaceChildren();st.admin=[];});
  $('tourResign').onclick=()=>action('resign');$('tourDraw').onclick=()=>action('offer_draw');$('tourAcceptDraw').onclick=()=>action('accept_draw');
  let lastTouch=0,touchStart=null;
  $('tournamentBoard').addEventListener('contextmenu',e=>e.preventDefault());
  $('tournamentBoard').addEventListener('touchstart',e=>{st.inTouch=true;lastTouch=Date.now();const t=e.changedTouches?.[0],sq=e.target.closest('[data-square]')?.dataset.square;touchStart=t&&sq?{x:t.clientX,y:t.clientY,square:sq}:null;},{capture:true,passive:true});
  $('tournamentBoard').addEventListener('touchend',e=>{lastTouch=Date.now();st.lastTouchEnd=lastTouch;const t=e.changedTouches?.[0];if(touchStart&&t&&Math.hypot(t.clientX-touchStart.x,t.clientY-touchStart.y)>24){touchStart=null;setTimeout(()=>{st.inTouch=false;},0);return;}const hit=t&&document.elementFromPoint?document.elementFromPoint(t.clientX,t.clientY):e.target;const sq=(hit?.closest?.('[data-square]')||e.target.closest?.('[data-square]'))?.dataset.square||touchStart?.square;touchStart=null;handleTourSquare(sq);setTimeout(()=>{st.inTouch=false;},0);},{passive:true});
  $('tournamentBoard').addEventListener('click',e=>{if(Date.now()-lastTouch<450||Date.now()-st.lastTouchEnd<450)return;handleTourSquare(e.target.closest('[data-square]')?.dataset.square);});
  setInterval(()=>{if(st.active)view();},5000);setInterval(clocks,250);window.addEventListener('resize',()=>{if(st.active&&st.board){st.board.resize();selectTour(st.selected);}});
  auth.onAuthStateChanged(user=>{if(!user){window.bchessTournamentActive=false;window.closeTournamentMode();st.game=null;st.id=null;}});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

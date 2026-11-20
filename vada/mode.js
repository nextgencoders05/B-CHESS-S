(() => {
  const $ = id => document.getElementById(id);
  const roles = {King:['e8'],Queen:['d8'],Rook:['a8','h8'],Bishop:['c8','f8'],Knight:['b8','g8'],Pawn:Array.from('abcdefgh',f=>f+'7')};
  const names = 'anbu chandra guna jawa-palani macha rajan senthil thambi velu padma'.split(' ');
  const defaults = {e8:'rajan',d8:'chandra',a8:'velu',h8:'velu',...Object.fromEntries(roles.Pawn.map(s=>[s,'macha']))};
  let assignments={}, roster={}, pending='', audio, generation=0;
  const css=document.head.appendChild(document.createElement('style'));
  function initial(rows) {
    const pieces={};
    for(const [slot,name] of Object.entries(defaults)) pieces[slot]={character_id:name,png:'vada/'+name+'.png'};
    return Object.assign(pieces,rows);
  }
  function positions() {
    const pos=initial(roster);
    for(const m of game.history({verbose:true})){
      const actor=pos[m.from]; delete pos[m.from]; delete pos[m.to];
      if(actor) pos[m.to]=actor;
      if(m.flags.includes('e')) delete pos[m.to[0]+m.from[1]];
      if(m.color==='b' && /[kq]/.test(m.flags)){
        const short=m.flags.includes('k'), from=short?'h8':'a8';
        if(pos[from]) pos[short?'f8':'d8']=pos[from];
        delete pos[from];
      }
    }
    return pos;
  }
  async function load(){
    const result=await window.sb.from('vada_pieces').select('*');
    if(result.error) throw result.error;
    return Object.fromEntries(result.data.map(r=>[r.slot,r]));
  }
  const valid=url=>/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(url)||/^vada\/[a-z-]+\.png$/.test(url);
  window.VC={
    active:false,
    leave(){generation++;$('vcIntro')?.remove();this.active=false;document.body.classList.remove('vc-mode');css.textContent='';audio?.pause();},
    render(){if(!this.active)return;
      const pos=positions();
      css.textContent=game.board().flat().map((piece,i)=>piece && ({...piece,square:"abcdefgh"[i%8]+(8-Math.floor(i/8))})).filter(Boolean).map(p=>{
        const url=pos[p.square]?.png;
        const src=url&&valid(url)?url:'pieces/'+p.color+p.type+'.png';
        return '.vc-mode #myBoard .square-'+p.square+' img[data-piece]{content:url("'+src+'");object-fit:contain}';
      }).join('\n');
    },
    sound(m){if(!this.active||!soundEnabled)return;
      const history=game.history({verbose:true});

      const prior=initial(roster);
      for(const x of history.slice(0,-1)){const a=prior[x.from];delete prior[x.from];delete prior[x.to];if(a)prior[x.to]=a;if(x.color==='b'&&/[kq]/.test(x.flags)){const f=x.flags.includes('k')?'h8':'a8';prior[f==='h8'?'f8':'d8']=prior[f];delete prior[f];}if(x.flags.includes('e'))delete prior[x.to[0]+x.from[1]];}
      const actor=prior[m.from]?.character_id,victim=prior[m.flags.includes('e')?m.to[0]+m.from[1]:m.to]?.character_id;
      const clips=[];
      if(actor==='anbu'&&m.captured&&m.captured!=='p')clips.push(0);
      const fen=game.fen().split(' ');fen[1]=m.color;fen[3]='-';
      const targets=new Set(new Chess(fen.join(' ')).moves({square:m.to,verbose:true}).filter(x=>x.captured).map(x=>x.to));
      const fork=targets.size+(game.in_check()?1:0)>=2;
      if((fork||['r','q'].includes(m.captured))&&actor==='chandra')clips.push(2);
      if((fork||['r','q'].includes(m.captured))&&actor==='macha')clips.push(3);
      if(actor==='padma'&&(fork||game.in_check()))clips.push(4);
      if(m.color==='b'&&game.in_checkmate()&&Object.entries(positions()).some(([s,p])=>p.character_id==='rajan'&&game.get(s)?.type==='k'))clips.push(5);
      if(m.color==='w'&&game.in_check()&&Object.entries(positions()).some(([s,p])=>p.character_id==='rajan'&&game.get(s)?.type==='k'))clips.push(6);
      if(victim==='thambi')clips.push(7);
      if(clips.length){audio?.pause();audio=new Audio('vada/'+clips[Math.floor(Math.random()*clips.length)]+'.mp3');audio.play().catch(()=>{});}
    }
  };
  document.addEventListener('click',async e=>{
    if(e.target.closest('#soundToggleBtn')&&!soundEnabled)audio?.pause();
    if(e.target.closest('#modeBooksBtn,#modePuzzlesBtn,#modeTournamentBtn,#modeHistoryBtn'))VC.leave();
    if(!e.target.closest('#vcEnter'))return;
    if(!currentUserId)return triggerGoogleLogin();
    if(!requireTermsAccepted()||isOnlineMatchActive||quickBot&&!quickBot.over||window.bchessTournamentActive)return;
    setGameMode('bot');const ticket=++generation;
    const intro=document.createElement('div');intro.id='vcIntro';intro.textContent='Entering Vada Chennai Mode…';document.body.append(intro);
    const [rows]=await Promise.all([load().catch(()=>assignments),new Promise(r=>setTimeout(r,matchMedia('(prefers-reduced-motion:reduce)').matches?100:1200))]);
    if(ticket!==generation)return;
    intro.remove();roster=rows;VC.active=true;document.body.classList.add('vc-mode');startNewBotGame();
  });
  function options(id,values){$(id).replaceChildren(...values.map(v=>new Option(v,v)));}
  options('vcCharacter',names);options('vcRole',Object.keys(roles));
  function slots(){const a=roles[$('vcRole').value];options('vcSlot',a.length>1?[...a,'All slots']:a);preview();}
  function draft(){const id=$('vcCharacter').value, png=pending||Object.values(assignments).find(a=>a.character_id===id)?.png||(id!=='padma'?'vada/'+id+'.png':'');
    return ($('vcSlot').value==='All slots'?roles[$('vcRole').value]:[$('vcSlot').value]).map(slot=>({slot,character_id:id,png}));}
  function preview(){const pos=initial(assignments);for(const r of draft())pos[r.slot]=r;
    const chess=new Chess(),cells=[];for(let rank=1;rank<=8;rank++)for(const f of 'hgfedcba'){const s=f+rank,p=chess.get(s),cell=document.createElement('span');cell.className=(f.charCodeAt(0)+rank)%2?'light':'dark';cell.title=s;if(p){const img=new Image();img.src=pos[s]?.png||'pieces/'+p.color+p.type+'.png';cell.append(img);}cells.push(cell);}$('vcPreview').replaceChildren(...cells);}
  $('vcRole').onchange=slots;$('vcCharacter').onchange=$('vcSlot').onchange=preview;slots();
  $('vcAdmin').ontoggle=async()=>{if($('vcAdmin').open)try{assignments=await load();preview();}catch(e){$('vcStatus').textContent=e.message;}};
  $('vcFile').onchange=async()=>{pending='';const f=$('vcFile').files[0];if(!f)return;if(f.type!=='image/png'||f.size>2900000){$('vcStatus').textContent='Choose a PNG under 2.9 MB.';return;}const reader=new FileReader();reader.onload=()=>{pending=reader.result;preview();};reader.readAsDataURL(f);};
  $('vcSave').onclick=async()=>{try{const rows=draft();for(const r of rows){if(!valid(r.png))throw Error('Choose a PNG first.');if(r.png.startsWith('vada/')){const blob=await(await fetch(r.png)).blob();r.png=await new Promise((ok,no)=>{const reader=new FileReader();reader.onload=()=>ok(reader.result);reader.onerror=no;reader.readAsDataURL(blob);});}}
    const res=await window.sb.from('vada_pieces').upsert(rows);if(res.error)throw res.error;assignments=await load();preview();$('vcStatus').textContent='Saved for new games.';}catch(e){$('vcStatus').textContent=e.message;}};
})();

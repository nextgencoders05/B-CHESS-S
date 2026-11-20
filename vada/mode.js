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
  function positions(history=game.history({verbose:true})) {
    const pos=initial(roster);
    for(const m of history){
      const actor=pos[m.from]; delete pos[m.from]; delete pos[m.to];
      if(actor) pos[m.to]=actor;
      if(m.flags.includes('e')) delete pos[m.to[0]+m.from[1]];
      if(/[kq]/.test(m.flags)){
        const rank=m.color==='b'?'8':'1';
        const short=m.flags.includes('k'), from=(short?'h':'a')+rank;
        if(pos[from]) pos[(short?'f':'d')+rank]=pos[from];
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
    leave(){generation++;music.pause();music.removeAttribute('src');music.load();$('vcIntro')?.remove();this.active=false;document.body.classList.remove('vc-mode');css.textContent='';audio?.pause();},
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

      const prior=positions(history.slice(0,-1));
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
    const [rows,track]=await Promise.all([load().catch(()=>assignments),readTrack().catch(()=>defaultTrack),new Promise(r=>setTimeout(r,matchMedia('(prefers-reduced-motion:reduce)').matches?100:1200))]);
    if(ticket!==generation)return;
    intro.remove();roster=rows;VC.active=true;document.body.classList.add('vc-mode');startNewBotGame();music.src=track.url;playMusic();
  });
  function options(id,values){$(id).replaceChildren(...values.map(v=>new Option(v,v)));}
  options('vcCharacter',[...names,'custom']);options('vcRole',Object.keys(roles));
  function roleSlots(){return roles[$('vcRole').value].map(s=>$('vcSide').value==='b'?s:s[0]+(s[1]==='7'?'2':'1'));}
  function slots(){const a=roleSlots();options('vcSlot',a.length>1?[...a,'All slots']:a);preview();}
  function draft(){const id=$('vcCharacter').value, png=pending||(!['custom','padma'].includes(id)?'vada/'+id+'.png':'');
    return ($('vcSlot').value==='All slots'?roleSlots():[$('vcSlot').value]).map(slot=>({slot,character_id:id,png}));}
  function preview(show=true){const pos=initial(assignments);for(const r of show===false?[]:draft())pos[r.slot]=r;
    const chess=new Chess(),cells=[];for(let rank=1;rank<=8;rank++)for(const f of 'hgfedcba'){const s=f+rank,p=chess.get(s),cell=document.createElement('span');cell.className=(f.charCodeAt(0)+rank)%2?'light':'dark';cell.title=s;if(p){const img=new Image();img.src=pos[s]?.png||'pieces/'+p.color+p.type+'.png';cell.append(img);}cells.push(cell);}$('vcPreview').replaceChildren(...cells);}
  $('vcSide').onchange=$('vcRole').onchange=slots;$('vcCharacter').onchange=()=>{clearFile();preview();};$('vcSlot').onchange=preview;slots();
  $('vcAdmin').ontoggle=async()=>{if($('vcAdmin').open)try{assignments=await load();preview(false);}catch(e){$('vcStatus').textContent=e.message;}};
  let version=0;
  function clearFile(){version++;pending='';$('vcFile').value='';$('vcSave').disabled=false;}
  function encode(blob){
    return new Promise((ok,no)=>{const reader=new FileReader();reader.onload=()=>ok(reader.result);reader.onerror=()=>no(Error('Could not read PNG'));reader.readAsDataURL(blob);});
  }
  $('vcFile').onchange=async()=>{
    const ticket=++version,file=$('vcFile').files[0];pending='';$('vcSave').disabled=!!file;
    if(!file){preview();return;}
    try{
      if(file.size>2900000||Array.from(new Uint8Array(await file.slice(0,8).arrayBuffer())).join(',')!=='137,80,78,71,13,10,26,10')throw Error('Choose a PNG under 2.9 MB.');
      const png=await encode(file);
      if(ticket!==version)return;
      pending=png;preview();$('vcSave').disabled=false;$('vcStatus').textContent='Ready to save.';
    }catch(e){if(ticket===version)$('vcStatus').textContent=e.message;}
  };
  $('vcSave').onclick=async()=>{
    const controls=Array.from($('vcAdmin').querySelectorAll('input,select,button'));controls.forEach(c=>c.disabled=true);
    try{
      const rows=draft();let png=rows[0].png;
      if(!valid(png))throw Error('Choose a PNG first.');
      if(png.startsWith('vada/')){
        const r=await fetch(png);if(!r.ok)throw Error('Character image unavailable.');
        png=await encode(new Blob([await r.arrayBuffer()],{type:'image/png'}));
      }
      rows.forEach(r=>r.png=png);
      const res=await sb.from('vada_pieces').upsert(rows,{onConflict:'slot'}).select('slot,character_id,png');
      if(res.error)throw res.error;
      if(!rows.every(r=>res.data?.some(x=>x.slot===r.slot&&x.png===png&&x.character_id===r.character_id)))throw Error('Server did not confirm the assignment.');
      res.data.forEach(r=>assignments[r.slot]=r);clearFile();preview(false);$('vcStatus').textContent='Saved for new games.';
    }catch(e){$('vcStatus').textContent='Save failed: '+e.message;}
    finally{controls.forEach(c=>c.disabled=false);}
  };
  const music=new Audio(),sample=new Audio(),bucket='vada-bgm';
  const defaultTrack={name:'Vada Chennai Mass BGM',url:'vada/default-bgm.mp3'};
  let published=defaultTrack,enabled=localStorage.getItem('vcMusic')!=='off',blocked=false,previewURL='';
  music.loop=true;
  async function readTrack(){
    const {data,error}=await sb.from('vada_music').select('name,path').maybeSingle();
    if(error)throw error;
    return data?{name:data.name,url:sb.storage.from(bucket).getPublicUrl(data.path).data.publicUrl}:defaultTrack;
  }
  function musicLabel(){
    $('vcMusicButton').textContent=enabled&&!blocked?'🔊 BGM':'🔇 BGM';
    $('vcMusicButton').setAttribute('aria-label',enabled&&!blocked?'Mute BGM':'Play BGM');
    $('vcMusicButton').setAttribute('aria-pressed',String(enabled&&!blocked));
  }
  function playMusic(){
    const ticket=generation;blocked=false;musicLabel();
    if(enabled)music.play().catch(()=>{if(ticket===generation){blocked=true;musicLabel();}});
    else music.pause();
  }
  $('vcMusicButton').onclick=()=>{enabled=blocked||!enabled;localStorage.setItem('vcMusic',enabled?'on':'off');playMusic();};
  function stopPreview(){sample.pause();sample.removeAttribute('src');sample.load();if(previewURL)URL.revokeObjectURL(previewURL);previewURL='';}
  $('vcMusicAdmin').ontoggle=async()=>{
    if(!$('vcMusicAdmin').open){stopPreview();return;}
    try{published=await readTrack();$('vcTrackName').textContent=published.name;}
    catch(e){$('vcTrackStatus').textContent=e.message;}
  };
  new MutationObserver(()=>{if($('adminDashboard').style.display==='none')stopPreview();}).observe($('adminDashboard'),{attributes:true,attributeFilter:['style']});
  $('vcTrackFile').onchange=stopPreview;
  $('vcListen').onclick=async()=>{
    if(!sample.paused){stopPreview();return;}
    stopPreview();
    const file=$('vcTrackFile').files[0];
    sample.src=file?(previewURL=URL.createObjectURL(file)):published.url;
    try{await sample.play();}catch(e){$('vcTrackStatus').textContent=e.message;}
  };
  $('vcPublish').onclick=async()=>{
    const file=$('vcTrackFile').files[0],button=$('vcPublish');
    button.disabled=true;
    try{
      if(!file||!file.name.toLowerCase().endsWith('.mp3')||file.size>50*1024*1024)throw Error('Choose an MP3 up to 50 MB.');
      const path=crypto.randomUUID()+'.mp3';
      const upload=await sb.storage.from(bucket).upload(path,file,{contentType:'audio/mpeg'});
      if(upload.error)throw upload.error;
      const save=await sb.from('vada_music').upsert({id:1,name:file.name,path}).select('path').single();
      if(save.error)throw save.error;
      if(save.data.path!==path)throw Error('Server did not confirm the track.');
      published={name:file.name,url:sb.storage.from(bucket).getPublicUrl(path).data.publicUrl};
      $('vcTrackName').textContent=file.name;$('vcTrackStatus').textContent='Saved for new games.';
    }catch(e){$('vcTrackStatus').textContent='Save failed: '+e.message;}
    finally{button.disabled=false;}
  };
})();

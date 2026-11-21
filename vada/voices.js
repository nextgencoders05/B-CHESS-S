const Voice=(()=>{
  const events={first:'First legal move',move:'Every legal move',capture:'Captures a piece',check:'Gives check',mate:'Gives checkmate',taken:'Is captured',forkmajor:'Fork or major-piece capture',forkcheck:'Fork or check',kingmate:'Own side gives checkmate (king)',kingcheck:'King receives check'};
  const targets={p:'Pawn',n:'Knight',b:'Bishop',r:'Rook',q:'Queen'};
  const ranks={King:'e',Queen:'d',Rook:'ah',Bishop:'cf',Knight:'bg',Pawn:'abcdefgh'};
  const builtin=[
    ['anbu','capture','bnqr',0],['chandra','forkmajor','',2],['macha','forkmajor','',3],
    ['padma','forkcheck','',4],['rajan','kingmate','',5],['rajan','kingcheck','',6],
    ['thambi','taken','',7],['thambi','capture','bnqr',8]
  ].map(([speaker,event,targets,n])=>({id:'default-'+n,speaker,event,targets,side:'b',clips:[{name:speaker+' · '+events[event],local:n}],playback:'random',cooldown:0}));
  const bucket='vc-dialogue',seen=new Set(),state=new Map();
  let rules=builtin,activeAudio=null;
  function stop(){activeAudio?.pause();activeAudio=null;}
  function reset(){stop();seen.clear();state.clear();}
  async function load(strict=false){
    try{
      const {data,error}=await sb.from('vc_voice_rules').select('*');
      if(error)throw error;
      const merged=new Map(builtin.map(r=>[r.id,r]));
      data.forEach(r=>merged.set(r.id,r));rules=[...merged.values()];
    }catch(e){if(strict)throw e;}
  }
  function url(clip){return Number.isInteger(clip.local)?'vada/'+clip.local+'.mp3':sb.storage.from(bucket).getPublicUrl(clip.path).data.publicUrl;}
  function move(ctx,enabled){
    const {actor,victim,m,fork,check,mate,king}=ctx;
    const key=m.color+'/'+actor,first=!seen.has(key);seen.add(key);
    if(!enabled)return;
    const eligible=[];
    for(const r of rules){
      const related=r.event==='taken'?victim:['kingmate','kingcheck'].includes(r.event)?king:actor;
      const side=['taken','kingcheck'].includes(r.event)?(m.color==='b'?'w':'b'):m.color;
      if(r.side!==side||r.speaker!==related||!r.clips.length)continue;
      const score={first:first&&6,move:1,capture:m.captured&&(!r.targets||r.targets.includes(m.captured))&&(r.targets?8:5),check:check&&5,mate:mate&&10,taken:9,forkmajor:(fork||['r','q'].includes(m.captured))&&5,forkcheck:(fork||check)&&5,kingmate:mate&&10,kingcheck:check&&!mate&&5}[r.event];
      const previous=state.get(r.id);
      if(score && !(previous && performance.now()-previous.time<1000*r.cooldown))eligible.push({r,score});
    }
    eligible.sort((a,b)=>b.score-a.score);
    if(!eligible.length)return;
    const r=eligible[0].r, seq=state.get(r.id)?.next||0;
    const clip=r.clips[r.playback==='ordered'?seq%r.clips.length:Math.floor(Math.random()*r.clips.length)];
    stop();const sound=new Audio(url(clip));activeAudio=sound;
    sound.play().then(()=>{if(activeAudio===sound)state.set(r.id,{time:performance.now(),next:seq+1});}).catch(()=>{});
  }
  const $=id=>document.getElementById(id);
  const editor=$('voiceEditor');
  editor.innerHTML='<label>Saved rule <select id="vRule"></select></label><label>Side <select id="vSide"><option value="b">Black</option><option value="w">White</option></select></label><label>Piece role <select id="vRole"></select></label><label>Character and slot <select id="vWho"></select></label><label>When should this voice play? <select id="vEvent"></select></label><fieldset id="vTargets"><legend>Which opponent piece?</legend></fieldset><label>Upload MP3 clips <input multiple type="file" accept=".mp3,audio/mpeg" id="vFiles"></label><div id="vList"></div><label>Playback order <select id="vOrder"><option value="random">Random</option><option value="ordered">In order (alternate)</option></select></label><label>Cooldown (seconds) <input id="vDelay" type="number" min="0" step="any" value="0"></label><p id="vSummary"></p><button type="button" id="vSave">Save voice rule</button><p role="status" id="vMsg"></p>';
  function options(el,pairs){el.replaceChildren(...pairs.map(([v,t])=>new Option(t,v)));}
  options($('vRole'),Object.keys(ranks).map(v=>[v,v]));options($('vEvent'),Object.entries(events));
  for(const [v,t] of [['','Any piece'],...Object.entries(targets)]){
    const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=v;input.checked=!v;label.append(input,t);$('vTargets').append(label);
  }
  let roster={},clips=[],original=null;
  const checks=()=>[...$('vTargets').querySelectorAll('input')];
  function slots(role,side){return Array.from(ranks[role],f=>f+(role==='Pawn'?(side==='b'?7:2):(side==='b'?8:1)));}
  function speakers(){
    options($('vWho'),slots($('vRole').value,$('vSide').value).filter(s=>roster[s]).map(s=>[roster[s].character_id,roster[s].character_id+' · '+s]));
    if(original&&!Array.from($('vWho').options).some(o=>o.value===original.speaker))$('vWho').add(new Option(original.speaker+' (saved rule)',original.speaker));
  }
  function filter(){return $('vEvent').value==='capture'?checks().filter(c=>c.checked).map(c=>c.value).sort().join(''):'';}
  function summary(){
    const evt=$('vEvent').value;
    $('vTargets').hidden=evt!=='capture';
    $('vSummary').textContent=[$('vWho').value,$('vSide').selectedOptions[0].text,$('vRole').value,events[evt],evt==='capture'?(Array.from(filter(),v=>targets[v]).join(', ')||'Any piece'):'',$('vOrder').selectedOptions[0].text,$('vDelay').value+' s cooldown'].filter(Boolean).join(' · ');
  }
  function list(){
    $('vList').querySelectorAll('audio').forEach(a=>a.pause());$('vList').replaceChildren();
    clips.forEach((c,i)=>{const row=document.createElement('div'),title=document.createElement('p'),a=document.createElement('audio');title.textContent=(i+1)+'. '+c.name;a.controls=true;a.preload='none';a.src=c.preview||url(c);row.append(title,a);
      if(c.local===undefined){const del=document.createElement('button');del.textContent='Remove';del.onclick=()=>{clips.splice(i,1);if(c.preview)URL.revokeObjectURL(c.preview);list();};row.append(del);}
      $('vList').append(row);});
  }
  function select(){
    original=rules.find(r=>r.id===$('vRule').value);
    clips.forEach(c=>{if(c.preview)URL.revokeObjectURL(c.preview);});clips=original?original.clips.map(c=>({...c})):[];
    if(original){$('vSide').value=original.side;$('vRole').value=Object.keys(ranks).find(k=>slots(k,original.side).some(s=>roster[s]?.character_id===original.speaker))||'King';}
    speakers();if(original)$('vWho').value=original.speaker;
    $('vEvent').value=original?.event||'first';$('vOrder').value=original?.playback||'random';$('vDelay').value=original?.cooldown||0;
    checks().forEach(c=>c.checked=c.value?!!original?.targets.includes(c.value):!original?.targets);$('vFiles').value='';list();summary();
  }
  function menu(id=''){options($('vRule'),[['','New rule'],...rules.map(r=>[r.id,r.side.toUpperCase()+' · '+r.speaker+' · '+events[r.event]+(r.targets?' · '+r.targets:'')])]);$('vRule').value=id;select();}
  $('voiceAdmin').ontoggle=async()=>{if(!$('voiceAdmin').open){$('vList').querySelectorAll('audio').forEach(a=>a.pause());return;}try{roster=await VC.speakers();await load(true);menu();}catch(e){$('vMsg').textContent=e.message;}};
  $('vRule').onchange=select;
  $('vSide').onchange=$('vRole').onchange=()=>{speakers();summary();};
  editor.oninput=summary;
  $('vTargets').onchange=e=>{if(!e.target.value&&e.target.checked)checks().slice(1).forEach(c=>c.checked=false);else checks()[0].checked=!checks().slice(1).some(c=>c.checked);summary();};
  $('vFiles').onchange=()=>{for(const file of $('vFiles').files){if(!file.name.toLowerCase().endsWith('.mp3')||file.size>8388608){$('vMsg').textContent='Use MP3 clips up to 8 MB.';continue;}clips.push({name:file.name,file,preview:URL.createObjectURL(file)});}list();$('vFiles').value='';};
  $('vSave').onclick=async()=>{
    const fields=[...editor.querySelectorAll('input,select,button')];fields.forEach(c=>c.disabled=true);
    try{
      const r={side:$('vSide').value,speaker:$('vWho').value,event:$('vEvent').value,targets:filter(),playback:$('vOrder').value,cooldown:Number($('vDelay').value)};
      if(!r.speaker||!Number.isFinite(r.cooldown)||r.cooldown<0)throw Error('Choose an assigned character and a valid cooldown.');
      const same=rules.find(x=>['side','speaker','event','targets'].every(k=>r[k]===x[k]));
      if(original&&same&&same.id!==original.id)throw Error('This rule already exists. Select it to add more clips.');
      const base=original||same, saved=original?[]:[...(same?.clips||[])];
      for(const c of clips){
        if(c.file&&!c.path){const path=crypto.randomUUID()+'.mp3';const res=await sb.storage.from(bucket).upload(path,c.file,{contentType:'audio/mpeg'});if(res.error)throw res.error;c.path=path;}
        saved.push(c.local===undefined?{name:c.name,path:c.path}:{name:c.name,local:c.local});
      }
      if(!saved.length&&!original)throw Error('Add a clip before saving.');
      Object.assign(r,{id:base?.id||crypto.randomUUID(),clips:saved,revision:(base?.revision||0)+1});
      const table=sb.from('vc_voice_rules'),write=base?.revision?table.update(r).eq('id',r.id).eq('revision',base.revision):table.insert(r);
      const res=await write.select('id').single();if(res.error)throw res.error;
      await load(true);menu(r.id);$('vMsg').textContent='Saved for new matches.';
    }catch(e){$('vMsg').textContent='Save failed: '+e.message;}finally{fields.forEach(c=>c.disabled=false);}
  };
  return {move,reset,stop,load};
})();

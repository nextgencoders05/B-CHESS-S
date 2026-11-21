(()=>{
  const open=document.createElement('button');open.id='openSyndicate';open.hidden=true;document.body.append(open);
  const dialog=document.createElement('dialog');dialog.id='syndicateDialog';dialog.setAttribute('aria-label','Syndicate');document.body.append(dialog);
  dialog.innerHTML='<button type="button" id="synClose" style="float:right" aria-label="Close Syndicate">×</button><h2>Syndicate</h2><section></section><p role="status"></p>';
  const panel=dialog.querySelector('section'),status=dialog.querySelector('[role=status]');
  let token=0;
  function close(){token++;dialog.close();}
  dialog.querySelector('#synClose').onclick=close;dialog.oncancel=()=>{token++;};
  function button(label,fn){const b=document.createElement('button');b.className='pill-btn';b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){status.textContent=e.message;}finally{b.disabled=false;}};return b;}
  function node(tag,str){const el=document.createElement(tag);el.textContent=str;return el;}
  function emblem(){const img=new Image();img.src='pieces/wn.png';img.alt='';return img;}
  async function result(query){const {data,error}=await query;if(error)throw error;return data;}
  async function profile(club){
    const t=++token;status.textContent='Loading members…';const members=await result(sb.rpc('syndicate_members_public',{cid:club.id}));if(t!==token)return;
    const joined=members.some(m=>m.player===currentUserId);
    const action=button(joined?'Joined':'Join Syndicate',async()=>{await result(sb.rpc('syndicate_join',{cid:club.id}));await profile(club);});action.disabled=joined;
    const detail=node('p','');panel.replaceChildren(button('Back to directory',directory),emblem(),node('h3',club.name),node('p',members.length+' members'),action,node('h4','Members'));
    for(const m of members)panel.append(button(m.username,()=>{detail.textContent=m.username+' · '+m.matches+' completed matches';}));
    panel.append(detail);status.textContent='';
  }
  function create(){
    token++;const input=document.createElement('input');input.maxLength=64;input.placeholder='Syndicate name';input.setAttribute('aria-label','Syndicate name');
    const save=button('Create Syndicate',async()=>{const name=input.value.trim();if(!name)throw Error('Enter a Syndicate name.');
      const {data,error}=await sb.rpc('syndicate_create',{title:name});if(error)throw Error(error.code==='23505'?'This Syndicate name is already taken.':error.message);await profile({id:data,name});});
    panel.replaceChildren(button('Back',directory),emblem(),input,save);status.textContent='';input.focus();
  }
  async function directory(){
    const t=++token;panel.replaceChildren();status.textContent='Loading Syndicates…';
    const search=document.createElement('input');search.type='search';search.placeholder='Search Syndicates';search.setAttribute('aria-label',search.placeholder);
    const list=document.createElement('div');let page=0,queryId=0;
    async function refresh(){
      const id=++queryId;let q=sb.from('syndicates').select('id,name,syndicate_members(count)').order('name');
      if(search.value.trim())q=q.ilike('name','%'+search.value.trim()+'%');
      const rows=await result(q.range(page*30,page*30+30));if(t!==token||id!==queryId)return;
      list.replaceChildren();for(const club of rows.slice(0,30)){const row=node('div','');row.append(emblem(),button(club.name,()=>profile(club)),node('span',(club.syndicate_members[0]?.count||0)+' members'));list.append(row);}
      if(!rows.length)list.append(node('p','No Syndicates found.'));
      if(page)list.append(button('Previous',async()=>{page--;await refresh();}));
      if(rows.length>30)list.append(button('Next',async()=>{page++;await refresh();}));status.textContent='';
    }
    search.oninput=()=>{page=0;refresh().catch(e=>status.textContent=e.message);};
    panel.append(button('Create Syndicate',create),search,list);await refresh();
  }
  open.onclick=()=>{if(!currentUserId)return triggerGoogleLogin();dialog.showModal();directory().catch(e=>status.textContent=e.message);};
})();

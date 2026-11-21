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
  function emblem(source){const img=new Image();img.src=source||'pieces/wn.png';img.alt='';return img;}
  async function result(query){const {data,error}=await query;if(error)throw error;return data;}
  async function profile(club){
    const t=++token;status.textContent='Loading members…';const members=await result(sb.rpc('syndicate_members_public',{cid:club.id}));if(t!==token)return;
    const joined=members.some(m=>m.player===currentUserId);
    const action=button(joined?'Joined':'Join Syndicate',async()=>{await result(sb.rpc('syndicate_join',{cid:club.id}));await profile(club);});action.disabled=joined;
    const detail=node('p','');panel.replaceChildren(button('Back to directory',directory),emblem(club.logo),node('h3',club.name),node('p',locationText(club)),node('p',memberCount(members.length)),action,node('h4','Members'));
    for(const m of members){
      const row=node('div','');
      row.append(button(m.username,()=>{detail.textContent=m.username+' · '+m.matches+' completed matches';}));
      if(club.captain===m.player){const badge=node('span','Captain');badge.className='syn-captain';row.append(badge);}
      panel.append(row);
    }
    panel.append(detail);status.textContent='';
  }
  let geography;
  async function catalog(){
    if(geography)return;
    const response=await fetch('locations/catalog.json');
    if(!response.ok)throw Error('Could not load locations. Please retry.');
    geography=await response.json();
  }
  function memberCount(count){return count+' '+(count===1?'member':'members');}
  function locationText(club){
    return [club.district,club.region,geography?.countries[club.country]?.name].filter(Boolean).join(', ');
  }
  function home(){
    token++;status.textContent='';
    panel.replaceChildren(button('Create Syndicate',create),button('Join Syndicate',directory));
  }
  function field(label,control){
    const wrap=node('label',label);
    wrap.append(control);
    return wrap;
  }
  function locationFields(required){
    const box=node('div',''),country=document.createElement('select');
    const regionWrap=node('div',''),districtWrap=node('div','');
    let region,district;
    function select(items){
      const el=document.createElement('select');
      el.add(new Option(required?'Select…':'All',''));
      for(const item of items)el.add(new Option(item,item));
      return el;
    }
    function free(){
      const el=document.createElement('input');el.maxLength=160;
      return el;
    }
    country.add(new Option(required?'Select country…':'All countries',''));
    for(const [code,c] of Object.entries(geography.countries).sort((a,b)=>a[1].name.localeCompare(b[1].name)))
      country.add(new Option(c.name,code));
    function updateDistrict(){
      const tamil=country.value==='IN'&&region.value==='Tamil Nadu';
      district=tamil?select(geography.tamilNadu):free();
      district.disabled=!region.value;
      districtWrap.replaceChildren(field(tamil?'District':'District (where applicable)',district));
    }
    function updateRegion(){
      const states=geography.countries[country.value]?.states||[];
      region=states.length?select(states):free();
      region.disabled=!country.value;
      regionWrap.replaceChildren(field('State or region',region));
      region.oninput=updateDistrict;
      region.onchange=updateDistrict;
      updateDistrict();
    }
    country.onchange=updateRegion;updateRegion();
    box.append(field('Country',country),regionWrap,districtWrap);
    return {box,clear(){country.value='';updateRegion();},values(){
      return {country:country.value,region:region.value.trim(),district:district.value.trim()};
    }};
  }
  async function thumbnail(file){
    if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Choose a PNG, JPEG or WebP picture.');
    const url=URL.createObjectURL(file);
    try{
      const img=new Image();img.src=url;await img.decode();
      const scale=Math.min(1,144/Math.max(img.width,img.height));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      return canvas.toDataURL('image/png');
    }finally{URL.revokeObjectURL(url);}
  }
  async function create(){
    const view=++token;await catalog();if(token!==view)return;
    const input=document.createElement('input');input.maxLength=64;
    const file=document.createElement('input');file.type='file';file.accept='image/jpeg,image/png,image/webp';
    const preview=emblem(),fields=locationFields(true);
    let picture=null,version=0;
    file.onchange=async()=>{
      const attempt=++version;picture=null;preview.src='pieces/wn.png';
      if(!file.files.length)return;
      try{
        const data=await thumbnail(file.files[0]);
        if(attempt===version&&view===token){picture=data;preview.src=data;status.textContent='';}
      }catch(e){if(attempt===version&&view===token)status.textContent=e.message;}
    };
    const save=button('Create Syndicate',async()=>{
      const name=input.value.trim(),place=fields.values();
      if(!name)throw Error('Enter a Syndicate name.');
      if(!picture)throw Error('Choose a logo and wait for its preview.');
      if(!place.country||(geography.countries[place.country].states.length&&!place.region)||
          (place.country==='IN'&&place.region==='Tamil Nadu'&&!place.district))throw Error('Complete your location selection.');
      const club={name,logo:picture,captain:currentUserId,...place};
      const {data,error}=await sb.rpc('syndicate_create_profile',{title:name,picture,nation:place.country,area:place.region,locality:place.district});
      if(error)throw Error(error.code==='23505'?'This Syndicate name is already taken':error.message);
      if(view===token)await profile({...club,id:data});
    });
    panel.replaceChildren(button('Back',home),field('Syndicate name',input),field('Syndicate logo',file),preview,fields.box,save);
    status.textContent='';input.focus();
  }
  async function directory(){
    const t=++token;panel.replaceChildren();status.textContent='Loading Syndicates…';
    await catalog();if(t!==token)return;
    const filters=locationFields(false);let applied={};
    const search=document.createElement('input');search.type='search';search.placeholder='Search Syndicates';search.setAttribute('aria-label',search.placeholder);
    const list=document.createElement('div');let page=0,queryId=0;
    async function refresh(){
      const id=++queryId;let q=sb.from('syndicates').select('id,name,logo,captain,country,region,district,syndicate_members(count)').order('name');
      for(const [field,value] of Object.entries(applied))if(value)q=q.eq(field,value);
      if(search.value.trim())q=q.ilike('name','%'+search.value.trim()+'%');
      const rows=await result(q.range(page*30,page*30+30));if(t!==token||id!==queryId)return;
      list.replaceChildren();for(const club of rows.slice(0,30)){const row=node('div','');row.append(emblem(club.logo),button(club.name,()=>profile(club)),node('span',locationText(club)),node('span',memberCount(club.syndicate_members[0]?.count||0)));list.append(row);}
      if(!rows.length)list.append(node('p','No Syndicates found.'));
      if(page)list.append(button('Previous',async()=>{page--;await refresh();}));
      if(rows.length>30)list.append(button('Next',async()=>{page++;await refresh();}));status.textContent='';
    }
    search.oninput=()=>{page=0;refresh().catch(e=>status.textContent=e.message);};
    panel.append(button('Back',home),filters.box,button('Apply Filters',async()=>{applied=filters.values();page=0;await refresh();}),button('Clear Filters',async()=>{filters.clear();applied={};search.value='';page=0;await refresh();}),search,list);await refresh();
  }
  open.onclick=()=>{if(!currentUserId)return triggerGoogleLogin();dialog.showModal();home();};
})();

(()=>{
  const open=document.createElement('button');open.id='openSyndicate';open.hidden=true;document.body.append(open);
  const dialog=document.createElement('dialog');dialog.id='syndicateDialog';dialog.setAttribute('aria-label','Syndicate');document.body.append(dialog);
  dialog.innerHTML='<button type="button" id="synClose" style="float:right" aria-label="Close Syndicate">×</button><h2>Syndicate</h2><section></section><p role="status"></p>';
  const panel=dialog.querySelector('section'),status=dialog.querySelector('[role=status]');
  let token=0;
  function leaveRoster(){dialog._stopRoster?.();dialog._stopRoster=null;dialog.classList.remove("sr-open");}
  function close(){leaveRoster();token++;dialog.close();}
  dialog.querySelector('#synClose').onclick=close;dialog.oncancel=()=>{leaveRoster();token++;};
  function button(label,fn){const b=document.createElement('button');b.className='pill-btn';b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){status.textContent=e.message;}finally{b.disabled=false;}};return b;}
  function node(tag,str){const el=document.createElement(tag);el.textContent=str;return el;}
  function emblem(source){const img=new Image();img.src=source||'pieces/wn.png';img.alt='';return img;}
  async function result(query){const {data,error}=await query;if(error)throw error;return data;}
  async function profile(club){
    const t=++token;status.textContent='Loading members…';const members=await result(sb.rpc('syndicate_members_public',{cid:club.id}));if(t!==token)return;
    leaveRoster();
    const joined=members.some(m=>m.player===currentUserId);
    const action=button(joined?'Joined':'Join Syndicate',async()=>{await result(sb.rpc('syndicate_join',{cid:club.id}));await profile(club);});action.disabled=joined;
    const root=node('div','');root.className='sr-layout';
    function box(tag,cls,text=''){
      const el=node(tag,text);el.className=cls;return el;
    }
    const rail=box('aside','sr-rail'), roster=box('div','sr-roster');
    const preview=box('article','sr-preview'),overview=box('article','sr-overview');
    const back=button('Back to directory',directory);
    const title=node('h3',club.name), place=locationText(club);
    rail.append(emblem(club.logo),title);
    if(place)rail.append(node('p',place));
    rail.append(node('p',memberCount(members.length)));
    const nav=box('nav','sr-nav');nav.setAttribute('aria-label','Syndicate profile');
    function showOverview(active){
      root.classList.toggle('overview',active);
      root.classList.remove('inspecting');
      overviewBtn.setAttribute('aria-pressed',String(active));
      membersBtn.setAttribute('aria-pressed',String(!active));
    }
    const overviewBtn=button('Overview',()=>showOverview(true));
    const membersBtn=button('Members',()=>showOverview(false));
    nav.append(overviewBtn,membersBtn);rail.append(nav);
    overview.append(node('h3','Overview'),node('p',club.name),node('p',place),node('p',memberCount(members.length)));
    const toolbar=box('div','sr-tools');
    const toggle=button('Details',()=>{
      const expanded=root.classList.toggle('expanded');
      toggle.textContent=expanded?'Done':'Details';
      toggle.setAttribute('aria-expanded',String(expanded));
    });
    toggle.setAttribute('aria-expanded','false');
    toolbar.append(node('h3','Members'),toggle);
    const scroll=box('div','sr-scroll'),heading=box('div','sr-head');
    heading.append(node('strong','Player'),box('strong','sr-stat','Completed matches'));
    scroll.append(heading);roster.append(toolbar,scroll);
    const photos=new Map(),rows=[];
    function avatar(member){
      const face=box('span','sr-avatar',(member.username||'P').charAt(0).toUpperCase());
      function display(src){
        if(!src)return;
        const image=new Image();image.alt='';
        image.onload=()=>face.replaceChildren(image);image.src=src;
      }
      function load(){
        if(!photos.has(member.player)){
          photos.set(member.player, Promise.resolve().then(async()=>{
            const snap=await database.ref('users/'+member.player).once('value');
            const u=snap.val()||{};return u.photoData||u.photo||u.photoURL;
          }).catch(()=>null));
        }
        photos.get(member.player).then(display);
      }
      if(typeof IntersectionObserver==='function'){
        // Load roster avatars only when their row is visible.
        observer.observe(face);loaders.set(face,load);
      }else load();
      return face;
    }
    const loaders=new WeakMap();
    const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
      for(const entry of entries)if(entry.isIntersecting){
        observer.unobserve(entry.target);loaders.get(entry.target)?.();
      }
    }):null;
    dialog._stopRoster=()=>observer?.disconnect();
    const captain=m=>m.player===club.captain;
    function badge(){return box('span','syn-captain','Captain');}
    let selected=-1;
    function select(i,inspect){
      if(selected>=0)rows[selected].setAttribute('aria-pressed','false');
      selected=i;const m=members[i];rows[i].setAttribute('aria-pressed','true');
      const previous=preview.querySelector('.sr-avatar');if(previous)observer?.unobserve(previous);
      const returnBtn=button('Back to members',()=>{
        root.classList.remove('inspecting');rows[selected].focus({preventScroll:true});
      });
      returnBtn.classList.add('sr-return');
      preview.replaceChildren(returnBtn,avatar(m),node('h3',m.username));
      if(captain(m))preview.append(badge());
      preview.append(node('p',m.matches+' completed matches'));
      if(typeof openPlayerProfile==='function')preview.append(button('Open chess profile',()=>{
        close();openPlayerProfile(m.player);
      }));
      if(inspect&&matchMedia('(max-width: 720px)').matches){
        root.classList.add('inspecting');returnBtn.focus({preventScroll:true});
      }
    }
    members.forEach((m,i)=>{
      const row=document.createElement('button');row.type='button';row.className='sr-row';
      const identity=box('span','sr-identity');identity.append(avatar(m),node('strong',m.username));
      if(captain(m))identity.append(badge());
      row.append(identity,box('span','sr-stat',String(m.matches)));
      row.setAttribute('aria-pressed','false');row.onclick=()=>select(i,true);
      rows.push(row);scroll.append(row);
    });
    if(rows.length)select(0,false);else scroll.append(node('p','No members yet.'));
    showOverview(false);
    root.append(rail,roster,preview,overview);
    const controls=box('div','sr-controls');controls.append(back,action);
    panel.replaceChildren(controls,root);dialog.classList.add('sr-open');status.textContent='';

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
    leaveRoster();
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

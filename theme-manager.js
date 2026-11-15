(function(){
 'use strict';const $=id=>document.getElementById(id),required={board:['light','dark'],coins:['wk','wq','wr','wb','wn','wp','bk','bq','br','bb','bn','bp']};
 let themes=[],coinAssets=null,prepared=null,previewURLs=[],loading=null,initialized=false,prepareToken=0;
 const asset=path=>sb.storage.from('bchess-themes').getPublicUrl(path).data.publicUrl;
 function pieceURL(piece){return coinAssets?.[piece.toLowerCase()]?asset(coinAssets[piece.toLowerCase()]):'pieces/'+piece.toLowerCase()+'.png';}
 function paintCoins(){document.querySelectorAll('img[data-piece]').forEach(img=>{img.src=pieceURL(img.dataset.piece);img.onerror=()=>{img.onerror=null;img.src='pieces/'+img.dataset.piece.toLowerCase()+'.png';};});}
 function selectBoard(id,save=true){const theme=themes.find(t=>t.id===id&&t.kind==='board');document.body.classList.toggle('wood-theme',id==='wood');document.body.classList.toggle('remote-board-theme',!!theme);
  for(const key of ['light','dark'])document.documentElement.style.setProperty('--custom-'+key,theme?'url("'+asset(theme.assets[key])+'")':'none');
  if(save)localStorage.setItem('bChessBoard',id);$('boardChoices').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.board===id)));
 }
 function selectCoins(id,save=true){coinAssets=themes.find(t=>t.id===id&&t.kind==='coins')?.assets||null;if(save)localStorage.setItem('bChessCoins',id);paintCoins();$('coinChoices').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.coins===id)));}
 function render(){
  $('boardChoices').replaceChildren();$('coinChoices').replaceChildren();
  const boards=[{id:'green',name:'Green & White',light:'#eeeed2',dark:'#769656'},{id:'wood',name:'Wood & Cream',light:'#f0d9b5',dark:'#b58863'},...themes.filter(t=>t.kind==='board')];
  boards.forEach(t=>{const b=document.createElement('button');b.className='theme-choice pill-btn';b.dataset.board=t.id;const grid=document.createElement('span');grid.className='board-preview';grid.setAttribute('aria-hidden','true');for(let i=0;i<16;i++){const s=document.createElement('i'),key=(Math.floor(i/4)+i)%2?'dark':'light';if(t.assets){s.style.backgroundImage='url("'+asset(t.assets[key])+'")';s.style.backgroundSize='cover';}else s.style.background=t[key];grid.append(s);}b.append(grid,document.createTextNode(t.name));b.onclick=()=>selectBoard(t.id);$('boardChoices').append(b);});
  [{id:'classic',name:'Classic'},...themes.filter(t=>t.kind==='coins')].forEach(t=>{const b=document.createElement('button');b.className='theme-choice pill-btn';b.dataset.coins=t.id;const preview=document.createElement('span');for(const p of ['wk','wq','wn','bk','bq','bn']){const img=document.createElement('img');img.alt='';img.src=t.assets?asset(t.assets[p]):'pieces/'+p+'.png';preview.append(img);}b.append(preview,document.createTextNode(t.name));b.onclick=()=>selectCoins(t.id);$('coinChoices').append(b);});
  const boardId=localStorage.getItem('bChessBoard')||'green',coinId=localStorage.getItem('bChessCoins')||'classic';selectBoard(boards.some(t=>t.id===boardId)?boardId:'green',false);selectCoins(coinId,false);
 }
 async function refresh(){if(loading)return loading;loading=(async()=>{try{const {data,error}=await sb.from('chess_themes').select('*').order('created_at');if(error)throw error;themes=(data||[]).filter(t=>required[t.kind]?.every(k=>typeof t.assets?.[k]==='string'&&t.assets[k]===t.id+'/'+k+'.png'));render();}catch(e){console.warn('Published themes unavailable:',e.message);}})();try{await loading;}finally{loading=null;}}
 function resetPreview(){prepareToken++;prepared=null;$('adminThemePublish').disabled=true;previewURLs.forEach(URL.revokeObjectURL);previewURLs=[];$('adminThemePreview').replaceChildren();}
 function help(){resetPreview();$('adminThemeHelp').textContent=$('adminThemeKind').value==='board'?'Upload exactly light.png and dark.png. Each square texture must be a square PNG, 32–1024 px, at most 512 KB.':'Upload 12 square PNGs: wk, wq, wr, wb, wn, wp, bk, bq, br, bb, bn, bp (each .png). 32–1024 px, at most 512 KB. Transparent backgrounds recommended.';}
 async function normalize(file){if(file.type!=='image/png'||file.size>524288)throw new Error('Use PNG files no larger than 512 KB.');const bitmap=await createImageBitmap(file);try{if(bitmap.width!==bitmap.height||bitmap.width<32||bitmap.width>1024)throw new Error('Each image must be square, 32–1024 pixels.');const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));if(!blob||blob.size>524288)throw new Error('Normalized PNG exceeds 512 KB.');return blob;}finally{bitmap.close();}}
 async function prepare(){resetPreview();const token=prepareToken;$('adminThemeStatus').textContent='Validating images…';const kind=$('adminThemeKind').value,files=Array.from($('adminThemeFiles').files),set={};
  try{if(files.length!==required[kind].length)throw new Error('Upload exactly '+required[kind].length+' files. Required: '+required[kind].join(', '));for(const file of files){const key=file.name.toLowerCase().replace(/\.png$/,'');if(!required[kind].includes(key)||set[key])throw new Error('Unexpected or duplicate filename: '+file.name);set[key]=await normalize(file);}
   if(token!==prepareToken||$('adminThemeKind').value!==kind)return;prepared={kind,files:set};for(const [key,blob]of Object.entries(set)){const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');const url=URL.createObjectURL(blob);previewURLs.push(url);img.src=url;img.alt=key;caption.textContent=key;figure.append(img,caption);$('adminThemePreview').append(figure);}
   $('adminThemeStatus').textContent='Complete set validated. Review the preview, enter a name, then publish.';$('adminThemePublish').disabled=false;
  }catch(e){if(token!==prepareToken)return;$('adminThemeStatus').textContent=e.message;resetPreview();}
 }
 async function publish(){if(!prepared)return;const name=$('adminThemeName').value.trim();if(name.length<2||name.length>60){$('adminThemeStatus').textContent='Enter a name of 2–60 characters.';return;}
  const selected=prepared,upload=crypto.randomUUID(),written=[];$('adminThemePublish').disabled=true;$('adminThemeStatus').textContent='Uploading and publishing…';
  try{const verified=await sbCall('admin_verify_session',{});if(!verified?.admin)throw new Error('Admin required');for(const [key,blob]of Object.entries(selected.files)){const path=auth.currentUser.uid+'/'+upload+'/'+key+'.png';const {error}=await sb.storage.from('bchess-theme-drafts').upload(path,blob,{contentType:'image/png',upsert:false});if(error)throw error;written.push(path);}
   await bchessSecure({action:'publish_theme',upload,kind:selected.kind,name});resetPreview();$('adminThemeFiles').value='';$('adminThemeStatus').textContent='Published. This theme is now available to all players.';await refresh();
  }catch(e){$('adminThemeStatus').textContent=e.message;$('adminThemePublish').disabled=!prepared;}
  finally{if(written.length)await sb.storage.from('bchess-theme-drafts').remove(written).catch(()=>{});}
 }
 function initChoices(){if(initialized)return;initialized=true;render();refresh();}
 function init(){help();$('adminThemeKind').onchange=help;$('adminThemeFiles').onchange=prepare;$('adminThemePublish').onclick=publish;document.addEventListener('bchess-admin-close',resetPreview);setInterval(()=>{if(!$('themePanel').hidden&&$('preferencesModal').style.display!=='none')refresh();},30000);}
 window.BChessThemes={pieceURL,refresh,initChoices};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

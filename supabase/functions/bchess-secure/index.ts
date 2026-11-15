import { createClient } from 'npm:@supabase/supabase-js@2.49.8';
import { Chess } from 'npm:chess.js@1.4.0';
import { adjudicate, validateDecodedPNG } from './rules.mjs';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
 try{
  if(req.method!=='POST')return reply({error:'Use POST'},405);
  const bearer=req.headers.get('Authorization')||'';if(!bearer.startsWith('Bearer '))return reply({error:'Sign in required'},401);
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const userClient=createClient(url,anon,{global:{headers:{Authorization:bearer}},auth:{persistSession:false}});
  const {data:{user},error:authError}=await userClient.auth.getUser(bearer.slice(7));if(authError||!user)return reply({error:'Invalid session'},401);
  const body=await req.text();if(body.length>10000)throw new Error('Request too large');const input=JSON.parse(body);
  const service=createClient(url,secret,{auth:{persistSession:false}});
  if(input.action==='move'){
   const {data:g,error}=await userClient.from('tournament_games').select('*').eq('id',input.game).single();if(error||!g)throw new Error('Match unavailable');
   if(g.version!==input.version)throw new Error('Position changed. Refresh and retry.');
   const verified=adjudicate(Chess,g,user.id,input.move);
   const {data,error:commitError}=await service.rpc('tournament_commit_move',{p_uid:user.id,p_game:g.id,p_version:g.version,p_move:verified.move,p_fen:verified.fen,p_terminal:verified.terminal});
   if(commitError)throw commitError;return reply(data);
  }
  if(input.action==='publish_theme'){
   const {data:admin,error}=await userClient.rpc('admin_verify_session');if(error||!admin?.admin)return reply({error:'Admin required'},403);
   if(!/^[0-9a-f-]{36}$/.test(input.upload)||!['board','coins'].includes(input.kind)||typeof input.name!=='string'||input.name.trim().length<2||input.name.trim().length>60)throw new Error('Invalid theme details');
   const names=input.kind==='board'?['light','dark']:['wk','wq','wr','wb','wn','wp','bk','bq','br','bb','bn','bp'];
   const files=[];for(const name of names){const {data,error}=await service.storage.from('bchess-theme-drafts').download(`${user.id}/${input.upload}/${name}.png`);if(error||!data)throw new Error('Missing asset: '+name+'.png');const bytes=new Uint8Array(await data.arrayBuffer());await validateDecodedPNG(bytes);files.push({name,bytes});}
   const id=crypto.randomUUID(),assets:Record<string,string>={},uploaded:string[]=[];
   try{for(const file of files){const path=`${id}/${file.name}.png`;const {error}=await service.storage.from('bchess-themes').upload(path,file.bytes,{contentType:'image/png',upsert:false});if(error)throw error;assets[file.name]=path;uploaded.push(path);}
    const {error}=await service.rpc('publish_theme_verified',{p_uid:user.id,p_id:id,p_name:input.name.trim(),p_kind:input.kind,p_assets:assets});if(error)throw error;
   }catch(e){if(uploaded.length)await service.storage.from('bchess-themes').remove(uploaded);throw e;}
   await service.storage.from('bchess-theme-drafts').remove(names.map(n=>`${user.id}/${input.upload}/${n}.png`));return reply({id});
  }
  return reply({error:'Unknown action'},400);
 }catch(e){return reply({error:e instanceof Error?e.message:String((e as {message?:string})?.message||'Request failed')},400);}
});

import {createClient} from 'npm:@supabase/supabase-js@2.49.8';
import webpush from 'npm:web-push@3.6.7';

const env=(name:string)=>Deno.env.get(name) || '';
const db=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'));
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type, x-cron-secret','Content-Type':'application/json'};
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
function checked<T>(res:{data:T,error:any}){if(res.error)throw res.error;return res.data;}
const dateKey=(ms:number)=>new Date(ms+19800000).toISOString().slice(0,10);
const general=['One quick game? Your chessboard is ready. ♟️','Got time for a clever opening?','Your next opponent is one game away.'];
const comeback=['Your knight took yesterday off too. Ready to get back on the board? ♞','Your pawns missed you yesterday. Fancy a game?','Your king had a day off. Time for a comeback?'];
function reminder(history:any,previous:string,now:number){
  const days=new Set(Object.values(history||{}).map((x:any)=>Number(x?.playedAt)).filter(t=>Number.isFinite(t)&&t>=now-8*86400000&&t<=now).map(dateKey));
  const options=(days.size>=3&&!days.has(dateKey(now-86400000))?comeback:general).filter(x=>x!==previous);
  return options[Math.floor(Math.random()*options.length)];
}
function valid(sub:any){
  if(!sub?.endpoint || sub.endpoint.length>1800)return false;
  const url=new URL(sub.endpoint);
  return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&
    /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com|web\.push\.apple\.com|[a-z0-9.-]+\.push\.apple\.com)$/.test(url.hostname)&&
    /^[A-Za-z0-9_-]{87}$/.test(sub.keys?.p256dh)&&/^[A-Za-z0-9_-]{22}$/.test(sub.keys?.auth);
}
async function deliver(job:string,recipient:string,sub:any,title:string,body:string){
  const {error}=await db.from('bchess_push_log').insert({job,recipient,message:body});
  if(error?.code==='23505')return;
  if(error)throw error;
  let status='accepted';
  try { await webpush.sendNotification(sub,JSON.stringify({title,body,tag:job}),{TTL:43200,timeout:8000}); }
  catch(e){ status='failed';if([404,410].includes(e.statusCode))checked(await db.from('bchess_push_devices').delete().eq('endpoint',sub.endpoint)); }
  checked(await db.from('bchess_push_log').update({status}).eq('job',job).eq('recipient',recipient));
}
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{headers});
  try{
    const input=await req.json();
    if(input.action==='daily'){
      if(!env('PUSH_CRON_SECRET')||req.headers.get('x-cron-secret')!==env('PUSH_CRON_SECRET'))return reply({error:'Forbidden'},403);
    }else{
      const token=req.headers.get('Authorization')||'';
      const caller=createClient(env('SUPABASE_URL'),env('SUPABASE_ANON_KEY'),{global:{headers:{Authorization:token}}});
      const {data:{user}}=await caller.auth.getUser(token.replace(/^Bearer /i,''));
      if(!user)return reply({error:'Sign in required'},401);
      if(input.action==='key')return reply({key:env('VAPID_PUBLIC_KEY')});
      if(input.action==='register'){
        if(!valid(input.subscription))return reply({error:'Unsupported subscription'},400);
        checked(await db.from('bchess_push_devices').upsert({endpoint:input.subscription.endpoint,user_id:user.id,subscription:input.subscription,updated_at:new Date().toISOString()}));
        return reply({ok:true});
      }
      if(input.action!=='broadcast'||!checked(await caller.rpc('is_admin')))return reply({error:'Admin required'},403);
    }
    webpush.setVapidDetails(env('VAPID_SUBJECT'),env('VAPID_PUBLIC_KEY'),env('VAPID_PRIVATE_KEY'));
    if(input.action==='daily'){
      const now=Date.now(),ist=new Date(now+19800000).toISOString();
      if(ist.slice(11,16)<(env('REMINDER_TIME_IST')||'19:00'))return reply({waiting:true});
      const job='daily-'+dateKey(now);
      const rows=checked(await db.rpc('bchess_daily_targets',{p_job:job}));
      await Promise.all(rows.map(r=>deliver(job,r.recipient,r.subscription,'B Chess',reminder(r.history,r.previous,now))));
      return reply({processed:rows.length});
    }
    const {title,body,id,cursor}=input;
    if(typeof title!=='string'||!title.trim()||title.length>100||typeof body!=='string'||!body.trim()||body.length>500||!/^[a-f0-9-]{36}$/i.test(id))return reply({error:'Invalid broadcast'},400);
    const job='broadcast-'+id;
    const rows=checked(await db.from('bchess_push_devices').select('endpoint,subscription').gt('endpoint',cursor||'').order('endpoint').limit(40));
    await Promise.all(rows.map(r=>deliver(job,r.endpoint,r.subscription,title,body)));
    const counts=await Promise.all(['accepted','failed','pending'].map(async status=>{
      const r=await db.from('bchess_push_log').select('*',{count:'exact',head:true}).eq('job',job).eq('status',status);
      checked(r);return r.count;
    }));
    return reply({next:rows.length===40?rows.at(-1).endpoint:null,accepted:counts[0],failed:counts[1],pending:counts[2]});
  }catch(e){console.error('Push operation failed',e.code||e.name);return reply({error:'Push operation failed. Check deployment settings and retry.'},500);}
});

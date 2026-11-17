const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('assert');
(async()=>{
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.uid',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
 await db.exec(fs.readFileSync(__dirname+'/../supabase/schema.sql','utf8').replace('create extension if not exists pgcrypto;','').replace(/do \$\$\ndeclare t text;[\s\S]*?end \$\$;/,''));
 const sql=fs.readFileSync(__dirname+'/../supabase/friend_requests_update.sql','utf8');await db.exec(sql);await db.exec(sql);
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333';
 for(const [id,name]of [[a,'Alice'],[b,'Bob'],[c,'Other']])await db.query('insert into rtdb(doc,data) values($1,$2)', ['users/'+id,JSON.stringify({username:name,rating:1000,matchHistory:{keep:true}})]);
 const user=async id=>db.exec(`reset role;select set_config('request.uid','${id}',false);set role authenticated;`);
 const call=(id,action,key=null)=>db.query('select bchess_friend_request($1,$2,$3) result',[id,action,key]);
 const profile=async id=>(await db.query('select data from rtdb where doc=$1',['users/'+id])).rows[0].data;
 await user(a);await assert.rejects(call(a,'send'));await call(b,'send');const outgoing=(await profile(a)).friendRequests.outgoing[b];await call(b,'send');assert.equal((await profile(a)).friendRequests.outgoing[b].id,outgoing.id);
 await assert.rejects(db.query('select rtdb_apply($1)',[JSON.stringify([{d:'users/'+a,p:['friends',c],v:{username:'forged'}}])]),/Protected profile field/);
 await user(b);const req=(await profile(b)).friendRequests.incoming[a];assert.equal(req.fromName,'Alice');assert.equal(req.id,outgoing.id);await assert.rejects(call(a,'accept','stale'));await call(a,'accept',req.id);await call(a,'accept',req.id);assert.equal((await profile(b)).friends[a].username,'Alice');assert.equal((await profile(b)).friendRequests,undefined);
 await user(a);assert.equal((await profile(a)).friends[b].username,'Bob');assert.deepEqual((await profile(a)).matchHistory,{keep:true});
 await call(c,'send');await user(c);const pending=(await profile(c)).friendRequests.incoming[a];await call(a,'decline',pending.id);assert(!(await profile(c)).friends);await user(a);assert(!(await profile(a)).friendRequests);
 await db.exec("reset role;set role anon");await assert.rejects(call(b,'send'));
 await db.close();console.log('PASS friend SQL migration twice, authentication, send/dedupe, persisted inbox, stale action rejection, reciprocal accept, decline and existing history preservation.');
})().catch(e=>{console.error(e);process.exit(1)});

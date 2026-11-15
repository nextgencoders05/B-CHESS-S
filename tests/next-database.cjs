const {PGlite}=require('@electric-sql/pglite');const fs=require('fs');const assert=require('assert');
(async()=>{const db=new PGlite();await db.exec(`create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.uid',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql as $$select jsonb_build_object('email',current_setting('request.email',true))$$;
grant usage on schema auth to authenticated,anon; grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
let schema=fs.readFileSync(__dirname+'/../supabase/schema.sql','utf8').replace('create extension if not exists pgcrypto;','').replace(/do \$\$\ndeclare t text;[\s\S]*?end \$\$;/,'');await db.exec(schema);
const migration=fs.readFileSync(__dirname+'/../supabase/five_updates_migration.sql','utf8');await db.exec(migration);await db.exec(migration);
const next=fs.readFileSync(__dirname+'/../supabase/next_update_migration.sql','utf8');
await db.exec('create role service_role; alter table auth.users add column email text;');
await db.exec(next);await db.exec(next);
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
await db.exec(`insert into auth.users(id,raw_user_meta_data) values('${a}','{}'),('${b}','{}');`);
async function user(id,admin=false){await db.exec(`reset role;select set_config('request.uid','${id}',false),set_config('request.email','${admin?'datathon2025x@gmail.com':'player@example.com'}',false);set role authenticated;`);}
async function call(fn,args=[]){return (await db.query('select '+fn+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as result',args)).rows[0].result;}
const fen='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const entries=Array.from({length:100},(_,i)=>({fen:fen.replace('0 1','0 '+(i+1)),solution:['e2e4','e7e5','g1f3']}));
await user(a,true);let preview=await call('admin_preview_puzzles',[JSON.stringify(entries)]);assert.equal(preview.stages.length,100);assert.equal(preview.stages[99].stage,100);
assert.equal((await call('admin_publish_puzzles',[JSON.stringify(entries)])).added,100);
assert.equal((await call('admin_publish_puzzles',[JSON.stringify(entries)])).skipped,100);
const repeated=Array.from({length:100},()=>entries[0]);const repeatedPreview=await call('admin_preview_puzzles',[JSON.stringify(repeated)]);assert.equal(new Set(repeatedPreview.stages.map(s=>s.stage)).size,100);
await assert.rejects(call('admin_publish_puzzles',[JSON.stringify([{fen:'invalid',solution:['e2e4']}])]));
await user(b);await assert.rejects(call('admin_publish_puzzles',[JSON.stringify(entries)]));let stages=await call('get_puzzle_stages');assert.equal(stages.puzzles.length,100);
await assert.rejects(call('complete_puzzle',[stages.puzzles[1].id,JSON.stringify(entries[1].solution)]));
await assert.rejects(call('complete_puzzle',[stages.puzzles[0].id,'["e2e4"]']));
await call('complete_puzzle',[stages.puzzles[0].id,JSON.stringify(entries[0].solution)]);
assert.equal((await call('get_puzzle_stages')).completed.length,1);
await user(a);assert.equal((await db.query('select * from puzzle_progress')).rows.length,0);
await assert.rejects(db.query(`insert into puzzle_progress(user_id,puzzle_id) values($1,$2)`,[a,stages.puzzles[1].id]));
const sa='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sb='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
assert.equal((await call('quick_match_search',[sa,'10+5'])).status,'waiting');
await user(b);assert.equal((await call('quick_match_search',[sb,'3+0'])).status,'waiting');
assert.equal((await call('quick_match_resolve',[sb,true])).status,'cancelled');
assert.equal((await call('quick_match_search',[sb,'3+0'])).status,'cancelled');
await user(a);assert.equal((await call('quick_match_resolve',[sa,false])).status,'bot');
assert.equal((await call('quick_match_search',[sa,'10+5'])).status,'bot');
const sc='cccccccc-cccc-4ccc-8ccc-cccccccccccc',sd='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
assert.equal((await call('quick_match_search',[sc,'10+5'])).status,'waiting');
await user(b);const matched=await call('quick_match_search',[sd,'10+5']);assert.equal(matched.status,'matched');
await user(a);const resolved=await call('quick_match_resolve',[sc,false]);assert.equal(resolved.status,'matched');assert.equal(resolved.roomCode,matched.roomCode);
const room=(await db.query('select data from rtdb where doc=$1',['rooms/'+matched.roomCode])).rows[0].data;assert.equal(room.increment,5);assert.equal(room.timeControl,600);
await db.exec(`reset role;update rtdb set data=data||'{"gameOver":true}'::jsonb where doc like 'rooms/%';`);
await user(a);const late='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
assert.equal((await call('quick_match_search',[late,'5+0',Date.now()-1000])).status,'expired');
await user(b);assert.equal((await call('quick_match_search',['ffffffff-ffff-4fff-8fff-ffffffffffff','5+0'])).status,'waiting');
await user(a);assert.equal((await call('quick_match_resolve',[late,false])).status,'bot');
console.log('PASS original SQL regression suite.');
// Username constraints also cover direct RTDB writes.
await db.exec(`reset role;insert into rtdb(doc,data) values('users/${a}','{"username":" Bharathi "}'),('users/${b}','{"username":"Jana"}');`);
await assert.rejects(db.exec(`update rtdb set data=jsonb_set(data,'{username}','"bharathi"') where doc='users/${b}'`));
await db.exec(`update rtdb set data=jsonb_set(data,'{username}','"Bharathi"') where doc='users/${a}'`);
await user(b);let all=await call('get_puzzle_stages');const first=all.puzzles[0];
const attempt='00000000-0000-4000-8000-000000000001';
assert.equal((await call('puzzle_hint',[first.id,attempt,0])).remaining,2);
assert.equal((await call('puzzle_hint',[first.id,attempt,0])).remaining,2);
assert.equal((await call('puzzle_hint',[first.id,attempt,2])).remaining,1);
assert.equal((await call('puzzle_hint',[first.id,'00000000-0000-4000-8000-000000000002',0])).remaining,0);
await assert.rejects(call('puzzle_hint',[first.id,'00000000-0000-4000-8000-000000000003',0]));
assert.equal((await call('puzzle_hint_status')).remaining,0);
await assert.rejects(call('admin_delete_puzzles',[[first.id],null]));
await user(a,true);const published=await call('admin_puzzle_list');assert(published[0].batch_id);
await call('admin_delete_puzzles',[[published[1].id,published[2].id],null]);
await user(b);all=await call('get_puzzle_stages');assert.equal(all.puzzles[1].stage,2);assert(all.completed.includes(first.id));
await call('complete_puzzle',[all.puzzles[1].id,JSON.stringify(entries[2].solution)]);
await user(a,true);await call('admin_delete_puzzles',[null,published[0].batch_id]);assert.equal((await call('admin_puzzle_list')).length,0);
console.log('PASS unique usernames, daily hints/repeats/exhaustion, admin deletion, contiguous stages, remaining progress, batch deletion.');
// Round robin with three users: 3 rounds, 3 real pairs and 3 rest byes.
const c='33333333-3333-4333-8333-333333333333';await db.exec(`reset role;insert into auth.users(id,raw_user_meta_data) values('${c}','{}');`);
await user(a,true);const now=Date.now();const config={name:'Test Blitz',category:'Blitz',base_seconds:180,increment:2,registration_opens:new Date(now-60000),registration_closes:new Date(now+60000),starts_at:new Date(now+120000),published:true};
const tid=await call('tournament_admin_save',[null,JSON.stringify(config)]);
for(const uid of [a,b,c]){await user(uid);await call('tournament_join',[tid]);await call('tournament_join',[tid]);}
await user(b);await assert.rejects(call('tournament_admin_action',[tid,'start']));await assert.rejects(call('tournament_commit_move',[b,a,0,'e4',fen,null]));
await db.exec(`reset role;update tournaments set registration_opens=now()-interval '2 hours',registration_closes=now()-interval '1 hour',starts_at=now()-interval '30 minutes' where id='${tid}';`);
await user(a,true);await call('tournament_admin_action',[tid,'start']);await call('tournament_admin_action',[tid,'start']);let tv=await call('tournament_view',[tid]);assert.equal(tv.games.length,6);assert.equal(tv.entries.length,3);
assert.equal(new Set(tv.games.filter(g=>g.white_id&&g.black_id).map(g=>[g.white_id,g.black_id].sort().join())).size,3);
await user(a);await assert.rejects(call('quick_match_search',['abababab-abab-4bab-8bab-abababababab','5+0']));
let g=tv.games.find(g=>g.status==='active');await user(g.white_id);await call('tournament_game_action',[g.id,'heartbeat']);await user(g.black_id);g=await call('tournament_game_action',[g.id,'heartbeat']);assert(g.clock_at);
const {Chess}=require('chess.js');const {adjudicate}=await import('../supabase/functions/bchess-secure/rules.mjs');
assert.throws(()=>adjudicate(Chess,g,g.black_id,{from:'e7',to:'e5'}));assert.throws(()=>adjudicate(Chess,g,g.white_id,{from:'e2',to:'e5'}));
const legal=adjudicate(Chess,g,g.white_id,{from:'e2',to:'e4'});await db.exec('reset role;set role service_role;');const moved=await call('tournament_commit_move',[g.white_id,g.id,g.version,legal.move,legal.fen,legal.terminal]);assert(moved.white_left>180);assert.equal(moved.moves.length,1);
await assert.rejects(call('tournament_commit_move',[g.white_id,g.id,g.version,legal.move,legal.fen,null]));
await user(g.white_id);await call('tournament_game_action',[g.id,'offer_draw']);await assert.rejects(call('tournament_game_action',[g.id,'accept_draw']));await user(g.black_id);await call('tournament_game_action',[g.id,'accept_draw']);
tv=await call('tournament_view',[tid]);assert.equal(tv.standings.filter(e=>Number(e.points)===0.5).length,2);
while(tv.tournament.status==='live'){const active=tv.games.find(x=>x.status==='active');assert(active);await user(active.white_id);await call('tournament_game_action',[active.id,'resign']);tv=await call('tournament_view',[tid]);}
assert.equal(tv.tournament.status,'completed');assert.equal(tv.games.filter(x=>x.result==='bye').length,3);assert(tv.standings[0].points>=tv.standings[1].points);
console.log('PASS tournament registration idempotency, round-robin pairs/byes, admin permissions, legal-move authority, version races, increment, draw acceptance, resignations, automatic rounds, standings and finish.');

// Hint day rollover uses database time; parallel submitted requests cannot overdraw.
await user(a,true);await call('admin_publish_puzzles',[JSON.stringify([entries[0]])]);const hp=(await call('get_puzzle_stages')).puzzles[0];
await user(b);assert.equal((await call('puzzle_hint_status')).remaining,0); // deletion did not refund hints
await assert.rejects(db.query('select * from puzzle_hint_usage'));
await db.exec(`reset role;update puzzle_hint_usage set day=(clock_timestamp() at time zone 'Asia/Kolkata')::date-1 where user_id='${b}';`);
await user(b);assert.equal((await call('puzzle_hint_status')).remaining,3);
const attempts=await Promise.allSettled(Array.from({length:5},(_,i)=>call('puzzle_hint',[hp.id,'00000000-0000-4000-8000-'+String(i+10).padStart(12,'0'),0])));
assert.equal(attempts.filter(r=>r.status==='fulfilled').length,3);assert.equal((await call('puzzle_hint_status')).remaining,0);
await db.exec('reset role;');await assert.rejects(db.query(`update rtdb set data=jsonb_set(data,'{username}',to_jsonb(E'\\tBHARATHI\\n'::text)) where doc=$1`,['users/'+b]));
// Additional two-player rounds: timeout, disconnect, double absence, cancellation.
async function readyTournament(){await user(a,true);const id=await call('tournament_admin_save',[null,JSON.stringify({...config,name:'Lifecycle'})]);for(const u of [a,b]){await user(u);await call('tournament_join',[id]);}await db.exec(`reset role;update tournaments set registration_opens=now()-interval '2 hours',registration_closes=now()-interval '1 hour',starts_at=now()-interval '30 minutes' where id='${id}';`);await user(a,true);await call('tournament_admin_action',[id,'start']);return (await call('tournament_view',[id]));}
for(const reason of ['timeout','disconnect','double_forfeit']){let x=await readyTournament(),game=x.games[0];await db.exec('reset role;');
 const state=reason==='timeout'?`clock_at=clock_timestamp()-interval '200 seconds',white_seen=clock_timestamp(),black_seen=clock_timestamp()`:
 reason==='disconnect'?`white_seen=clock_timestamp()-interval '61 seconds',black_seen=clock_timestamp()`: `started_at=clock_timestamp()-interval '61 seconds'`;
 await db.exec(`update tournament_games set ${state} where id='${game.id}';`);await user(a);x=await call('tournament_view',[x.tournament.id]);assert.equal(x.games[0].result,reason);assert.equal(x.tournament.status,'completed');}
let cancelled=await readyTournament();await user(a,true);await call('tournament_admin_action',[cancelled.tournament.id,'cancel']);assert.equal((await call('tournament_view',[cancelled.tournament.id])).tournament.status,'cancelled');
// Storage policy syntax and permissions with the same metadata interface as Storage.
await db.exec(`reset role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;`);
const storage=fs.readFileSync(__dirname+'/../supabase/theme_storage.sql','utf8');await db.exec(storage);await db.exec(storage);
await user(a,true);await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['bchess-theme-drafts',a+'/upload/wk.png']);await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['bchess-themes','public/wk.png']));
await user(b);assert.equal((await db.query('select * from storage.objects')).rows.length,0);await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['bchess-theme-drafts',b+'/upload/wk.png']));
await assert.rejects(call('publish_theme_verified',[b,b,'Denied','board','{}']));
await db.exec(`reset role;update auth.users set email='datathon2025x@gmail.com' where id='${a}';set role service_role;`);
await assert.rejects(call('publish_theme_verified',[a,a,'Incomplete','coins','{}']));await call('publish_theme_verified',[a,a,'Board','board',JSON.stringify({light:a+'/light.png',dark:a+'/dark.png'})]);
await user(b);assert.equal((await db.query('select * from chess_themes')).rows.length,1);
console.log('PASS server-day reset, parallel hint requests, whitespace conflicts, timeout/disconnect/double-forfeit/cancellation, storage policy permissions and published catalog visibility.');
await db.exec('reset role;');
await db.query(`insert into rtdb(doc,data) values($1,'{"username":"OtherName"}') on conflict(doc) do nothing`,['users/'+c]);
const simultaneous=await Promise.allSettled([b,c].map(id=>db.query(`update rtdb set data=jsonb_set(data,'{username}','"ConcurrentClaim"'::jsonb) where doc=$1`,['users/'+id])));assert.equal(simultaneous.filter(r=>r.status==='fulfilled').length,1);
await db.exec('drop index bchess_unique_username;');await db.query(`update rtdb set data=jsonb_set(data,'{username}','"bharathi"'::jsonb) where doc=$1`,['users/'+b]);
const duplicateReport=await db.query(fs.readFileSync(__dirname+'/../supabase/username_preflight.sql','utf8'));assert.equal(duplicateReport.rows.length,1);
await assert.rejects(db.exec(next));await db.exec('rollback;');assert.equal((await db.query('select data from rtdb where doc=$1',['users/'+b])).rows[0].data.username,'bharathi');await db.query(`update rtdb set data=jsonb_set(data,'{username}','"Jana"'::jsonb) where doc=$1`,['users/'+b]);await db.exec(next);
console.log('PASS competing username claims and duplicate preflight stops migration without renaming accounts.');
await db.close();})().catch(e=>{console.error(e.message,e.detail||'',e.position||'');process.exit(1)});

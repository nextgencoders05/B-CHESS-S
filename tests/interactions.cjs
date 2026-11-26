const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');const assert=require('assert');const FakeTimers=require('@sinonjs/fake-timers');
const base=require('path').resolve(__dirname,'..')+'/';
async function fixture(width=1440, saved={}){
 const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(fs.readFileSync(base+'index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''),{url:'https://test.invalid/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});const w=dom.window; w.eval=code=>require('vm').runInContext(code,dom.getInternalVMContext());
 Object.defineProperty(w,'innerWidth',{value:width});w.matchMedia=()=>({matches:width<=700,addEventListener(){}});w.alert=()=>{};w.confirm=()=>true;w.fetch=async()=>({ok:false});w.URL.createObjectURL=()=>'';w.URL.revokeObjectURL=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
 const authCallbacks=[];
 const auth={currentUser:{uid:'test-user',email:'admin@test',getIdToken:async()=>''},onAuthStateChanged(cb){authCallbacks.push(cb);},getRedirectResult:()=>Promise.resolve(),signOut:()=>{throw Error('Unexpected sign out')}};
 const snap={val:()=>null,exists:()=>false,forEach(){}};const ref={on(){},off(){},once:()=>Promise.resolve(snap),set:()=>Promise.resolve(),update:()=>Promise.resolve(),remove:()=>Promise.resolve(),transaction:()=>Promise.resolve({committed:true,snapshot:snap}),onDisconnect:()=>({remove:()=>Promise.resolve(),cancel:()=>Promise.resolve()})};
 w.firebase={auth:()=>auth,database:()=>({ref:()=>ref})};w.firebase.database.ServerValue={TIMESTAMP:{'.sv':'timestamp'}};
 const query={select(){return this},order(){return this},eq(){return this},in(){return this},maybeSingle(){return Promise.resolve({data:null})},then(resolve){return Promise.resolve({data:[]}).then(resolve)}};
 w.sb={from:()=>Object.create(query),channel:()=>({on(){return this},subscribe(){return this}}),removeChannel(){}};
 w.sbCall=async(name)=>name==='admin_verify_session'?{admin:true,email:'admin@test'}:['admin_puzzle_list','tournament_list'].includes(name)?[]:name==='puzzle_hint_status'?{remaining:3}:{status:'waiting'};
 for(const [k,v]of Object.entries(saved))w.localStorage.setItem(k,v);
 w.localStorage.setItem('bChessTermsAcceptedVersion','1.0');
 w.eval(fs.readFileSync(require.resolve('jquery'),'utf8'));w.eval(fs.readFileSync(__dirname+'/vendor/chess.min.js','utf8'));w.eval(fs.readFileSync(__dirname+'/vendor/chessboard.min.js','utf8'));
 for(const name of ['books_data.js','engine-loader.js','script.js','ux.js','features.js','next-core.js','move-badges.js','puzzles.js','theme-manager.js','tournaments.js','preferences.js','interaction-update.js'])w.eval(fs.readFileSync(base+name,'utf8'));
 await new Promise(r=>w.$(()=>w.setTimeout(r,0)));w.eval("currentUserId='test-user';currentUserRating=1370;currentUserName='Test';");
 const clock=FakeTimers.withGlobal(w).install({now:Date.now(),shouldClearNativeTimers:true,toFake:['Date','setTimeout','clearTimeout','setInterval','clearInterval']});
 return {w,clock,errors,authCallbacks,close(){clock.uninstall();dom.window.close();}};
}
module.exports={fixture};
if(require.main===module)(async()=>{
 for(const width of [1440,390]){
  const t=await fixture(width);const {w}=t;const click=id=>w.document.getElementById(id).click();
  click('appMenuBtn');assert.equal(w.document.getElementById('appMenu').hidden,false);click('settingsMenuBtn');click('soundToggleBtn');click('arrowToggleBtn');await Promise.resolve();
  assert.equal(w.localStorage.getItem('bChessSound'),'off');assert.equal(w.document.getElementById('soundToggleBtn').textContent,'Sound — Off');assert.equal(w.localStorage.getItem('bChessArrows'),'off');
  click('preferencesClose');click('appMenuBtn');click('themeBtn');
  w.eval("game.move('e4');board.position(game.fen());board.orientation('black');");const fen=w.eval('game.fen()');
  w.document.querySelector('[data-board="wood"]').click();assert(w.document.body.classList.contains('wood-theme'));assert.equal(w.eval('game.fen()'),fen);assert.equal(w.eval('board.orientation()'),'black');
  click('preferencesClose');w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowUp',ctrlKey:true,bubbles:true}));await t.clock.tickAsync(0);
  assert.equal(w.document.getElementById('adminDashboard').style.display,'flex');click('adminDashClose');assert.equal(w.document.getElementById('adminDashboard').style.display,'none');assert.equal(w.eval('auth.currentUser.uid'),'test-user');assert.equal(w.eval('game.fen()'),fen);
  assert.equal(w.document.querySelectorAll('#uxNav > button').length,9);assert.equal(w.document.getElementById('appMenuBtn').closest('.top-bar')!==null,true);
  const saved=Object.fromEntries(Object.keys(w.localStorage).map(k=>[k,w.localStorage.getItem(k)]));assert.deepEqual(t.errors,[]);t.close();
  const reload=await fixture(width,saved);assert.equal(reload.w.eval('soundEnabled'),false);assert.equal(reload.w.eval('showBestMoveArrow'),false);assert(reload.w.document.body.classList.contains('wood-theme'));assert.equal(reload.w.localStorage.getItem('bChessCoins')||'classic','classic');reload.close();
 }
 console.log('PASS DOM desktop/mobile configurations: header menu, settings immediate/persistent, theme position/orientation preservation, refresh, admin close without signout, navigation.');
 const t=await fixture();const {w,clock}=t;let calls=[];
 w.sbCall=async(name,args)=>{calls.push(name);return name==='quick_match_resolve'?{status:'bot'}:{status:'waiting'};};
 w.openQuickMatchPage();w.document.querySelector('[data-qm-time="10+5"]').click();w.document.querySelector('[data-qm-time="10+5"]').click();
 await clock.tickAsync(29999);assert.equal(w.eval('quickBot'),null);await clock.tickAsync(2);assert.equal(w.eval('quickBot.tc'),600);assert.equal(w.eval('quickBot.increment'),5);assert.equal(w.eval('botRating'),1400);assert(w.eval('quickBot.name').includes('(Bot)'));assert.equal(calls.filter(x=>x==='quick_match_resolve').length,1);
 // Control clock and moves without real-time engine work.
 w.eval("quickBot.clock={w:600,b:600,turn:'w',startedAt:Date.now()};game.reset();game.move('e4');quickBotAfterMove();");assert.equal(w.eval('quickBot.clock.w'),605);
 w.eval("game.move('e5');quickBotAfterMove();");assert.equal(w.eval('quickBot.clock.b'),605);w.eval("finishQuickBotGame('draw',null)");assert(w.document.getElementById('resultRematchBtn').textContent.includes('New Quick Match'));w.document.getElementById('resultRematchBtn').click();await clock.tickAsync(0);assert.equal(w.document.getElementById('friendMatchResultPanel').style.display,'none');assert.equal(w.eval('quickBot'),null);t.close();
 const cancel=await fixture();let resolved=0;cancel.w.sbCall=async n=>n==='quick_match_resolve'?(resolved++,{status:'cancelled'}):{status:'waiting'};
 cancel.w.openQuickMatchPage();cancel.w.document.querySelector('[data-qm-time="3+2"]').click();await cancel.clock.tickAsync(500);cancel.w.document.getElementById('qmCancelBtn').click();await cancel.clock.tickAsync(40000);assert.equal(cancel.w.eval('quickBot'),null);assert.equal(resolved,1);cancel.close();
 // A human result returned during cutoff resolution must win without a bot.
 const near=await fixture();near.w.sbCall=async n=>n==='quick_match_resolve'?{status:'matched',roomCode:'QM-near',color:'w',opponent:{name:'Human',rating:1400},timeControl:'10+5'}:{status:'waiting'};
 near.w.openQuickMatchPage();near.w.document.querySelector('[data-qm-time="10+5"]').click();await near.clock.tickAsync(30001);assert.equal(near.w.eval('quickBot'),null);assert(near.w.document.body.textContent.includes('Match found!'));near.close();
 const race=await fixture();let release, resolving=false;
 race.w.sbCall=(n,a)=>{if(n==='quick_match_search')return Promise.resolve({status:'waiting'});if(a.p_cancel)return Promise.resolve({status:'cancelled'});resolving=true;return new Promise(r=>release=r);};
 race.w.openQuickMatchPage();race.w.document.querySelector('[data-qm-time="10+0"]').click();await race.clock.tickAsync(30001);assert(resolving);race.w.document.getElementById('qmCancelBtn').click();await race.clock.tickAsync(0);release({status:'bot'});await race.clock.tickAsync(0);assert.equal(race.w.eval('quickBot'),null);race.close();
 console.log('PASS timed flow: immediate card search, duplicate tap guard, 30-second fallback, closest Elo, Bot label, both increments, cancellation never starts bot.');
 const p=await fixture();const parser=p.w.BChessPuzzleImport;
 const start='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
 assert.equal(parser.parseImport('1. e4 e5 2. Nf3 *','pgn')[0].solution.join(' '),'e2e4 e7e5 g1f3');
 assert.equal(parser.parseImport('[Event "A"]\n\n1. e4 e5 *\n\n[Event "B"]\n\n1. d4 d5 *','pgn').length,2);
 assert.equal(parser.parseImport(start+' | e2e4 e7e5\n'+start+' | d2d4 d7d5','fen').length,2);
 assert(parser.parseImport(start+' | e2e5','fen')[0].error);assert(parser.parseImport('8/8/8/8/8/8/8/8 w - - 0 1 | e2e4','fen')[0].error);
 const custom='[SetUp "1"]\n[FEN "7k/8/8/8/8/8/4K3/8 b - - 0 1"]\n\n1... Kg7 *';assert.equal(parser.parseImport(custom,'pgn')[0].solution[0],'h8g7');
 let completed=[];p.w.sbCall=async(name,args)=>{if(name==='get_puzzle_stages')return {puzzles:[{id:'one',stage:1,fen:start,solution:['e2e4','e7e5','g1f3']},{id:'two',stage:2,fen:start,solution:['d2d4']}],completed};if(name==='complete_puzzle'){completed.push(args.p_id);return {completed:true}};return {status:'cancelled'};};
 p.w.document.getElementById('modePuzzlesBtn').click();await p.clock.tickAsync(0);let buttons=p.w.document.querySelectorAll('#puzzleStages button');assert.equal(buttons[1].disabled,true);
 const sq=s=>p.w.document.querySelector('#puzzleBoard [data-square="'+s+'"]').click();sq('d2');sq('d4');await p.clock.tickAsync(0);assert(p.w.document.getElementById('puzzleStatus').textContent.includes('try again'));
 sq('e2');sq('e4');await p.clock.tickAsync(450);sq('g1');sq('f3');await p.clock.tickAsync(0);assert.equal(completed.length,1);assert.equal(p.w.document.querySelectorAll('#puzzleStages button')[1].disabled,false);
 p.w.closePuzzleMode();p.w.document.getElementById('modePuzzlesBtn').click();await p.clock.tickAsync(0);assert(p.w.document.getElementById('puzzleStatus').textContent.includes('Your turn'));assert.deepEqual(p.errors,[]);p.close();
 console.log('PASS puzzles: PGN and FEN parsing, bulk order, invalid positions/moves, black-to-move FEN, wrong move retry, automatic reply, completion/unlock, resume.');
})().catch(e=>{console.error(e);process.exit(1)});

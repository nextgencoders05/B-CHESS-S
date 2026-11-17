/* Browser rendering and input checks against mocked backend data; no live account access. */
const {chromium}=require('playwright'),fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert');
const base=path.resolve(__dirname,'..');
const stub=`
window.alert=()=>{};window.confirm=()=>true;localStorage.setItem('bChessTermsAcceptedVersion','1.0');
window.__inbox={};window.__inboxCallback=null;
const snap=()=>({val:()=>null,exists:()=>false,forEach(){}});
const ref={on(){},off(){},once:async()=>snap(),set:async()=>{},update:async()=>{},remove:async()=>{},onDisconnect:()=>({remove:async()=>{},cancel:async()=>{}})};
const inboxRef={on:(e,cb)=>window.__inboxCallback=cb,off(){},once:async()=>({val:()=>window.__inbox})};
const auth={currentUser:{uid:'test-user',getIdToken:async()=>''},onAuthStateChanged(){},getRedirectResult:async()=>null};
window.firebase={auth:()=>auth,database:()=>({ref:p=>p?.endsWith('/friendRequests/incoming')?inboxRef:ref})};firebase.database.ServerValue={TIMESTAMP:{'.sv':'timestamp'}};
const query={select(){return this},order(){return this},eq(){return this},in(){return this},maybeSingle:async()=>({data:null}),then:r=>Promise.resolve({data:[]}).then(r)};
window.sb={from:()=>Object.create(query),channel:()=>({on(){return this},subscribe(){return this}}),removeChannel(){}};
window.__completed=[];
window.sbCall=async(n,a)=>{if(n==='get_puzzle_stages')return {puzzles:Array.from({length:100},(_,i)=>({id:'p'+i,stage:i+1,fen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',solution:['e2e4']})),completed:window.__completed};if(n==='complete_puzzle'){window.__completed.push(a.p_id);return {}}if(n==='puzzle_hint_status')return {remaining:3};return []};
`;
(async()=>{
 const server=http.createServer((req,res)=>{let file=path.join(base,decodeURIComponent(req.url.split('?')[0]));if(req.url==='/')file=path.join(base,'index.html');if(!file.startsWith(base)){res.writeHead(403);return res.end()}try{const bytes=fs.readFileSync(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');res.end(bytes)}catch(_){res.writeHead(404);res.end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
 try{for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<600,serviceWorkers:'block'});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{const u=route.request().url();
   if(u.endsWith('/supabase-compat.js'))return route.fulfill({contentType:'text/javascript',body:stub});
   if(u.includes('jquery-3.7.1'))return route.fulfill({path:require.resolve('jquery'),contentType:'text/javascript'});
   if(u.includes('/chess.js/'))return route.fulfill({path:path.join(__dirname,'vendor/chess.min.js'),contentType:'text/javascript'});
   if(u.includes('chessboard-1.0.0.min.'))return route.fulfill({path:path.join(__dirname,u.endsWith('.css')?'vendor/chessboard.min.css':'vendor/chessboard.min.js'),contentType:u.endsWith('.css')?'text/css':'text/javascript'});
   if(!u.startsWith(origin))return route.fulfill({body:'',contentType:'text/javascript'});
   return route.continue();
  });
  await page.goto(origin);await page.waitForFunction(()=>window.BChessPremove&&window.BChessPuzzleImport);
  await page.evaluate(()=>{currentUserId='test-user';currentUserName='Test';document.getElementById('modePuzzlesBtn').click()});
  await page.waitForSelector('.journey-stage');assert.equal(await page.locator('.journey-stage').count(),100);
  const geometry=await page.evaluate(()=>{const b=document.getElementById('puzzleBoard').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,board:[b.width,b.height],cells:[...document.querySelectorAll('#puzzleBoard [data-square]')].map(e=>{const r=e.getBoundingClientRect();return [r.width,r.height]})}});
  assert(!geometry.overflow,JSON.stringify({width,geometry}));assert(Math.abs(geometry.board[0]-geometry.board[1])<3);assert(geometry.cells.every(([a,b])=>Math.abs(a-b)<1));
  await page.locator('#puzzleBoard [data-square="e2"]').click();await page.locator('#puzzleBoard [data-square="e4"]').click();await page.waitForFunction(()=>window.__completed.length===1);
  await page.waitForSelector('#puzzleCompletionScreen:not([hidden])');
  await page.locator('#puzzleNextBtn').click();
  const from=await page.locator('#puzzleBoard [data-square="e2"]').boundingBox(),to=await page.locator('#puzzleBoard [data-square="e4"]').boundingBox();
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(to.x+to.width/2,to.y+to.height/2,{steps:10});await page.mouse.up();await page.waitForFunction(()=>window.__completed.length===2);
  await page.evaluate(()=>{window.__inbox={Alice:{id:'a',fromName:'Alice'}};window.__inboxCallback({val:()=>window.__inbox})});
  await page.waitForSelector('#friendRequestToast');const overlap=await page.evaluate(()=>{const t=document.getElementById('friendRequestToast').getBoundingClientRect(),b=document.getElementById('puzzleBoard').getBoundingClientRect();return t.bottom>b.top&&t.top<b.bottom});assert(!overlap);
  assert.deepEqual(errors,[]);console.log('PASS Chromium '+width+'px: 100 stages, square board/cells, no horizontal overflow, real click and drag solution input, completion screen and Next Puzzle transition, non-overlapping popup.');await context.close();
 }}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1)});

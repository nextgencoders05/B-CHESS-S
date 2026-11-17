const {fixture}=require('./interactions.cjs');const assert=require('assert');
(async()=>{
 const t=await fixture(),{w,clock}=t;let release,calls=0;
 w.eval("currentMode='friend';currentRoomCode='TEST';myOnlineColor='w';friendTimeControl=0;friendRoomData={guestId:'other',gameFen:'start',moveHistory:[]};game.reset();");
 w.bchessSecure=()=>{calls++;return new Promise(r=>release=r)};
 assert.equal(w.eval("applyHumanMove('e2','e4')"),true);
 assert.equal(w.eval('game.history().length'),0,'history waits for server');
 assert.equal(w.eval('board.position().e4'),'wP','immediate preview');
 w.eval('onSnapEnd()');assert.equal(w.eval('board.position().e4'),'wP');
 w.eval("syncOnlinePosition({moveHistory:[]})");assert.equal(w.eval('board.position().e4'),'wP');
 w.eval("applyHumanMove('d2','d4')");assert.equal(calls,1);
 const g=new w.Chess();g.move('e4');release({guestId:'other',moveHistory:['e4'],gameFen:g.fen()});await clock.tickAsync(0);
 assert.equal(w.eval('game.history().join()'),'e4');assert.equal(w.eval('pendingOnlineMove'),null);
 w.eval("syncOnlinePosition({moveHistory:[]})");assert.equal(w.eval('game.history().length'),1);
 w.eval("game.reset();friendRoomData={guestId:'other',gameFen:'start',moveHistory:[]}");w.bchessSecure=async()=>{throw Error('rejected')};w.eval("applyHumanMove('e2','e4')");await clock.tickAsync(0);assert.equal(w.eval('board.position().e2'),'wP');assert.equal(w.eval('game.history().length'),0);
 w.bchessSecure=()=>new Promise(()=>{});w.eval("applyHumanMove('e2','e4')");await clock.tickAsync(15001);assert.equal(w.eval('pendingOnlineMove'),null);assert.equal(w.eval('board.position().e2'),'wP');
 console.log('PASS optimistic online preview, snapback suppression, duplicate guard, authoritative commit, stale snapshot, rejection and timeout rollback.');
 w.eval("currentRoomCode=null;currentMode='bot';playerColor='w';isBotThinking=false;checkBotTrigger=()=>{};game.reset();game.move('e4');");
 assert(!w.BChessPremove.waiting());w.document.getElementById('premoveToggleBtn').click();assert(w.BChessPremove.waiting());assert.equal(w.localStorage.getItem('bChessPremove'),'on');
 w.eval("handleSquareClick('g1');handleSquareClick('f3')");assert(!w.document.getElementById('premoveStatus').hidden);
 w.eval("executeBotMove('e7e5')");await clock.tickAsync(0);assert.equal(w.eval('game.history().join()'),'e4,e5,Nf3');
 // Queue and cancel, then replace and discard illegal move.
 w.eval("handleSquareClick('f3');handleSquareClick('g5')");w.document.querySelector('#premoveStatus button').click();assert(w.document.getElementById('premoveStatus').hidden);
 w.eval("handleSquareClick('f3');handleSquareClick('g5');handleSquareClick('d2');handleSquareClick('d8');executeBotMove('b8c6')");await clock.tickAsync(0);assert.equal(w.eval('game.history().length'),4);
 // A dragged premove uses the same validator.
 w.eval("game.move('d4');onDragStart('f3','wN');onDrop('f3','g5');executeBotMove('g8f6')");await clock.tickAsync(0);assert.equal(w.eval('game.history().at(-1)'),'Ng5');
 // Promotion choice is deferred to the existing modal, then legally executed.
 w.eval("BChessPremove.clear();game.load('7k/P7/8/8/8/8/8/7K b - - 0 1');handleSquareClick('a7');handleSquareClick('a8')");assert.equal(w.document.getElementById('promotionModal').style.display,'flex');w.eval("finishPromotionChoice('n');executeBotMove('h8g7')");await clock.tickAsync(0);assert.equal(w.eval("game.get('a8').type"),'n');
 // Online premove waits for opponent update and submits once.
 w.eval("BChessPremove.clear();game.reset();game.move('e4');currentMode='friend';currentRoomCode='QMtest';myOnlineColor='w';friendRoomData={guestId:'other',gameFen:game.fen(),moveHistory:['e4']};handleSquareClick('g1');handleSquareClick('f3')");let req;w.bchessSecure=async body=>{req=body;const c=new w.Chess();['e4','e5','Nf3'].forEach(m=>c.move(m));return {guestId:'other',moveHistory:c.history(),gameFen:c.fen()}};
 w.eval("friendRoomData={guestId:'other',gameFen:'saved-fen',moveHistory:['e4','e5']};syncOnlinePosition(friendRoomData)");await clock.tickAsync(0);assert.equal(req.move.from,'g1');assert.equal(req.ply,2);assert.equal(req.before,'saved-fen');assert.equal(w.eval('game.history().length'),3);
 w.eval("cleanupFriendGame(false)");assert(w.document.getElementById('premoveStatus').hidden);assert.deepEqual(t.errors,[]);t.close();
 console.log('PASS premove opt-in/persistence, click, drag, cancel, replace, invalid discard, promotion, bot and online path.');
 // Real DOM input and stable stage identity, using explicitly mocked RPC data.
 const p=await fixture(390),pw=p.w;const start=new pw.Chess().fen();let complete=[];let puzzles=Array.from({length:100},(_,i)=>({id:'p'+i,stage:i+1,fen:start,solution:['e2e4']}));
 pw.sbCall=async(n,a)=>{if(n==='get_puzzle_stages')return {puzzles,completed:complete};if(n==='complete_puzzle'){complete.push(a.p_id);return {}};return {remaining:3}};
 pw.document.getElementById('modePuzzlesBtn').click();await p.clock.tickAsync(0);assert.equal(pw.document.querySelectorAll('.journey-stage').length,100);
 const sq=s=>pw.document.querySelector('#puzzleBoard [data-square="'+s+'"]').click();sq('d2');assert(pw.document.querySelector('[data-square="d2"].puzzle-selected'));sq('e2');assert(pw.document.querySelector('[data-square="e2"].puzzle-selected'));sq('e2');assert(!pw.document.querySelector('.puzzle-selected'));sq('e2');sq('e4');await p.clock.tickAsync(0);assert.deepEqual(complete,['p0']);assert(pw.document.querySelector('[data-puzzle-id="p0"]').classList.contains('completed'));assert.equal(pw.document.querySelector('[aria-current="step"]').dataset.puzzleId,'p1');
 puzzles=puzzles.slice(1);pw.closePuzzleMode();pw.document.getElementById('modePuzzlesBtn').click();await p.clock.tickAsync(0);assert(!pw.document.querySelector('[data-puzzle-id="p0"]'));assert(!pw.document.querySelector('[data-puzzle-id="p1"]').classList.contains('completed'));assert.deepEqual(p.errors,[]);p.close();
 console.log('PASS 100-stage map, selection/reselection/deselection, solution submission, current marker and stable IDs after deletion (mock RPC).');
})().catch(e=>{console.error(e);process.exit(1)});

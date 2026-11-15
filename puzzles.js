/* Puzzles use their own board/game so opening the mode never rewrites a match. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const rpc = (name,args) => window.sbCall(name,args);
  const state = { active:false, generation:0, list:[], completed:new Set(), board:null, game:null, puzzle:null, index:0, selected:null, busy:false, moves:[], preview:null, attempt:null, hints:0, hintBusy:false };
  function message(text) { $('puzzleStatus').textContent = text; updateTurn(); }
  function updateTurn(){
    const el=$('puzzleTurn');if(!state.puzzle||!state.game){el.textContent='Select an available stage';return;}
    const color=state.game.turn()==='w'?'White':'Black';el.replaceChildren();const token=document.createElement('span');token.className='turn-token '+color.toLowerCase();token.setAttribute('aria-hidden','true');el.append(token,document.createTextNode('Stage '+state.puzzle.stage+' • '+color+' to move'));
    $('puzzleHintBtn').disabled=state.hintBusy||state.busy||state.hints<=0||state.index>=state.puzzle.solution.length;
  }
  function clearHint(){document.querySelectorAll('#puzzleBoard .puzzle-hint-square').forEach(x=>x.classList.remove('puzzle-hint-square'));}
  async function hintStatus(){try{const r=await rpc('puzzle_hint_status',{});state.hints=r.remaining;$('puzzleHintCount').textContent='Hints left today: '+r.remaining+'/3';$('puzzleHintBtn').title=r.remaining?'Highlight the piece to move':'Available again at midnight IST';updateTurn();}catch(e){$('puzzleHintCount').textContent='Hints unavailable: '+e.message;}}
  async function hint(){if(!state.puzzle||state.busy||state.hintBusy||state.hints<=0)return;const generation=state.generation;state.hintBusy=true;updateTurn();
    try{const r=await rpc('puzzle_hint',{p_id:state.puzzle.id,p_attempt:state.attempt,p_ply:state.index});if(generation!==state.generation||!state.active)return;state.hints=r.remaining;$('puzzleHintCount').textContent='Hints left today: '+r.remaining+'/3';clearHint();document.querySelector('#puzzleBoard [data-square="'+r.source+'"]').classList.add('puzzle-hint-square');message('Hint: move the highlighted piece.');}
    catch(e){if(generation===state.generation)message(e.message);await hintStatus();}finally{state.hintBusy=false;updateTurn();}
  }
  let adminPuzzles=[],miniBoards=[];
  async function adminList(){
    try{adminPuzzles=await rpc('admin_puzzle_list',{});miniBoards.forEach(b=>b.destroy());miniBoards=[];$('adminPuzzleList').replaceChildren();$('adminPuzzleBatches').replaceChildren();
    adminPuzzles.forEach(p=>{const card=document.createElement('article');card.className='admin-puzzle-card';const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.value=p.id;box.className='puzzle-select';label.append(box,document.createTextNode(' Stage '+p.stage));const preview=document.createElement('div');preview.id='admin-puzzle-'+p.id;preview.className='admin-puzzle-preview';const del=document.createElement('button');del.className='pill-btn resign-danger-btn';del.textContent='Delete';del.onclick=()=>deletePuzzles([p.id]);card.append(label,preview,del);$('adminPuzzleList').append(card);miniBoards.push(Chessboard(preview.id,{position:p.fen,draggable:false,pieceTheme:PIECE_IMG_URL}));});
    const batches=[...new Set(adminPuzzles.map(p=>p.batch_id).filter(Boolean))];batches.forEach(id=>{const group=adminPuzzles.filter(p=>p.batch_id===id),button=document.createElement('button');button.className='pill-btn';button.textContent='Delete batch '+id.slice(0,8)+' ('+group.length+' stages)';button.onclick=()=>deletePuzzles(group.map(p=>p.id),id);$('adminPuzzleBatches').append(button);});
    $('adminPuzzleMessage').textContent=adminPuzzles.length+' published puzzles. Earlier uploads without batch IDs can be selected individually.';
    }catch(e){$('adminPuzzleMessage').textContent=e.message;}
  }
  async function deletePuzzles(ids,batch=null){if(!ids.length){$('adminPuzzleMessage').textContent='Select puzzles first.';return;}const stages=adminPuzzles.filter(p=>ids.includes(p.id)).map(p=>p.stage);if(!confirm('Delete '+ids.length+' puzzle(s): stages '+stages.join(', ')+'? Only these puzzles and their progress will be removed. Remaining progress is preserved.'))return;
    try{await rpc('admin_delete_puzzles',{p_ids:batch?null:ids,p_batch:batch});await adminList();if(state.active)await refreshActive();}catch(e){$('adminPuzzleMessage').textContent=e.message;}
  }
  async function refreshActive(){if(!state.active)return;const generation=state.generation;try{const r=await rpc('get_puzzle_stages',{});if(!state.active||generation!==state.generation)return;state.list=r.puzzles;state.completed=new Set(r.completed);
    if(state.puzzle){const found=state.list.find(p=>p.id===state.puzzle.id);if(!found){state.generation++;state.puzzle=null;state.busy=false;state.board?.position('empty',false);window.BChessBadges?.clear('puzzleBoard');message('This puzzle was deleted. Choose an available stage.');}else state.puzzle.stage=found.stage;}
    renderStages();updateTurn();}catch(_){} }

  function strictPosition(fen) {
    const chess = new Chess();
    if (!chess.load(fen)) throw new Error('Invalid FEN: expected all six position fields.');
    const pieces = chess.board().flat().filter(Boolean);
    for (const color of ['w','b']) if (pieces.filter(p=>p.color===color && p.type==='k').length!==1) throw new Error('Position must have one king of each color.');
    if (pieces.filter(p=>p.color==='w').length>16 || pieces.filter(p=>p.color==='b').length>16) throw new Error('Too many pieces.');
    for (const color of ['w','b']) if (pieces.filter(p=>p.color===color && p.type==='p').length>8) throw new Error('Too many pawns.');
    const fields = fen.split(/\s+/);
    for (const [flag, king, rook, color] of [['K','e1','h1','w'],['Q','e1','a1','w'],['k','e8','h8','b'],['q','e8','a8','b']]) {
      if (fields[2].includes(flag) && (chess.get(king)?.type!=='k' || chess.get(king)?.color!==color || chess.get(rook)?.type!=='r' || chess.get(rook)?.color!==color)) throw new Error('Castling rights do not match the pieces.');
    }
    if (fields[3]!=='-') {
      const ep = fields[3], pawnSquare = ep[0]+(fields[1]==='w'?'5':'4');
      if (ep[1] !== (fields[1]==='w'?'6':'3') || chess.get(ep) || chess.get(pawnSquare)?.type!=='p' || chess.get(pawnSquare)?.color===fields[1]) throw new Error('Invalid en passant square.');
    }
    const rows = chess.board();
    if ([...rows[0],...rows[7]].some(p=>p && p.type==='p')) throw new Error('Pawns cannot start on the first or eighth rank.');
    // Side that just moved cannot leave its own king in check.
    const opposite = fen.split(/\s+/); opposite[1] = opposite[1]==='w'?'b':'w'; opposite[3]='-';
    const previous = new Chess(opposite.join(' '));
    if (previous.in_check()) throw new Error('Illegal position: the side that just moved is in check.');
    return chess;
  }
  function moveToken(chess,token) {
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(token)) return chess.move({from:token.slice(0,2),to:token.slice(2,4),promotion:token[4]});
    return chess.move(token,{sloppy:true});
  }
  function tokens(text) {
    return String(text).replace(/\{[^}]*\}/g,' ').replace(/;[^\n]*/g,' ').replace(/\d+\.(\.\.)?/g,' ').trim().split(/\s+/).filter(t=>t && !['1-0','0-1','1/2-1/2','*'].includes(t));
  }
  function validate(fen,solution) {
    const chess = strictPosition(fen), start = chess.fen(), uci=[];
    const moves = Array.isArray(solution)?solution:tokens(solution);
    if (!moves.length) throw new Error('Solution moves are required.');
    for (const token of moves) {
      const m = moveToken(chess,String(token));
      if (!m) throw new Error('Illegal solution move '+(uci.length+1)+': '+token);
      uci.push(m.from+m.to+(m.promotion||''));
    }
    return {fen:start,solution:uci};
  }
  function parsePGN(text) {
    const chess = new Chess();
    if (!chess.load_pgn(text,{sloppy:true})) throw new Error('Invalid PGN or illegal move.');
    const history = chess.history({verbose:true});
    if (!history.length) throw new Error('PGN has no solution moves.');
    while(chess.undo()) {}
    return validate(chess.fen(),history.map(m=>m.from+m.to+(m.promotion||'')));
  }
  function entries(text,format,solution) {
    if(format==='fen') {
      if (text.trim().startsWith('[')) return JSON.parse(text).map(e=>({fen:e.fen,solution:e.solution}));
      return text.split(/\n/).filter(l=>l.trim()).map(line=>{const parts=line.split('|');return {fen:parts[0].trim(),solution:(parts[1]||solution||'').trim()};});
    }
    // A result marker closes a headerless game. Header blocks can have any first tag.
    const chunks=text.trim().split(/\n\s*---\s*\n|(?<=1-0|0-1|1\/2-1\/2|\*)\s*(?=\[|\d+\.)|\n\s*\n(?=\[(?:Event|FEN)\s)/).filter(x=>x.trim());
    return chunks.map(pgn=>({pgn}));
  }
  function parseImport(text,format,solution) {
    let raw; try { raw=entries(text,format,solution); if(!Array.isArray(raw)||!raw.length) throw new Error('No entries found.'); }
    catch(e) {return [{error:e.message}];}
    return raw.map(entry=>{try{return entry.pgn?parsePGN(entry.pgn):validate(entry.fen,entry.solution);}catch(e){return {error:e.message};}});
  }
  window.BChessPuzzleImport = {parseImport,validate};
  async function preview() {
    $('puzzlePublishBtn').disabled=true; state.preview=null;
    $('puzzleImportStatus').textContent='Validating…';
    try {
      const rows=parseImport($('puzzleSource').value,$('puzzleFormat').value,$('puzzleSolution').value);
      const valid=rows.filter(r=>!r.error);
      if(valid.length>1000) throw new Error('Import at most 1,000 stages at a time.');
      const result=valid.length?await rpc('admin_preview_puzzles',{p_entries:valid}):{stages:[]};
      $('puzzleImportPreview').replaceChildren(); let i=0;
      rows.forEach((r,n)=>{
        const li=document.createElement('li');
        if(r.error) li.textContent='Entry '+(n+1)+' — Invalid: '+r.error;
        else {const stage=result.stages[i++]; li.textContent='Entry '+(n+1)+' → Stage '+stage.stage+(stage.existing?' (already imported; skipped)':' (new)');}
        $('puzzleImportPreview').append(li);
      });
      state.preview=valid;
      $('puzzleImportStatus').textContent=valid.length+' valid, '+(rows.length-valid.length)+' invalid. Only valid entries will be published in the supplied order.';
      $('puzzlePublishBtn').disabled=!valid.length;
    } catch(e) {$('puzzleImportStatus').textContent=e.message;}
  }
  async function publish() {
    if(!state.preview) return;
    const batch=state.preview; $('puzzlePublishBtn').disabled=true;
    try {
      const result=await rpc('admin_publish_puzzles',{p_entries:batch});
      $('puzzleImportStatus').textContent='Published '+result.added+' new stages. '+result.skipped+' duplicates skipped. Refresh preview for current stage numbers.';
      state.preview=null;await adminList();
    } catch(e) {$('puzzleImportStatus').textContent=e.message; $('puzzlePublishBtn').disabled=false;}
  }
  function invalidate() {state.preview=null;$('puzzlePublishBtn').disabled=true;$('puzzleImportPreview').replaceChildren();}
  window.clearPuzzleAdmin = () => {invalidate();$('puzzleSource').value='';$('puzzleSolution').value='';$('puzzleFiles').value='';$('puzzleImportStatus').textContent='';};
  function renderStages() {
    $('puzzleStages').replaceChildren();
    state.list.forEach((p,i)=>{
      const done=state.completed.has(p.id), available=i===0||state.completed.has(state.list[i-1].id);
      const button=document.createElement('button'); button.className='pill-btn'; button.disabled=!available;
      button.textContent='Stage '+p.stage+' '+(done?'✓ Completed':available?'• Available':'🔒 Locked');
      button.setAttribute('aria-pressed',String(state.puzzle && state.puzzle.id===p.id));
      button.onclick=()=>start(p);$('puzzleStages').append(button);
    });
  }
  function start(puzzle,newAttempt=false) {
    const key='bChessAttempt:'+currentUserId+':'+puzzle.id;
    state.attempt=!newAttempt&&sessionStorage.getItem(key)||crypto.randomUUID();sessionStorage.setItem(key,state.attempt);
    clearHint();window.BChessBadges?.clear('puzzleBoard');
    state.generation++; state.puzzle=puzzle; state.game=new Chess(puzzle.fen);state.index=0;state.moves=[];state.busy=false;state.selected=null;
    if(!state.board) state.board=Chessboard('puzzleBoard',{draggable:true,position:puzzle.fen,pieceTheme:PIECE_IMG_URL,
      onDragStart:(source,piece)=>!state.busy && state.active && piece[0]===state.game.turn(),
      onDrop:(from,to)=>{attempt(from,to);return 'snapback';},onSnapEnd:()=>state.board.position(state.game.fen())});
    state.board.orientation(state.game.turn()==='w'?'white':'black');state.board.position(puzzle.fen,false);state.board.resize();
    message('Your turn.');renderStages();hintStatus();
  }
  async function attempt(from,to) {
    if(state.busy||!state.active||!state.puzzle||state.index>=state.puzzle.solution.length) return;
    const generation=state.generation, p=state.puzzle, chess=state.game;
    let promotion;
    if(chess.get(from)?.type==='p' && /[18]$/.test(to)) {
      state.busy=true;
      promotion=await new Promise(resolve=>{
        const cancel=()=>resolve(null);
        $('cancelPromotionBtn').addEventListener('click',cancel,{once:true});
        showPromotionModal(from,to,piece=>{$('cancelPromotionBtn').removeEventListener('click',cancel);resolve(piece);});
      });
      if(generation!==state.generation||!state.active)return;
      state.busy=false;
      if (!promotion) {message('Promotion cancelled. Choose a move to retry.');return;}
    }
    const beforeFen=chess.fen();
    const move=chess.move({from,to,promotion:promotion||'q'});
    if(!move) {message('Illegal move. Try again.');return;}
    clearHint();
    const afterFen=chess.fen();
    const uci=move.from+move.to+(move.promotion||'');
    if(uci!==p.solution[state.index]) {chess.undo();state.board.position(chess.fen());message('Not the intended solution — try again.');return;}
    state.moves.push(uci);state.index++;state.busy=true;state.board.position(chess.fen());playSound('move');
    window.BChessBadges?.inspect('puzzleBoard',beforeFen,move,afterFen,()=>state.active&&state.generation===generation&&state.game.fen()===afterFen);
    if(state.index<p.solution.length) {
      message('Opponent is moving…');
      await new Promise(resolve=>setTimeout(resolve,400));
      if(generation!==state.generation||!state.active)return;
      const reply=p.solution[state.index],replyBefore=chess.fen(),replyMove=moveToken(chess,reply);state.moves.push(reply);state.index++;state.board.position(chess.fen());
      const replyAfter=chess.fen();window.BChessBadges?.inspect('puzzleBoard',replyBefore,replyMove,replyAfter,()=>state.active&&state.generation===generation&&state.game.fen()===replyAfter);
    }
    if(state.index===p.solution.length) {
      message('Correct! Saving progress…');
      try {
        await rpc('complete_puzzle',{p_id:p.id,p_moves:state.moves});
        if(generation!==state.generation||!state.active)return;
        state.completed.add(p.id);renderStages();message('Stage '+p.stage+' completed! '+(state.list.some(x=>x.stage>p.stage)?'The next stage is unlocked.':'All available stages completed.'));
      }catch(e){if(generation===state.generation){message('Could not save: '+e.message+' Use Retry stage to try again.');}}
    } else {state.busy=false;message('Correct. Your turn.');}
  }
  async function open() {
    if(window.bchessTournamentActive||currentRoomCode||isOnlineMatchActive||(quickBot&&!quickBot.over)) return alert('Finish your current match before opening Puzzles.');
    if(!currentUserId)return triggerGoogleLogin();
    if(!requireTermsAccepted())return;
    setGameMode('quick'); if(window.qmCancelActiveSearch)window.qmCancelActiveSearch();
    state.active=true;const generation=++state.generation;
    state.list=[];state.completed.clear();state.puzzle=null;state.busy=false;
    $('puzzleStages').replaceChildren();if(state.board)state.board.position('empty',false);
    document.body.classList.add('puzzle-mode');$('puzzlesPanel').hidden=false;
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));$('modePuzzlesBtn').classList.add('active');
    message('Loading your stages…');
    try {
      const result=await rpc('get_puzzle_stages',{});
      if(!state.active||generation!==state.generation)return;
      state.list=result.puzzles;state.completed=new Set(result.completed);renderStages();
      if(state.list.length)start(state.list.find(p=>!state.completed.has(p.id))||state.list[0]);else message('No published puzzles yet.');
    }catch(e){if(state.active)message(e.message);}
  }
  window.closePuzzleMode=()=>{window.BChessBadges?.clear('puzzleBoard');state.active=false;state.generation++;document.body.classList.remove('puzzle-mode');$('puzzlesPanel').hidden=true;$('modePuzzlesBtn').classList.remove('active');};
  function init(){
    $('modePuzzlesBtn').onclick=open;$('puzzlePreviewBtn').onclick=preview;$('puzzlePublishBtn').onclick=publish;
    $('puzzleRetry').onclick=()=>{if(state.puzzle)start(state.puzzle,true);};
    $('puzzleHintBtn').onclick=hint;
    $('adminPuzzleRefresh').onclick=adminList;
    $('adminPuzzleDelete').onclick=()=>deletePuzzles(Array.from(document.querySelectorAll('.puzzle-select:checked')).map(x=>x.value));
    document.addEventListener('bchess-admin-open',adminList);
    document.addEventListener('bchess-admin-close',()=>{miniBoards.forEach(b=>b.destroy());miniBoards=[];adminPuzzles=[];$('adminPuzzleList').replaceChildren();$('adminPuzzleBatches').replaceChildren();});
    setInterval(()=>{if(state.active){refreshActive();hintStatus();}},5000);
    ['puzzleSource','puzzleSolution','puzzleFormat'].forEach(id=>$(id).addEventListener('input',invalidate));
    $('puzzleFiles').onchange=async()=>{
      invalidate();try {const texts=[];for(const file of $('puzzleFiles').files){if(file.size>5*1024*1024)throw new Error('Each file must be under 5 MB.');texts.push(await file.text());}
        const format=$('puzzleFormat').value;
        if(format==='fen'&&texts.every(t=>t.trim().startsWith('['))) $('puzzleSource').value=JSON.stringify(texts.flatMap(t=>JSON.parse(t)));
        else $('puzzleSource').value=texts.join(format==='pgn'?'\n---\n':'\n');
      }catch(e){$('puzzleImportStatus').textContent=e.message;}
    };
    $('puzzleBoard').addEventListener('click',e=>{const square=e.target.closest('[data-square]')?.dataset.square;if(!square||state.busy)return;
      if(state.selected){const from=state.selected;state.selected=null;attempt(from,square);}else if(state.game?.get(square)?.color===state.game.turn())state.selected=square;
    });
    window.addEventListener('resize',()=>{if(state.active&&state.board)state.board.resize();});
    let uid=auth.currentUser?.uid;
    auth.onAuthStateChanged(user=>{if(user?.uid!==uid){uid=user?.uid;window.closePuzzleMode();state.list=[];state.completed.clear();state.puzzle=null;}});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

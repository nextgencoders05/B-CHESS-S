/* Puzzles use their own board/game so opening the mode never rewrites a match. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const rpc = (name,args) => window.sbCall(name,args);
  const state = { active:false, generation:0, list:[], completed:new Set(), board:null, game:null, puzzle:null, index:0, selected:null, busy:false, moves:[], preview:null };
  function message(text) { $('puzzleStatus').textContent = text; }
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
      state.preview=null;
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
  function start(puzzle) {
    state.generation++; state.puzzle=puzzle; state.game=new Chess(puzzle.fen);state.index=0;state.moves=[];state.busy=false;state.selected=null;
    if(!state.board) state.board=Chessboard('puzzleBoard',{draggable:true,position:puzzle.fen,pieceTheme:PIECE_IMG_URL,
      onDragStart:(source,piece)=>!state.busy && state.active && piece[0]===state.game.turn(),
      onDrop:(from,to)=>{attempt(from,to);return 'snapback';},onSnapEnd:()=>state.board.position(state.game.fen())});
    state.board.orientation(state.game.turn()==='w'?'white':'black');state.board.position(puzzle.fen,false);state.board.resize();
    message('Stage '+puzzle.stage+' — '+(state.game.turn()==='w'?'White':'Black')+' to move.');renderStages();
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
    const move=chess.move({from,to,promotion:promotion||'q'});
    if(!move) {message('Illegal move. Try again.');return;}
    const uci=move.from+move.to+(move.promotion||'');
    if(uci!==p.solution[state.index]) {chess.undo();state.board.position(chess.fen());message('Not the intended move. Try again.');return;}
    state.moves.push(uci);state.index++;state.busy=true;state.board.position(chess.fen());playSound('move');
    if(state.index<p.solution.length) {
      await new Promise(resolve=>setTimeout(resolve,400));
      if(generation!==state.generation||!state.active)return;
      const reply=p.solution[state.index];moveToken(chess,reply);state.moves.push(reply);state.index++;state.board.position(chess.fen());
    }
    if(state.index===p.solution.length) {
      message('Correct! Saving progress…');
      try {
        await rpc('complete_puzzle',{p_id:p.id,p_moves:state.moves});
        if(generation!==state.generation||!state.active)return;
        state.completed.add(p.id);renderStages();message('Stage '+p.stage+' completed! '+(state.list.some(x=>x.stage>p.stage)?'The next stage is unlocked.':'All available stages completed.'));
      }catch(e){if(generation===state.generation){message('Could not save: '+e.message+' Use Retry stage to try again.');}}
    } else {state.busy=false;message('Correct. Your next move.');}
  }
  async function open() {
    if(currentRoomCode||isOnlineMatchActive||(quickBot&&!quickBot.over)) return alert('Finish your current match before opening Puzzles.');
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
  window.closePuzzleMode=()=>{state.active=false;state.generation++;document.body.classList.remove('puzzle-mode');$('puzzlesPanel').hidden=true;$('modePuzzlesBtn').classList.remove('active');};
  function init(){
    $('modePuzzlesBtn').onclick=open;$('puzzlePreviewBtn').onclick=preview;$('puzzlePublishBtn').onclick=publish;
    $('puzzleRetry').onclick=()=>{if(state.puzzle)start(state.puzzle);};
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

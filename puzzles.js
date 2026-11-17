/* Puzzles use their own board/game so opening the mode never rewrites a match. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const rpc = (name,args) => window.sbCall(name,args);
  const state = { active:false, generation:0, list:[], completed:new Set(), board:null, game:null, puzzle:null, index:0, selected:null, hintSquare:null, busy:false, moves:[], preview:null, attempt:null, hints:0, hintBusy:false };
  function message(text) { $('puzzleStatus').textContent = text; updateTurn(); }
  function updateTurn(){
    const el=$('puzzleTurn');if(!state.puzzle||!state.game){el.textContent='Select an available stage';return;}
    const color=state.game.turn()==='w'?'White':'Black';el.replaceChildren();const token=document.createElement('span');token.className='turn-token '+color.toLowerCase();token.setAttribute('aria-hidden','true');el.append(token,document.createTextNode('Stage '+state.puzzle.stage+' • '+color+' to move'));
    $('puzzleHintBtn').disabled=state.hintBusy||state.busy||state.hints<=0||state.index>=state.puzzle.solution.length;
  }
  function clearHint(){state.hintSquare=null;document.querySelectorAll('#puzzleBoard .puzzle-hint-square').forEach(x=>x.classList.remove('puzzle-hint-square'));}
  function paintHint(){
    document.querySelectorAll('#puzzleBoard .puzzle-hint-square').forEach(x=>x.classList.remove('puzzle-hint-square'));
    if(state.hintSquare)document.querySelector('#puzzleBoard [data-square="'+state.hintSquare+'"]')?.classList.add('puzzle-hint-square');
  }
  async function hintStatus(){try{const r=await rpc('puzzle_hint_status',{});state.hints=r.remaining;$('puzzleHintCount').textContent='Hints left today: '+r.remaining+'/3';$('puzzleHintBtn').title=r.remaining?'Highlight the piece to move':'Available again at midnight IST';updateTurn();}catch(e){$('puzzleHintCount').textContent='Hints unavailable: '+e.message;}}
  async function hint(){if(!state.puzzle||state.busy||state.hintBusy||state.hints<=0)return;const generation=state.generation;state.hintBusy=true;updateTurn();
    try{const r=await rpc('puzzle_hint',{p_id:state.puzzle.id,p_attempt:state.attempt,p_ply:state.index});if(generation!==state.generation||!state.active)return;state.hints=r.remaining;$('puzzleHintCount').textContent='Hints left today: '+r.remaining+'/3';state.hintSquare=r.source;paintHint();message('Hint: move the highlighted piece.');}
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
    if(state.puzzle){const found=state.list.find(p=>p.id===state.puzzle.id);if(!found){state.generation++;state.puzzle=null;state.busy=false;hideCompletionScreen();hideWrongMoveScreen();state.board?.position('empty',false);window.BChessBadges?.clear('puzzleBoard');message('This puzzle was deleted. Choose an available stage.');}else state.puzzle.stage=found.stage;}
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
  let journeySignature = '', lastDrop = 0, lastDropSquare = null, lastDropWasMove = false, dragFrom = null, justCompleted = null, inTouch = false, lastTouchEnd = 0, lastBoardTouchEnd = 0;
  function highlightSquareAndMoves(square) {
    document.querySelectorAll('#puzzleBoard .puzzle-selected, #puzzleBoard .square-selected, #puzzleBoard .legal-dest-dot, #puzzleBoard .legal-dest-capture').forEach(el=>el.classList.remove('puzzle-selected','square-selected','legal-dest-dot','legal-dest-capture'));
    if(square && state.game) {
      const sqEl = document.querySelector('#puzzleBoard [data-square="'+square+'"]');
      if(sqEl) sqEl.classList.add('puzzle-selected','square-selected');
      const legal = state.game.moves({square, verbose:true});
      for(const m of legal) {
        const dest = document.querySelector('#puzzleBoard [data-square="'+m.to+'"]');
        if(dest) dest.classList.add(m.captured || state.game.get(m.to) ? 'legal-dest-capture' : 'legal-dest-dot');
      }
    }
  }
  function selection(square) {
    state.selected = square || null;
    highlightSquareAndMoves(state.selected);
  }
  function findNextPuzzle(completedPuzzle) {
    if (!state.list.length) return null;
    const idx = completedPuzzle ? state.list.findIndex(p => p.id === completedPuzzle.id) : -1;
    if (idx >= 0) {
      const nextUncompletedAfter = state.list.slice(idx + 1).find(p => !state.completed.has(p.id));
      if (nextUncompletedAfter) return nextUncompletedAfter;
    }
    const anyUncompleted = state.list.find(p => !state.completed.has(p.id));
    if (anyUncompleted) return anyUncompleted;
    if (idx >= 0 && idx + 1 < state.list.length) return state.list[idx + 1];
    return null;
  }
  function ensureStageWrap() {
    const boardEl = $('puzzleBoard');
    if (!boardEl) return null;
    let stageWrap = $('puzzleBoardStage');
    if (!stageWrap) {
      stageWrap = document.createElement('div');
      stageWrap.id = 'puzzleBoardStage';
      stageWrap.className = 'puzzle-board-stage';
      boardEl.parentNode.insertBefore(stageWrap, boardEl);
      stageWrap.appendChild(boardEl);
    }
    return stageWrap;
  }
  function ensureCompletionOverlay() {
    const stageWrap = ensureStageWrap();
    let overlay = $('puzzleCompletionScreen');
    if (!overlay && stageWrap) {
      overlay = document.createElement('div');
      overlay.id = 'puzzleCompletionScreen';
      overlay.className = 'puzzle-completion-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'false');
      overlay.setAttribute('aria-labelledby', 'puzzleCompleteTitle');
      overlay.hidden = true;
      overlay.innerHTML =
        '<div class="puzzle-completion-card">' +
          '<div class="puzzle-completion-icon" aria-hidden="true">' +
            '<svg viewBox="0 0 52 52" class="puzzle-checkmark-svg">' +
              '<circle class="puzzle-checkmark-circle" cx="26" cy="26" r="24" fill="none"></circle>' +
              '<path class="puzzle-checkmark-check" fill="none" d="M14 27l8 8 16-16"></path>' +
            '</svg>' +
          '</div>' +
          '<h3 id="puzzleCompleteTitle" class="puzzle-completion-title">Puzzle Completed!</h3>' +
          '<p id="puzzleCompleteSub" class="puzzle-completion-sub">Great job! You solved this puzzle.</p>' +
          '<div id="puzzleCompleteActions" class="puzzle-completion-actions">' +
            '<button type="button" id="puzzleNextBtn" class="pill-btn highlight-btn puzzle-next-btn">Go to Next Puzzle</button>' +
          '</div>' +
          '<div id="puzzleAllCompletedBox" class="puzzle-all-completed-box" hidden>' +
            '<p id="puzzleAllCompletedText" class="puzzle-all-completed-text">All Available Puzzles Completed</p>' +
            '<button type="button" id="puzzleReturnListBtn" class="pill-btn highlight-btn puzzle-return-btn">Return to Puzzle List</button>' +
          '</div>' +
        '</div>';
      stageWrap.appendChild(overlay);
    }
    ensureWrongMoveOverlay();
    bindCompletionButtons();
    return overlay;
  }
  function ensureWrongMoveOverlay() {
    const stageWrap = ensureStageWrap();
    let wrongOverlay = $('puzzleWrongMoveScreen');
    if (!wrongOverlay && stageWrap) {
      wrongOverlay = document.createElement('div');
      wrongOverlay.id = 'puzzleWrongMoveScreen';
      wrongOverlay.className = 'puzzle-completion-overlay puzzle-wrong-overlay';
      wrongOverlay.setAttribute('role', 'dialog');
      wrongOverlay.setAttribute('aria-modal', 'false');
      wrongOverlay.setAttribute('aria-labelledby', 'puzzleWrongMoveTitle');
      wrongOverlay.hidden = true;
      wrongOverlay.innerHTML =
        '<div class="puzzle-completion-card puzzle-wrong-card">' +
          '<div class="puzzle-completion-icon puzzle-wrong-icon" aria-hidden="true">' +
            '<svg viewBox="0 0 52 52" class="puzzle-checkmark-svg">' +
              '<circle class="puzzle-wrong-circle" cx="26" cy="26" r="24" fill="none"></circle>' +
              '<path class="puzzle-wrong-cross" fill="none" d="M17 17l18 18M35 17L17 35"></path>' +
            '</svg>' +
          '</div>' +
          '<h3 id="puzzleWrongMoveTitle" class="puzzle-completion-title puzzle-wrong-title">Wrong Move!</h3>' +
          '<p id="puzzleWrongMoveSub" class="puzzle-completion-sub">That move is not the expected solution. Try again!</p>' +
          '<div class="puzzle-completion-actions">' +
            '<button type="button" id="puzzleWrongRetryBtn" class="pill-btn highlight-btn puzzle-next-btn puzzle-wrong-retry-btn">Retry</button>' +
          '</div>' +
        '</div>';
      stageWrap.appendChild(wrongOverlay);
    }
    return wrongOverlay;
  }
  function hideCompletionScreen() {
    const overlay = $('puzzleCompletionScreen');
    if (overlay) overlay.hidden = true;
  }
  function hideWrongMoveScreen() {
    const wrongOverlay = $('puzzleWrongMoveScreen');
    if (wrongOverlay) wrongOverlay.hidden = true;
  }
  function showWrongMoveScreen() {
    ensureCompletionOverlay();
    hideCompletionScreen();
    const wrongOverlay = ensureWrongMoveOverlay();
    if (!wrongOverlay) return;
    wrongOverlay.hidden = false;
    requestAnimationFrame(() => {
      if (!wrongOverlay.hidden) {
        $('puzzleWrongRetryBtn')?.focus({ preventScroll: true });
      }
    });
  }
  function retryCurrentPuzzle() {
    if (Date.now() - lastBoardTouchEnd < 400) return;
    hideWrongMoveScreen();
    if (state.puzzle) {
      start(state.puzzle, true);
    }
  }
  function showCompletionScreen(completedPuzzle) {
    hideWrongMoveScreen();
    const overlay = ensureCompletionOverlay();
    if (!overlay) return;
    const nextPuzzle = findNextPuzzle(completedPuzzle);
    const nextBtn = $('puzzleNextBtn');
    const actionsBox = $('puzzleCompleteActions');
    const allBox = $('puzzleAllCompletedBox');
    if (nextPuzzle) {
      if (actionsBox) actionsBox.hidden = false;
      if (nextBtn) nextBtn.hidden = false;
      if (allBox) allBox.hidden = true;
    } else {
      if (actionsBox) actionsBox.hidden = true;
      if (nextBtn) nextBtn.hidden = true;
      if (allBox) allBox.hidden = false;
    }
    overlay.hidden = false;
    requestAnimationFrame(() => {
      if (!overlay.hidden) {
        (nextPuzzle ? nextBtn : $('puzzleReturnListBtn'))?.focus({ preventScroll: true });
      }
    });
  }
  function syncJourneyScroll(targetPuzzle) {
    const p = targetPuzzle || currentStage();
    const viewport = $('puzzleStages');
    const el = p && document.querySelector('#puzzleJourney [data-puzzle-id="' + p.id + '"]');
    if (viewport && el) {
      viewport.scrollTop = Math.max(0, el.offsetTop - viewport.clientHeight / 2 + el.offsetHeight / 2);
    }
  }
  function goToNextPuzzle() {
    if (Date.now() - lastBoardTouchEnd < 400) return;
    const nextPuzzle = findNextPuzzle(state.puzzle);
    if (nextPuzzle) {
      hideCompletionScreen();
      start(nextPuzzle);
      syncJourneyScroll(nextPuzzle);
    } else {
      const actionsBox = $('puzzleCompleteActions');
      const nextBtn = $('puzzleNextBtn');
      const allBox = $('puzzleAllCompletedBox');
      if (actionsBox) actionsBox.hidden = true;
      if (nextBtn) nextBtn.hidden = true;
      if (allBox) allBox.hidden = false;
      message('All Available Puzzles Completed');
    }
  }
  function returnToPuzzleList() {
    if (Date.now() - lastBoardTouchEnd < 400) return;
    hideCompletionScreen();
    focusCurrent();
    $('puzzleStages')?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    $('puzzleStages')?.focus({ preventScroll: true });
  }
  function bindCompletionButtons() {
    const overlay = $('puzzleCompletionScreen');
    if (overlay && !overlay.dataset.boundTouch) {
      overlay.dataset.boundTouch = '1';
      overlay.addEventListener('touchstart', () => { lastBoardTouchEnd = 0; }, { passive: true });
    }
    const wrongOverlay = $('puzzleWrongMoveScreen');
    if (wrongOverlay && !wrongOverlay.dataset.boundTouch) {
      wrongOverlay.dataset.boundTouch = '1';
      wrongOverlay.addEventListener('touchstart', () => { lastBoardTouchEnd = 0; }, { passive: true });
    }
    const nextBtn = $('puzzleNextBtn');
    if (nextBtn) nextBtn.onclick = goToNextPuzzle;
    const returnBtn = $('puzzleReturnListBtn');
    if (returnBtn) returnBtn.onclick = returnToPuzzleList;
    const wrongRetryBtn = $('puzzleWrongRetryBtn');
    if (wrongRetryBtn) wrongRetryBtn.onclick = retryCurrentPuzzle;
  }
  function currentStage() { return state.list.find(p=>!state.completed.has(p.id)) || state.list[state.list.length-1]; }
  function focusCurrent() {
    const p=currentStage();
    if(p) document.querySelector('#puzzleJourney [data-puzzle-id="'+p.id+'"]')?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }
  function renderStages() {
    const signature=JSON.stringify([state.list.map(p=>[p.id,p.stage]),[...state.completed],state.puzzle?.id]);
    if(signature===journeySignature)return;
    journeySignature=signature;
    const viewport=$('puzzleStages');let journey=$('puzzleJourney');
    if(!journey){journey=document.createElement('div');journey.id='puzzleJourney';viewport.append(journey);}
    const oldMarker=journey.querySelector('.journey-marker');
    const oldTop=oldMarker?.style.top, oldLeft=oldMarker?.style.left;
    const focusedId=document.activeElement?.dataset.puzzleId;
    journey.replaceChildren();
    const height=Math.max(180,state.list.length*100+70);journey.style.height=height+'px';
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 100 '+height);svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');svg.classList.add('journey-path');
    const path=document.createElementNS(svg.namespaceURI,'path');
    const xAt=i=>[25,50,75,50][i%4],yAt=i=>60+i*100;
    path.setAttribute('d',state.list.map((p,i)=>(i?'L':'M')+xAt(i)+' '+yAt(i)).join(' '));svg.append(path);journey.append(svg);
    const current=currentStage();let currentIndex=-1;
    state.list.forEach((p,i)=>{
      const done=state.completed.has(p.id),available=i===0||state.completed.has(state.list[i-1].id);
      const button=document.createElement('button');button.type='button';button.className='journey-stage '+(done?'completed':available?'available':'locked');button.disabled=!available;button.dataset.puzzleId=p.id;if(p.id===justCompleted)button.classList.add('just-completed');
      button.style.left=xAt(i)+'%';button.style.top=yAt(i)+'px';
      button.textContent='Stage '+p.stage+(done?' ✓':available?'':' 🔒');
      button.setAttribute('aria-label','Stage '+p.stage+' '+(done?'Completed':available?'Available':'Locked'));
      button.title=button.getAttribute('aria-label');
      button.setAttribute('aria-pressed',String(state.puzzle?.id===p.id));
      if(p.id===current?.id){button.setAttribute('aria-current','step');currentIndex=i;}
      button.onclick=()=>{start(p);$('puzzleBoard').scrollIntoView({block:'nearest'});};journey.append(button);
    });
    if(currentIndex>=0){
      const marker=oldMarker||document.createElement('span');marker.className='journey-marker';marker.textContent='♟';marker.setAttribute('aria-hidden','true');
      marker.style.left=oldLeft||xAt(currentIndex)+'%';marker.style.top=oldTop||(yAt(currentIndex)-43)+'px';journey.append(marker);
      requestAnimationFrame(()=>{marker.style.left=xAt(currentIndex)+'%';marker.style.top=(yAt(currentIndex)-43)+'px';});
    }
    if(focusedId)journey.querySelector('[data-puzzle-id="'+focusedId+'"]')?.focus({preventScroll:true});
  }
  function resizeBoard() {
    if (!state.board) return;
    state.board.resize();
    selection(state.selected);
    paintHint();
  }
  function start(puzzle,newAttempt=false) {
    const key='bChessAttempt:'+currentUserId+':'+puzzle.id;
    state.attempt=!newAttempt&&sessionStorage.getItem(key)||crypto.randomUUID();sessionStorage.setItem(key,state.attempt);
    hideCompletionScreen();
    hideWrongMoveScreen();
    selection(null);clearHint();window.BChessBadges?.clear('puzzleBoard');
    justCompleted=null;dragFrom=null;lastDrop=0;lastDropSquare=null;lastDropWasMove=false;inTouch=false;
    state.generation++; state.puzzle=puzzle; state.game=new Chess(puzzle.fen);state.index=0;state.moves=[];state.busy=false;state.selected=null;
    if(!state.board) state.board=Chessboard('puzzleBoard',{draggable:true,position:puzzle.fen,pieceTheme:PIECE_IMG_URL,
      onDragStart:(source,piece)=>{
        if(!inTouch&&Date.now()-lastTouchEnd<450)return false;
        if(state.busy||!state.active||!state.puzzle||state.index>=state.puzzle.solution.length||piece[0]!==state.game.turn())return false;
        hideWrongMoveScreen();
        dragFrom=source;
        if(state.selected!==source)highlightSquareAndMoves(source);
        return true;
      },
      onDrop:(from,to)=>{
        dragFrom=null;
        if(inTouch){inTouch=false;lastTouchEnd=Date.now();lastBoardTouchEnd=lastTouchEnd;}
        if(!state.active||state.busy||!state.puzzle)return 'snapback';
        if(!to||to==='offboard'){selection(state.selected);return 'snapback';}
        lastDrop=Date.now();
        lastDropSquare=to;
        if(from===to){
          lastDropWasMove=false;
          selection(state.selected===from?null:from);
          return 'snapback';
        }
        if(state.game?.get(to)?.color===state.game?.turn()){
          lastDropWasMove=false;
          selection(to);
          return 'snapback';
        }
        lastDropWasMove=true;
        selection(null);
        attempt(from,to,true);
        return 'snapback';
      },
      onSnapbackEnd:()=>{if(state.game)state.board.position(state.game.fen(),false);selection(state.selected);paintHint();},
      onSnapEnd:()=>{if(state.game)state.board.position(state.game.fen(),false);selection(state.selected);paintHint();} });
    state.board.orientation(state.game.turn()==='w'?'white':'black');state.board.position(puzzle.fen,false);resizeBoard();
    message('Your turn.');renderStages();hintStatus();
  }
  async function attempt(from,to,fromDrag=false) {
    if(state.busy||!state.active||!state.puzzle||state.index>=state.puzzle.solution.length) return;
    hideWrongMoveScreen();
    const generation=state.generation, p=state.puzzle, chess=state.game;
    let promotion;
    if(chess.get(from)?.type==='p' && /[18]$/.test(to)) {
      const probe=new Chess(chess.fen());
      if(!probe.move({from,to,promotion:'q'})) {message('Illegal move. Try again.');return;}
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
    if(uci!==p.solution[state.index]) {
      chess.undo();
      state.board.position(chess.fen(),false);
      message('Wrong Move! — Not the intended solution, try again.');
      showWrongMoveScreen();
      return;
    }
    state.moves.push(uci);state.index++;state.busy=true;state.board.position(chess.fen(),!fromDrag);playSound('move');
    window.BChessBadges?.inspect('puzzleBoard',beforeFen,move,afterFen,()=>state.active&&state.generation===generation&&state.game.fen()===afterFen);
    if(state.index<p.solution.length) {
      message('Opponent is moving…');
      await new Promise(resolve=>setTimeout(resolve,400));
      if(generation!==state.generation||!state.active)return;
      const reply=p.solution[state.index],replyBefore=chess.fen(),replyMove=moveToken(chess,reply);state.moves.push(reply);state.index++;state.board.position(chess.fen(),false);
      const replyAfter=chess.fen();window.BChessBadges?.inspect('puzzleBoard',replyBefore,replyMove,replyAfter,()=>state.active&&state.generation===generation&&state.game.fen()===replyAfter);
    }
    if(state.index===p.solution.length) {
      message('Correct! Saving progress…');
      try {
        await rpc('complete_puzzle',{p_id:p.id,p_moves:state.moves});
        if(generation!==state.generation||!state.active)return;
        state.completed.add(p.id);justCompleted=p.id;renderStages();message('Stage '+p.stage+' completed! '+(state.list.some(x=>x.stage>p.stage)?'The next stage is unlocked.':'All available stages completed.'));
        showCompletionScreen(p);
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
    hideCompletionScreen();
    hideWrongMoveScreen();
    journeySignature='';$('puzzleStages').replaceChildren();if(state.board)state.board.position('empty',false);
    document.body.classList.add('puzzle-mode');$('puzzlesPanel').hidden=false;
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));$('modePuzzlesBtn').classList.add('active');
    message('Loading your stages…');
    try {
      const result=await rpc('get_puzzle_stages',{});
      if(!state.active||generation!==state.generation)return;
      state.list=result.puzzles;state.completed=new Set(result.completed);renderStages();
      if(state.list.length){start(state.list.find(p=>!state.completed.has(p.id))||state.list[0]);focusCurrent();}else message('No published puzzles yet.');
    }catch(e){if(state.active)message(e.message);}
  }
  window.closePuzzleMode=()=>{hideCompletionScreen();hideWrongMoveScreen();selection(null);clearHint();window.BChessBadges?.clear('puzzleBoard');state.active=false;state.generation++;document.body.classList.remove('puzzle-mode');$('puzzlesPanel').hidden=true;$('modePuzzlesBtn').classList.remove('active');};
  function handleSquareInput(square) {
    if(!square||!state.active||state.busy||!state.puzzle||dragFrom)return;
    const now=Date.now();
    if(lastDropWasMove&&now-lastDrop<400)return;
    if(!lastDropWasMove&&square===lastDropSquare&&now-lastDrop<400)return;
    hideWrongMoveScreen();
    if(state.selected===square){selection(null);return;}
    if(state.game?.get(square)?.color===state.game.turn()){selection(square);return;}
    if(state.selected){const from=state.selected;selection(null);attempt(from,square,false);}
  }
  function init(){
    ensureCompletionOverlay();
    bindCompletionButtons();
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
    $('puzzleCurrentStage').onclick=focusCurrent;
    let lastTouch=0,touchStart=null;
    $('puzzleBoard').addEventListener('contextmenu',e=>e.preventDefault());
    $('puzzleBoard').addEventListener('touchstart',e=>{
      inTouch=true;
      lastTouch=Date.now();
      const t=e.changedTouches?.[0];
      const square=e.target.closest('[data-square]')?.dataset.square;
      touchStart=t&&square?{x:t.clientX,y:t.clientY,square}:null;
    },{capture:true,passive:true});
    $('puzzleBoard').addEventListener('touchend',e=>{
      lastTouch=Date.now();
      lastTouchEnd=lastTouch;
      lastBoardTouchEnd=lastTouch;
      const t=e.changedTouches?.[0];
      if(touchStart&&t&&Math.hypot(t.clientX-touchStart.x,t.clientY-touchStart.y)>24){touchStart=null;setTimeout(()=>{inTouch=false;},0);return;}
      const hit=t&&document.elementFromPoint?document.elementFromPoint(t.clientX,t.clientY):e.target;
      const square=(hit?.closest?.('[data-square]')||e.target.closest?.('[data-square]'))?.dataset.square||touchStart?.square;
      touchStart=null;
      handleSquareInput(square);
      setTimeout(()=>{inTouch=false;},0);
    },{passive:true});
    $('puzzleBoard').addEventListener('click',e=>{
      if(Date.now()-lastTouch<450||Date.now()-lastTouchEnd<450)return;
      const square=e.target.closest('[data-square]')?.dataset.square;
      handleSquareInput(square);
    });
    window.addEventListener('resize',()=>{if(state.active&&state.board)resizeBoard();});
    let uid=auth.currentUser?.uid;
    auth.onAuthStateChanged(user=>{if(user?.uid!==uid){uid=user?.uid;window.closePuzzleMode();state.list=[];state.completed.clear();state.puzzle=null;}});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

(function(){
 'use strict';
 window.bchessSecure=async body=>{
  const {data,error}=await sb.functions.invoke('bchess-secure',{body});
  if(error){let message=error.message;try{message=(await error.context.json()).error||message;}catch(_){}throw new Error(message);}
  if(data?.error)throw new Error(data.error);return data;
 };
 function init(){
  const profile=document.getElementById('userProfile');profile.addEventListener('click',()=>openProfileModal(false));profile.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openProfileModal(false);}});
  document.getElementById('headerAnalysisBtn').onclick=()=>document.getElementById('modeAnalyzeBtn').click();
  const wrap=document.createElement('div');wrap.id='analysisPGNImport';wrap.innerHTML='<label for="analysisPGNInput">Review a PGN game</label><textarea id="analysisPGNInput" rows="3" placeholder="Paste PGN game"></textarea><button id="analysisPGNLoad" class="pill-btn">Load PGN review</button><span id="analysisPGNError" role="status"></span>';
  document.getElementById('fenInput').parentNode.append(wrap);
  document.getElementById('analysisPGNLoad').onclick=()=>{
   const error=document.getElementById('analysisPGNError');error.textContent='';
   if(isOnlineMatchActive||currentRoomCode||window.bchessTournamentActive){error.textContent='Review is unavailable during a live match.';return;}
   const c=new Chess();if(!c.load_pgn(document.getElementById('analysisPGNInput').value,{sloppy:true})||!c.history().length){error.textContent='Enter a valid PGN with moves.';return;}
   reviewSans=c.history();while(c.undo()){}reviewFens=[c.fen()];reviewSans.forEach(m=>{c.move(m);reviewFens.push(c.fen());});reviewGame=c;
   document.getElementById('matchReviewTitle').textContent='PGN game review';document.getElementById('matchReviewSub').textContent='Select a move to analyze its quality.';document.getElementById('matchReviewModal').style.display='flex';
   if(reviewBoard)reviewBoard.destroy();reviewBoard=Chessboard('reviewBoard',{draggable:false,position:reviewFens[0],pieceTheme:PIECE_IMG_URL});renderReviewMoveList();setReviewIndex(1);
  };
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

/* Scoped settings and theme controls. Piece assets are complete local sets only. */
(function () {
  const el = id => document.getElementById(id);
  function init() {
    const menu = el('appMenu'), modal = el('preferencesModal');
    el('appMenuBtn').onclick = () => { menu.hidden = !menu.hidden; el('appMenuBtn').setAttribute('aria-expanded', String(!menu.hidden)); };
    document.addEventListener('click', e => { if (!e.target.closest('.app-menu-wrap')) { menu.hidden = true; el('appMenuBtn').setAttribute('aria-expanded', 'false'); } });
    let returnFocus;
    function open(theme) {
      returnFocus = document.activeElement; menu.hidden = true;
      el('appMenuBtn').setAttribute('aria-expanded', 'false');
      el('preferencesTitle').textContent = theme ? 'Theme' : 'Settings';
      el('settingsPanel').hidden = theme; el('themePanel').hidden = !theme;
      modal.style.display = 'flex'; el('preferencesClose').focus();
    }
    function close() { modal.style.display = 'none'; if (returnFocus) returnFocus.focus(); }
    el('settingsMenuBtn').onclick = () => open(false); el('themeBtn').onclick = () => open(true);
    el('preferencesClose').onclick = close;
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); menu.hidden = true; } });
    function sync() {
      [['soundToggleBtn', 'Sound', soundEnabled], ['arrowToggleBtn', 'Engine Arrows', showBestMoveArrow]].forEach(([id, label, on]) => {
        el(id).textContent = label + ' — ' + (on ? 'On' : 'Off');
        el(id).setAttribute('role', 'switch'); el(id).setAttribute('aria-checked', String(on)); el(id).classList.toggle('active-pill', on);
      });
    }
    ['soundToggleBtn','arrowToggleBtn'].forEach(id => el(id).addEventListener('click', () => queueMicrotask(sync))); sync();
    const boards = [{ id:'green', label:'Green & White', light:'#eeeed2', dark:'#769656' },{ id:'wood', label:'Wood & Cream', light:'#f0d9b5', dark:'#b58863' }];
    let selected = localStorage.getItem('bChessBoard') || 'green';
    if (!boards.some(b => b.id === selected)) selected = 'green';
    function applyBoard(id) {
      selected = id; document.body.classList.toggle('wood-theme', id === 'wood'); localStorage.setItem('bChessBoard', id);
      el('boardChoices').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.board === id)));
    }
    boards.forEach(b => {
      const button = document.createElement('button'); button.className = 'theme-choice pill-btn'; button.dataset.board = b.id;
      const preview = document.createElement('span'); preview.className = 'board-preview'; preview.setAttribute('aria-hidden','true');
      for (let i=0;i<16;i++) { const square = document.createElement('i'); square.style.background = (Math.floor(i/4)+i)%2 ? b.dark : b.light; preview.append(square); }
      button.append(preview, document.createTextNode(b.label)); button.onclick = () => applyBoard(b.id); el('boardChoices').append(button);
    });
    applyBoard(selected);
    // The supplied ZIP contains one complete local coin set. Do not advertise missing sets.
    const coins = document.createElement('button'); coins.className = 'theme-choice pill-btn'; coins.setAttribute('aria-pressed','true');
    const preview = document.createElement('span');
    ['wk','wq','wn','bk','bq','bn'].forEach(p => { const img = document.createElement('img'); img.src = 'pieces/'+p+'.png'; img.alt=''; preview.append(img); });
    coins.append(preview, document.createTextNode('Classic')); coins.onclick = () => localStorage.setItem('bChessCoins','classic');
    el('coinChoices').append(coins); localStorage.setItem('bChessCoins','classic');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();

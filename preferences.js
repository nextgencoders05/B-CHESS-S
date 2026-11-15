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
      if (theme && window.BChessThemes) window.BChessThemes.refresh();
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
    if (window.BChessThemes) window.BChessThemes.initChoices();

  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init); else init();
})();

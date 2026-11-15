/* Navigation only: builds a sidebar (desktop) / bottom bar (mobile) that CLICKS the existing
   mode buttons. It never changes game logic, voice/mic, rules or modes. */
(function () {
  'use strict';
  const items = [
    { id: 'modeQuickBtn', label: 'Quick Match', caption: 'Find a match', icon: '<path d="m13 2-9 12h7l-1 8 10-12h-7z"/>' },
    { id: 'modeBotBtn', label: 'Play', caption: 'Play against the bot', icon: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V5M2 11v5m20-5v5"/><circle cx="12" cy="3" r="1.5"/><circle cx="8.5" cy="14" r="1"/><circle cx="15.5" cy="14" r="1"/>' },
    { id: 'modeFriendBtn', label: 'Friends', caption: 'Play with friends', icon: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="8" r="2.7"/><path d="M2 20v-2a6 6 0 0 1 12 0v2m2-7a5 5 0 0 1 6 5v2"/>' },
    { id: 'modeAnalyzeBtn', label: 'Analyze', caption: 'Review a position', icon: '<path d="M5 20v-5m7 5V9m7 11V4"/>' },
    { id: 'modePuzzlesBtn', label: 'Puzzles', caption: 'Solve a tactic', icon: '<path d="M4 4h5V3a2 2 0 0 1 4 0v1h5v5h1a2 2 0 0 1 0 4h-1v5h-5v1a2 2 0 0 1-4 0v-1H4v-5h1a2 2 0 0 0 0-4H4z"/>' },
    { id: 'modeBooksBtn', label: 'Books', caption: 'Explore openings', icon: '<path d="M12 6v15M2 4c4-1 7 0 10 2 3-2 6-3 10-2v15c-4-1-7 0-10 2-3-2-6-3-10-2z"/>' },
    { id: 'modeHistoryBtn', label: 'History', caption: 'Review saved games', icon: '<path d="M3 12a9 9 0 1 0 2-6M3 4v5h5m4-2v5l3 2"/>' }
  ];
  function navigationIcon(path) {
    return '<svg class="ux-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }
  function init() {
    if (document.getElementById('uxNav')) return;
    var targets = items.map(function (i) { return document.getElementById(i.id); });
    if (targets.some(function (t) { return !t; })) return; // fail safe: keep original UI
    var nav = document.createElement('nav');
    nav.id = 'uxNav';
    nav.setAttribute('aria-label', 'Main navigation');
    var btns = items.map(function (it, idx) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'ux-nav-item'; b.dataset.mode = it.id;
      b.innerHTML = navigationIcon(it.icon) + '<span class="ux-nav-copy"><span>' + it.label +
        '</span><small class="ux-caption" aria-hidden="true">' + it.caption + '</small></span>';
      b.addEventListener('click', function () { targets[idx].click(); setTimeout(sync, 0); });
      nav.appendChild(b);
      return b;
    });
    var more = document.createElement('button'); more.className='ux-nav-item mobile-only'; more.id='mobileMoreBtn'; more.innerHTML=navigationIcon('<path d="M4 12h1m6 0h1m6 0h1" stroke-width="3"/>')+'<span>More</span>';more.setAttribute('aria-expanded','false');
    var panel=document.createElement('div');panel.id='mobileMorePanel';panel.hidden=true;
    [{id:'modeFriendBtn',label:'Friends'},{id:'modeBooksBtn',label:'Books'},{id:'modeTournamentBtn',label:'Tournaments'},{id:'modeAnalyzeBtn',label:'Analyze'},{id:'modeHistoryBtn',label:'History'}].forEach(function(it){var b=document.createElement('button');b.className='pill-btn';b.textContent=it.label;b.onclick=function(){panel.hidden=true;more.setAttribute('aria-expanded','false');document.getElementById(it.id).click();};panel.appendChild(b);});
    more.onclick=function(){panel.hidden=!panel.hidden;more.setAttribute('aria-expanded',String(!panel.hidden));};nav.appendChild(more);nav.appendChild(panel);
    document.addEventListener('click',function(e){if(!nav.contains(e.target)){panel.hidden=true;more.setAttribute('aria-expanded','false');}});
    document.body.appendChild(nav);
    function sync() {
      targets.forEach(function (t, i) { btns[i].classList.toggle('active', t.classList.contains('active')); });
      more.classList.toggle('active',['modeFriendBtn','modeBooksBtn','modeTournamentBtn','modeAnalyzeBtn'].some(function(id){return document.getElementById(id).classList.contains('active');}));
    }
    var mo = new MutationObserver(sync);
    targets.forEach(function (t) { mo.observe(t, { attributes: true, attributeFilter: ['class'] }); });
    mo.observe(document.getElementById('modeTournamentBtn'), {attributes:true,attributeFilter:['class']});
    sync();
    document.body.classList.add('ux-nav-ready');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* Mobile: move the "Recent Moves" box above the board as a scrolling strip (same element, same IDs). */
  function initMoveStrip() {
    var box = document.getElementById('quickHistoryBox');
    var topBar = document.getElementById('topCapturedBar');
    var list = document.getElementById('quickMoveHistory');
    if (!box || !topBar || !list) return;
    var home = box.parentNode, next = box.nextSibling;
    var mq = window.matchMedia('(max-width:700px)');
    function place() {
      if (mq.matches) { if (box.nextSibling !== topBar) topBar.parentNode.insertBefore(box, topBar); }
      else if (box.parentNode !== home) { home.insertBefore(box, next && next.parentNode === home ? next : null); }
    }
    place();
    if (mq.addEventListener) mq.addEventListener('change', place); else mq.addListener(place);
    new MutationObserver(function () { list.scrollLeft = list.scrollWidth; })
      .observe(list, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMoveStrip);
  else initMoveStrip();
})();

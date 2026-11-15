(function () {
  'use strict';

  const MATCH_INTERVAL = 8000;
  const HEADER_INTERVAL = 20000;
  const REQUEST_TIMEOUT = 5000;
  const STALE_AFTER = 17000;
  const OFFLINE_AFTER = 34000;

  const descriptions = {
    checking: 'Checking connection',
    unavailable: 'Status unavailable',
    good: 'Good connection',
    medium: 'Medium connection',
    low: 'Low connection',
    offline: 'No network'
  };

  function level(ms) {
    if (!Number.isFinite(ms) || ms < 0) return 'unavailable';
    if (ms < 250) return 'good';
    return ms < 650 ? 'medium' : 'low';
  }

  function roomContext() {
    if (!currentUserId || !currentRoomCode || currentMode !== 'friend' || quickBot ||
        friendRoomData?.quickMatch !== true || friendRoomData.gameOver) return null;
    const white = friendRoomData.creatorId;
    const black = friendRoomData.guestId;
    if (!white || !black || white === black || (white !== currentUserId && black !== currentUserId)) return null;
    return {
      key: JSON.stringify([currentRoomCode, currentUserId, white, black]),
      code: currentRoomCode,
      opponentIsWhite: currentUserId === black
    };
  }

  function paint(node, state, description) {
    if (node.dataset.signal === state) return;
    node.dataset.signal = state;
    node.title = description;
    node.setAttribute('aria-label', description);
    node.querySelector('.connection-label').textContent = descriptions[state];
  }

  let scope = null;
  let local = 'checking';
  let lastRtt = null;
  let peer = null;
  let nextCheck = 0;
  let pending = false;
  let failuresSince = null;

  function render(context) {
    const header = document.getElementById('connectionStatus');
    const top = document.getElementById('topConnectionStatus');
    const bottom = document.getElementById('bottomConnectionStatus');
    paint(header, local, 'Your B Chess connection: ' + descriptions[local]);
    const topIsOpponent = context && context.opponentIsWhite === (board.orientation() === 'black');
    top.hidden = !topIsOpponent;
    bottom.hidden = !context || !!topIsOpponent;
    if (!context) return;
    const age = peer ? peer.age + performance.now() - peer.received : 0;
    const state = !navigator.onLine || local === 'offline' || local === 'unavailable' ? 'unavailable'
      : !peer ? (local === 'checking' ? 'checking' : 'unavailable')
      : age >= OFFLINE_AFTER ? 'offline'
      : age >= STALE_AFTER ? 'unavailable' : level(peer.rtt);
    const label = 'Opponent’s B Chess connection: ' + descriptions[state];
    paint(topIsOpponent ? top : bottom, state, label);
  }

  async function probe(context) {
    pending = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    const start = performance.now();
    try {
      const { data, error } = await sb.rpc('bchess_connection_check', {
        room_code: context?.code ?? null,
        last_rtt_ms: lastRtt
      }).abortSignal(controller.signal);
      if (error || !data) throw error || new Error('Connection check failed');
      if ((roomContext()?.key ?? null) !== (context?.key ?? null) || !navigator.onLine) return;
      failuresSince = null;
      lastRtt = Math.round(performance.now() - start);
      local = level(lastRtt);
      if (context) {
        peer = Number.isFinite(data.peerAgeMs)
          ? { age: data.peerAgeMs, received: performance.now(), rtt: data.peerRttMs }
          : null;
      }
    } catch (error) {
      if ((roomContext()?.key ?? null) !== (context?.key ?? null) || !navigator.onLine) return;
      failuresSince ??= performance.now();
      const transportFailed = controller.signal.aborted || !error?.code;
      local = transportFailed && performance.now() - failuresSince >= MATCH_INTERVAL
        ? 'offline' : 'unavailable';
      if (!transportFailed) peer = null;
      nextCheck = performance.now() + MATCH_INTERVAL;
    } finally {
      clearTimeout(timeout);
      pending = false;
      // Rendering on the next tick also handles match changes during the request.
    }
  }

  function tick() {
    const context = roomContext();
    if ((context?.key ?? null) !== scope) {
      scope = context?.key ?? null;
      peer = null;
      nextCheck = 0;
    }
    if (!navigator.onLine) local = 'offline';
    render(context);
    const now = performance.now();
    if (!navigator.onLine || pending || now < nextCheck) return;
    nextCheck = now + (context ? MATCH_INTERVAL : HEADER_INTERVAL);
    void probe(context);
  }

  function init() {
    const header = document.getElementById('connectionStatus');
    header.addEventListener('click', () => {
      const expanded = header.getAttribute('aria-expanded') !== 'true';
      header.setAttribute('aria-expanded', String(expanded));
    });
    document.addEventListener('click', event => {
      if (!header.contains(event.target)) header.setAttribute('aria-expanded', 'false');
    });
    window.addEventListener('offline', tick);
    window.addEventListener('online', () => {
      local = 'checking';
      nextCheck = 0;
      tick();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { nextCheck = 0; tick(); }
    });
    // Chessboard redraws its squares when flipped. Move the badge before the next paint.
    new MutationObserver(() => {
      const context = roomContext();
      if ((context?.key ?? null) === scope) render(context);
    }).observe(document.getElementById('myBoard'), { childList: true, subtree: true });
    setInterval(tick, 1000);
    tick();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

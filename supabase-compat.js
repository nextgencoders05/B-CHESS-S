/* =====================================================================
   B CHESS ANALYZER — Supabase backend adapter
   Gives the app the small part of the Firebase API it uses
   (auth + Realtime Database style refs), implemented with Supabase:
     - Auth:      Supabase Auth (Google)
     - Database:  public.rtdb table (JSON documents) + Realtime + SQL functions
     - onDisconnect / .info/connected: heartbeat sessions (see supabase/schema.sql)
   Load order: supabase-js → config.js → this file → script.js → features.js
   ===================================================================== */
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Client
  // ------------------------------------------------------------------
  const CFG = Object.assign({}, window.SUPABASE_CONFIG || {});
  const configured = /^https:\/\/[^/]+$/.test(String(CFG.url || '').replace(/\/+$/, '')) &&
    CFG.anonKey && !/YOUR[-_]/i.test(CFG.url + CFG.anonKey);
  CFG.url = String(CFG.url || '').replace(/\/+$/, '');
  if (!configured) {
    console.error('[B Chess] Supabase is not configured. Fill in config.js (Project URL + anon key).');
    window.SUPABASE_NOT_CONFIGURED = true;
  }
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.error('[B Chess] The Supabase library did not load (check your internet connection).');
  }
  const sb = window.supabase.createClient(configured ? CFG.url : 'https://not-configured.supabase.co',
    configured ? CFG.anonKey : 'not-configured', {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
      realtime: { params: { eventsPerSecond: 30 } }
    });
  window.sb = sb;

  // ------------------------------------------------------------------
  // Errors + RPC
  // ------------------------------------------------------------------
  function mkErr(code, message) { const e = new Error(message || code); e.code = code; e._bchess = true; return e; }

  function fromSbError(err) {
    if (!err) return mkErr('internal', 'Unknown error');
    if (err._bchess) return err;
    const msg = String(err.message || err);
    const m = /^([a-z][a-z-]+): ([\s\S]*)$/.exec(msg);
    if (m) return mkErr(m[1], m[2]);
    if (window.SUPABASE_NOT_CONFIGURED) return mkErr('not-found', 'Supabase is not configured yet (config.js).');
    if (err.code === 'PGRST202' || err.code === '42883' || err.code === '42P01' || err.code === 'PGRST205' ||
        /Could not find the (function|table)/i.test(msg)) {
      return mkErr('not-found', 'Server setup missing — run supabase/schema.sql in the Supabase SQL Editor. (' + msg + ')');
    }
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return mkErr('unavailable', msg);
    if (err.code === '42501') return mkErr('permission-denied', msg);
    if (err.status === 401 || /JWT/i.test(msg)) return mkErr('unauthenticated', msg);
    return mkErr('internal', msg);
  }

  async function rpc(name, args) {
    let res;
    try { res = await sb.rpc(name, args || {}); } catch (e) { throw fromSbError(e); }
    if (res.error) throw fromSbError(res.error);
    return res.data;
  }
  window.sbCall = rpc;

  // Fire-and-forget call that survives the page closing (used on pagehide).
  function rpcKeepalive(name, args) {
    if (!cachedToken || !configured) return;
    try {
      fetch(CFG.url + '/rest/v1/rpc/' + name, {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json', apikey: CFG.anonKey, Authorization: 'Bearer ' + cachedToken },
        body: JSON.stringify(args || {})
      }).catch(() => {});
    } catch (_) {}
  }
  window.sbCallKeepalive = rpcKeepalive;

  // ------------------------------------------------------------------
  // Auth (firebase.auth() look-alike)
  // ------------------------------------------------------------------
  let currentUser = null;
  let cachedToken = null;
  let authReady = false;
  const authCbs = [];

  function toUser(u) {
    if (!u) return null;
    const m = u.user_metadata || {};
    return {
      uid: u.id,
      email: u.email || m.email || null,
      displayName: m.full_name || m.name || null,
      photoURL: m.avatar_url || m.picture || null,
      phoneNumber: u.phone || null,
      providerData: [],
      getIdToken: async () => {
        const { data } = await sb.auth.getSession();
        return (data && data.session && data.session.access_token) || '';
      }
    };
  }

  function emitAuth() {
    authCbs.slice().forEach(cb => { try { cb(currentUser); } catch (e) { console.error(e); } });
  }

  sb.auth.onAuthStateChange((event, session) => {
    const nu = toUser(session && session.user);
    const changed = (nu && nu.uid) !== (currentUser && currentUser.uid);
    cachedToken = session ? session.access_token : null;
    if (changed) currentUser = nu;
    else if (nu && currentUser) Object.assign(currentUser, { email: nu.email, displayName: nu.displayName, photoURL: nu.photoURL });
    if (!authReady || changed) {
      authReady = true;
      // Never call Supabase from inside this callback (it can dead-lock): defer.
      setTimeout(() => { emitAuth(); onAuthChangedInternal(changed); }, 0);
    }
  });

  class GoogleAuthProvider {
    constructor() { this.providerId = 'google.com'; this._params = {}; }
    addScope() { return this; }
    setCustomParameters(p) { this._params = Object.assign({}, p); return this; }
  }

  function redirectUrl() {
    if (CFG.redirectTo) return CFG.redirectTo;
    const u = new URL(location.href);
    u.hash = '';
    u.searchParams.delete('code');
    return u.toString();
  }

  function signInWithGoogle(provider) {
    return new Promise((resolve, reject) => {
      if (!configured) { reject(mkErr('auth/not-configured', 'Supabase is not configured yet. Fill in config.js.')); return; }
      sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectUrl(), queryParams: Object.assign({ prompt: 'select_account' }, (provider && provider._params) || {}) }
      }).then(({ error }) => {
        if (error) reject(mkErr('auth/internal-error', error.message));
        // On success the browser navigates to Google, so this promise simply stays pending.
      }, e => reject(mkErr('auth/network-request-failed', e.message)));
    });
  }

  const auth = {
    get currentUser() { return currentUser; },
    onAuthStateChanged(cb) {
      authCbs.push(cb);
      if (authReady) setTimeout(() => { if (authCbs.includes(cb)) cb(currentUser); }, 0);
      return () => { const i = authCbs.indexOf(cb); if (i >= 0) authCbs.splice(i, 1); };
    },
    signInWithPopup: signInWithGoogle,
    signInWithRedirect: signInWithGoogle,
    getRedirectResult: () => Promise.resolve({ user: currentUser }),
    setPersistence: () => Promise.resolve(),
    signOut: async () => {
      if (hadSession) rpcKeepalive('rtdb_session_end', { p_session: SESSION });
      const { error } = await sb.auth.signOut();
      if (error) throw mkErr('auth/internal-error', error.message);
    }
  };

  // ------------------------------------------------------------------
  // JSON helpers (Firebase Realtime Database semantics)
  // ------------------------------------------------------------------
  const DOC_DEPTH = { matchmaking: 3 };   // users/{uid}, rooms/{code}, matchmaking/{tc}/{uid}
  const TIMESTAMP = { '.sv': 'timestamp' };

  const segs = (p) => String(p == null ? '' : p).split('/').filter(Boolean);
  function docOf(s) {
    const d = DOC_DEPTH[s[0]] || 2;
    return s.length >= d ? { doc: s.slice(0, d).join('/'), sub: s.slice(d) } : null;
  }
  function getIn(v, sub) {
    for (const k of sub) {
      if (v == null || typeof v !== 'object') return null;
      v = v[k];
    }
    return v === undefined ? null : v;
  }
  const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));

  // Drop null / undefined / empty objects like Firebase does (empty arrays too).
  function normalize(v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'function' || typeof v === 'symbol') return null;
    if (typeof v === 'bigint') return Number(v);
    if (v instanceof Date) return v.getTime();
    if (Array.isArray(v)) {
      const out = v.map(normalize);
      while (out.length && out[out.length - 1] === null) out.pop();
      if (!out.length) return null;
      if (out.some(x => x === null)) { const o = {}; out.forEach((x, i) => { if (x !== null) o[i] = x; }); return o; }
      return out;
    }
    if (typeof v === 'object') {
      if (v['.sv'] !== undefined && Object.keys(v).length === 1) return { '.sv': v['.sv'] };
      const o = {};
      let n = 0;
      for (const k of Object.keys(v)) {
        const c = normalize(v[k]);
        if (c !== null) { o[k] = c; n++; }
      }
      return n ? o : null;
    }
    return v;
  }

  const typeRank = (x) => (x === null || x === undefined) ? 0 : x === false ? 1 : x === true ? 2 :
    typeof x === 'number' ? 3 : typeof x === 'string' ? 4 : 5;
  function cmpVal(a, b) {
    const ra = typeRank(a), rb = typeRank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 3) return a - b;
    if (ra === 4) return a < b ? -1 : a > b ? 1 : 0;
    return 0;
  }
  const INT_KEY = /^-?\d{1,10}$/;
  function cmpKey(a, b) {
    const ia = INT_KEY.test(a), ib = INT_KEY.test(b);
    if (ia && ib) return Number(a) - Number(b);
    if (ia) return -1;
    if (ib) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  // Children of a value as [key, value] pairs, ordered + filtered by a query.
  function orderedChildren(v, q) {
    if (v == null || typeof v !== 'object') return [];
    let kids = Object.keys(v).filter(k => v[k] !== null && v[k] !== undefined).map(k => [k, v[k]]);
    q = q || {};
    const by = q.orderBy || 'key';
    const sortVal = (pair) => by === 'child' ? getIn(pair[1], segs(q.child)) : by === 'value' ? pair[1] : pair[0];
    const cmp = (a, b) => by === 'key' ? cmpKey(a, b) : cmpVal(a, b);
    kids.sort((a, b) => (by === 'key' ? 0 : cmp(sortVal(a), sortVal(b))) || cmpKey(a[0], b[0]));
    if (q.equalTo !== undefined) kids = kids.filter(p => cmp(sortVal(p), q.equalTo) === 0);
    if (q.startAt !== undefined) kids = kids.filter(p => cmp(sortVal(p), q.startAt) >= 0);
    if (q.endAt !== undefined) kids = kids.filter(p => cmp(sortVal(p), q.endAt) <= 0);
    if (q.limitFirst) kids = kids.slice(0, q.limitFirst);
    if (q.limitLast) kids = kids.slice(Math.max(0, kids.length - q.limitLast));
    return kids;
  }
  const hasQuery = (q) => !!(q && Object.keys(q).length);
  function applyQuery(v, q) {
    if (!hasQuery(q)) return v;
    const kids = orderedChildren(v, q);
    if (!kids.length) return null;
    const o = {};
    kids.forEach(([k, val]) => { o[k] = val; });
    return o;
  }

  // Firebase-style chronological push ids
  const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  let lastPushTime = 0;
  const lastRand = [];
  function pushId() {
    let now = Date.now() + serverOffset;
    const dup = now === lastPushTime;
    lastPushTime = now;
    const ts = new Array(8);
    for (let i = 7; i >= 0; i--) { ts[i] = PUSH_CHARS.charAt(now % 64); now = Math.floor(now / 64); }
    let id = ts.join('');
    if (!dup) { for (let i = 0; i < 12; i++) lastRand[i] = Math.floor(Math.random() * 64); }
    else {
      let i = 11;
      for (; i >= 0 && lastRand[i] === 63; i--) lastRand[i] = 0;
      if (i >= 0) lastRand[i]++;
    }
    for (let i = 0; i < 12; i++) id += PUSH_CHARS.charAt(lastRand[i]);
    return id;
  }

  function uuid4() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.random() * 256 | 0; });
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // ------------------------------------------------------------------
  // Document cache + realtime subscriptions
  // ------------------------------------------------------------------
  const docs = new Map();      // doc -> { data, version, loaded, subs, channel }
  const listeners = [];        // registered .on() listeners
  let chanSeq = 0;

  function docState(doc) {
    let s = docs.get(doc);
    if (!s) { s = { data: null, version: 0, loaded: false, subs: 0, channel: null }; docs.set(doc, s); }
    return s;
  }

  function setDoc(doc, data, version, force) {
    const s = docState(doc);
    if (!force && s.loaded && version < s.version) return;
    if (!force && s.loaded && version === s.version) { notifyDoc(doc); return; }
    s.data = data === undefined ? null : data;
    s.version = version;
    s.loaded = true;
    notifyDoc(doc);
  }

  async function fetchDoc(doc) {
    const { data, error } = await sb.from('rtdb').select('data,version').eq('doc', doc).maybeSingle();
    if (error) throw fromSbError(error);
    const s = docState(doc);
    const v = data ? Number(data.version) : 0;
    if (!s.loaded || v >= s.version || (v === 0 && s.version > 0 && !data)) {
      s.data = data ? data.data : null;
      s.version = v;
      s.loaded = true;
    }
    notifyDoc(doc);
    return { data: s.data, version: s.version };
  }

  async function refreshDocs(list) {
    if (!list.length || !currentUser) return;
    for (let i = 0; i < list.length; i += 50) {
      const part = list.slice(i, i + 50);
      const { data, error } = await sb.from('rtdb').select('doc,data,version').in('doc', part);
      if (error) continue;
      const seen = new Set();
      (data || []).forEach(r => { seen.add(r.doc); setDoc(r.doc, r.data, Number(r.version)); });
      part.forEach(d => { if (!seen.has(d)) { const s = docState(d); if (!s.loaded) setDoc(d, null, 0); } });
    }
  }

  function openChannel(doc) {
    const s = docState(doc);
    const ch = sb.channel('rtdb-' + (++chanSeq) + '-' + Date.now().toString(36));
    s.channel = ch;
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'rtdb', filter: 'doc=eq.' + doc }, (payload) => {
      const row = payload.new;
      if (!row || row.doc !== doc) return;
      if ((payload.errors && payload.errors.length) || !('data' in row) || row.version == null) {
        fetchDoc(doc).catch(() => {});
        return;
      }
      setDoc(doc, row.data, Number(row.version), payload.eventType === 'INSERT' && Number(row.version) === 1 && s.version > 1);
    }).subscribe((status) => {
      if (s.channel !== ch) return;
      if (status === 'SUBSCRIBED') fetchDoc(doc).catch(() => {});
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        setTimeout(() => {
          if (s.channel !== ch || s.subs <= 0) return;
          try { sb.removeChannel(ch); } catch (_) {}
          s.channel = null;
          openChannel(doc);
        }, 3000);
      }
    });
    fetchDoc(doc).catch(() => {});
  }

  function retainDoc(doc) {
    const s = docState(doc);
    s.subs++;
    if (s.subs === 1 || !s.channel) openChannel(doc);
  }

  function releaseDoc(doc) {
    const s = docs.get(doc);
    if (!s) return;
    s.subs = Math.max(0, s.subs - 1);
    if (!s.subs && s.channel) {
      const ch = s.channel;
      s.channel = null;
      try { sb.removeChannel(ch); } catch (_) {}
    }
  }

  // Safety net: re-read live documents after the tab wakes up / every 20 s.
  function refreshLiveDocs() {
    const live = [];
    docs.forEach((s, d) => { if (s.subs > 0) live.push(d); });
    refreshDocs(live).catch(() => {});
    listeners.forEach(L => { if (!L.doc && L.poll) L.poll(); });
  }
  setInterval(() => { if (!document.hidden) refreshLiveDocs(); }, 20000);

  // ------------------------------------------------------------------
  // Listener evaluation
  // ------------------------------------------------------------------
  function notifyDoc(doc) {
    listeners.slice().forEach(L => { if (L.doc === doc && listeners.includes(L)) evalListener(L, getIn(docs.get(doc).data, L.sub)); });
  }

  function fire(L, snap, prevKey) {
    try { L.cb.call(L.ctx || null, snap, prevKey === undefined ? null : prevKey); }
    catch (e) { console.error('Listener error:', e); }
  }

  function evalListener(L, raw) {
    raw = raw === undefined ? null : raw;
    if (L.type === 'value') {
      const v = applyQuery(raw, L.ref._q);
      const key = JSON.stringify(v);
      if (L.last === key) return;
      L.last = key;
      fire(L, new DataSnapshot(L.ref, clone(v), L.ref._q));
      return;
    }
    const kids = orderedChildren(raw, L.ref._q);
    const now = new Map(kids.map(([k, v]) => [k, JSON.stringify(v)]));
    const first = !L.started;
    L.started = true;
    if (L.type === 'child_added') {
      kids.forEach(([k, v], i) => {
        if (!L.seen.has(k)) fire(L, new DataSnapshot(L.ref.child(k), clone(v)), i ? kids[i - 1][0] : null);
      });
    } else if (L.type === 'child_changed' && !first) {
      kids.forEach(([k, v], i) => {
        if (L.seen.has(k) && L.seen.get(k) !== now.get(k)) fire(L, new DataSnapshot(L.ref.child(k), clone(v)), i ? kids[i - 1][0] : null);
      });
    } else if (L.type === 'child_removed' && !first) {
      L.seen.forEach((json, k) => {
        if (!now.has(k)) fire(L, new DataSnapshot(L.ref.child(k), json === undefined ? null : JSON.parse(json)));
      });
    }
    L.seen = now;
  }

  // ------------------------------------------------------------------
  // Write queue (keeps writes in order, batches them into one call)
  // ------------------------------------------------------------------
  const wq = [];
  let flushing = false;
  let idleWaiters = [];

  function applyResult(rows) {
    (rows || []).forEach(r => setDoc(r.doc, r.data, Number(r.version)));
  }

  function enqueueOps(ops) {
    if (!ops.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
      wq.push({ ops, resolve, reject });
      if (!flushing) flushQueue();
    });
  }

  async function flushQueue() {
    flushing = true;
    while (wq.length) {
      const batch = wq.splice(0, 40);
      const ops = [].concat(...batch.map(b => b.ops));
      try {
        applyResult(await rpc('rtdb_apply', { p_ops: ops }));
        batch.forEach(b => b.resolve());
      } catch (err) {
        if (batch.length === 1) { batch[0].reject(err); continue; }
        for (const b of batch) {
          try { applyResult(await rpc('rtdb_apply', { p_ops: b.ops })); b.resolve(); }
          catch (e) { b.reject(e); }
        }
      }
    }
    flushing = false;
    const w = idleWaiters;
    idleWaiters = [];
    w.forEach(f => f());
  }

  function writesIdle() {
    return (!flushing && !wq.length) ? Promise.resolve() : new Promise(r => idleWaiters.push(r));
  }

  function opsForSet(s, value) {
    const info = docOf(s);
    if (info) return [{ d: info.doc, p: info.sub, v: value }];
    if (!s.length) throw mkErr('invalid-argument', 'Writing to the database root is not supported.');
    const ops = [{ prefix: s.join('/') }];
    if (value && typeof value === 'object' && value['.sv'] === undefined) {
      Object.keys(value).forEach(k => { ops.push(...opsForSet(s.concat(segs(k)), value[k])); });
    }
    return ops;
  }

  function opsForUpdate(s, obj) {
    const ops = [];
    Object.keys(obj || {}).forEach(k => { ops.push(...opsForSet(s.concat(segs(k)), normalize(obj[k]))); });
    return ops;
  }

  function withCallback(p, onComplete) {
    if (typeof onComplete === 'function') p.then(() => onComplete(null), e => onComplete(e));
    return p;
  }

  // Reads below the document level (e.g. "users" search) are assembled from several documents.
  const likeEscape = (s) => String(s).replace(/[\\%_]/g, '\\$&');
  async function fetchShallow(s, q) {
    const prefix = s.join('/');
    let req = sb.from('rtdb').select('doc,data').not('data', 'is', null);
    if (prefix) req = req.like('doc', likeEscape(prefix) + '/%');
    const depth = DOC_DEPTH[s[0]] || 2;
    if (q && q.orderBy === 'child' && s.length + 1 === depth && /^[A-Za-z0-9_]+$/.test(q.child || '')) {
      const col = 'data->>' + q.child;
      if (q.equalTo !== undefined && q.equalTo !== null) req = req.eq(col, String(q.equalTo));
      else if (typeof q.startAt === 'string' && q.endAt === q.startAt + '') req = req.like(col, likeEscape(q.startAt) + '%');
      if (q.limitFirst && q.equalTo === undefined) req = req.order(col, { ascending: true }).limit(q.limitFirst * 2 + 10);
    }
    const { data, error } = await req.limit(1000);
    if (error) throw fromSbError(error);
    let tree = null;
    (data || []).forEach(r => {
      const rel = segs(r.doc.slice(prefix.length));
      if (!rel.length) return;
      tree = tree || {};
      let node = tree;
      rel.slice(0, -1).forEach(k => { node = node[k] = (node[k] && typeof node[k] === 'object') ? node[k] : {}; });
      node[rel[rel.length - 1]] = r.data;
    });
    return applyQuery(tree, q);
  }

  // ------------------------------------------------------------------
  // .info/connected + .info/serverTimeOffset + onDisconnect sessions
  // ------------------------------------------------------------------
  const SESSION = uuid4();
  let connected = false;
  let everConnected = false;
  let hadSession = false;
  let serverOffset = 0;
  let beatTimer = null;
  const infoListeners = [];

  function infoValue(path) {
    if (path === '.info/connected') return connected;
    if (path === '.info/serverTimeOffset') return serverOffset;
    return null;
  }
  function emitInfo(path) {
    infoListeners.slice().forEach(L => { if (L.path === path) fire(L, new DataSnapshot(L.ref, infoValue(path))); });
  }
  function setConnected(v) {
    if (connected === v) return;
    connected = v;
    emitInfo('.info/connected');
  }

  async function beat() {
    if (!currentUser || !configured) { setConnected(false); return; }
    const t0 = Date.now();
    try {
      const r = await rpc('rtdb_session_beat', { p_session: SESSION });
      const t1 = Date.now();
      const off = Math.round(Number(r && r.now) - (t0 + t1) / 2);
      if (Number.isFinite(off) && Math.abs(off - serverOffset) > 50) { serverOffset = off; emitInfo('.info/serverTimeOffset'); }
      if (r && r.existed === false && everConnected) setConnected(false); // the server dropped our session
      everConnected = true;
      setConnected(true);
    } catch (_) {
      setConnected(false);
    }
  }

  function startHeartbeat() {
    if (beatTimer) return;
    beat();
    beatTimer = setInterval(beat, 10000);
  }
  function stopHeartbeat() {
    clearInterval(beatTimer);
    beatTimer = null;
    setConnected(false);
  }

  function onAuthChangedInternal(changed) {
    if (currentUser) { startHeartbeat(); if (changed) refreshLiveDocs(); }
    else stopHeartbeat();
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) { beat(); refreshLiveDocs(); } });
  window.addEventListener('online', () => { beat(); refreshLiveDocs(); });
  window.addEventListener('offline', () => setConnected(false));
  window.addEventListener('pagehide', () => { if (hadSession) rpcKeepalive('rtdb_session_end', { p_session: SESSION }); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) { everConnected = true; beat(); refreshLiveDocs(); } });

  class OnDisconnect {
    constructor(ref) { this._ref = ref; }
    async _add(ops) {
      if (!currentUser) return;
      await rpc('rtdb_ondisconnect_add', { p_session: SESSION, p_path: this._ref.path, p_ops: ops });
      hadSession = true;
      startHeartbeat();
    }
    set(v, cb) { return withCallback(this._add(opsForSet(this._ref._s, normalize(v))), cb); }
    update(obj, cb) { return withCallback(this._add(opsForUpdate(this._ref._s, obj)), cb); }
    remove(cb) { return this.set(null, cb); }
    cancel(cb) {
      const p = currentUser ? rpc('rtdb_ondisconnect_cancel', { p_session: SESSION, p_path: this._ref.path }).then(() => {}) : Promise.resolve();
      return withCallback(p, cb);
    }
  }

  // ------------------------------------------------------------------
  // DataSnapshot + Reference
  // ------------------------------------------------------------------
  class DataSnapshot {
    constructor(ref, value, q) { this.ref = ref; this.key = ref.key; this._v = value === undefined ? null : value; this._q = q || null; }
    val() { return clone(this._v); }
    exportVal() { return this.val(); }
    toJSON() { return this.val(); }
    exists() { return this._v !== null; }
    child(p) { return new DataSnapshot(this.ref.child(p), getIn(this._v, segs(p))); }
    hasChild(p) { return this.child(p).exists(); }
    hasChildren() { return !!this._v && typeof this._v === 'object' && Object.keys(this._v).length > 0; }
    numChildren() { return this.hasChildren() ? Object.keys(this._v).length : 0; }
    forEach(cb) {
      for (const [k, v] of orderedChildren(this._v, this._q)) {
        if (cb(new DataSnapshot(this.ref.child(k), v)) === true) return true;
      }
      return false;
    }
  }

  class Reference {
    constructor(path, q) {
      this._s = segs(path);
      this._q = q || null;
      this.path = this._s.join('/');
      this.key = this._s.length ? this._s[this._s.length - 1] : null;
    }
    get parent() { return this._s.length ? new Reference(this._s.slice(0, -1).join('/')) : null; }
    get root() { return new Reference(''); }
    get ref() { return new Reference(this.path); }
    child(p) { return new Reference(this._s.concat(segs(p)).join('/')); }
    toString() { return CFG.url + '/rtdb/' + this.path; }
    isEqual(o) { return !!o && o.path === this.path && JSON.stringify(o._q) === JSON.stringify(this._q); }
    _withQ(patch) { return new Reference(this.path, Object.assign({}, this._q, patch)); }
    orderByChild(c) { return this._withQ({ orderBy: 'child', child: c }); }
    orderByKey() { return this._withQ({ orderBy: 'key' }); }
    orderByValue() { return this._withQ({ orderBy: 'value' }); }
    startAt(v) { return this._withQ({ startAt: v }); }
    endAt(v) { return this._withQ({ endAt: v }); }
    equalTo(v) { return this._withQ({ equalTo: v }); }
    limitToFirst(n) { return this._withQ({ limitFirst: n }); }
    limitToLast(n) { return this._withQ({ limitLast: n }); }

    set(value, cb) {
      let ops;
      try { ops = opsForSet(this._s, normalize(value)); } catch (e) { return withCallback(Promise.reject(e), cb); }
      return withCallback(enqueueOps(ops), cb);
    }
    update(obj, cb) {
      let ops;
      try { ops = opsForUpdate(this._s, obj); } catch (e) { return withCallback(Promise.reject(e), cb); }
      return withCallback(enqueueOps(ops), cb);
    }
    remove(cb) { return this.set(null, cb); }
    push(value, cb) {
      const ref = this.child(pushId());
      const plain = new Reference(ref.path);
      const p = value === undefined ? Promise.resolve(plain) : ref.set(value, cb).then(() => plain);
      ref.then = p.then.bind(p);
      ref.catch = p.catch.bind(p);
      return ref;
    }
    onDisconnect() { return new OnDisconnect(this); }

    async _read() {
      if (this.path.startsWith('.info')) return infoValue(this.path);
      await writesIdle();
      const info = docOf(this._s);
      if (info) {
        const r = await fetchDoc(info.doc);
        return applyQuery(getIn(r.data, info.sub), this._q);
      }
      return fetchShallow(this._s, this._q);
    }
    get() { return this._read().then(v => new DataSnapshot(this, clone(v), this._q)); }
    once(type, cb, errCb) {
      type = type || 'value';
      const p = this._read().then(v => {
        if (type === 'value') return new DataSnapshot(this, clone(v), this._q);
        const kids = orderedChildren(v, this._q);
        return kids.length ? new DataSnapshot(this.child(kids[0][0]), clone(kids[0][1])) : new DataSnapshot(this, null);
      });
      if (typeof cb === 'function') p.then(s => cb(s), e => { if (typeof errCb === 'function') errCb(e); else console.warn(e); });
      return p;
    }

    on(type, cb, errCbOrCtx, ctx) {
      if (typeof cb !== 'function') return cb;
      const context = (errCbOrCtx && typeof errCbOrCtx === 'object') ? errCbOrCtx : ctx;
      if (this.path.startsWith('.info')) {
        const L = { path: this.path, ref: this, type, cb, ctx: context };
        infoListeners.push(L);
        setTimeout(() => { if (infoListeners.includes(L)) fire(L, new DataSnapshot(this, infoValue(this.path))); }, 0);
        return cb;
      }
      const info = docOf(this._s);
      const L = { ref: this, path: this.path, qkey: JSON.stringify(this._q), type, cb, ctx: context, seen: new Map(), started: false, last: undefined,
        doc: info ? info.doc : null, sub: info ? info.sub : null };
      listeners.push(L);
      if (info) {
        const s = docState(info.doc);
        const wasLive = s.subs > 0 && s.loaded;
        retainDoc(info.doc);
        if (wasLive) setTimeout(() => { if (listeners.includes(L)) evalListener(L, getIn(s.data, L.sub)); }, 0);
      } else {
        // Rare: live listener above document level → light polling.
        L.poll = () => fetchShallow(this._s, null).then(v => { if (listeners.includes(L)) evalListener(L, v); }).catch(() => {});
        L.poll();
        L.timer = setInterval(L.poll, 4000);
      }
      return cb;
    }

    off(type, cb) {
      const qkey = JSON.stringify(this._q);
      if (this.path.startsWith('.info')) {
        for (let i = infoListeners.length - 1; i >= 0; i--) {
          const L = infoListeners[i];
          if (L.path === this.path && (!type || L.type === type) && (!cb || L.cb === cb)) infoListeners.splice(i, 1);
        }
        return;
      }
      for (let i = listeners.length - 1; i >= 0; i--) {
        const L = listeners[i];
        if (L.path !== this.path || (this._q && L.qkey !== qkey)) continue;
        if (type && L.type !== type) continue;
        if (cb && L.cb !== cb) continue;
        listeners.splice(i, 1);
        if (L.doc) releaseDoc(L.doc);
        if (L.timer) clearInterval(L.timer);
      }
    }

    async transaction(fn, onComplete) {
      const info = docOf(this._s);
      try {
        if (!info) throw mkErr('invalid-argument', 'Transactions must target a single document path.');
        await writesIdle();
        let { data, version } = await fetchDoc(info.doc);
        let committed = false;
        let finalVal = null;
        for (let attempt = 0; attempt < 30; attempt++) {
          const cur = clone(getIn(data, info.sub));
          const next = fn(cur);
          if (next === undefined) { finalVal = cur; break; }
          const r = await rpc('rtdb_cas', { p_doc: info.doc, p_path: info.sub, p_expected: version, p_value: normalize(next) });
          setDoc(info.doc, r.data, Number(r.version), true);
          data = r.data;
          version = Number(r.version);
          if (r.ok) { committed = true; finalVal = getIn(r.data, info.sub); break; }
          if (attempt === 29) throw mkErr('aborted', 'Too many concurrent changes. Please try again.');
        }
        const snapshot = new DataSnapshot(this, clone(finalVal));
        if (typeof onComplete === 'function') onComplete(null, committed, snapshot);
        return { committed, snapshot };
      } catch (err) {
        if (typeof onComplete === 'function') { onComplete(err, false, null); }
        throw err;
      }
    }
  }

  // ------------------------------------------------------------------
  // firebase.* global used by script.js
  // ------------------------------------------------------------------
  const database = {
    ref: (p) => new Reference(p || ''),
    goOnline() {}, goOffline() {}
  };
  const databaseFn = function () { return database; };
  databaseFn.ServerValue = { TIMESTAMP };
  const authFn = function () { return auth; };
  authFn.GoogleAuthProvider = GoogleAuthProvider;
  authFn.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } };
  const app = { name: '[DEFAULT]', options: { projectId: 'supabase' }, auth: authFn, database: databaseFn };

  window.firebase = {
    apps: [app],
    initializeApp: () => app,
    app: () => app,
    auth: authFn,
    database: databaseFn
  };
})();

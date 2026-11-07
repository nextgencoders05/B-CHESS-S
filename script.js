// ==========================================
// 1. BACKEND (Supabase — see config.js, supabase-compat.js, supabase/schema.sql)
// ==========================================
// supabase-compat.js provides the small firebase-style API used below
// (auth + realtime database refs), backed by Supabase.
const auth = firebase.auth();
const database = firebase.database();

// Global User & Multiplayer State
let currentUserId = null;
let currentUserName = "Player";
let currentUserPhoto = "";
let currentUserRating = 800;
let currentRoomCode = null;
let myOnlineColor = 'w';
let isOnlineMatchActive = false;
let selectedFriendTimeControl = 600;
let friendTimeChosen = false;
let friendTimeControl = 0;
let whiteTimeLeft = 0;
let blackTimeLeft = 0;
let friendClockInterval = null;
let friendClockStartedAt = null;
let friendClockTurn = null;
let friendClockExpiredHandled = false;
let friendRoomListenerRef = null;
let friendChatListenerRef = null;
let friendHistorySavedCodes = new Set();
let pendingPromotionMove = null;
let friendProfileListeners = [];
let friendRoomData = null;
let challengeListenerRef = null;
let challengeNotificationMap = {};
let friendResultData = null;
let isWaitingForOpponent = false;
let waitingChallengeTargetId = null;
let selfCancellingChallenge = false;
let boardPlayerInfo = null; // { w:{name,rating}, b:{name,rating} } while a match is on the board
let challengeToastCode = null;
let pendingChallengeDeepLink = null; // { code, action } from a tapped browser notification
let serverTimeOffset = 0;
let quickMatch = null; // active Quick Match search (see QUICK MATCH section)
let quickBot = null;   // active Quick Match game against the fallback opponent
database.ref('.info/serverTimeOffset').on('value', s => { serverTimeOffset = Number(s.val()) || 0; });

// WebRTC Live Voice Chat State
let peerConnection = null;
let audioTransceiver = null;
let localVoiceStream = null;
let isMicMuted = true;
const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    // TURN relay fallback so voice works across different networks / mobile data
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" }
  ]
};

// --- MODE LOCKING (Blocks switching to Analysis / Bot during live match) ---
function lockModeButtons(lock) {
  isOnlineMatchActive = lock;
  const analyzeBtn = document.getElementById('modeAnalyzeBtn');
  const botBtn = document.getElementById('modeBotBtn');

  if (lock) {
    if (analyzeBtn) {
      analyzeBtn.disabled = true;
      analyzeBtn.style.opacity = "0.4";
      analyzeBtn.style.cursor = "not-allowed";
      analyzeBtn.title = "மேட்ச் முடியும் வரை அனலைஸ் செல்ல முடியாது";
    }
    if (botBtn) {
      botBtn.disabled = true;
      botBtn.style.opacity = "0.4";
      botBtn.style.cursor = "not-allowed";
      botBtn.title = "மேட்ச் முடியும் வரை பாட் மோடு செல்ல முடியாது";
    }
  } else {
    if (analyzeBtn) {
      analyzeBtn.disabled = false;
      analyzeBtn.style.opacity = "1";
      analyzeBtn.style.cursor = "pointer";
      analyzeBtn.title = "";
    }
    if (botBtn) {
      botBtn.disabled = false;
      botBtn.style.opacity = "1";
      botBtn.style.cursor = "pointer";
      botBtn.title = "";
    }
  }
}

// --- TERMS & CONDITIONS ---
const TERMS_VERSION = '1.0';
const TERMS_STORAGE_KEY = 'bChessTermsAcceptedVersion';

function hasAcceptedTerms() {
  return localStorage.getItem(TERMS_STORAGE_KEY) === TERMS_VERSION;
}

function showTermsModal() {
  const modal = document.getElementById('termsModal');
  const checkbox = document.getElementById('termsAcceptCheckbox');
  const error = document.getElementById('termsError');
  if (!modal) return;
  if (checkbox) checkbox.checked = false;
  if (error) error.textContent = '';
  modal.style.display = 'flex';
}

function closeTermsModal() {
  const modal = document.getElementById('termsModal');
  if (modal) modal.style.display = 'none';
}

function requireTermsAccepted() {
  if (hasAcceptedTerms()) return true;
  showTermsModal();
  return false;
}

function acceptTermsAndContinue() {
  const checkbox = document.getElementById('termsAcceptCheckbox');
  const error = document.getElementById('termsError');
  if (!checkbox || !checkbox.checked) {
    if (error) error.textContent = 'Please tick the checkbox to continue.';
    return;
  }
  localStorage.setItem(TERMS_STORAGE_KEY, TERMS_VERSION);
  closeTermsModal();

  // Preserve the existing first-time profile setup flow after terms acceptance.
  const user = auth.currentUser;
  if (user) {
    database.ref("users/" + user.uid).once("value").then((snap) => {
      const data = snap.val() || {};
      if (!data.username) openProfileModal(true);
    });
  }
}

// --- GOOGLE SIGN-IN (Popup Blocker Fix & Redirect Fallback) ---
function triggerGoogleLogin() {
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch((error) => {
    console.warn("Popup blocked or closed:", error.message);
    if (error.code === 'auth/popup-blocked') {
      auth.signInWithRedirect(provider);
    } else if (error.code !== 'auth/popup-closed-by-user') {
      alert("Sign-in issue: " + error.message);
    }
  });
}

auth.getRedirectResult().catch(err => console.log(err));

auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUserId = user.uid;
    const loginBtn = document.getElementById("googleLoginBtn");
    const userProfile = document.getElementById("userProfile");
    if (loginBtn) loginBtn.style.display = "none";
    if (userProfile) userProfile.style.display = "inline-flex";
    const challengeWrap = document.getElementById('challengeNotificationWrap');
    if (challengeWrap) challengeWrap.style.display = 'inline-block';

    const snap = await database.ref("users/" + user.uid).once("value");
    const data = snap.val() || {};
    currentUserName = data.username || data.name || user.displayName || "Player";
    currentUserPhoto = data.photoData || user.photoURL || "";
    updateProfileUI();
    startChallengeNotifications();
    setTimeout(handleIncomingFriendLink, 250);

    // After Google sign-in, require Terms & Conditions acceptance once per terms version.
    if (!hasAcceptedTerms()) {
      showTermsModal();
    } else if (!data.username) {
      openProfileModal(true);
    }

    if (!data.rating) {
      const modal = document.getElementById("skillModal");
      if (modal && data.username) modal.style.display = "flex";
    } else {
      currentUserRating = data.rating;
      const ratingDisplay = document.getElementById("userRatingDisplay");
      if (ratingDisplay) ratingDisplay.textContent = currentUserRating;
    }
  } else {
    if (challengeListenerRef) { challengeListenerRef.off(); challengeListenerRef = null; }
    challengeNotificationMap = {};
    currentUserId = null;
    currentUserName = "Player";
    currentUserPhoto = "";
    const loginBtn = document.getElementById("googleLoginBtn");
    const userProfile = document.getElementById("userProfile");
    if (loginBtn) loginBtn.style.display = "inline-flex";
    if (userProfile) userProfile.style.display = "none";
    const challengeWrap = document.getElementById('challengeNotificationWrap');
    if (challengeWrap) challengeWrap.style.display = 'none';
    const challengeBox = document.getElementById('challengeNotificationBox');
    if (challengeBox) challengeBox.style.display = 'none';
  }
});

function updateProfileUI() {
  const nameDisplay = document.getElementById("userNameDisplay");
  const avatar = document.getElementById("userAvatarImg");
  const fallback = document.getElementById("userAvatarFallback");
  if (nameDisplay) nameDisplay.textContent = currentUserName;
  if (currentUserPhoto) {
    if (avatar) { avatar.src = currentUserPhoto; avatar.style.display = "block"; }
    if (fallback) fallback.style.display = "none";
  } else {
    if (avatar) avatar.style.display = "none";
    if (fallback) {
      fallback.textContent = (currentUserName || "P").charAt(0).toUpperCase();
      fallback.style.display = "inline-flex";
    }
  }
}

function openProfileModal(firstSetup = false) {
  const modal = document.getElementById("profileModal");
  const usernameInput = document.getElementById("profileUsernameInput");
  const photoInput = document.getElementById("profilePhotoInput");
  const preview = document.getElementById("profilePreviewImg");
  const fallback = document.getElementById("profilePreviewFallback");
  const cancelBtn = document.getElementById("cancelProfileBtn");
  const status = document.getElementById("profileSaveStatus");
  if (!modal) return;

  if (usernameInput) usernameInput.value = currentUserName === "Player" ? "" : currentUserName;
  if (photoInput) photoInput.value = "";
  if (status) status.textContent = "";

  if (currentUserPhoto) {
    if (preview) { preview.src = currentUserPhoto; preview.style.display = "block"; }
    if (fallback) fallback.style.display = "none";
  } else {
    if (preview) preview.style.display = "none";
    if (fallback) {
      fallback.textContent = (currentUserName || "P").charAt(0).toUpperCase();
      fallback.style.display = "inline-flex";
    }
  }
  if (cancelBtn) cancelBtn.style.display = firstSetup ? "none" : "inline-block";
  modal.dataset.firstSetup = firstSetup ? "true" : "false";
  modal.style.display = "flex";
}

function closeProfileModal() {
  const modal = document.getElementById("profileModal");
  if (modal) modal.style.display = "none";
}

function readAndResizeProfilePhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 256, canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject; img.src = reader.result;
    };
    reader.onerror = reject; reader.readAsDataURL(file);
  });
}

async function saveUserProfile() {
  if (!currentUserId) return;
  const usernameInput = document.getElementById("profileUsernameInput");
  const photoInput = document.getElementById("profilePhotoInput");
  const status = document.getElementById("profileSaveStatus");
  const saveBtn = document.getElementById("saveProfileBtn");
  const username = (usernameInput?.value || "").trim().replace(/\s+/g, " ");

  if (!username) { if (status) status.textContent = "Please enter a username."; return; }
  if (username.length < 2) { if (status) status.textContent = "Username must be at least 2 characters."; return; }

  try {
    if (saveBtn) saveBtn.disabled = true;
    if (status) status.textContent = "Saving...";
    let photoData = currentUserPhoto;
    if (photoInput?.files?.[0]) photoData = await readAndResizeProfilePhoto(photoInput.files[0]);

    await database.ref("users/" + currentUserId).update({
      username, name: username, photoData: photoData || ""
    });
    currentUserName = username;
    currentUserPhoto = photoData || "";
    updateProfileUI();
    closeProfileModal();

    const modal = document.getElementById("skillModal");
    const snap = await database.ref("users/" + currentUserId).once("value");
    const data = snap.val() || {};
    if (modal && !data.rating) modal.style.display = "flex";
  } catch (err) {
    console.error("Profile save error:", err);
    if (status) status.textContent = "Could not save profile: " + err.message;
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function handleLogout() {
  auth.signOut().then(() => window.location.reload());
}

function selectSkillLevel(level) {
  let initial = 800;
  if (level === 'intermediate') initial = 1200;
  if (level === 'advanced') initial = 1600;

  if (currentUserId) {
    database.ref("users/" + currentUserId).update({
      username: currentUserName,
      name: currentUserName,
      photoData: currentUserPhoto || "",
      rating: initial,
      skillLevel: level
    }).then(() => {
      currentUserRating = initial;
      const ratingDisplay = document.getElementById("userRatingDisplay");
      if (ratingDisplay) ratingDisplay.textContent = initial;
      const modal = document.getElementById("skillModal");
      if (modal) modal.style.display = "none";
    });
  }
}

// --- MULTIPLAYER ROOM & GAME LOGIC ---
function createFriendRoom() {
  if (!currentUserId) {
    alert("Please Sign in with Google first!");
    return triggerGoogleLogin();
  }
  if (!requireTermsAccepted()) return;
  showFriendTimeModal((seconds) => {
    selectedFriendTimeControl = Number(seconds) || 0;
    friendTimeChosen = true;
    createFriendRoomWithTime(selectedFriendTimeControl);
  });
}

function generateRoomCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function buildRoomPayload(timeSeconds, extra = {}) {
  return Object.assign({
    creatorId: currentUserId,
    creatorName: currentUserName,
    creatorRating: currentUserRating,
    guestId: null,
    guestName: null,
    gameFen: 'start',
    status: 'waiting',
    timeControl: Number(timeSeconds) || 0,
    gameOver: false,
    challengeFriendId: null,
    challengeFriendName: null,
    moveHistory: []
  }, extra);
}

// Local state for the room creator (White) before the room goes live.
function prepareCreatorRoomState(code, timeSeconds, guestId = null, guestName = null) {
  currentRoomCode = code;
  myOnlineColor = 'w';
  friendTimeControl = Number(timeSeconds) || 0;
  friendRoomData = { creatorId: currentUserId, creatorName: currentUserName, creatorRating: currentUserRating, creatorPhoto: currentUserPhoto || '', guestId: guestId || null, guestName: guestName || null, guestRating: null, guestPhoto: '' };
  board.orientation('white');
  game.reset();
  board.start();
  lockModeButtons(true);
  resetFriendClockUI();
}

function activateCreatorRoom(code) {
  document.getElementById("activeRoomInfo").style.display = "flex";
  document.getElementById("activeRoomCode").textContent = code;
  updateTimeControlUI();
  listenToRoom(code, true);
  startVoiceChat(code, true);
}

function createFriendRoomWithTime(timeSeconds, challengeFriendId = null, challengeFriendName = null, challengeFriendRating = null) {
  const code = generateRoomCode();
  prepareCreatorRoomState(code, timeSeconds, challengeFriendId, challengeFriendName);
  // Match must not start until the opponent accepts.
  waitingChallengeTargetId = challengeFriendId || null;
  setWaitingForOpponent(true);
  if (challengeFriendId) showChallengeSentStatus(challengeFriendId, challengeFriendName, challengeFriendRating, friendTimeControl);
  else setWaitingDetails('Waiting for Opponent...', 'Room ' + code + ' • ' + friendTimeLabel(friendTimeControl), 'Share the room code. The match starts once your opponent joins.');

  database.ref("rooms/" + code).set(buildRoomPayload(friendTimeControl, {
    challengeFriendId: challengeFriendId || null,
    challengeFriendName: challengeFriendName || null
  })).then(() => {
    activateCreatorRoom(code);
    if (challengeFriendId) {
      const label = friendTimeLabel(friendTimeControl);
      database.ref('users/' + challengeFriendId + '/challenges/' + code).set({fromId: currentUserId, fromName: currentUserName, fromRating: currentUserRating, fromPhoto: currentUserPhoto || '', timeControl: friendTimeControl, timeLabel: label, message: currentUserName + ' challenged you to a ' + label + ' game!', createdAt: firebase.database.ServerValue.TIMESTAMP});
    }
  });
}

// --- WAITING / CHALLENGE-SENT STATUS (shown on the existing waiting overlay) ---
function setWaitingDetails(title, detail, sub) {
  const t = document.getElementById('waitingText');
  const d = document.getElementById('waitingDetail');
  const s = document.getElementById('waitingSub');
  if (t) t.textContent = title || 'Waiting for Opponent...';
  if (d) { d.textContent = detail || ''; d.style.display = detail ? 'block' : 'none'; }
  if (s) s.textContent = sub || '';
}

function showChallengeSentStatus(friendId, friendName, friendRating, timeSeconds) {
  const name = friendName || 'Player';
  const render = (rating) => setWaitingDetails(
    'Challenge sent to ' + name,
    name + (rating ? ' • ' + rating + ' Elo' : '') + ' • ' + friendTimeLabel(timeSeconds),
    'Waiting for opponent to accept...'
  );
  render(friendRating);
  // Use the opponent's live rating (the friends list copy can be outdated).
  database.ref('users/' + friendId + '/rating').once('value').then(snap => {
    const live = Number(snap.val());
    if (live && isWaitingForOpponent && waitingChallengeTargetId === friendId) render(live);
  }).catch(() => {});
}

function joinFriendRoom(codeOverride, onFail) {
  if (!currentUserId) {
    alert("Please Sign in with Google first!");
    return triggerGoogleLogin();
  }
  if (!requireTermsAccepted()) return;
  const fail = (msg) => (typeof onFail === 'function' ? onFail(msg) : alert(msg));
  const code = (typeof codeOverride === 'string' ? codeOverride : document.getElementById("roomCodeInput").value).trim().toUpperCase();
  if (!code) return alert("Enter Room Code");

  const roomRef = database.ref("rooms/" + code);
  roomRef.once("value", (snap) => {
    const val = snap.val();
    if (!val) return fail("Invalid room code!");
    if (val.gameOver) return fail("This game has already ended.");
    if (val.guestId && val.guestId !== currentUserId) return fail("This room already has a player.");

    currentRoomCode = code;
    myOnlineColor = 'b';
    friendTimeControl = Number(val.timeControl) || 0;
    friendRoomData = val;
    board.orientation('black');
    lockModeButtons(true);
    resetFriendClockUI();

    roomRef.transaction((cur) => {
      if (cur === null) return cur;
      if (cur.gameOver || (cur.guestId && cur.guestId !== currentUserId)) return;
      return Object.assign({}, cur, {
        guestId: currentUserId,
        guestName: currentUserName,
        guestRating: currentUserRating,
        status: 'playing',
        gameOver: false
      });
    }).then((res) => {
      if (!res.committed || !res.snapshot.val()) {
        cleanupFriendGame(false);
        board.orientation('white');
        fail('This challenge is no longer available. It may have been cancelled.');
        return;
      }
      friendRoomData = Object.assign({}, val, { guestId: currentUserId, guestName: currentUserName, guestRating: currentUserRating, guestPhoto: currentUserPhoto || '', status: 'playing' });
      document.getElementById("activeRoomInfo").style.display = "flex";
      document.getElementById("activeRoomCode").textContent = code;
      updateTimeControlUI();
      listenToRoom(code, false);
      startVoiceChat(code, false);
    });
  });
}

function showFriendTimeModal(onSelect, options = {}) {
  const modal = document.getElementById('friendTimeModal');
  if (!modal) return onSelect(selectedFriendTimeControl);
  const title = document.getElementById('friendTimeTitle');
  const sub = document.getElementById('friendTimeSub');
  const noTimer = modal.querySelector('[data-time-control="0"]');
  if (title) title.textContent = options.quick ? '⚡ Quick Match' : 'Choose Time Control';
  if (sub) sub.textContent = options.quick ? 'Choose a time control. We will find an online opponent near your rating.' : 'Select how long each player gets for the game.';
  if (noTimer) noTimer.style.display = options.quick ? 'none' : '';
  modal.style.display = 'flex';
  modal.__onSelect = onSelect;
}

function closeFriendTimeModal() {
  const modal = document.getElementById('friendTimeModal');
  if (modal) modal.style.display = 'none';
}

function formatClock(seconds) {
  const safe = Math.max(0, Math.ceil(Number(seconds) || 0));
  const m = Math.floor(safe / 60);
  const sec = safe % 60;
  return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
}

function updateTimeControlUI() {
  const label = document.getElementById('activeTimeControl');
  const w = document.getElementById('whiteClock');
  const b = document.getElementById('blackClock');
  const names = { 600: 'Rapid • 10 min', 300: 'Blitz • 5 min', 60: 'Bullet • 1 min', 0: 'No Timer' };
  const quickLabel = currentRoomCode && friendRoomData && friendRoomData.quickLabel;
  if (label) label.textContent = '⏱ ' + (quickLabel || names[friendTimeControl] || 'No Timer');
  const show = friendTimeControl > 0;
  if (w) w.style.display = show ? 'block' : 'none';
  if (b) b.style.display = show ? 'block' : 'none';
}

function resetFriendClockUI() {
  stopFriendClock();
  friendClockStartedAt = null;
  friendClockTurn = null;
  friendClockExpiredHandled = false;
  whiteTimeLeft = friendTimeControl;
  blackTimeLeft = friendTimeControl;
  const w = document.getElementById('whiteClock');
  const b = document.getElementById('blackClock');
  if (w) w.textContent = formatClock(whiteTimeLeft);
  if (b) b.textContent = formatClock(blackTimeLeft);
  if (w) w.classList.remove('active-clock','low-clock');
  if (b) b.classList.remove('active-clock','low-clock');
  updateTimeControlUI();
}

function stopFriendClock() {
  if (friendClockInterval) {
    clearInterval(friendClockInterval);
    friendClockInterval = null;
  }
}

function renderFriendClock() {
  if (!friendTimeControl || !friendClockTurn || !friendClockStartedAt) return;
  const elapsed = Math.max(0, (Date.now() - friendClockStartedAt) / 1000);
  const w = friendClockTurn === 'w' ? Math.max(0, whiteTimeLeft - elapsed) : whiteTimeLeft;
  const b = friendClockTurn === 'b' ? Math.max(0, blackTimeLeft - elapsed) : blackTimeLeft;
  const wEl = document.getElementById('whiteClock');
  const bEl = document.getElementById('blackClock');
  if (wEl) { wEl.textContent = formatClock(w); wEl.classList.toggle('active-clock', friendClockTurn === 'w'); wEl.classList.toggle('low-clock', w <= 10); }
  if (bEl) { bEl.textContent = formatClock(b); bEl.classList.toggle('active-clock', friendClockTurn === 'b'); bEl.classList.toggle('low-clock', b <= 10); }
  if ((friendClockTurn === 'w' && w <= 0) || (friendClockTurn === 'b' && b <= 0)) {
    handleFriendTimeout(friendClockTurn);
  }
}

function startFriendClock(turn, startedAt, whiteLeft, blackLeft) {
  if (!friendTimeControl || !currentRoomCode || !turn || !startedAt) return;
  friendClockTurn = turn;
  friendClockStartedAt = Number(startedAt);
  whiteTimeLeft = Number(whiteLeft);
  blackTimeLeft = Number(blackLeft);
  friendClockExpiredHandled = false;
  stopFriendClock();
  renderFriendClock();
  friendClockInterval = setInterval(renderFriendClock, 250);
}

function snapshotFriendClock() {
  if (!friendTimeControl || !friendClockTurn || !friendClockStartedAt) {
    return { whiteTimeLeft, blackTimeLeft };
  }
  const elapsed = Math.max(0, (Date.now() - friendClockStartedAt) / 1000);
  return {
    whiteTimeLeft: friendClockTurn === 'w' ? Math.max(0, whiteTimeLeft - elapsed) : whiteTimeLeft,
    blackTimeLeft: friendClockTurn === 'b' ? Math.max(0, blackTimeLeft - elapsed) : blackTimeLeft
  };
}

function handleFriendTimeout(color) {
  if (friendClockExpiredHandled || !currentRoomCode) return;
  friendClockExpiredHandled = true;
  stopFriendClock();
  const winnerColor = color === 'w' ? 'b' : 'w';
  database.ref('rooms/' + currentRoomCode).once('value').then(snap => {
    const val = snap.val();
    if (!val || val.gameOver) return;
    const winnerId = winnerColor === 'w' ? val.creatorId : val.guestId;
    database.ref('rooms/' + currentRoomCode).update({
      gameOver: true,
      result: 'timeout',
      winner: winnerId,
      timeoutColor: color
    });
  });
}

function commitClockAfterMove(nextTurn) {
  if (!friendTimeControl || !currentRoomCode) return null;
  const left = snapshotFriendClock();
  const increment = Number(friendRoomData && friendRoomData.increment) || 0;
  if (increment > 0 && left.whiteTimeLeft > 0 && left.blackTimeLeft > 0) {
    if (nextTurn === 'b') left.whiteTimeLeft += increment; else left.blackTimeLeft += increment;
  }
  return {
    whiteTimeLeft: left.whiteTimeLeft,
    blackTimeLeft: left.blackTimeLeft,
    clockTurn: nextTurn,
    clockStartedAt: firebase.database.ServerValue.TIMESTAMP
  };
}

function leaveFriendGame() {
  if (isWaitingForOpponent) { cancelWaitingChallenge(); return; }
  if (quickBot) {
    if (quickBot.over) { closeResultAndExitRoom(); return; }
    if (!confirm('Leave this game? Your current game will be abandoned.')) return;
    finishQuickBotGame('left', quickBot.botColor);
    return;
  }
  if (!currentRoomCode) {
    setGameMode('friend');
    return;
  }
  if (!confirm('Leave this game? Your current game will be abandoned.')) return;
  const code = currentRoomCode;
  const roomRef = database.ref('rooms/' + code);
  roomRef.once('value').then(snap => {
    const val = snap.val() || {};
    const opponentId = val.creatorId === currentUserId ? val.guestId : val.creatorId;
    const next = {...val, gameOver:true, result:'left', leftBy:currentUserId, winner:opponentId || null};
    saveFriendMatchHistory(next, code);
    return roomRef.update({ gameOver: true, result: 'left', leftBy: currentUserId, winner: opponentId || null });
  }).finally(() => {
    cleanupFriendGame(false);
  });
}

function setWaitingForOpponent(waiting) {
  isWaitingForOpponent = !!waiting;
  const overlay = document.getElementById('waitingOverlay');
  if (overlay) overlay.style.display = waiting ? 'flex' : 'none';
  if (!waiting) waitingChallengeTargetId = null;
  updateBoardMicButtons();
}

function cancelWaitingChallenge() {
  // Waiting without a room only happens while Quick Match is searching / starting.
  if (!currentRoomCode) { if (isWaitingForOpponent || quickMatch) cancelQuickMatch(); return; }
  if (!isWaitingForOpponent) return;
  const code = currentRoomCode;
  const targetId = waitingChallengeTargetId;
  selfCancellingChallenge = true;
  // Only delete the room if no opponent has joined in the meantime.
  database.ref('rooms/' + code).transaction((cur) => {
    if (cur && cur.guestId) return; // already accepted - abort
    return null;
  }).then((res) => {
    if (res.committed) {
      if (targetId) database.ref('users/' + targetId + '/challenges/' + code).remove().catch(() => {});
      cleanupFriendGame(false);
    } else {
      alert('Your opponent has just accepted - the match is starting.');
    }
  }).catch(() => {
    if (targetId) database.ref('users/' + targetId + '/challenges/' + code).remove().catch(() => {});
    cleanupFriendGame(false);
  }).finally(() => { selfCancellingChallenge = false; });
}

function cleanupFriendGame(resetMode = true) {
  const wasQuickRoom = typeof qmOnRoomCleanup === 'function' ? qmOnRoomCleanup() : false;
  stopQuickMatchSearch();
  endQuickBotGame();
  setWaitingForOpponent(false);
  stopFriendClock();
  if (friendRoomListenerRef) { friendRoomListenerRef.off(); friendRoomListenerRef = null; }
  if (friendChatListenerRef) { friendChatListenerRef.off(); friendChatListenerRef = null; }
  try { if (peerConnection) peerConnection.close(); } catch (_) {}
  peerConnection = null;
  audioTransceiver = null;
  try { if (localVoiceStream) localVoiceStream.getTracks().forEach(t => t.stop()); } catch (_) {}
  localVoiceStream = null;
  isMicMuted = true;
  renderMicControls(false);
  boardPlayerInfo = null;
  currentRoomCode = null;
  isOnlineMatchActive = false;
  friendTimeControl = 0;
  friendClockStartedAt = null;
  friendClockTurn = null;
  resetFriendClockUI();
  const info = document.getElementById('activeRoomInfo');
  if (info) info.style.display = 'none';
  const codeInput = document.getElementById('roomCodeInput');
  if (codeInput) codeInput.value = '';
  lockModeButtons(false);
  if (resetMode) setGameMode(wasQuickRoom ? 'quick' : 'friend');
}

function copyRoomCode() {
  if (currentRoomCode) {
    navigator.clipboard.writeText(currentRoomCode);
    alert("Room Code copied: " + currentRoomCode);
  }
}

function listenToRoom(code, isCreator) {
  const roomRef = database.ref("rooms/" + code);
  friendRoomListenerRef = roomRef;
  roomRef.on("value", (snap) => {
    const val = snap.val();
    if (!val) {
      if (isWaitingForOpponent && !selfCancellingChallenge && currentRoomCode === code) {
        cleanupFriendGame(false);
        alert('The challenge was declined or is no longer available.');
      }
      return;
    }
    friendRoomData = val;
    updateFriendPlayerLabels(val);
    if (isWaitingForOpponent && (val.guestId || val.guestName || val.status === 'playing')) {
      setWaitingForOpponent(false);
    }

    if (val.guestName) {
      const quickReady = !val.quickMatch || (typeof qmBothPlayersPresent === 'function' && qmBothPlayersPresent(val));
      if (friendTimeControl > 0 && val.guestId && val.guestName && !val.clockStartedAt && !val.gameOver && quickReady) {
        roomRef.transaction((current) => {
          if (!current || current.gameOver || !current.guestId || current.clockStartedAt) return;
          return Object.assign({}, current, {
            clockTurn: 'w',
            clockStartedAt: firebase.database.ServerValue.TIMESTAMP,
            whiteTimeLeft: Number(current.timeControl) || friendTimeControl,
            blackTimeLeft: Number(current.timeControl) || friendTimeControl
          });
        });
      }
      const oppLabel = isCreator ? val.guestName : val.creatorName;
      const chatOpp = document.getElementById("chatOpponentName");
      if (chatOpp) chatOpp.textContent = oppLabel + " (" + (isCreator ? val.guestRating : val.creatorRating) + ")";
    }

    if (Array.isArray(val.moveHistory) && val.moveHistory.length !== game.history().length) {
      try {
        game.reset();
        val.moveHistory.forEach(san => game.move(san));
        board.position(game.fen());
        updateUI();
      } catch (e) { console.warn('Move history sync failed:', e); }
    } else if (val.gameFen && val.gameFen !== game.fen()) {
      if (val.gameFen === 'start') game.reset();
      else game.load(val.gameFen);
      board.position(game.fen());
      playSound('move');
      updateUI();
      setTimeout(showKingStateEffects, 40);
    }

    if (val.drawOffer && val.drawOffer !== currentUserId) {
      if (confirm("Opponent offered a draw. Accept?")) {
        roomRef.update({ gameOver: true, result: 'draw', drawOffer: null });
        lockModeButtons(false);
      } else {
        roomRef.child("drawOffer").remove();
      }
    }

    if (val.timeControl !== undefined && friendTimeControl === 0 && currentRoomCode === code) {
      friendTimeControl = Number(val.timeControl) || 0;
      updateTimeControlUI();
      if (friendTimeControl > 0 && val.clockTurn && val.clockStartedAt) {
        startFriendClock(val.clockTurn, val.clockStartedAt, Number(val.whiteTimeLeft), Number(val.blackTimeLeft));
      }
    }

    if (val.clockTurn && val.clockStartedAt && friendTimeControl > 0 && currentRoomCode === code && !val.gameOver) {
      const changed = friendClockTurn !== val.clockTurn || Number(friendClockStartedAt) !== Number(val.clockStartedAt);
      if (changed) startFriendClock(val.clockTurn, val.clockStartedAt, Number(val.whiteTimeLeft), Number(val.blackTimeLeft));
    }

    if (val.gameOver) {
      saveFriendMatchHistory(val, code);
      stopFriendClock();
      lockModeButtons(false);
      showFriendMatchResult(val, code);
    }
  });

  listenForChat(code);
}

function updateFriendPlayerLabels(roomValue) {
  if (!roomValue) return;
  const white = { name: roomValue.creatorName || 'White', rating: Number(roomValue.creatorRating || 800) };
  const black = { name: roomValue.guestName || 'Waiting...', rating: Number(roomValue.guestRating || 800) };
  if (currentRoomCode) boardPlayerInfo = { w: white, b: black };
  updateBoardMicButtons();
  const topIsWhite = board.orientation() === 'black';
  const top = topIsWhite ? white : black;
  const bottom = topIsWhite ? black : white;
  const topEl = document.getElementById('topPlayerName');
  const bottomEl = document.getElementById('bottomPlayerName');
  if (currentMode === 'friend' && currentRoomCode) {
    if (topEl) topEl.textContent = `${top.name} • ${top.rating}`;
    if (bottomEl) bottomEl.textContent = `${bottom.name} • ${bottom.rating}`;
  }
}

function getLocalMatchStats() {
  const stats = { blunders: 0, mistakes: 0, excellent: 0, good: 0, inaccuracies: 0, accuracy: 0, analyzed: 0 };
  let totalLoss = 0;
  moveQualityHistory.forEach(m => {
    if (m.color !== myOnlineColor || m.quality === '...') return;
    stats.analyzed++;
    if (m.quality === 'blunder') stats.blunders++;
    else if (m.quality === 'mistake') stats.mistakes++;
    else if (m.quality === 'best') stats.excellent++;
    else if (m.quality === 'good') stats.good++;
    else if (m.quality === 'inaccuracy') stats.inaccuracies++;
    totalLoss += Number(m.loss || 0);
  });
  if (stats.analyzed) {
    stats.accuracy = Math.max(30, Math.min(99, Math.round(100 * Math.exp(-0.0055 * (totalLoss / stats.analyzed)))));
  }
  return stats;
}

function showFriendMatchResult(roomValue, code) {
  if (!roomValue || !currentUserId) return;
  const white = { id: roomValue.creatorId, name: roomValue.creatorName || 'White', rating: Number(roomValue.creatorRating || 800) };
  const black = { id: roomValue.guestId, name: roomValue.guestName || 'Black', rating: Number(roomValue.guestRating || 800) };
  const winnerId = roomValue.winner || null;
  const isAborted = roomValue.result === 'aborted';
  const isDraw = roomValue.result === 'draw' || isAborted;
  const winner = winnerId === white.id ? white : winnerId === black.id ? black : null;
  const loser = winnerId === white.id ? black : winnerId === black.id ? white : null;
  const me = currentUserId === white.id ? white : black;
  const opponent = currentUserId === white.id ? black : white;
  const stats = getLocalMatchStats();
  friendResultData = { roomValue, code, opponentId: opponent.id, opponentName: opponent.name, timeControl: Number(roomValue.timeControl || 0) };

  const panel = document.getElementById('friendMatchResultPanel');
  if (!panel) return;
  const resultTitle = isAborted ? 'ABORTED' : isDraw ? 'DRAW' : (winnerId === currentUserId ? 'YOU WON' : 'YOU LOST');
  const resultSub = isAborted ? 'Your opponent did not connect. The game was cancelled (no rating change).' : isDraw ? 'The game ended in a draw.' : `${winner.name} defeated ${loser.name}`;
  const resultClass = isDraw ? 'draw' : (winnerId === currentUserId ? 'win' : 'loss');
  panel.innerHTML = `
    <button type="button" id="resultCloseBtn" class="result-close-btn" title="Close" aria-label="Close result">✕</button>
    <div class="friend-result-card ${resultClass}">
      <div class="friend-result-kicker">${escapeHtml(roomValue.quickLabel || friendTimeLabel(roomValue.timeControl))}</div>
      <div class="friend-result-title">${resultTitle}</div>
      <div class="friend-result-sub">${escapeHtml(resultSub)}</div>
      <div class="friend-result-players">
        <div class="result-player ${me.id===white.id?'active-me':''}"><span class="result-side">WHITE</span><strong>${escapeHtml(white.name)}</strong><small>${white.rating} Elo</small></div>
        <div class="result-vs">VS</div>
        <div class="result-player ${me.id===black.id?'active-me':''}"><span class="result-side">BLACK</span><strong>${escapeHtml(black.name)}</strong><small>${black.rating} Elo</small></div>
      </div>
      <div class="result-stat-grid">
        <div><strong>${stats.blunders}</strong><span>Blunders</span></div>
        <div><strong>${stats.mistakes}</strong><span>Mistakes</span></div>
        <div><strong>${stats.excellent}</strong><span>Excellent</span></div>
        <div><strong>${stats.inaccuracies}</strong><span>Inaccuracies</span></div>
        <div><strong>${stats.accuracy || '--'}${stats.accuracy ? '%' : ''}</strong><span>Accuracy</span></div>
      </div>
      <div class="friend-result-actions">
        <button id="resultReviewBtn" class="pill-btn highlight-btn">📊 View Analysis</button>
        <button id="resultRematchBtn" class="pill-btn">${roomValue.quickMatch ? '⚡ New Quick Match' : '♟ Rematch'}</button>
        <button id="resultFriendsBtn" class="pill-btn">👥 Friends</button>
      </div>
    </div>`;
  panel.style.display = 'flex';
  const reviewBtn = document.getElementById('resultReviewBtn');
  const rematchBtn = document.getElementById('resultRematchBtn');
  const friendsBtn = document.getElementById('resultFriendsBtn');
  const closeResultBtn = document.getElementById('resultCloseBtn');
  if (closeResultBtn) closeResultBtn.onclick = closeResultAndExitRoom;
  if (reviewBtn) reviewBtn.onclick = () => { panel.style.display='none'; document.querySelector('[data-tab="reviewTab"]')?.click(); };
  if (rematchBtn) rematchBtn.onclick = () => {
    panel.style.display='none';
    const quickKey = roomValue.quickMatch ? (roomValue.quickKey || null) : null;
    cleanupFriendGame(!quickKey);
    if (quickKey && typeof qmRematch === 'function') qmRematch(quickKey);
    else if (friendResultData.opponentId) sendChallenge(friendResultData.opponentId, friendResultData.opponentName, friendResultData.timeControl);
  };
  if (friendsBtn) friendsBtn.onclick = () => { panel.style.display='none'; cleanupFriendGame(true); openFriendsModal('friends'); };
}

// X on the Winner/Loser screen: close it and leave only this room (history is already saved; the room is not deleted).
function closeResultAndExitRoom() {
  const panel = document.getElementById('friendMatchResultPanel');
  if (panel) panel.style.display = 'none';
  friendResultData = null;
  cleanupFriendGame(true);
  game.reset();
  redoStack = [];
  moveQualityHistory = [];
  clearClickHighlights();
  selectedSquare = null;
  board.orientation('white');
  board.start();
  updateGameReview();
  updateUI();
}

function closeFriendMatchResult() {
  const panel = document.getElementById('friendMatchResultPanel');
  if (panel) panel.style.display = 'none';
}

// Browsers only allow the permission prompt after a user gesture.
function ensureNotificationPermission() {
  if (!('Notification' in window) || Notification.permission !== 'default') return;
  try { const p = Notification.requestPermission(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
}

function challengeMessageText(c) {
  return c.message || ((c.fromName || 'Player') + ' challenged you to a ' + (c.timeLabel || friendTimeLabel(c.timeControl)) + ' game!');
}

function challengeAvatarHtml(c) {
  return c.fromPhoto ? `<img src="${escapeHtml(c.fromPhoto)}" alt="" class="challenge-avatar">` : `<span class="challenge-avatar-fallback">${escapeHtml((c.fromName||'P').charAt(0).toUpperCase())}</span>`;
}

function startChallengeNotifications() {
  if (!currentUserId) return;
  if (challengeListenerRef) challengeListenerRef.off();
  challengeListenerRef = database.ref('users/' + currentUserId + '/challenges');
  document.addEventListener('pointerdown', ensureNotificationPermission, { once: true });

  // Every new challenge is shown at once as an in-app pop-up, plus a native
  // browser/PWA notification when the page is in the background.
  challengeListenerRef.on('child_added', snap => {
    const c = snap.val() || {};
    const code = snap.key;
    // Drop challenges whose room was cancelled or already used while we were away.
    database.ref('rooms/' + code).once('value').then(roomSnap => {
      const room = roomSnap.val();
      if (!room || room.gameOver || room.guestId || (c.fromId && room.creatorId !== c.fromId)) {
        snap.ref.remove().catch(() => {});
        return;
      }
      announceChallenge(code, c);
    }).catch(() => announceChallenge(code, c));
  });
  challengeListenerRef.on('value', snap => {
    challengeNotificationMap = snap.val() || {};
    renderChallengeNotifications();
    if (challengeToastCode && !challengeNotificationMap[challengeToastCode]) hideChallengeToast();
    processChallengeDeepLink(true);
  });
}

function announceChallenge(code, c) {
  if (currentRoomCode === code) return;
  showChallengeToast(code, c);
  playSound('check');
  try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) {}
  showNativeChallengeNotification(code, c);
}

function showNativeChallengeNotification(code, c) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return; // the in-app pop-up is already visible
  const title = '♟ New Chess Challenge';
  const body = challengeMessageText(c) + '\n' + (c.fromName || 'Player') + ' • ' + Number(c.fromRating || 800) + ' Elo • ' + (c.timeLabel || friendTimeLabel(c.timeControl));
  const tag = 'bchess-challenge-' + code;
  const fallback = () => {
    try {
      const n = new Notification(title, { body, tag, icon: 'icons/icon-192.png' });
      n.onclick = () => { try { window.focus(); } catch (e) {} handleChallengeDeepLink(code, null); try { n.close(); } catch (e) {} };
    } catch (e) {}
  };
  // Android Chrome / installed PWAs only allow notifications through the service worker.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg) return fallback();
      return reg.showNotification(title, {
        body, tag, renotify: true, requireInteraction: true,
        icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
        data: { type: 'bchess-challenge', code },
        actions: [{ action: 'accept', title: '✓ Accept' }, { action: 'decline', title: '✕ Decline' }]
      });
    }).catch(fallback);
  } else {
    fallback();
  }
}

function showChallengeToast(code, c) {
  const toast = document.getElementById('challengeToast');
  if (!toast) return;
  challengeToastCode = code;
  toast.innerHTML = `
    <div class="challenge-notification-title">♟ New Challenge</div>
    <div class="challenge-notification-list">
      <div class="challenge-notification-row"><div class="challenge-profile">${challengeAvatarHtml(c)}<div><strong>${escapeHtml(c.fromName||'Player')}</strong><small>${Number(c.fromRating||800)} Elo • ${escapeHtml(c.timeLabel||friendTimeLabel(c.timeControl))}</small></div></div></div>
      <div class="challenge-toast-msg">${escapeHtml(challengeMessageText(c))}</div>
      <div class="challenge-toast-actions">
        <button type="button" class="challenge-accept-btn" id="challengeToastAcceptBtn">✓ Accept</button>
        <button type="button" class="challenge-decline-btn" id="challengeToastDeclineBtn">✕ Decline</button>
      </div>
    </div>`;
  toast.style.display = 'block';
  document.getElementById('challengeToastAcceptBtn').onclick = () => acceptChallengeNotification(code);
  document.getElementById('challengeToastDeclineBtn').onclick = () => declineChallengeNotification(code);
}

function hideChallengeToast() {
  challengeToastCode = null;
  const toast = document.getElementById('challengeToast');
  if (toast) toast.style.display = 'none';
}

// Tapping a browser notification (or its Accept / Decline action) lands here.
function handleChallengeDeepLink(code, action) {
  if (!code) return;
  pendingChallengeDeepLink = { code: String(code), action: action || null };
  processChallengeDeepLink(false);
}

function processChallengeDeepLink(listLoaded) {
  const link = pendingChallengeDeepLink;
  if (!link || !currentUserId) return;
  const c = challengeNotificationMap[link.code];
  if (!c) {
    if (listLoaded) { pendingChallengeDeepLink = null; alert('This challenge is no longer available.'); }
    return;
  }
  pendingChallengeDeepLink = null;
  if (link.action === 'accept') acceptChallengeNotification(link.code);
  else if (link.action === 'decline') declineChallengeNotification(link.code);
  else showChallengeToast(link.code, c);
}

(function readChallengeDeepLinkFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('challenge');
  if (!code) return;
  pendingChallengeDeepLink = { code, action: params.get('challengeAction') || null };
  params.delete('challenge');
  params.delete('challengeAction');
  const qs = params.toString();
  try { history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash); } catch (e) {}
})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    const d = event.data || {};
    if (d.type === 'bchess-challenge') {
      try { window.focus(); } catch (e) {}
      handleChallengeDeepLink(d.code, d.action);
    }
  });
}

function renderChallengeNotifications() {
  const list = document.getElementById('challengeNotificationList');
  const badge = document.getElementById('challengeBadge');
  const ids = Object.keys(challengeNotificationMap || {});
  if (badge) { badge.textContent = ids.length; badge.style.display = ids.length ? 'inline-flex' : 'none'; }
  if (!list) return;
  list.innerHTML = ids.length ? ids.map(code => {
    const c = challengeNotificationMap[code] || {};
    const avatar = challengeAvatarHtml(c);
    return `<div class="challenge-notification-row"><div class="challenge-profile">${avatar}<div><strong>${escapeHtml(c.fromName||'Player')}</strong><small>${Number(c.fromRating||800)} Elo • ${escapeHtml(c.timeLabel||friendTimeLabel(c.timeControl))}</small></div></div><div class="challenge-actions"><button class="challenge-accept-btn" data-code="${escapeHtml(code)}">✓</button><button class="challenge-decline-btn" data-code="${escapeHtml(code)}">×</button></div></div>`;
  }).join('') : '<div class="friend-empty">No new challenges.</div>';
  list.querySelectorAll('.challenge-accept-btn').forEach(btn => btn.onclick = () => acceptChallengeNotification(btn.dataset.code));
  list.querySelectorAll('.challenge-decline-btn').forEach(btn => btn.onclick = () => declineChallengeNotification(btn.dataset.code));
}

function openChallengeNotifications() {
  ensureNotificationPermission();
  const box = document.getElementById('challengeNotificationBox');
  if (box) { box.style.display = box.style.display === 'block' ? 'none' : 'block'; renderChallengeNotifications(); }
}

function acceptChallengeNotification(code) {
  const challenge = challengeNotificationMap[code];
  if (!challenge) return;
  if (quickMatch && !currentRoomCode) cancelQuickMatch();
  if (currentRoomCode || (quickBot && !quickBot.over)) return alert('You are already in a game.');
  if (quickBot) cleanupFriendGame(false);
  hideChallengeToast();
  database.ref('users/' + currentUserId + '/challenges/' + code).remove();
  document.getElementById('challengeNotificationBox').style.display = 'none';
  if (currentMode !== 'friend') setGameMode('friend');
  document.getElementById('roomCodeInput').value = code;
  joinFriendRoom();
}

function declineChallengeNotification(code) {
  if (challengeToastCode === code) hideChallengeToast();
  database.ref('users/' + currentUserId + '/challenges/' + code).remove();
  // Remove the pending room so the challenger is not left waiting forever.
  database.ref('rooms/' + code).transaction((cur) => {
    if (cur && !cur.guestId && cur.status === 'waiting' && !cur.gameOver) return null;
    return cur;
  }).catch(() => {});
}

function friendTimeLabel(seconds) {
  return ({600:'Rapid • 10 min',300:'Blitz • 5 min',60:'Bullet • 1 min',0:'No Timer'})[Number(seconds)||0] || 'No Timer';
}

function saveFriendMatchHistory(roomValue, code) {
  if (!roomValue || !currentUserId || !roomValue.creatorId || !roomValue.guestId || friendHistorySavedCodes.has(code)) return;
  if (roomValue.result === 'aborted') return;
  friendHistorySavedCodes.add(code);
  const iAmWhite = roomValue.creatorId === currentUserId;
  const opponentId = iAmWhite ? roomValue.guestId : roomValue.creatorId;
  const opponentName = iAmWhite ? roomValue.guestName : roomValue.creatorName;
  let result = 'draw';
  if (roomValue.result === 'checkmate' || roomValue.result === 'timeout' || roomValue.result === 'resigned') result = roomValue.winner === currentUserId ? 'win' : 'loss';
  if (roomValue.result === 'left') result = roomValue.winner === currentUserId ? 'win' : 'loss';
  const record = {
    roomCode: code,
    opponentId,
    opponentName: opponentName || 'Player',
    result,
    resultType: roomValue.result || 'unknown',
    winnerId: roomValue.winner || null,
    timeControl: Number(roomValue.timeControl) || 0,
    timeLabel: roomValue.quickLabel || friendTimeLabel(roomValue.timeControl),
    moves: roomValue.moveHistory || game.history(),
    playedAt: firebase.database.ServerValue.TIMESTAMP
  };
  database.ref('users/' + currentUserId + '/matchHistory/' + code).set(record).catch(() => {});
}

function copyFriendLink(friendId, friendName) {
  const link = window.location.origin + window.location.pathname + '?addfriend=' + encodeURIComponent(friendId);
  navigator.clipboard.writeText(link).then(() => alert('Friend request link copied for ' + friendName + '.')).catch(() => alert(link));
}

function handleIncomingFriendLink() {
  const params = new URLSearchParams(window.location.search);
  const friendId = params.get('addfriend');
  if (!friendId || !currentUserId || friendId === currentUserId) return;
  database.ref('users/' + friendId).once('value').then(snap => {
    const u=snap.val()||{};
    openFriendsModal('friends');
    const input=document.getElementById('friendSearchInput');
    if (input) input.value=u.username||'';
    const out=document.getElementById('friendSearchResults');
    if (out) out.innerHTML=`<div class="friend-row"><div><strong>${escapeHtml(u.username||'Player')}</strong><small>${Number(u.rating||800)} Elo</small></div><div class="friend-link-actions"><button class="pill-btn friend-request-btn" id="linkedFriendRequestBtn">➕ Send Request</button></div></div>`;
    const btn=document.getElementById('linkedFriendRequestBtn');
    if(btn) btn.addEventListener('click',()=>sendFriendRequest(friendId,u.username||'Player'));
  });
}

function openFriendsModal(tab = 'friends') {
  if (!currentUserId) return alert('Please Sign in with Google first!');
  const modal = document.getElementById('friendsModal');
  if (!modal) return;
  modal.style.display = 'flex';
  switchFriendsTab(tab);
  loadFriendsData();
}

function closeFriendsModal() {
  const modal = document.getElementById('friendsModal');
  if (modal) modal.style.display = 'none';
}

function switchFriendsTab(tab) {
  const map = { friends:['friendsPanel','friendsTabBtn'], requests:['requestsPanel','requestsTabBtn'], history:['historyPanel','historyTabBtn'] };
  Object.entries(map).forEach(([key,[panel,btn]]) => {
    const p=document.getElementById(panel), b=document.getElementById(btn);
    if (p) p.style.display = key===tab ? 'block':'none';
    if (b) b.classList.toggle('active', key===tab);
  });
  if (tab==='history') loadMatchHistory();
  if (tab==='requests') loadFriendRequests();
}

function loadFriendsData() {
  if (!currentUserId) return;
  const list = document.getElementById('friendsList');
  if (!list) return;
  database.ref('users/'+currentUserId+'/friends').once('value').then(snap => {
    const data=snap.val()||{}; const ids=Object.keys(data);
    if (!ids.length) { list.innerHTML='<div class="friend-empty">No friends yet. Search a username above.</div>'; return; }
    list.innerHTML=ids.map(id => {
      const f=data[id]||{};
      return `<div class="friend-row"><div><strong>${escapeHtml(f.username||'Player')}</strong><small>${Number(f.rating||800)} Elo</small></div><div><button class="pill-btn friend-challenge-btn" data-id="${id}" data-name="${escapeHtml(f.username||'Player')}" data-rating="${Number(f.rating||800)}">♟ Challenge</button></div></div>`;
    }).join('');
    list.querySelectorAll('.friend-challenge-btn').forEach(btn => btn.addEventListener('click',()=>sendChallenge(btn.dataset.id, btn.dataset.name, null, Number(btn.dataset.rating) || null)));
  });
}

function searchFriendByUsername() {
  const input=document.getElementById('friendSearchInput');
  const out=document.getElementById('friendSearchResults');
  const name=(input?.value||'').trim();
  if (!name) return;
  database.ref('users').orderByChild('username').equalTo(name).once('value').then(snap=>{
    const data=snap.val()||{}; const ids=Object.keys(data).filter(id=>id!==currentUserId);
    if (!ids.length) { out.innerHTML='<div class="friend-empty">User not found.</div>'; return; }
    out.innerHTML=ids.map(id=>{const u=data[id]||{};return `<div class="friend-row"><div><strong>${escapeHtml(u.username||'Player')}</strong><small>${Number(u.rating||800)} Elo</small></div><div class="friend-link-actions"><button class="pill-btn friend-request-btn" data-id="${id}" data-name="${escapeHtml(u.username||'Player')}">➕ Add Friend</button><button class="pill-btn friend-copy-link-btn" data-id="${id}" data-name="${escapeHtml(u.username||'Player')}">🔗 Copy Link</button></div></div>`;}).join('');
    out.querySelectorAll('.friend-request-btn').forEach(btn=>btn.addEventListener('click',()=>sendFriendRequest(btn.dataset.id,btn.dataset.name)));
    out.querySelectorAll('.friend-copy-link-btn').forEach(btn=>btn.addEventListener('click',()=>copyFriendLink(btn.dataset.id,btn.dataset.name)));
  }).catch(err=>{ out.innerHTML='<div class="friend-empty">Search is unavailable with the current database rules.</div>'; console.warn(err); });
}

function sendFriendRequest(friendId, friendName) {
  if (!currentUserId || friendId===currentUserId) return;
  const payload={fromId:currentUserId,fromName:currentUserName,fromRating:currentUserRating,toId:friendId,createdAt:firebase.database.ServerValue.TIMESTAMP};
  const updates={};
  updates['users/'+friendId+'/friendRequests/incoming/'+currentUserId]=payload;
  updates['users/'+currentUserId+'/friendRequests/outgoing/'+friendId]={toId:friendId,toName:friendName,createdAt:firebase.database.ServerValue.TIMESTAMP};
  database.ref().update(updates).then(()=>alert('Friend request sent to '+friendName+'.'));
}

function acceptFriendRequest(fromId, req) {
  const now=firebase.database.ServerValue.TIMESTAMP;
  const updates={};
  updates['users/'+currentUserId+'/friends/'+fromId]={username:req.fromName||'Player',rating:req.fromRating||800};
  updates['users/'+fromId+'/friends/'+currentUserId]={username:currentUserName,rating:currentUserRating};
  updates['users/'+currentUserId+'/friendRequests/incoming/'+fromId]=null;
  updates['users/'+fromId+'/friendRequests/outgoing/'+currentUserId]=null;
  updates['users/'+currentUserId+'/friendsUpdatedAt']=now;
  database.ref().update(updates).then(()=>loadFriendRequests());
}

function loadFriendRequests() {
  if (!currentUserId) return;
  const incoming=document.getElementById('incomingRequests'), outgoing=document.getElementById('outgoingRequests');
  database.ref('users/'+currentUserId+'/friendRequests/incoming').once('value').then(s=>{
    const d=s.val()||{}; const ids=Object.keys(d);
    incoming.innerHTML=ids.length?ids.map(id=>{const r=d[id];return `<div class="friend-row"><div><strong>${escapeHtml(r.fromName||'Player')}</strong><small>${Number(r.fromRating||800)} Elo</small></div><button class="pill-btn accept-request-btn" data-id="${id}">Accept</button></div>`}).join(''):'<div class="friend-empty">No incoming requests.</div>';
    incoming.querySelectorAll('.accept-request-btn').forEach(btn=>btn.addEventListener('click',()=>acceptFriendRequest(btn.dataset.id,d[btn.dataset.id])));
  });
  database.ref('users/'+currentUserId+'/friendRequests/outgoing').once('value').then(s=>{const d=s.val()||{}; const ids=Object.keys(d); outgoing.innerHTML=ids.length?ids.map(id=>`<div class="friend-row"><div><strong>${escapeHtml(d[id].toName||'Player')}</strong><small>Request sent</small></div></div>`).join(''):'<div class="friend-empty">No sent requests.</div>';});
}

function sendChallenge(friendId, friendName, presetTime = null, friendRating = null) {
  if (!currentUserId) return;
  if (currentRoomCode || quickMatch || (quickBot && !quickBot.over)) return alert('You are already in a game.');
  // Close the Friends / profile windows so the "Challenge sent" status on the board is visible right away.
  const launch = (seconds) => {
    closeFriendsModal();
    closePlayerProfile();
    if (quickBot) cleanupFriendGame(false);
    if (currentMode !== 'friend') setGameMode('friend');
    createFriendRoomWithTime(Number(seconds) || 0, friendId, friendName, friendRating);
  };
  if (presetTime !== null && presetTime !== undefined) {
    launch(presetTime);
    return;
  }
  showFriendTimeModal(launch);
}

// Optional challenge metadata is stored on the opponent profile; room creation itself remains unchanged.
function loadMatchHistory() {
  const out=document.getElementById('matchHistoryList'); if(!out||!currentUserId)return;
  database.ref('users/'+currentUserId+'/matchHistory').orderByChild('playedAt').limitToLast(50).once('value').then(s=>{
    const d=s.val()||{}; const arr=Object.entries(d).map(([code,v])=>({code,...v})).sort((a,b)=>(b.playedAt||0)-(a.playedAt||0));
    const wins=arr.filter(m=>m.result==='win').length, losses=arr.filter(m=>m.result==='loss').length, draws=arr.filter(m=>m.result==='draw').length;
    out.innerHTML=(arr.length ? `<div class="history-summary"><strong>${wins} Wins</strong><span>${losses} Losses</span><span>${draws} Draws</span><span>${arr.length} Matches</span></div>`+arr.map(m=>`<div class="history-match-row"><div><strong>${escapeHtml(m.opponentName||'Player')}</strong><small>${escapeHtml(m.timeLabel||'No Timer')} • ${new Date(m.playedAt||Date.now()).toLocaleString()}</small></div><span class="history-result ${m.result}">${m.result.toUpperCase()}</span></div>`).join('') : '<div class="friend-empty">No friend matches yet.</div>');
  });
}

function checkOnlineTrigger(move) {
  if (currentMode === 'friend' && currentRoomCode) {
    const clockUpdate = commitClockAfterMove(game.turn());
    database.ref("rooms/" + currentRoomCode).update({
      gameFen: game.fen(),
      lastMove: { from: move.from, to: move.to },
      moveHistory: game.history(),
      ...(clockUpdate || {})
    });

    if (game.in_checkmate()) {
      const roomRef = database.ref("rooms/" + currentRoomCode);
      roomRef.once("value", (snap) => {
        const val = snap.val();
        const opponentId = (val.creatorId === currentUserId) ? val.guestId : val.creatorId;
        roomRef.update({ gameOver: true, result: 'checkmate', winner: currentUserId });
        lockModeButtons(false);
        if (opponentId) {
          database.ref("users/" + currentUserId + "/rating").transaction(r => (r || 800) + 8);
          database.ref("users/" + opponentId + "/rating").transaction(r => Math.max(100, (r || 800) - 8));
        }
      });
    }
  }
}

function resignGame() {
  if (quickBot && !currentRoomCode) {
    if (quickBot.over) return;
    if (!confirm("Are you sure you want to resign? (-8 Rating)")) return;
    finishQuickBotGame('resigned', quickBot.botColor);
    return;
  }
  if (!currentRoomCode) return alert("Not in an active match!");
  if (!confirm("Are you sure you want to resign? (-8 Rating)")) return;

  const roomRef = database.ref("rooms/" + currentRoomCode);
  roomRef.once("value", (snap) => {
    const val = snap.val();
    const opponentId = (val.creatorId === currentUserId) ? val.guestId : val.creatorId;

    roomRef.update({
      gameOver: true,
      result: 'resigned',
      winner: opponentId,
      loser: currentUserId
    });
    lockModeButtons(false);
    if (opponentId) database.ref("users/" + opponentId + "/rating").transaction(r => (r || 800) + 8);
    database.ref("users/" + currentUserId + "/rating").transaction(r => Math.max(100, (r || 800) - 8));
  });
}

function offerDrawGame() {
  if (quickBot && !currentRoomCode) {
    if (quickBot.over) return;
    alert("Draw offer sent to opponent.");
    const qb = quickBot;
    setTimeout(() => {
      if (quickBot !== qb || qb.over) return;
      const opponentEdge = (qb.botColor === 'w' ? 1 : -1) * currentPositionCp;
      if (game.history().length >= 20 && opponentEdge < 60) finishQuickBotGame('draw', null);
    }, 1500 + Math.random() * 2000);
    return;
  }
  if (!currentRoomCode) return alert("Not in an active match!");
  database.ref("rooms/" + currentRoomCode + "/drawOffer").set(currentUserId);
  alert("Draw offer sent to opponent.");
}

// --- LIVE CHAT ---
function handleSendChat(e) {
  e.preventDefault();
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (text && quickBot && !currentRoomCode) {
    const box = document.getElementById("chatMessages");
    const bubble = document.createElement("div");
    bubble.className = 'chat-bubble mine';
    bubble.innerHTML = `<span class="chat-bubble-author">${escapeHtml(currentUserName)}</span><span class="chat-bubble-text">${escapeHtml(text)}</span>`;
    if (box) { box.appendChild(bubble); box.scrollTop = box.scrollHeight; }
    input.value = "";
    return;
  }
  if (!text || !currentRoomCode) return;

  database.ref("rooms/" + currentRoomCode + "/chat").push({
    sender: currentUserName,
    senderId: currentUserId,
    text: text,
    timestamp: Date.now()
  });
  input.value = "";
}

function listenForChat(code) {
  const box = document.getElementById("chatMessages");
  if (!box) return;
  box.innerHTML = "";

  friendChatListenerRef = database.ref("rooms/" + code + "/chat").limitToLast(40);
  friendChatListenerRef.on("child_added", (snap) => {
    const msg = snap.val();
    const isMe = msg.senderId === currentUserId;
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${isMe ? 'mine' : 'theirs'}`;
    bubble.innerHTML = `<span class="chat-bubble-author">${escapeHtml(msg.sender)}</span><span class="chat-bubble-text">${escapeHtml(msg.text)}</span>`;
    box.appendChild(bubble);
    box.scrollTop = box.scrollHeight;
  });
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.innerText = str;
  return d.innerHTML;
}

// --- WEBRTC LIVE VOICE CHAT ---
// Voice uses one initial WebRTC negotiation plus explicit renegotiation when
// a microphone track is added after the room connection has already started.
// This is important for two-way audio: the room creator is the WebRTC offerer,
// so a microphone added later by the guest must trigger a fresh offer from the
// creator instead of only calling replaceTrack() on the guest.
let pendingRemoteCandidates = [];
let remoteDescriptionReady = false;
let isSpeakerMuted = false;
let remoteVoiceStream = null;
let voiceRoomRef = null;
let voiceIsCaller = false;
let renegotiationBusy = false;
let renegotiationQueue = false;

async function addRemoteIceCandidate(candidate, pc = peerConnection) {
  if (!pc || !candidate) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.warn("ICE candidate error:", err);
  }
}

async function flushRemoteIceCandidates() {
  const queued = pendingRemoteCandidates.splice(0);
  for (const candidate of queued) await addRemoteIceCandidate(candidate);
}

async function setRemoteDescriptionSafe(description) {
  if (!peerConnection || !description) return;
  await peerConnection.setRemoteDescription(new RTCSessionDescription(description));
  remoteDescriptionReady = true;
  await flushRemoteIceCandidates();
}

function setSpeakerState(muted) {
  isSpeakerMuted = muted;
  const audio = document.getElementById("remoteAudio");
  const btn = document.getElementById("toggleSpeakerBtn");
  if (audio) {
    audio.muted = muted;
    audio.volume = muted ? 0 : 1;
    if (!muted) audio.play().catch(() => {});
  }
  if (btn) {
    btn.textContent = muted ? "🔇 Speaker OFF" : "🔊 Speaker ON";
    btn.classList.toggle("active-mic", !muted);
  }
}

async function addRenegotiationCandidates(negRef, pc) {
  negRef.child(voiceIsCaller ? "calleeCandidates" : "callerCandidates")
    .on("child_added", snap => {
      const c = snap.val();
      if (c) addRemoteIceCandidate(c, pc);
    });
}

async function createCallerRenegotiation() {
  if (!peerConnection || !voiceRoomRef || !voiceIsCaller) return;
  if (peerConnection.signalingState !== "stable") {
    renegotiationQueue = true;
    return;
  }
  if (renegotiationBusy) {
    renegotiationQueue = true;
    return;
  }

  renegotiationBusy = true;
  const negRef = voiceRoomRef.child("renegotiations").push();
  const negId = negRef.key;

  try {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    // ICE candidates can be generated immediately after setLocalDescription.
    // Store them under this exact negotiation so they cannot be mixed with
    // candidates from the original offer.
    peerConnection.__activeNegotiationRef = negRef;

    await negRef.child("offer").set({
      sdp: offer.sdp,
      type: offer.type
    });

    negRef.child("answer").on("value", async snap => {
      const answer = snap.val();
      if (!answer || peerConnection.signalingState !== "have-local-offer") return;
      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        remoteDescriptionReady = true;
        await flushRemoteIceCandidates();
        console.log("Voice renegotiation completed:", negId);
      } catch (err) {
        console.warn("Voice renegotiation answer error:", err);
      } finally {
        renegotiationBusy = false;
        if (renegotiationQueue) {
          renegotiationQueue = false;
          setTimeout(() => createCallerRenegotiation(), 0);
        }
      }
    });

    await addRenegotiationCandidates(negRef, peerConnection);
  } catch (err) {
    renegotiationBusy = false;
    console.warn("Voice renegotiation error:", err);
  }
}

function requestVoiceRenegotiation() {
  if (!voiceRoomRef || voiceIsCaller) {
    if (voiceIsCaller) createCallerRenegotiation();
    return;
  }
  const requestRef = voiceRoomRef.child("renegotiationRequests").push();
  requestRef.set({
    requestedAt: firebase.database.ServerValue.TIMESTAMP
  });
}

// Acquire the microphone for BOTH players as soon as the room connects, so the
// mic track is already inside the first offer/answer (no late renegotiation).
// The track starts disabled (muted); the Mic button only enables/disables it.
let micReadyPromise = Promise.resolve();
async function acquireLocalMic() {
  if (localVoiceStream) return localVoiceStream;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false
    });
    stream.getAudioTracks().forEach(t => t.enabled = !isMicMuted);
    localVoiceStream = stream;
    return stream;
  } catch (err) {
    console.warn("Microphone not available at room start:", err);
    return null;
  }
}

async function attachLocalMicToPeer() {
  if (!peerConnection || !localVoiceStream) return;
  const track = localVoiceStream.getAudioTracks()[0];
  if (!track) return;
  let t = audioTransceiver;
  if (!t) t = peerConnection.getTransceivers().find(x => x.receiver && x.receiver.track && x.receiver.track.kind === "audio");
  if (t) {
    audioTransceiver = t;
    t.direction = "sendrecv";
    await t.sender.replaceTrack(track);
  } else {
    audioTransceiver = peerConnection.addTransceiver(track, { direction: "sendrecv" });
  }
}

async function startVoiceChat(roomId, isCaller) {
  try {
    pendingRemoteCandidates = [];
    remoteDescriptionReady = false;
    remoteVoiceStream = null;
    voiceIsCaller = !!isCaller;
    voiceRoomRef = database.ref("rooms/" + roomId + "/voice");
    peerConnection = new RTCPeerConnection(rtcConfig);
    renegotiationBusy = false;
    renegotiationQueue = false;

    // Keep a stable audio m-line from the beginning. The actual microphone
    // track can be attached later, followed by explicit renegotiation.
    audioTransceiver = null;
    if (isCaller) {
      audioTransceiver = peerConnection.addTransceiver("audio", { direction: "sendrecv" });
    }
    micReadyPromise = acquireLocalMic();

    peerConnection.onconnectionstatechange = () => {
      console.log("Voice connection state:", peerConnection.connectionState);
      if (peerConnection.connectionState === "connected") {
        const audio = document.getElementById("remoteAudio");
        if (audio && !isSpeakerMuted) audio.play().catch(() => {});
      }
    };

    peerConnection.ontrack = (event) => {
      const audio = document.getElementById("remoteAudio");
      if (!audio) return;

      if (event.streams && event.streams[0]) {
        remoteVoiceStream = event.streams[0];
      } else {
        if (!remoteVoiceStream) remoteVoiceStream = new MediaStream();
        const alreadyAdded = remoteVoiceStream.getTracks().some(t => t.id === event.track.id);
        if (!alreadyAdded) remoteVoiceStream.addTrack(event.track);
      }

      event.track.enabled = true;
      audio.autoplay = true;
      audio.playsInline = true;
      audio.srcObject = remoteVoiceStream;
      audio.muted = isSpeakerMuted;
      audio.volume = isSpeakerMuted ? 0 : 1;
      audio.play().then(() => {
        console.log("Remote voice playback started", {
          trackId: event.track.id,
          readyState: event.track.readyState
        });
      }).catch(e => {
        console.log("Remote voice playback needs speaker interaction:", e);
      });
    };

    peerConnection.onicecandidate = (e) => {
      if (!e.candidate) return;
      const activeRef = peerConnection.__activeNegotiationRef;
      if (activeRef) {
        const path = voiceIsCaller ? "callerCandidates" : "calleeCandidates";
        activeRef.child(path).push(e.candidate.toJSON());
      } else {
        const path = voiceIsCaller ? "callerCandidates" : "calleeCandidates";
        voiceRoomRef.child(path).push(e.candidate.toJSON());
      }
    };

    if (isCaller) {
      // Initial negotiation (mic track included in the offer).
      await micReadyPromise;
      await attachLocalMicToPeer();
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      await voiceRoomRef.child("offer").set({ sdp: offer.sdp, type: offer.type });

      voiceRoomRef.child("answer").on("value", async snap => {
        const ans = snap.val();
        if (ans && !peerConnection.currentRemoteDescription) {
          await setRemoteDescriptionSafe(ans);
        }
      });

      voiceRoomRef.child("calleeCandidates").on("child_added", snap => {
        const c = snap.val();
        if (c) {
          if (!remoteDescriptionReady) pendingRemoteCandidates.push(c);
          else addRemoteIceCandidate(c);
        }
      });

      // The guest cannot create an offer itself in this simple two-peer setup.
      // If the guest turns its mic on later, it asks the caller to renegotiate.
      voiceRoomRef.child("renegotiationRequests").on("child_added", snap => {
        if (snap.val()) createCallerRenegotiation();
      });

      // The caller is also allowed to renegotiate when its own microphone is
      // enabled, so both directions use the same SDP path.
    } else {
      voiceRoomRef.child("offer").on("value", async snap => {
        const off = snap.val();
        if (off && !peerConnection.currentRemoteDescription) {
          await setRemoteDescriptionSafe(off);
          await micReadyPromise;
          await attachLocalMicToPeer();
          const ans = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(ans);
          await voiceRoomRef.child("answer").set({ sdp: ans.sdp, type: ans.type });
        }
      });

      voiceRoomRef.child("callerCandidates").on("child_added", snap => {
        const c = snap.val();
        if (c) {
          if (!remoteDescriptionReady) pendingRemoteCandidates.push(c);
          else addRemoteIceCandidate(c);
        }
      });

      // Handle every new caller-created renegotiation offer.
      voiceRoomRef.child("renegotiations").on("child_added", async snap => {
        const negRef = snap.ref;
        const neg = snap.val();
        if (!neg || !neg.offer) return;

        try {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(neg.offer));
          await attachLocalMicToPeer();
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          await negRef.child("answer").set({ sdp: answer.sdp, type: answer.type });

          negRef.child("callerCandidates").on("child_added", candidateSnap => {
            const c = candidateSnap.val();
            if (c) addRemoteIceCandidate(c);
          });

          console.log("Voice renegotiation answer sent:", snap.key);
        } catch (err) {
          console.warn("Voice renegotiation offer error:", err);
        }
      });
    }
  } catch (err) {
    console.warn("WebRTC voice init error:", err);
  }
}

// Live voice status: the existing voice row + the small mic buttons beside the player names.
function renderMicControls(on) {
  const micBtn = document.getElementById("toggleMicBtn");
  const dot = document.getElementById("voiceStatusDot");
  const txt = document.getElementById("voiceStatusText");
  if (on) {
    if (micBtn) { micBtn.textContent = "🔴 Mute"; micBtn.classList.add("active-mic"); }
    if (dot) dot.className = "voice-dot on";
    if (txt) { txt.textContent = "Live Voice: ON"; txt.style.color = "#34d399"; }
  } else {
    if (micBtn) { micBtn.textContent = "🎙️ Turn Mic ON"; micBtn.classList.remove("active-mic"); }
    if (dot) dot.className = "voice-dot off";
    if (txt) { txt.textContent = "Live Voice: OFF"; txt.style.color = "#94a3b8"; }
  }
  updateBoardMicButtons();
}

// Each player bar gets a mic button. Your own bar toggles your microphone;
// the opponent's bar shows their live ON/OFF status (synced through rooms/{code}/mic).
function updateBoardMicButtons() {
  const topBtn = document.getElementById('topMicBtn');
  const bottomBtn = document.getElementById('bottomMicBtn');
  if (!topBtn || !bottomBtn) return;
  const inRoom = currentMode === 'friend' && currentRoomCode && friendRoomData && friendRoomData.guestId && !isWaitingForOpponent;
  const active = inRoom || !!quickBot;
  if (!active || !board) { topBtn.style.display = 'none'; bottomBtn.style.display = 'none'; return; }
  const topColor = board.orientation() === 'black' ? 'w' : 'b';
  const myColor = quickBot ? quickBot.myColor : myOnlineColor;
  let opponentOn = false;
  if (!quickBot && friendRoomData && friendRoomData.mic) {
    const opponentId = friendRoomData.creatorId === currentUserId ? friendRoomData.guestId : friendRoomData.creatorId;
    opponentOn = !!friendRoomData.mic[opponentId];
  }
  const myOn = quickBot ? !!quickBot.micOn : !isMicMuted;
  [[topBtn, topColor], [bottomBtn, topColor === 'w' ? 'b' : 'w']].forEach(([btn, color]) => {
    const mine = color === myColor;
    const on = mine ? myOn : opponentOn;
    btn.style.display = 'inline-flex';
    btn.disabled = !mine;
    btn.classList.toggle('mine', mine);
    btn.classList.toggle('on', on);
    btn.textContent = on ? '🎙️ ON' : '🔇 OFF';
    btn.title = mine ? (on ? 'Your microphone is ON — tap to turn it OFF' : 'Your microphone is OFF — tap to turn it ON')
                     : (on ? "Opponent's microphone is ON" : "Opponent's microphone is OFF");
    btn.setAttribute('aria-label', btn.title);
  });
}

async function toggleMicrophone() {
  if (quickBot && !currentRoomCode) {
    quickBot.micOn = !quickBot.micOn;
    renderMicControls(quickBot.micOn);
    return;
  }
  if (!currentRoomCode) {
    alert("Please create or join a room first.");
    return;
  }

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Microphone is not available. Use HTTPS or localhost and allow browser microphone permission.");
    }

    let newTrackWasAdded = false;

    if (!localVoiceStream) {
      // Mic was not granted at room start (or permission was denied) - ask again now.
      const stream = await acquireLocalMic();
      if (!stream) throw new Error("Microphone permission denied. Allow the microphone in the browser address bar and try again.");
      await attachLocalMicToPeer();
      newTrackWasAdded = true;
    }

    isMicMuted = !isMicMuted;
    localVoiceStream.getAudioTracks().forEach(t => t.enabled = !isMicMuted);

    // If the track was added after the initial SDP exchange, explicitly
    // renegotiate. This is the key fix for guest -> creator audio.
    if (newTrackWasAdded && peerConnection) {
      if (voiceIsCaller) {
        await createCallerRenegotiation();
      } else {
        requestVoiceRenegotiation();
      }
    }

    const audio = document.getElementById("remoteAudio");
    if (audio) {
      audio.muted = isSpeakerMuted;
      audio.volume = isSpeakerMuted ? 0 : 1;
      audio.play().catch(() => {});
    }

    renderMicControls(!isMicMuted);
    database.ref("rooms/" + currentRoomCode + "/mic/" + currentUserId).set(!isMicMuted).catch(() => {});
  } catch (err) {
    console.error("Microphone error:", err);
    alert("Microphone access failed: " + err.message);
  }
}

async function toggleSpeaker() {
  const audio = document.getElementById("remoteAudio");
  if (!audio) return;

  const nextMuted = !isSpeakerMuted;
  setSpeakerState(nextMuted);

  if (!nextMuted) {
    try {
      audio.muted = false;
      audio.volume = 1;
      if (remoteVoiceStream && audio.srcObject !== remoteVoiceStream) {
        audio.srcObject = remoteVoiceStream;
      }
      await audio.play();
    } catch (err) {
      console.log("Speaker playback waiting:", err);
    }
  }
}


// B Chess Analyzer — Stockfish Engine + Audio FX + Real-time Blunder Engine + Captured Pieces + Copy Report

let board = null;
const game = new Chess();
let redoStack = [];
let stockfish = null;
let engineReady = false;
let currentBestMoveUci = null;
let showBestMoveArrow = true;
let targetDepth = 15;
let soundEnabled = true;

// Click-to-Move / Tap state
let selectedSquare = null;
let dragActive = false;
let lastDropTime = 0;

// Game Mode State: 'analysis' or 'bot'
let currentMode = 'analysis';
let playerColor = 'w';
let botRating = 1400;
let isBotThinking = false;

// Audio Synthesizer (Realistic Wooden Acoustic Multi-layered Audio)
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioCtx = new AudioContext();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playSound(type) {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (type === 'move') {
      // Realistic wooden board tap: dual resonant body + contact click
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      const gain2 = ctx.createGain();

      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(320, now);
      osc1.frequency.exponentialRampToValueAtTime(65, now + 0.07);

      gain1.gain.setValueAtTime(0.75, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(140, now);
      osc2.frequency.exponentialRampToValueAtTime(45, now + 0.09);

      gain2.gain.setValueAtTime(0.5, now);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      osc1.connect(gain1);
      osc2.connect(gain2);
      gain1.connect(ctx.destination);
      gain2.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.075);
      osc2.stop(now + 0.095);

    } else if (type === 'capture') {
      // Sharp wooden piece clash with impact crack
      const osc = ctx.createOscillator();
      const noise = ctx.createBufferSource();
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.06, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < buffer.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.015));
      }
      noise.buffer = buffer;

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.65, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(480, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.1);

      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(0.6, now);
      oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);

      noise.connect(noiseGain);
      osc.connect(oscGain);
      noiseGain.connect(ctx.destination);
      oscGain.connect(ctx.destination);

      noise.start(now);
      osc.start(now);
      osc.stop(now + 0.1);

    } else if (type === 'check') {
      // Clear alert chime (Bell-like tension tone)
      [659.25, 880].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.07);

        gain.gain.setValueAtTime(0.45, now + idx * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.22);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.07);
        osc.stop(now + idx * 0.07 + 0.23);
      });

    } else if (type === 'checkmate') {
      // Triumphant orchestral brass-like victory chord
      const freqs = [392.00, 493.88, 587.33, 783.99, 987.77];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.1);

        gain.gain.setValueAtTime(0.5, now + idx * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.8);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.1);
        osc.stop(now + idx * 0.1 + 0.85);
      });
    }
  } catch (e) {
    console.warn('Audio playback error:', e);
  }
}

// Move Quality & Real-Time Blunder Analysis Engine
// Each move stores { san, color, evalBefore, evalAfter, quality, loss }
let moveQualityHistory = [];
let pendingEvalMoveIndex = null;
let currentPositionCp = 0; // Perspective: White (e.g. +120 = +1.20 pawns for White)

// Bot profiles
const BOT_PROFILES = {
  800:  { skill: 0,  depth: 1,  moveTime: 300, blunderRate: 0.35 },
  1100: { skill: 3,  depth: 2,  moveTime: 400, blunderRate: 0.18 },
  1400: { skill: 6,  depth: 4,  moveTime: 500, blunderRate: 0.06 },
  1700: { skill: 10, depth: 7,  moveTime: 650, blunderRate: 0.01 },
  2000: { skill: 15, depth: 10, moveTime: 800, blunderRate: 0.00 },
  2500: { skill: 20, depth: 14, moveTime: 1000, blunderRate: 0.00 }
};

// Rich Opening & Gambit Dictionary
const OPENINGS_LIST = [
  { moves: ["e4", "e5", "f4"], name: "King's Gambit" },
  { moves: ["e4", "e5", "f4", "exf4"], name: "King's Gambit Accepted" },
  { moves: ["e4", "e5", "f4", "d5"], name: "Falkbeer Counter-Gambit" },
  { moves: ["d4", "d5", "c4"], name: "Queen's Gambit" },
  { moves: ["d4", "d5", "c4", "dxc4"], name: "Queen's Gambit Accepted (QGA)" },
  { moves: ["d4", "d5", "c4", "c6"], name: "Slav Defense" },
  { moves: ["d4", "d5", "c4", "e6"], name: "Queen's Gambit Declined (QGD)" },
  { moves: ["e4", "e5", "Nf3", "Nc6", "d4", "exd4", "Bc4"], name: "Scotch Gambit" },
  { moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "b4"], name: "Evans Gambit" },
  { moves: ["e4", "e5", "d4", "exd4", "c3"], name: "Danish Gambit" },
  { moves: ["e4", "e5", "Nf3", "d5"], name: "Elephant Gambit" },
  { moves: ["e4", "e5", "Nf3", "f5"], name: "Latvian Gambit" },
  { moves: ["d4", "Nf6", "c4", "e5"], name: "Budapest Gambit" },
  { moves: ["d4", "f5", "e4"], name: "Staunton Gambit" },
  { moves: ["d4", "c5", "d5", "b5"], name: "Benko Gambit" },
  { moves: ["e4", "c5", "b4"], name: "Sicilian Wing Gambit" },
  { moves: ["e4", "c5", "d4", "cxd4", "c3"], name: "Smith-Morra Gambit" },
  { moves: ["d4", "d5", "e4"], name: "Blackmar-Diemer Gambit" },
  { moves: ["e4", "e6", "d4", "d5", "c4"], name: "Diemer-Duhm Gambit" },
  { moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "exd5", "Na5"], name: "Two Knights Defense" },
  { moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "d4"], name: "Two Knights: Modern Bishop's Opening" },
  { moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"], name: "Giuoco Piano (Italian Game)" },
  { moves: ["e4", "e5", "Nf3", "Nc6", "Bc4"], name: "Italian Game" },
  { moves: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"], name: "Ruy Lopez: Morphy Defense" },
  { moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"], name: "Ruy Lopez (Spanish Opening)" },
  { moves: ["e4", "e5", "Nf3", "Nc6", "d4"], name: "Scotch Game" },
  { moves: ["e4", "e5", "Nf3", "Nf6"], name: "Petrov's Defense (Russian Game)" },
  { moves: ["e4", "e5", "Nf3", "d6"], name: "Philidor Defense" },
  { moves: ["e4", "e5", "Nc3"], name: "Vienna Game" },
  { moves: ["e4", "e5", "Bc4"], name: "Bishop's Opening" },
  { moves: ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"], name: "Sicilian Defense: Najdorf Variation" },
  { moves: ["e4", "c5", "Nf3", "Nc6", "d4", "cxd4", "Nxd4", "g6"], name: "Sicilian Defense: Accelerated Dragon" },
  { moves: ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "g6"], name: "Sicilian Defense: Dragon Variation" },
  { moves: ["e4", "c5", "c3"], name: "Sicilian Defense: Alapin Variation" },
  { moves: ["e4", "c5", "Nc3"], name: "Closed Sicilian" },
  { moves: ["e4", "c5"], name: "Sicilian Defense" },
  { moves: ["e4", "e6", "d4", "d5"], name: "French Defense" },
  { moves: ["e4", "e6"], name: "French Defense" },
  { moves: ["e4", "c6", "d4", "d5"], name: "Caro-Kann Defense" },
  { moves: ["e4", "c6"], name: "Caro-Kann Defense" },
  { moves: ["e4", "d6", "d4", "Nf6"], name: "Pirc Defense" },
  { moves: ["e4", "Nf6"], name: "Alekhine's Defense" },
  { moves: ["e4", "d5"], name: "Scandinavian Defense (Center Counter)" },
  { moves: ["e4", "g6"], name: "Modern Defense" },
  { moves: ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7"], name: "King's Indian Defense (KID)" },
  { moves: ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4"], name: "Nimzo-Indian Defense" },
  { moves: ["d4", "Nf6", "c4", "e6", "Nf3", "b6"], name: "Queen's Indian Defense" },
  { moves: ["d4", "Nf6", "c4", "c5"], name: "Benoni Defense" },
  { moves: ["d4", "f5"], name: "Dutch Defense" },
  { moves: ["d4", "d5", "Bf4"], name: "London System" },
  { moves: ["d4", "Nf6", "Bf4"], name: "London System" },
  { moves: ["c4"], name: "English Opening" },
  { moves: ["Nf3"], name: "Réti Opening" },
  { moves: ["b3"], name: "Nimzo-Larsen Attack" },
  { moves: ["f4"], name: "Bird's Opening" },
  { moves: ["e4", "e5"], name: "Open Game (1. e4 e5)" },
  { moves: ["e4"], name: "King's Pawn Opening (1. e4)" },
  { moves: ["d4"], name: "Queen's Pawn Opening (1. d4)" }
];

function detectOpening() {
  const history = game.history();
  if (history.length === 0) return "Starting Position";

  let matchedOpening = null;
  let maxMatchedLen = 0;

  for (const item of OPENINGS_LIST) {
    if (item.moves.length <= history.length) {
      let match = true;
      for (let i = 0; i < item.moves.length; i++) {
        if (history[i] !== item.moves[i]) {
          match = false;
          break;
        }
      }
      if (match && item.moves.length > maxMatchedLen) {
        maxMatchedLen = item.moves.length;
        matchedOpening = item.name;
      }
    }
  }

  return matchedOpening || "Unorthodox / Custom Variation";
}

// 1. Initialize Stockfish Engine
async function initStockfish() {
  const urls = [
    'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js',
    'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js'
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const scriptText = await response.text();
      const blob = new Blob([scriptText], { type: 'application/javascript' });
      stockfish = new Worker(URL.createObjectURL(blob));
      setupStockfishListeners();
      stockfish.postMessage('uci');
      return;
    } catch (e) {
      console.warn('Trying next Stockfish CDN...', e);
    }
  }

  document.getElementById('engineBadge').textContent = 'Offline Mode';
  document.getElementById('engineSubtext').textContent = 'Could not load remote Stockfish worker.';
}

function setupStockfishListeners() {
  stockfish.onmessage = function(event) {
    const line = typeof event.data === 'string' ? event.data : '';
    if (!line) return;

    if (line === 'uciok') {
      engineReady = true;
      document.getElementById('engineBadge').textContent = 'Stockfish 10 Ready';
      if (currentMode === 'analysis') {
        analyzePosition();
      }
    }

    if (line.startsWith('info depth')) {
      const depthMatch = line.match(/depth (\d+)/);
      const scoreMatch = line.match(/score cp (-?\d+)/);
      const mateMatch = line.match(/score mate (-?\d+)/);
      const pvMatch = line.match(/ pv ([a-h1-8qrbn\s]+)/);

      if (depthMatch) {
        if (!quickBot) document.getElementById('depthVal').textContent = `${depthMatch[1]} / ${targetDepth}`;
      }

      if (pvMatch) {
        const pvMoves = pvMatch[1].trim().split(/\s+/);
        const topUci = pvMoves[0];
        if (topUci && topUci.length >= 4) {
          currentBestMoveUci = topUci;
          if (currentMode === 'analysis') {
            updateBestMoveDisplay(topUci);
            drawBestMoveArrow(topUci);
          }
        }
        if (!quickBot) document.getElementById('pvLineText').textContent = `Engine Line: ${pvMoves.slice(0, 5).join(' → ')}`;
      }

      const turnMultiplier = game.turn() === 'w' ? 1 : -1;
      let newScoreCp = 0;

      if (mateMatch) {
        const mateRaw = parseInt(mateMatch[1], 10) * turnMultiplier;
        const mateText = `M${Math.abs(mateRaw)}`;
        if (!quickBot) {
          document.getElementById('evalScore').textContent = mateRaw > 0 ? `+${mateText}` : `-${mateText}`;
          updateEvalBar(mateRaw > 0 ? 10 : -10, mateText);
        }
        newScoreCp = mateRaw > 0 ? 1500 : -1500;
      } else if (scoreMatch) {
        const cpWhite = (parseInt(scoreMatch[1], 10) * turnMultiplier) / 100;
        newScoreCp = parseInt(scoreMatch[1], 10) * turnMultiplier;
        const sign = cpWhite > 0 ? '+' : '';
        const formatted = `${sign}${cpWhite.toFixed(2)}`;
        if (!quickBot) {
          document.getElementById('evalScore').textContent = formatted;
          updateEvalBar(cpWhite, `${sign}${cpWhite.toFixed(1)}`);
        }
      }

      currentPositionCp = newScoreCp;

      // RESOLVE MOVE QUALITY UPON RECEIVING REAL EVALUATION FROM ENGINE:
      if (pendingEvalMoveIndex !== null && moveQualityHistory[pendingEvalMoveIndex]) {
        resolveMoveQuality(pendingEvalMoveIndex, newScoreCp);
        pendingEvalMoveIndex = null;
      }
    }

    if (line.startsWith('bestmove')) {
      const parts = line.split(' ');
      const bestUci = parts[1];

      if (currentMode === 'bot' && isBotThinking) {
        isBotThinking = false;
        executeBotMove(bestUci);
        return;
      }

      if (bestUci && bestUci !== '(none)') {
        currentBestMoveUci = bestUci;
        if (currentMode === 'analysis') {
          updateBestMoveDisplay(bestUci);
          drawBestMoveArrow(bestUci);
        }
      }
    }
  };
}

// Correct Centipawn Difference Calculation for Real Blunders & Mistakes
function resolveMoveQuality(index, evalAfter) {
  const item = moveQualityHistory[index];
  if (!item) return;

  item.evalAfter = evalAfter;
  const evalBefore = item.evalBefore;

  // For White: If eval dropped, loss = evalBefore - evalAfter
  // For Black: If eval increased in White's favor, loss = evalAfter - evalBefore
  let diff = 0;
  if (item.color === 'w') {
    diff = evalBefore - evalAfter;
  } else {
    diff = evalAfter - evalBefore;
  }

  let quality = 'good';
  if (diff >= 200) {
    quality = 'blunder';       // ?? Loss >= 2 pawns
  } else if (diff >= 90) {
    quality = 'mistake';       // ? Loss >= 0.9 pawns
  } else if (diff >= 40) {
    quality = 'inaccuracy';    // ?! Loss >= 0.4 pawns
  } else if (diff <= 15) {
    quality = 'best';          // ★ Optimal move / minimal drop
  } else {
    quality = 'good';          // ✓ Standard playable move
  }

  item.quality = quality;
  item.loss = Math.max(0, diff);

  updateGameReview();
  renderMoveHistoryBadges();
}

function updateBestMoveDisplay(uci) {
  if (!uci || uci.length < 4) return;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : 'q';

  const tempGame = new Chess(game.fen());
  const moveObj = tempGame.move({ from, to, promotion });
  const sanText = moveObj ? moveObj.san : `${from}→${to}`;

  document.getElementById('bestMoveText').textContent = `${sanText} (${from.toUpperCase()} → ${to.toUpperCase()})`;
  document.getElementById('engineSubtext').textContent = `Move piece from ${from.toUpperCase()} to ${to.toUpperCase()}`;
}

function updateEvalBar(cpWhite, displayScore) {
  const clamped = Math.max(-10, Math.min(10, cpWhite));
  const whitePercent = 50 + (clamped / 10) * 46;

  document.getElementById('evalBarWhite').style.height = `${whitePercent}%`;
  document.getElementById('evalBarText').textContent = displayScore;

  const wProb = Math.round(whitePercent);
  const bProb = 100 - wProb;
  document.getElementById('whiteProbBar').style.width = `${wProb}%`;
  document.getElementById('whiteProbBar').textContent = `White ${wProb}%`;
  document.getElementById('blackProbBar').style.width = `${bProb}%`;
  document.getElementById('blackProbBar').textContent = `Black ${bProb}%`;

  const explainEl = document.getElementById('evalExplainText');
  if (cpWhite > 1.5) explainEl.textContent = 'White has a winning advantage.';
  else if (cpWhite > 0.4) explainEl.textContent = 'White is slightly better.';
  else if (cpWhite < -1.5) explainEl.textContent = 'Black has a winning advantage.';
  else if (cpWhite < -0.4) explainEl.textContent = 'Black is slightly better.';
  else explainEl.textContent = 'Position is balanced.';
}

function drawBestMoveArrow(uci) {
  clearHighlights();
  const arrowEl = document.getElementById('bestMoveArrow');

  if (!showBestMoveArrow || currentMode === 'bot' || !uci || uci.length < 4 || game.game_over()) {
    arrowEl.setAttribute('visibility', 'hidden');
    return;
  }

  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);

  $(`#myBoard .square-${from}`).addClass('highlight-from');
  $(`#myBoard .square-${to}`).addClass('highlight-to');

  const coordsFrom = squareToSvgCoords(from);
  const coordsTo = squareToSvgCoords(to);

  arrowEl.setAttribute('x1', coordsFrom.x);
  arrowEl.setAttribute('y1', coordsFrom.y);
  arrowEl.setAttribute('x2', coordsTo.x);
  arrowEl.setAttribute('y2', coordsTo.y);
  arrowEl.setAttribute('visibility', 'visible');
}

function squareToSvgCoords(square) {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1], 10) - 1;
  const orientation = board.orientation();

  let col, row;
  if (orientation === 'white') {
    col = file;
    row = 7 - rank;
  } else {
    col = 7 - file;
    row = rank;
  }

  return {
    x: col * 12.5 + 6.25,
    y: row * 12.5 + 6.25
  };
}

function clearHighlights() {
  $('#myBoard .square-55d63').removeClass('highlight-from highlight-to');
}

function clearClickHighlights() {
  $('#myBoard .square-selected, #myBoard .legal-dest-dot, #myBoard .legal-dest-capture').removeClass('square-selected legal-dest-dot legal-dest-capture');
}

function showLegalDestinations(sourceSquare) {
  clearClickHighlights();
  $(`#myBoard .square-${sourceSquare}`).addClass('square-selected');

  const legalMoves = game.moves({ square: sourceSquare, verbose: true });
  for (const m of legalMoves) {
    const $target = $(`#myBoard .square-${m.to}`);
    if (m.captured || game.get(m.to)) {
      $target.addClass('legal-dest-capture');
    } else {
      $target.addClass('legal-dest-dot');
    }
  }
}

function analyzePosition() {
  if (!stockfish || !engineReady) return;
  if (game.game_over()) {
    document.getElementById('bestMoveText').textContent = 'Game Over';
    document.getElementById('bestMoveArrow').setAttribute('visibility', 'hidden');
    return;
  }

  document.getElementById('bestMoveText').textContent = 'Analyzing...';
  stockfish.postMessage('stop');
  stockfish.postMessage('setoption name Skill Level value 20');
  stockfish.postMessage('position fen ' + game.fen());
  stockfish.postMessage('go depth ' + targetDepth);
}

function requestBotMove() {
  if (game.game_over() || (quickBot && quickBot.over)) return;
  if (!stockfish || !engineReady) {
    if (quickBot) playRandomQuickBotMove();
    return;
  }
  isBotThinking = true;

  if (!quickBot) {
    document.getElementById('bestMoveText').textContent = `Bot (${botRating}) is thinking...`;
    document.getElementById('engineSubtext').textContent = 'Calculating response...';
    document.getElementById('pvLineText').textContent = 'Bot turn in progress...';
  }
  document.getElementById('bestMoveArrow').setAttribute('visibility', 'hidden');

  const profile = BOT_PROFILES[botRating] || BOT_PROFILES[1400];

  if (Math.random() < profile.blunderRate) {
    const legalMoves = game.moves({ verbose: true });
    if (legalMoves.length > 0) {
      const randomMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];
      setTimeout(() => {
        if (!isBotThinking) return;
        isBotThinking = false;
        const uciMove = randomMove.from + randomMove.to + (randomMove.promotion || '');
        executeBotMove(uciMove);
      }, profile.moveTime);
      return;
    }
  }

  stockfish.postMessage('stop');
  stockfish.postMessage(`setoption name Skill Level value ${profile.skill}`);
  stockfish.postMessage('position fen ' + game.fen());
  stockfish.postMessage(`go depth ${profile.depth} movetime ${profile.moveTime}`);
}

function executeBotMove(uci) {
  if (!uci || uci === '(none)' || (quickBot && quickBot.over)) {
    isBotThinking = false;
    return;
  }

  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : 'q';

  const beforeEval = currentPositionCp;
  const move = game.move({ from, to, promotion });
  if (move) {
    redoStack = [];
    board.position(game.fen());
    recordMoveQuality(move, beforeEval);
    handleMoveEffects(move);
    updateUI();
    quickBotAfterMove();
  }
}

// --- PAWN PROMOTION ---
function isPromotionMove(source, target) {
  const piece = game.get(source);
  if (!piece || piece.type !== 'p') return false;
  return (piece.color === 'w' && target[1] === '8') || (piece.color === 'b' && target[1] === '1');
}

function showPromotionModal(source, target, onChosen) {
  const modal = document.getElementById('promotionModal');
  if (!modal) return onChosen('q');
  pendingPromotionMove = { source, target, onChosen };
  modal.style.display = 'flex';
}

function closePromotionModal() {
  const modal = document.getElementById('promotionModal');
  if (modal) modal.style.display = 'none';
  pendingPromotionMove = null;
}

function finishPromotionChoice(piece) {
  const pending = pendingPromotionMove;
  closePromotionModal();
  if (pending && typeof pending.onChosen === 'function') pending.onChosen(piece);
}

function applyHumanMove(source, target, promotion = 'q') {
  const beforeEval = currentPositionCp;
  const move = game.move({ from: source, to: target, promotion });
  if (!move) return false;
  redoStack = [];
  board.position(game.fen());
  recordMoveQuality(move, beforeEval);
  handleMoveEffects(move);
  updateUI();
  quickBotAfterMove();
  checkBotTrigger();
  checkOnlineTrigger(move);
  return true;
}

// Drag & Drop Handlers
function onDragStart(source, piece) {
  if (isWaitingForOpponent) return false;
  if (currentMode === 'quick') return false;
  if (quickBot && quickBot.over) return false;
  if (game.game_over()) return false;
  if (isBotThinking) return false;

  if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
      (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
    return false;
  }

  if (currentMode === 'bot' && game.turn() !== playerColor) {
    return false;
  }
  if (currentMode === 'friend' && currentRoomCode) {
    if (game.turn() !== myOnlineColor) return false;
    if ((myOnlineColor === 'w' && piece.search(/^b/) !== -1) ||
        (myOnlineColor === 'b' && piece.search(/^w/) !== -1)) {
      return false;
    }
  }

  dragActive = true;
  // Let the dragged piece render first; highlight legal squares on the next frame.
  requestAnimationFrame(() => { if (dragActive) showLegalDestinations(source); });
}

function onDrop(source, target) {
  dragActive = false;
  lastDropTime = Date.now();

  if (source === target) {
    if (selectedSquare === source) {
      clearClickHighlights();
      selectedSquare = null;
    } else {
      selectedSquare = source;
      showLegalDestinations(source);
    }
    return 'snapback';
  }

  clearClickHighlights();
  selectedSquare = null;

  if (isPromotionMove(source, target)) {
    showPromotionModal(source, target, (promotion) => applyHumanMove(source, target, promotion));
    return 'snapback';
  }

  return applyHumanMove(source, target) ? undefined : 'snapback';
}

function onSnapEnd() {
  board.position(game.fen());
}

// Universal Click & Touch handler for mobile & desktop
function handleSquareClick(square) {
  if (isWaitingForOpponent) return;
  if (currentMode === 'quick') return;
  if (quickBot && quickBot.over) return;
  if (game.game_over() || isBotThinking) return;

  if (selectedSquare) {
    const clickedPiece = game.get(square);
    if (clickedPiece && clickedPiece.color === game.turn() &&
        (currentMode !== 'bot' || clickedPiece.color === playerColor)) {
      if (selectedSquare === square) {
        clearClickHighlights();
        selectedSquare = null;
        return;
      }
      selectedSquare = square;
      showLegalDestinations(square);
      return;
    }

    const source = selectedSquare;
    clearClickHighlights();
    selectedSquare = null;

    if (isPromotionMove(source, square)) {
      showPromotionModal(source, square, (promotion) => applyHumanMove(source, square, promotion));
      return;
    }

    if (applyHumanMove(source, square)) return;
  }

  const piece = game.get(square);
  if (!piece) return;

  if (piece.color !== game.turn()) return;
  if (currentMode === 'bot' && piece.color !== playerColor) return;
  if (currentMode === 'friend' && currentRoomCode && piece.color !== myOnlineColor) return;

  selectedSquare = square;
  showLegalDestinations(square);
}

function recordMoveQuality(move, beforeEval) {
  const newIndex = moveQualityHistory.length;
  moveQualityHistory.push({
    san: move.san,
    color: move.color,
    evalBefore: beforeEval,
    evalAfter: beforeEval,
    quality: '...', // Pending evaluation from Stockfish
    loss: 0
  });
  pendingEvalMoveIndex = newIndex;
}

function clearKingStateEffects() {
  document.querySelectorAll('#myBoard .king-in-check, #myBoard .king-checkmate-fall').forEach(el => {
    el.classList.remove('king-in-check', 'king-checkmate-fall');
  });
}

function showKingStateEffects() {
  clearKingStateEffects();
  const kingColor = game.turn();
  const kingSquare = game.board().reduce((found, row, r) => {
    if (found) return found;
    for (let c = 0; c < row.length; c++) {
      const p = row[c];
      if (p && p.type === 'k' && p.color === kingColor) {
        return String.fromCharCode(97 + c) + (8 - r);
      }
    }
    return null;
  }, null);
  if (!kingSquare) return;
  const squareEl = document.querySelector(`#myBoard .square-${kingSquare}`);
  if (!squareEl) return;
  if (game.in_checkmate()) {
    squareEl.classList.add('king-checkmate-fall');
  } else if (game.in_check()) {
    squareEl.classList.add('king-in-check');
  }
}

function handleMoveEffects(move) {
  if (game.in_checkmate()) {
    playSound('checkmate');
  } else if (game.in_check()) {
    playSound('check');
  } else if (move.captured) {
    playSound('capture');
  } else {
    playSound('move');
  }
  setTimeout(showKingStateEffects, 30);
}

// Captured Pieces Tracking & Material Score Calculation
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_IMAGES = {
  w: {
    p: 'https://chessboardjs.com/img/chesspieces/wikipedia/wP.png',
    n: 'https://chessboardjs.com/img/chesspieces/wikipedia/wN.png',
    b: 'https://chessboardjs.com/img/chesspieces/wikipedia/wB.png',
    r: 'https://chessboardjs.com/img/chesspieces/wikipedia/wR.png',
    q: 'https://chessboardjs.com/img/chesspieces/wikipedia/wQ.png'
  },
  b: {
    p: 'https://chessboardjs.com/img/chesspieces/wikipedia/bP.png',
    n: 'https://chessboardjs.com/img/chesspieces/wikipedia/bN.png',
    b: 'https://chessboardjs.com/img/chesspieces/wikipedia/bB.png',
    r: 'https://chessboardjs.com/img/chesspieces/wikipedia/bR.png',
    q: 'https://chessboardjs.com/img/chesspieces/wikipedia/bQ.png'
  }
};

function updateCapturedPiecesDisplay() {
  const startingCounts = {
    w: { p: 8, n: 2, b: 2, r: 2, q: 1 },
    b: { p: 8, n: 2, b: 2, r: 2, q: 1 }
  };

  const currentBoard = game.board();
  const currentCounts = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 }
  };

  let whiteMaterial = 0;
  let blackMaterial = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = currentBoard[r][c];
      if (piece && piece.type !== 'k') {
        currentCounts[piece.color][piece.type]++;
        if (piece.color === 'w') whiteMaterial += PIECE_VALUES[piece.type];
        else blackMaterial += PIECE_VALUES[piece.type];
      }
    }
  }

  // Pieces captured from Black (captured by White):
  const capturedFromBlack = [];
  ['q', 'r', 'b', 'n', 'p'].forEach(type => {
    const diff = startingCounts.b[type] - currentCounts.b[type];
    for (let i = 0; i < diff; i++) {
      capturedFromBlack.push({ color: 'b', type: type });
    }
  });

  // Pieces captured from White (captured by Black):
  const capturedFromWhite = [];
  ['q', 'r', 'b', 'n', 'p'].forEach(type => {
    const diff = startingCounts.w[type] - currentCounts.w[type];
    for (let i = 0; i < diff; i++) {
      capturedFromWhite.push({ color: 'w', type: type });
    }
  });

  const diffMaterial = whiteMaterial - blackMaterial;
  const isFlipped = board && board.orientation() === 'black';

  // If flipped, top is White, bottom is Black
  const topList = isFlipped ? capturedFromBlack : capturedFromWhite;
  const bottomList = isFlipped ? capturedFromWhite : capturedFromBlack;

  const barLabel = (color) => boardPlayerInfo && boardPlayerInfo[color]
    ? `${boardPlayerInfo[color].name} • ${boardPlayerInfo[color].rating}`
    : (color === 'w' ? 'White' : 'Black');
  const topName = barLabel(isFlipped ? 'w' : 'b');
  const bottomName = barLabel(isFlipped ? 'b' : 'w');

  document.getElementById('topPlayerName').textContent = topName;
  document.getElementById('bottomPlayerName').textContent = bottomName;

  // Each clock stays in the bar of the player it belongs to.
  const topBar = document.getElementById('topCapturedBar');
  const bottomBar = document.getElementById('bottomCapturedBar');
  const topClock = document.getElementById(isFlipped ? 'whiteClock' : 'blackClock');
  const bottomClock = document.getElementById(isFlipped ? 'blackClock' : 'whiteClock');
  if (topClock && topClock.parentNode !== topBar) topBar.appendChild(topClock);
  if (bottomClock && bottomClock.parentNode !== bottomBar) bottomBar.appendChild(bottomClock);

  document.getElementById('topCapturedBar').querySelector('.player-dot').className = `player-dot ${isFlipped ? 'white-dot' : 'black-dot'}`;
  document.getElementById('bottomCapturedBar').querySelector('.player-dot').className = `player-dot ${isFlipped ? 'black-dot' : 'white-dot'}`;

  // Render HTML icons for captured pieces
  document.getElementById('topCapturedPieces').innerHTML = topList.map(p =>
    `<img src="${PIECE_IMAGES[p.color][p.type]}" class="captured-img captured-${p.color}" alt="${p.type}" />`
  ).join('');

  document.getElementById('bottomCapturedPieces').innerHTML = bottomList.map(p =>
    `<img src="${PIECE_IMAGES[p.color][p.type]}" class="captured-img captured-${p.color}" alt="${p.type}" />`
  ).join('');

  // Material Advantage badges (+1, +3, etc.)
  const topAdvEl = document.getElementById('topMaterialAdv');
  const bottomAdvEl = document.getElementById('bottomMaterialAdv');

  topAdvEl.textContent = '';
  bottomAdvEl.textContent = '';

  if (diffMaterial > 0) {
    // White leads
    if (isFlipped) topAdvEl.textContent = `+${diffMaterial}`;
    else bottomAdvEl.textContent = `+${diffMaterial}`;
  } else if (diffMaterial < 0) {
    // Black leads
    if (isFlipped) bottomAdvEl.textContent = `+${Math.abs(diffMaterial)}`;
    else topAdvEl.textContent = `+${Math.abs(diffMaterial)}`;
  }
  updateBoardMicButtons();
}

function updateGameReview() {
  if (moveQualityHistory.length === 0) {
    document.getElementById('estEloVal').textContent = '-- Elo';
    document.getElementById('accuracyVal').textContent = '--%';
    document.getElementById('countBest').textContent = '0';
    document.getElementById('countGood').textContent = '0';
    document.getElementById('countInacc').textContent = '0';
    document.getElementById('countMistake').textContent = '0';
    document.getElementById('countBlunder').textContent = '0';
    document.getElementById('whiteQualityStats').textContent = '0 Blunders • 0 Mistakes';
    document.getElementById('blackQualityStats').textContent = '0 Blunders • 0 Mistakes';
    return;
  }

  let counts = { best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, '...': 0 };
  let whiteBlunders = 0, whiteMistakes = 0;
  let blackBlunders = 0, blackMistakes = 0;
  let totalLoss = 0;
  let analyzedMoves = 0;

  for (const m of moveQualityHistory) {
    if (m.quality !== '...') {
      counts[m.quality] = (counts[m.quality] || 0) + 1;
      totalLoss += m.loss;
      analyzedMoves++;

      if (m.color === 'w') {
        if (m.quality === 'blunder') whiteBlunders++;
        if (m.quality === 'mistake') whiteMistakes++;
      } else {
        if (m.quality === 'blunder') blackBlunders++;
        if (m.quality === 'mistake') blackMistakes++;
      }
    }
  }

  document.getElementById('countBest').textContent = counts.best;
  document.getElementById('countGood').textContent = counts.good;
  document.getElementById('countInacc').textContent = counts.inaccuracy;
  document.getElementById('countMistake').textContent = counts.mistake;
  document.getElementById('countBlunder').textContent = counts.blunder;

  document.getElementById('whiteQualityStats').textContent = `${whiteBlunders} Blunders • ${whiteMistakes} Mistakes`;
  document.getElementById('blackQualityStats').textContent = `${blackBlunders} Blunders • ${blackMistakes} Mistakes`;

  if (analyzedMoves === 0) return;

  const avgLoss = totalLoss / analyzedMoves;
  let accuracy = Math.round(100 * Math.exp(-0.0055 * avgLoss));
  accuracy = Math.max(30, Math.min(99, accuracy));
  document.getElementById('accuracyVal').textContent = `${accuracy}%`;

  let estElo = Math.round(700 + (accuracy - 30) * 26 - (counts.blunder * 40) - (counts.mistake * 15));
  estElo = Math.max(650, Math.min(2800, estElo));
  document.getElementById('estEloVal').textContent = `~${estElo} Elo`;

  const summaryEl = document.getElementById('reviewSummaryText');
  if (counts.blunder === 0 && counts.mistake === 0) {
    summaryEl.textContent = 'Flawless accuracy! GM-level precision without blunders.';
  } else if (counts.blunder === 0) {
    summaryEl.textContent = `Solid game! No catastrophic blunders. Found ${counts.best} best moves.`;
  } else {
    summaryEl.textContent = `Caution: ${counts.blunder} blunder(s) and ${counts.mistake} mistake(s) occurred. Review move badges below to inspect turning points.`;
  }
}

function renderMoveHistoryBadges() {
  const history = game.history();
  if (history.length === 0) {
    const emptyHtml = '<div class="move-list-empty">No moves yet</div>';
    document.getElementById('moveHistory').innerHTML = emptyHtml;
    document.getElementById('quickMoveHistory').innerHTML = emptyHtml;
    return;
  }

  let html = '';
  for (let i = 0; i < history.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    const whiteMove = history[i] || '';
    const blackMove = history[i + 1] || '';

    const whiteReview = moveQualityHistory[i];
    const blackReview = moveQualityHistory[i + 1];

    const whiteBadge = (whiteReview && whiteReview.quality !== '...')
      ? `<span class="move-badge badge-${whiteReview.quality}">${whiteReview.quality}</span>`
      : '';
    const blackBadge = (blackReview && blackReview.quality !== '...')
      ? `<span class="move-badge badge-${blackReview.quality}">${blackReview.quality}</span>`
      : '';

    html += `<div class="move-row">
      <span class="move-num">${moveNum}.</span>
      <span>${whiteMove} ${whiteBadge}</span>
      <span>${blackMove} ${blackBadge}</span>
    </div>`;
  }
  document.getElementById('moveHistory').innerHTML = html;
  document.getElementById('quickMoveHistory').innerHTML = html;
}

function checkBotTrigger() {
  if (currentMode === 'bot' && !game.game_over() && !(quickBot && quickBot.over)) {
    if (game.turn() !== playerColor) {
      const token = quickBot;
      setTimeout(() => {
        if (quickBot !== token || (quickBot && quickBot.over)) return;
        requestBotMove();
      }, quickBot ? quickBotThinkDelay() : 250);
    }
  }
}

function updateUI() {
  const currentOpening = detectOpening();
  document.getElementById('openingName').textContent = currentOpening;

  const statusEl = document.getElementById('gameStatus');
  if (game.in_checkmate()) {
    statusEl.textContent = 'Checkmate!';
    statusEl.style.color = '#f87171';
  } else if (game.in_draw()) {
    statusEl.textContent = 'Draw';
    statusEl.style.color = '#fbbf24';
  } else if (game.in_check()) {
    statusEl.textContent = 'Check!';
    statusEl.style.color = '#fb923c';
  } else {
    statusEl.textContent = `${game.turn() === 'w' ? 'White' : 'Black'} to move`;
    statusEl.style.color = '#4ade80';
  }

  updateCapturedPiecesDisplay();
  renderMoveHistoryBadges();

  if (currentMode === 'analysis') {
    analyzePosition();
  }
}

function setGameMode(mode) {
  if (isOnlineMatchActive && mode !== 'friend') {
    alert("நண்பருடன் நேரலை மேட்ச் நடந்துகொண்டிருக்கிறது! விளையாடும் போது அனலைஸ் அல்லது பாட் மோடிற்கு மாற முடியாது.\n\nமேட்ச் முடிந்த பின், டிரா அல்லது ரிசைன் செய்த பிறகே பிற மோடுகளுக்கு மாற முடியும்.");
    return;
  }

  if (quickBot) {
    if (!quickBot.over) { applyQuickBotChrome(); return; }
    cleanupFriendGame(false);
  }

  currentMode = mode;
  selectedSquare = null;
  clearClickHighlights();

  const botBtn = document.getElementById('modeBotBtn');
  const analyzeBtn = document.getElementById('modeAnalyzeBtn');
  const friendBtn = document.getElementById('modeFriendBtn');
  const botControls = document.getElementById('botControls');
  const friendControls = document.getElementById('friendControls');
  const playBestBtn = document.getElementById('playBestBtn');
  const chatTabBtn = document.getElementById('chatTabBtn');
  // Quick Match page (features.js). Hidden in every other mode.
  const quickBtn = document.getElementById('modeQuickBtn');
  const quickControls = document.getElementById('quickMatchControls');
  if (quickBtn) quickBtn.classList.toggle('active', mode === 'quick');
  if (quickControls) quickControls.style.display = mode === 'quick' ? 'flex' : 'none';

  if (botBtn) botBtn.classList.toggle('active', mode === 'bot');
  if (analyzeBtn) analyzeBtn.classList.toggle('active', mode === 'analysis');
  if (friendBtn) friendBtn.classList.toggle('active', mode === 'friend');

  if (mode === 'quick') {
    ['undoBtn', 'redoBtn', 'resetBtn'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    if (botControls) botControls.style.display = 'none';
    if (friendControls) friendControls.style.display = 'none';
    if (chatTabBtn) chatTabBtn.style.display = 'none';
    if (playBestBtn) playBestBtn.style.display = 'none';
    document.getElementById('panelPrimaryLabel').textContent = 'Quick Match';
    document.getElementById('bestMoveText').textContent = '⚡ Quick Match';
    document.getElementById('engineSubtext').textContent = 'Choose a time control and press Find Opponent.';
    document.getElementById('pvLineText').textContent = 'Play a random online opponent with the same time control.';
    document.getElementById('bestMoveArrow').setAttribute('visibility', 'hidden');
    updateEvalBar(0, '0.0');
    try { if (stockfish) stockfish.postMessage('stop'); } catch (_) {}
    clearHighlights();
    return;
  }

  if (mode === 'bot') {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    const resetBtn = document.getElementById('resetBtn');
    if (undoBtn) undoBtn.style.display = '';
    if (redoBtn) redoBtn.style.display = '';
    if (resetBtn) resetBtn.style.display = '';
    if (botControls) botControls.style.display = 'flex';
    if (friendControls) friendControls.style.display = 'none';
    if (chatTabBtn) chatTabBtn.style.display = 'none';
    if (playBestBtn) playBestBtn.style.display = 'none';
    document.getElementById('panelPrimaryLabel').textContent = 'Bot Status';
    document.getElementById('bestMoveArrow').setAttribute('visibility', 'hidden');
    clearHighlights();
  } else if (mode === 'friend') {
    if (botControls) botControls.style.display = 'none';
    if (friendControls) friendControls.style.display = 'flex';
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    const resetBtn = document.getElementById('resetBtn');
    if (undoBtn) undoBtn.style.display = 'none';
    if (redoBtn) redoBtn.style.display = 'none';
    if (resetBtn) resetBtn.style.display = 'none';
    if (chatTabBtn) chatTabBtn.style.display = 'inline-block';
    if (playBestBtn) playBestBtn.style.display = 'none';
    document.getElementById('panelPrimaryLabel').textContent = 'Friend Match';
    document.getElementById('bestMoveArrow').setAttribute('visibility', 'hidden');
    clearHighlights();
  } else {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    const resetBtn = document.getElementById('resetBtn');
    if (undoBtn) undoBtn.style.display = '';
    if (redoBtn) redoBtn.style.display = '';
    if (resetBtn) resetBtn.style.display = '';
    if (botControls) botControls.style.display = 'none';
    if (friendControls) friendControls.style.display = 'none';
    if (chatTabBtn) chatTabBtn.style.display = 'none';
    if (playBestBtn) playBestBtn.style.display = 'block';
    document.getElementById('panelPrimaryLabel').textContent = 'Best Move Suggestion';
    analyzePosition();
  }
}

function startNewBotGame() {
  game.reset();
  redoStack = [];
  moveQualityHistory = [];
  selectedSquare = null;
  isBotThinking = false;
  clearClickHighlights();
  clearHighlights();

  playerColor = document.getElementById('botSideSelect').value;
  botRating = parseInt(document.getElementById('botRatingSelect').value, 10);

  board.orientation(playerColor === 'w' ? 'white' : 'black');
  board.start();

  updateEvalBar(0, '0.0');
  document.getElementById('evalScore').textContent = '+0.00';
  updateGameReview();
  updateUI();

  if (playerColor === 'b') {
    setTimeout(() => {
      requestBotMove();
    }, 400);
  } else {
    document.getElementById('bestMoveText').textContent = 'Your turn!';
    document.getElementById('engineSubtext').textContent = `Playing against Stockfish bot (${botRating})`;
    document.getElementById('pvLineText').textContent = 'Make your opening move...';
  }
}

// Full Analysis Report Copy function
function copyFullAnalysisReport() {
  const opening = detectOpening();
  const evalScore = document.getElementById('evalScore').textContent;
  const accuracy = document.getElementById('accuracyVal').textContent;
  const estElo = document.getElementById('estEloVal').textContent;
  const bestCount = document.getElementById('countBest').textContent;
  const goodCount = document.getElementById('countGood').textContent;
  const inaccCount = document.getElementById('countInacc').textContent;
  const mistakeCount = document.getElementById('countMistake').textContent;
  const blunderCount = document.getElementById('countBlunder').textContent;
  const whiteStats = document.getElementById('whiteQualityStats').textContent;
  const blackStats = document.getElementById('blackQualityStats').textContent;
  const pgn = game.pgn() || 'No moves played yet.';

  const report = [
    '=== B CHESS ANALYZER — FULL GAME REPORT ===',
    `Opening / Gambit : ${opening}`,
    `Final Evaluation : ${evalScore}`,
    `Move Accuracy    : ${accuracy}`,
    `Estimated Elo    : ${estElo}`,
    '-------------------------------------------',
    'MOVE QUALITY BREAKDOWN:',
    `★ Best Moves     : ${bestCount}`,
    `✓ Good Moves     : ${goodCount}`,
    `?! Inaccuracies  : ${inaccCount}`,
    `? Mistakes       : ${mistakeCount}`,
    `?? Blunders      : ${blunderCount}`,
    '-------------------------------------------',
    `White Stats      : ${whiteStats}`,
    `Black Stats      : ${blackStats}`,
    '-------------------------------------------',
    'PGN MOVE RECORD:',
    pgn,
    '==========================================='
  ].join('\n');

  navigator.clipboard.writeText(report).then(() => {
    const msg = document.getElementById('copySuccessMsg');
    msg.style.display = 'block';
    setTimeout(() => {
      msg.style.display = 'none';
    }, 3500);
  }).catch(err => {
    alert('Analysis report copied to console!');
    console.log(report);
  });
}

// Preload + decode all piece images so the first drag has no image-load/decode delay.
const PIECE_IMG_URL = 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png';
const preloadedPieceImages = [];
function preloadPieceImages() {
  ['wP','wN','wB','wR','wQ','wK','bP','bN','bB','bR','bQ','bK'].forEach(p => {
    const img = new Image();
    img.src = PIECE_IMG_URL.replace('{piece}', p);
    if (img.decode) img.decode().catch(() => {});
    preloadedPieceImages.push(img);
  });
}
preloadPieceImages();

$(document).ready(function() {
  const config = {
    draggable: true,
    position: 'start',
    pieceTheme: PIECE_IMG_URL,
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd
  };

  board = Chessboard('myBoard', config);

  let lastTouchTime = 0;
  $('#myBoard').on('touchstart', '.square-55d63', function() {
    lastTouchTime = Date.now();
  });

  $('#myBoard').on('click touchend', '.square-55d63', function(e) {
    if (dragActive) return;
    if (Date.now() - lastDropTime < 400) return;
    if (e.type === 'click' && Date.now() - lastTouchTime < 450) {
      return;
    }
    const square = $(this).attr('data-square');
    if (square) {
      handleSquareClick(square);
    }
  });

  $(window).resize(() => {
    board.resize();
    if (currentBestMoveUci && currentMode === 'analysis') {
      drawBestMoveArrow(currentBestMoveUci);
    }
  });

  initStockfish();
  updateUI();

  // Copy Analysis Button Listener
  document.getElementById('copyAnalysisBtn').addEventListener('click', copyFullAnalysisReport);

  // Mode Switchers
  document.getElementById('modeAnalyzeBtn').addEventListener('click', () => {
    setGameMode('analysis');
  });

  document.getElementById('modeBotBtn').addEventListener('click', () => {
    if (!currentUserId) {
      alert('Please Sign in with Google first!');
      return triggerGoogleLogin();
    }
    if (!requireTermsAccepted()) return;
    setGameMode('bot');
    startNewBotGame();
  });

  const friendBtn = document.getElementById('modeFriendBtn');
  if (friendBtn) {
    friendBtn.addEventListener('click', () => {
      if (!currentUserId) {
        alert('Please Sign in with Google first!');
        return triggerGoogleLogin();
      }
      if (!requireTermsAccepted()) return;
      ensureNotificationPermission();
      setGameMode('friend');
    });
  }

  const termsAcceptBtn = document.getElementById('acceptTermsBtn');
  if (termsAcceptBtn) termsAcceptBtn.addEventListener('click', acceptTermsAndContinue);
  const loginBtn = document.getElementById('googleLoginBtn');
  if (loginBtn) loginBtn.addEventListener('click', triggerGoogleLogin);

  const signoutBtn = document.getElementById('signOutBtn');
  if (signoutBtn) signoutBtn.addEventListener('click', handleLogout);
  const editProfileBtn = document.getElementById('editProfileBtn');
  if (editProfileBtn) editProfileBtn.addEventListener('click', () => openProfileModal(false));

  const saveProfileBtn = document.getElementById('saveProfileBtn');
  if (saveProfileBtn) saveProfileBtn.addEventListener('click', saveUserProfile);

  const cancelProfileBtn = document.getElementById('cancelProfileBtn');
  if (cancelProfileBtn) cancelProfileBtn.addEventListener('click', closeProfileModal);

  const profilePhotoInput = document.getElementById('profilePhotoInput');
  if (profilePhotoInput) {
    profilePhotoInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const photo = await readAndResizeProfilePhoto(file);
        const preview = document.getElementById('profilePreviewImg');
        const fallback = document.getElementById('profilePreviewFallback');
        if (preview) { preview.src = photo; preview.style.display = 'block'; }
        if (fallback) fallback.style.display = 'none';
      } catch (err) {
        console.error("Profile image preview error:", err);
      }
    });
  }

  const createBtn = document.getElementById('createRoomBtn');
  if (createBtn) createBtn.addEventListener('click', createFriendRoom);
  const quickMatchBtn = document.getElementById('quickMatchBtn');
  if (quickMatchBtn) quickMatchBtn.addEventListener('click', () => (typeof openQuickMatchPage === 'function' ? openQuickMatchPage() : startQuickMatch()));
  ['topMicBtn', 'bottomMicBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => { if (!el.disabled) toggleMicrophone(); });
  });

  document.querySelectorAll('.time-control-card').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedFriendTimeControl = Number(btn.dataset.timeControl) || 0;
      const modal = document.getElementById('friendTimeModal');
      const callback = modal && modal.__onSelect;
      closeFriendTimeModal();
      if (typeof callback === 'function') callback(selectedFriendTimeControl);
    });
  });
  const cancelTimeBtn = document.getElementById('cancelFriendTimeBtn');
  if (cancelTimeBtn) cancelTimeBtn.addEventListener('click', closeFriendTimeModal);

  const joinBtn = document.getElementById('joinRoomBtn');
  if (joinBtn) joinBtn.addEventListener('click', joinFriendRoom);

  const copyBtn = document.getElementById('copyRoomCodeBtn');
  if (copyBtn) copyBtn.addEventListener('click', copyRoomCode);

  const micBtn = document.getElementById('toggleMicBtn');
  if (micBtn) micBtn.addEventListener('click', toggleMicrophone);
  const speakerBtn = document.getElementById('toggleSpeakerBtn');
  if (speakerBtn) speakerBtn.addEventListener('click', toggleSpeaker);

  const drawBtn = document.getElementById('offerDrawBtn');
  if (drawBtn) drawBtn.addEventListener('click', offerDrawGame);

  const resBtn = document.getElementById('resignBtn');
  if (resBtn) resBtn.addEventListener('click', resignGame);
  const leaveBtn = document.getElementById('leaveGameBtn');
  if (leaveBtn) leaveBtn.addEventListener('click', leaveFriendGame);

  const chatF = document.getElementById('chatForm');
  if (chatF) chatF.addEventListener('submit', handleSendChat);

  document.getElementById('startBotGameBtn').addEventListener('click', () => {
    startNewBotGame();
  });

  document.getElementById('botRatingSelect').addEventListener('change', (e) => {
    botRating = parseInt(e.target.value, 10);
  });

  // Sound Toggle Button
  document.getElementById('soundToggleBtn').addEventListener('click', (e) => {
    soundEnabled = !soundEnabled;
    e.target.textContent = soundEnabled ? '🔊 Sound: ON' : '🔇 Sound: OFF';
    e.target.classList.toggle('active-pill', soundEnabled);
    if (soundEnabled) playSound('move');
  });

  // Undo Button
  document.getElementById('undoBtn').addEventListener('click', () => {
    if (currentMode === 'friend' || quickBot) return;
    if (isBotThinking) return;
    clearClickHighlights();
    selectedSquare = null;

    if (currentMode === 'bot') {
      game.undo();
      game.undo();
      moveQualityHistory.pop();
      moveQualityHistory.pop();
    } else {
      const move = game.undo();
      if (move) {
        redoStack.push(move);
        moveQualityHistory.pop();
      }
    }
    board.position(game.fen());
    updateGameReview();
    updateUI();
  });

  // Redo Button
  document.getElementById('redoBtn').addEventListener('click', () => {
    if (currentMode === 'friend' || currentMode === 'bot' || isBotThinking) return;
    clearClickHighlights();
    selectedSquare = null;
    if (redoStack.length > 0) {
      const move = redoStack.pop();
      game.move(move);
      board.position(game.fen());
      updateUI();
    }
  });

  // Flip Board
  document.getElementById('flipBtn').addEventListener('click', () => {
    board.flip();
    updateCapturedPiecesDisplay();
    if (currentBestMoveUci && currentMode === 'analysis') {
      drawBestMoveArrow(currentBestMoveUci);
    }
  });

  // Play Best Move Button
  document.getElementById('playBestBtn').addEventListener('click', () => {
    if (currentMode === 'bot' || !currentBestMoveUci || game.game_over()) return;
    clearClickHighlights();
    selectedSquare = null;
    const from = currentBestMoveUci.slice(0, 2);
    const to = currentBestMoveUci.slice(2, 4);
    const promotion = currentBestMoveUci.length > 4 ? currentBestMoveUci[4] : 'q';

    const beforeEval = currentPositionCp;
    const move = game.move({ from, to, promotion });
    if (move) {
      redoStack = [];
      board.position(game.fen());
      recordMoveQuality(move, beforeEval);
      handleMoveEffects(move);
      updateUI();
    }
  });

  // Reset Button
  document.getElementById('resetBtn').addEventListener('click', () => {
    if (quickBot) return;
    clearClickHighlights();
    selectedSquare = null;
    moveQualityHistory = [];
    if (currentMode === 'bot') {
      startNewBotGame();
    } else {
      game.reset();
      redoStack = [];
      board.start();
      updateEvalBar(0, '0.0');
      document.getElementById('evalScore').textContent = '+0.00';
      updateGameReview();
      updateUI();
    }
  });

  // Toggle Best Move Arrow
  document.getElementById('arrowToggleBtn').addEventListener('click', (e) => {
    showBestMoveArrow = !showBestMoveArrow;
    e.target.textContent = showBestMoveArrow ? '🏹 Arrow: ON' : '🏹 Arrow: OFF';
    e.target.classList.toggle('active-pill', showBestMoveArrow);
    if (currentBestMoveUci && currentMode === 'analysis') {
      drawBestMoveArrow(currentBestMoveUci);
    }
  });

  // Theme Toggle
  document.getElementById('themeBtn').addEventListener('click', (e) => {
    document.body.classList.toggle('wood-theme');
    const isWood = document.body.classList.contains('wood-theme');
    e.target.textContent = isWood ? 'Wood & Cream' : 'Green & White';
  });

  // Load FEN
  document.getElementById('loadFenBtn').addEventListener('click', () => {
    const fen = document.getElementById('fenInput').value.trim();
    if (fen && game.load(fen)) {
      redoStack = [];
      moveQualityHistory = [];
      clearClickHighlights();
      selectedSquare = null;
      board.position(game.fen());
      updateGameReview();
      updateUI();
    } else {
      alert('Invalid FEN string!');
    }
  });

  // Tabs Switching
  document.querySelectorAll('.tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active-content'));
      tabBtn.classList.add('active');
      const targetId = tabBtn.getAttribute('data-tab');
      document.getElementById(targetId).classList.add('active-content');
    });
  });

  // Pawn promotion selection
  document.querySelectorAll('.promotion-choice').forEach(btn => btn.addEventListener('click', () => finishPromotionChoice(btn.dataset.promotion)));
  const cancelPromotionBtn = document.getElementById('cancelPromotionBtn');
  if (cancelPromotionBtn) cancelPromotionBtn.addEventListener('click', closePromotionModal);

  // Friends / requests / match history
  const challengeNotificationBtn = document.getElementById('challengeNotificationBtn');
  if (challengeNotificationBtn) challengeNotificationBtn.addEventListener('click', openChallengeNotifications);

  const friendsBtn = document.getElementById('friendsBtn');
  if (friendsBtn) friendsBtn.addEventListener('click', () => openFriendsModal('friends'));
  const historyBtn = document.getElementById('matchHistoryBtn');
  if (historyBtn) historyBtn.addEventListener('click', () => openFriendsModal('history'));
  const closeFriendsBtn = document.getElementById('closeFriendsModalBtn');
  if (closeFriendsBtn) closeFriendsBtn.addEventListener('click', closeFriendsModal);
  const searchFriendBtn = document.getElementById('friendSearchBtn');
  if (searchFriendBtn) searchFriendBtn.addEventListener('click', searchFriendByUsername);
  const searchFriendInput = document.getElementById('friendSearchInput');
  if (searchFriendInput) searchFriendInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchFriendByUsername(); });
  const ftab = document.getElementById('friendsTabBtn'); if (ftab) ftab.addEventListener('click',()=>switchFriendsTab('friends'));
  const rtab = document.getElementById('requestsTabBtn'); if (rtab) rtab.addEventListener('click',()=>switchFriendsTab('requests'));
  const htab = document.getElementById('historyTabBtn'); if (htab) htab.addEventListener('click',()=>switchFriendsTab('history'));

  const copyMovesBtn = document.getElementById('copyMovesBtn');
  if (copyMovesBtn) copyMovesBtn.addEventListener('click', () => {
    const pgn = game.pgn() || 'No moves yet';
    navigator.clipboard.writeText(pgn).then(() => alert('Moves copied.')).catch(() => alert('Could not copy moves.'));
  });

  // Depth Slider
  document.getElementById('depthSlider').addEventListener('input', (e) => {
    targetDepth = parseInt(e.target.value, 10);
    document.getElementById('depthSliderVal').textContent = targetDepth;
    if (currentMode === 'analysis') {
      analyzePosition();
    }
  });
});


// =====================================================================
// PLAYER SEARCH, PROFILE INSPECTION, MATCH REVIEW & BOOKS
// (additive section - uses existing Firebase users/{id} + matchHistory)
// =====================================================================
function attrEsc(str) {
  return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function textEsc(str) {
  return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------- Player search ----------
let playerSearchTimer = null;
let playerSearchSeq = 0;
let playerSearchCache = {};

async function fetchPlayersByPrefix(term) {
  const lower = term.toLowerCase();
  const variants = Array.from(new Set([term, lower, lower.charAt(0).toUpperCase() + lower.slice(1), term.toUpperCase()]));
  const merged = {};
  await Promise.all(variants.map(v =>
    database.ref('users').orderByChild('username').startAt(v).endAt(v + '\uf8ff').limitToFirst(10).once('value')
      .then(snap => {
        const d = snap.val() || {};
        Object.keys(d).forEach(id => { merged[id] = d[id]; });
      })
  ));
  return Object.keys(merged)
    .filter(id => String(merged[id].username || '').toLowerCase().startsWith(lower))
    .slice(0, 10)
    .map(id => ({
      id,
      username: merged[id].username || 'Player',
      rating: Number(merged[id].rating || 800),
      photo: merged[id].photo || merged[id].photoURL || ''
    }));
}

function playerAvatarHtml(p, cls) {
  return p.photo
    ? `<img src="${attrEsc(p.photo)}" alt="" class="${cls}">`
    : `<span class="${cls} ${cls}-fallback">${textEsc((p.username || 'P').charAt(0).toUpperCase())}</span>`;
}

function renderPlayerSearchResults(list, message) {
  const box = document.getElementById('playerSearchResults');
  if (!box) return;
  box.style.display = 'block';
  if (message) { box.innerHTML = `<div class="player-search-empty">${textEsc(message)}</div>`; return; }
  playerSearchCache = {};
  list.forEach(p => { playerSearchCache[p.id] = p; });
  box.innerHTML = list.map(p => `
    <div class="player-result-row" data-id="${attrEsc(p.id)}">
      <div class="player-result-info">
        ${playerAvatarHtml(p, 'player-result-avatar')}
        <div class="player-result-text"><strong>${textEsc(p.username)}${p.id === currentUserId ? ' (You)' : ''}</strong><small>${p.rating} Elo</small></div>
      </div>
      <button type="button" class="pill-btn inspect-profile-btn" data-id="${attrEsc(p.id)}">Inspect Profile</button>
    </div>`).join('');
  box.querySelectorAll('.inspect-profile-btn').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openPlayerProfile(btn.dataset.id);
  }));
  box.querySelectorAll('.player-result-row').forEach(row => row.addEventListener('click', () => openPlayerProfile(row.dataset.id)));
}

function runPlayerSearch() {
  const input = document.getElementById('playerSearchInput');
  const term = (input.value || '').trim();
  const box = document.getElementById('playerSearchResults');
  if (!term) { if (box) box.style.display = 'none'; return; }
  if (!currentUserId) { renderPlayerSearchResults([], 'Sign in with Google to search players.'); return; }
  const seq = ++playerSearchSeq;
  renderPlayerSearchResults([], 'Searching...');
  fetchPlayersByPrefix(term).then(list => {
    if (seq !== playerSearchSeq) return;
    if (!list.length) return renderPlayerSearchResults([], 'No players found.');
    renderPlayerSearchResults(list);
  }).catch(err => {
    console.warn('Player search failed:', err);
    if (seq === playerSearchSeq) renderPlayerSearchResults([], 'Search is unavailable right now.');
  });
}

// ---------- Profile inspection ----------
let inspectedMatches = [];

function formatMatchDate(ts) {
  try { return new Date(ts || Date.now()).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (_) { return ''; }
}

function openPlayerProfile(userId) {
  if (!currentUserId) { alert('Please Sign in with Google first!'); return; }
  const results = document.getElementById('playerSearchResults');
  if (results) results.style.display = 'none';
  const modal = document.getElementById('playerProfileModal');
  const body = document.getElementById('playerProfileBody');
  modal.style.display = 'flex';
  body.innerHTML = '<div class="friend-empty">Loading profile...</div>';
  database.ref('users/' + userId).once('value').then(snap => {
    const u = snap.val();
    if (!u) { body.innerHTML = '<div class="friend-empty">Player not found.</div>'; return; }
    renderPlayerProfile(userId, u);
  }).catch(err => {
    console.warn('Profile load failed:', err);
    body.innerHTML = '<div class="friend-empty">Could not load this profile.</div>';
  });
}

function renderPlayerProfile(userId, u) {
  const body = document.getElementById('playerProfileBody');
  const hist = u.matchHistory || {};
  const matches = Object.entries(hist).map(([code, v]) => Object.assign({ code }, v))
    .sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0));
  inspectedMatches = matches;
  const total = matches.length;
  const wins = matches.filter(m => m.result === 'win');
  const losses = matches.filter(m => m.result === 'loss').length;
  const draws = matches.filter(m => m.result === 'draw').length;
  const winRate = total ? Math.round((wins.length / total) * 100) : 0;
  const player = { username: u.username || 'Player', photo: u.photo || u.photoURL || '' };

  // Win history: players they defeated (grouped)
  const defeated = {};
  wins.forEach(m => {
    const key = m.opponentId || m.opponentName || 'unknown';
    if (!defeated[key]) defeated[key] = { name: m.opponentName || 'Player', count: 0, last: 0 };
    defeated[key].count++;
    defeated[key].last = Math.max(defeated[key].last, m.playedAt || 0);
  });
  const defeatedRows = Object.values(defeated).sort((a, b) => b.last - a.last);

  // Performance by time control
  const byTc = {};
  matches.forEach(m => {
    const k = m.timeLabel || 'No Timer';
    if (!byTc[k]) byTc[k] = { w: 0, l: 0, d: 0 };
    if (m.result === 'win') byTc[k].w++; else if (m.result === 'loss') byTc[k].l++; else byTc[k].d++;
  });

  const matchRow = (m, i) => `
    <div class="history-match-row">
      <div><strong>vs ${textEsc(m.opponentName || 'Player')}</strong><small>${textEsc(m.timeLabel || 'No Timer')} • ${formatMatchDate(m.playedAt)}${m.resultType ? ' • ' + textEsc(m.resultType) : ''}</small></div>
      <div class="profile-match-actions">
        <span class="history-result ${attrEsc(m.result || 'draw')}">${textEsc((m.result || 'draw').toUpperCase())}</span>
        <button type="button" class="pill-btn review-match-btn" data-idx="${i}">Review</button>
      </div>
    </div>`;

  body.innerHTML = `
    <div class="pp-header">
      ${playerAvatarHtml(player, 'pp-avatar')}
      <div class="pp-header-text"><h2>${textEsc(player.username)}</h2><span class="rating-badge-pill">${Number(u.rating || 800)} Elo</span></div>
    </div>
    <div class="pp-stats">
      <div class="pp-stat"><strong>${total}</strong><span>Played</span></div>
      <div class="pp-stat pp-win"><strong>${wins.length}</strong><span>Won</span></div>
      <div class="pp-stat pp-loss"><strong>${losses}</strong><span>Lost</span></div>
      <div class="pp-stat"><strong>${draws}</strong><span>Drawn</span></div>
    </div>
    <div class="pp-section-title">Performance</div>
    <div class="pp-winrate"><div class="pp-winrate-bar"><div class="pp-winrate-fill" style="width:${winRate}%"></div></div><span>${winRate}% win rate</span></div>
    ${Object.keys(byTc).length ? `<div class="pp-tc-list">${Object.entries(byTc).map(([k, v]) => `<span class="pp-tc-chip">${textEsc(k)}: <b>${v.w}W</b> ${v.l}L ${v.d}D</span>`).join('')}</div>` : ''}
    <div class="pp-section-title">Win History (players defeated)</div>
    <div class="friend-list">${defeatedRows.length ? defeatedRows.map(d => `<div class="friend-row"><div><strong>${textEsc(d.name)}</strong><small>Last win ${formatMatchDate(d.last)}</small></div><span class="history-result win">${d.count}x</span></div>`).join('') : '<div class="friend-empty">No wins yet.</div>'}</div>
    <div class="pp-section-title">Recent Matches</div>
    <div class="friend-list">${total ? matches.slice(0, 5).map((m, i) => matchRow(m, i)).join('') : '<div class="friend-empty">No matches played yet.</div>'}</div>
    ${total > 5 ? `<div class="pp-section-title">Previous Matches (tap Review to replay)</div><div class="friend-list pp-all-matches">${matches.slice(5).map((m, i) => matchRow(m, i + 5)).join('')}</div>` : ''}
  `;
  body.querySelectorAll('.review-match-btn').forEach(btn => btn.addEventListener('click', () => openMatchReview(Number(btn.dataset.idx), player.username)));
}

function closePlayerProfile() {
  const modal = document.getElementById('playerProfileModal');
  if (modal) modal.style.display = 'none';
}

// ---------- Match review ----------
let reviewBoard = null;
let reviewGame = null;
let reviewFens = [];
let reviewSans = [];
let reviewIndex = 0;

function openMatchReview(idx, playerName) {
  const m = inspectedMatches[idx];
  if (!m) return;
  const sans = Array.isArray(m.moves) ? m.moves : (m.moves ? Object.values(m.moves) : []);
  if (!sans.length) { alert('No move record is available for this match.'); return; }
  reviewGame = new Chess();
  reviewFens = [reviewGame.fen()];
  reviewSans = [];
  for (const san of sans) {
    if (!reviewGame.move(san)) break;
    reviewSans.push(san);
    reviewFens.push(reviewGame.fen());
  }
  reviewIndex = reviewFens.length - 1;
  document.getElementById('matchReviewTitle').textContent = `${playerName} vs ${m.opponentName || 'Player'}`;
  document.getElementById('matchReviewSub').textContent = `${(m.result || 'draw').toUpperCase()} • ${m.timeLabel || 'No Timer'} • ${formatMatchDate(m.playedAt)}`;
  document.getElementById('matchReviewModal').style.display = 'flex';
  if (reviewBoard) { try { reviewBoard.destroy(); } catch (_) {} reviewBoard = null; }
  reviewBoard = Chessboard('reviewBoard', { draggable: false, position: reviewFens[reviewIndex], pieceTheme: PIECE_IMG_URL });
  renderReviewMoveList();
  setReviewIndex(reviewIndex);
}

function renderReviewMoveList() {
  const list = document.getElementById('reviewMoveList');
  let html = '';
  for (let i = 0; i < reviewSans.length; i++) {
    if (i % 2 === 0) html += `<span class="rv-num">${i / 2 + 1}.</span>`;
    html += `<button type="button" class="rv-move" data-i="${i + 1}">${textEsc(reviewSans[i])}</button>`;
  }
  list.innerHTML = html;
  list.querySelectorAll('.rv-move').forEach(b => b.addEventListener('click', () => setReviewIndex(Number(b.dataset.i))));
}

function setReviewIndex(i) {
  reviewIndex = Math.max(0, Math.min(reviewFens.length - 1, i));
  if (reviewBoard) reviewBoard.position(reviewFens[reviewIndex]);
  document.querySelectorAll('#reviewMoveList .rv-move').forEach(b => {
    const active = Number(b.dataset.i) === reviewIndex;
    b.classList.toggle('active', active);
    if (active) b.scrollIntoView({ block: 'nearest' });
  });
}

function closeMatchReview() {
  document.getElementById('matchReviewModal').style.display = 'none';
  if (reviewBoard) { try { reviewBoard.destroy(); } catch (_) {} reviewBoard = null; }
}

function openReviewInAnalysis() {
  if (isOnlineMatchActive || currentRoomCode) { alert('Finish your current match before loading a game into Analysis.'); return; }
  const sans = reviewSans.slice();
  closeMatchReview();
  closePlayerProfile();
  setGameMode('analysis');
  game.reset();
  redoStack = [];
  moveQualityHistory = [];
  sans.forEach(san => game.move(san));
  clearClickHighlights();
  selectedSquare = null;
  board.position(game.fen());
  updateGameReview();
  updateUI();
}

// ---------- Books (structure only) ----------
// Add your content later by pushing objects into these arrays, e.g.:
//   BOOKS_DATA.openings.push({ title: 'Book title', author: 'Author', description: '...', link: 'https://...' });
const BOOKS_DATA = {
  openings: (typeof CHESS_OPENINGS_TOP50 !== 'undefined') ? CHESS_OPENINGS_TOP50 : [],
  defences: (typeof CHESS_DEFENCES_TOP50 !== 'undefined') ? CHESS_DEFENCES_TOP50 : [],
  other: []
};

function formatMovesNumbered(movesStr) {
  const sans = String(movesStr || '').split(/\s+/).filter(Boolean);
  let out = '';
  sans.forEach((san, i) => {
    if (i % 2 === 0) out += `<span class="bk-num">${i / 2 + 1}.</span>`;
    out += `<span class="bk-mv">${textEsc(san)}</span>`;
  });
  return out;
}

function renderBooksPanels() {
  const map = { openings: 'booksPanelOpenings', defences: 'booksPanelDefences', other: 'booksPanelOther' };
  const titles = { openings: 'Openings', defences: 'Defences', other: 'Other Learning Materials' };
  Object.keys(map).forEach(cat => {
    const el = document.getElementById(map[cat]);
    if (!el) return;
    if (cat === 'other' && typeof renderLearningMaterialsPanel === 'function') { renderLearningMaterialsPanel(); return; }
    const items = BOOKS_DATA[cat] || [];
    if (items.length && items[0].moves) {
      el.innerHTML = `<input type="text" class="profile-input books-filter" data-books-filter="${cat}" placeholder="Search ${titles[cat].toLowerCase()}..." autocomplete="off" />
        <div class="books-count">${items.length} ${titles[cat].toLowerCase()}</div>` +
        items.map((b, i) => `<div class="book-opening-card" data-title="${attrEsc((b.title || '').toLowerCase())}">
          <div class="book-opening-head"><span class="book-opening-num">${i + 1}</span><strong>${textEsc(b.title)}</strong>
            <button type="button" class="pill-btn highlight-btn review-analysis-btn" data-cat="${cat}" data-idx="${i}">Review Analysis</button></div>
          <div class="book-opening-moves">${formatMovesNumbered(b.moves)}</div></div>`).join('') +
        `<div class="books-empty books-no-match" style="display:none;"><span>No matches found.</span></div>`;
      const filter = el.querySelector('.books-filter');
      filter.addEventListener('input', () => {
        const q = filter.value.trim().toLowerCase();
        let shown = 0;
        el.querySelectorAll('.book-opening-card').forEach(card => {
          const ok = !q || card.dataset.title.includes(q);
          card.style.display = ok ? '' : 'none';
          if (ok) shown++;
        });
        el.querySelector('.books-no-match').style.display = shown ? 'none' : 'flex';
      });
      el.querySelectorAll('.review-analysis-btn').forEach(btn => btn.addEventListener('click', () => startOpeningReview(btn.dataset.cat, Number(btn.dataset.idx))));
      return;
    }
    el.innerHTML = items.length
      ? items.map(b => `<div class="friend-row book-row"><div><strong>${textEsc(b.title || 'Untitled')}</strong><small>${textEsc(b.author || '')}${b.description ? ' • ' + textEsc(b.description) : ''}</small></div>${b.link ? `<a class="pill-btn" href="${attrEsc(b.link)}" target="_blank" rel="noopener">Open</a>` : ''}</div>`).join('')
      : `<div class="books-empty"><div class="books-empty-icon">📖</div><strong>${titles[cat]}</strong><span>No content yet - coming soon.</span></div>`;
  });
}

function openBooksModal() {
  renderBooksPanels();
  document.getElementById('booksModal').style.display = 'flex';
}
function switchBooksCategory(cat) {
  document.querySelectorAll('.books-tab').forEach(b => b.classList.toggle('active', b.dataset.booksCat === cat));
  document.querySelectorAll('.books-panel').forEach(p => { p.style.display = p.dataset.booksPanel === cat ? 'block' : 'none'; });
}

// ---------- Wiring ----------
$(document).ready(function() {
  // Waiting overlay: cancel challenge
  const cancelChallengeBtn = document.getElementById('cancelChallengeBtn');
  if (cancelChallengeBtn) cancelChallengeBtn.addEventListener('click', cancelWaitingChallenge);

  // Player search
  const psInput = document.getElementById('playerSearchInput');
  const psClear = document.getElementById('playerSearchClearBtn');
  if (psInput) {
    psInput.addEventListener('input', () => {
      if (psClear) psClear.style.display = psInput.value ? 'inline-flex' : 'none';
      clearTimeout(playerSearchTimer);
      playerSearchTimer = setTimeout(runPlayerSearch, 350);
    });
    psInput.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(playerSearchTimer); runPlayerSearch(); } });
    psInput.addEventListener('focus', () => { if (psInput.value.trim()) runPlayerSearch(); });
  }
  if (psClear) psClear.addEventListener('click', () => {
    psInput.value = '';
    psClear.style.display = 'none';
    playerSearchSeq++;
    document.getElementById('playerSearchResults').style.display = 'none';
  });
  document.addEventListener('click', (e) => {
    const wrap = document.getElementById('playerSearchWrap');
    if (wrap && !wrap.contains(e.target)) document.getElementById('playerSearchResults').style.display = 'none';
  });

  // Profile + review modals
  const closeProfile = document.getElementById('closePlayerProfileBtn');
  if (closeProfile) closeProfile.addEventListener('click', closePlayerProfile);
  const closeReview = document.getElementById('closeMatchReviewBtn');
  if (closeReview) closeReview.addEventListener('click', closeMatchReview);
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  bind('reviewStartBtn', () => setReviewIndex(0));
  bind('reviewPrevBtn', () => setReviewIndex(reviewIndex - 1));
  bind('reviewNextBtn', () => setReviewIndex(reviewIndex + 1));
  bind('reviewEndBtn', () => setReviewIndex(reviewFens.length - 1));
  bind('reviewFlipBtn', () => { if (reviewBoard) reviewBoard.flip(); });
  bind('reviewOpenAnalysisBtn', openReviewInAnalysis);

  // Books
  bind('modeBooksBtn', openBooksModal);
  bind('closeBooksModalBtn', () => { document.getElementById('booksModal').style.display = 'none'; });
  bind('closeBooksModalX', () => { document.getElementById('booksModal').style.display = 'none'; });
  document.querySelectorAll('.books-tab').forEach(b => b.addEventListener('click', () => switchBooksCategory(b.dataset.booksCat)));
  renderBooksPanels();
});


// =====================================================================
// OPENING / DEFENCE REVIEW (Books > Review Analysis) - uses the main analysis board
// =====================================================================
let openingReview = null; // { title, sans, index, side }
let openingReviewTimer = null;

function stopOpeningAuto() {
  if (openingReviewTimer) { clearInterval(openingReviewTimer); openingReviewTimer = null; }
  const btn = document.getElementById('orAutoBtn');
  if (btn) btn.textContent = '▶ Auto';
}

function clearOpeningLastMove() {
  $('#myBoard .opening-last-move').removeClass('opening-last-move');
}

function closeOpeningReview() {
  stopOpeningAuto();
  clearOpeningLastMove();
  openingReview = null;
  const bar = document.getElementById('openingReviewBar');
  if (bar) bar.style.display = 'none';
}

function startOpeningReview(cat, idx) {
  const item = (BOOKS_DATA[cat] || [])[idx];
  if (!item || !item.moves) return;
  if (isOnlineMatchActive || currentRoomCode) { alert('Finish your current match before reviewing an opening.'); return; }
  if (isBotThinking) { alert('Please wait for the bot to finish its move.'); return; }
  const sans = item.moves.split(/\s+/).filter(Boolean);
  document.getElementById('booksModal').style.display = 'none';
  stopOpeningAuto();
  setGameMode('analysis');
  openingReview = { title: item.title, sans, index: 0, side: cat === 'defences' ? 'black' : 'white' };
  board.orientation(openingReview.side);
  document.getElementById('orTitle').textContent = item.title;
  document.getElementById('openingReviewBar').style.display = 'block';
  const analysisTabBtn = document.querySelector('.tab[data-tab="analysisTab"]');
  if (analysisTabBtn) analysisTabBtn.click();
  openingReviewGoTo(0);
  const card = document.querySelector('.board-card');
  if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openingReviewGoTo(n) {
  if (!openingReview) return;
  if (isOnlineMatchActive || currentRoomCode || currentMode !== 'analysis') { closeOpeningReview(); return; }
  const total = openingReview.sans.length;
  n = Math.max(0, Math.min(total, n));
  openingReview.index = n;
  game.reset();
  for (let i = 0; i < n; i++) game.move(openingReview.sans[i]);
  redoStack = [];
  moveQualityHistory = [];
  clearClickHighlights();
  selectedSquare = null;
  board.position(game.fen());
  updateGameReview();
  updateUI();
  // highlight last move
  clearOpeningLastMove();
  const hist = game.history({ verbose: true });
  if (hist.length) {
    const last = hist[hist.length - 1];
    $(`#myBoard .square-${last.from}, #myBoard .square-${last.to}`).addClass('opening-last-move');
  }
  renderOpeningReviewBar();
}

function renderOpeningReviewBar() {
  if (!openingReview) return;
  const { sans, index } = openingReview;
  const status = document.getElementById('orStatus');
  if (index === 0) {
    status.textContent = `Starting position - press ▶ to play move 1 of ${sans.length}.`;
  } else {
    const moveNo = Math.ceil(index / 2);
    const side = index % 2 === 1 ? 'White' : 'Black';
    status.innerHTML = `Move ${index} of ${sans.length}: <strong>${moveNo}${index % 2 === 1 ? '.' : '...'} ${textEsc(sans[index - 1])}</strong> (${side})`;
  }
  let html = '';
  sans.forEach((san, i) => {
    if (i % 2 === 0) html += `<span class="bk-num">${i / 2 + 1}.</span>`;
    html += `<button type="button" class="rv-move${i + 1 === index ? ' active' : ''}" data-i="${i + 1}">${textEsc(san)}</button>`;
  });
  const list = document.getElementById('orMoves');
  list.innerHTML = html;
  list.querySelectorAll('.rv-move').forEach(b => b.addEventListener('click', () => { stopOpeningAuto(); openingReviewGoTo(Number(b.dataset.i)); }));
  const act = list.querySelector('.rv-move.active');
  if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
  document.getElementById('orPrevBtn').disabled = index === 0;
  document.getElementById('orStartBtn').disabled = index === 0;
  document.getElementById('orNextBtn').disabled = index === sans.length;
  document.getElementById('orEndBtn').disabled = index === sans.length;
}

$(document).ready(function() {
  const b = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  b('orStartBtn', () => { stopOpeningAuto(); openingReviewGoTo(0); });
  b('orPrevBtn', () => { stopOpeningAuto(); if (openingReview) openingReviewGoTo(openingReview.index - 1); });
  b('orNextBtn', () => { stopOpeningAuto(); if (openingReview) openingReviewGoTo(openingReview.index + 1); });
  b('orEndBtn', () => { stopOpeningAuto(); if (openingReview) openingReviewGoTo(openingReview.sans.length); });
  b('orCloseBtn', closeOpeningReview);
  b('orAutoBtn', () => {
    if (!openingReview) return;
    if (openingReviewTimer) { stopOpeningAuto(); return; }
    if (openingReview.index >= openingReview.sans.length) openingReviewGoTo(0);
    document.getElementById('orAutoBtn').textContent = '⏸ Pause';
    openingReviewTimer = setInterval(() => {
      if (!openingReview || openingReview.index >= openingReview.sans.length) { stopOpeningAuto(); return; }
      openingReviewGoTo(openingReview.index + 1);
    }, 1200);
  });
  // Leaving analysis or resetting ends the review so it never interferes with other modes
  ['modeQuickBtn', 'modeBotBtn', 'modeFriendBtn', 'resetBtn'].forEach(id => b(id, closeOpeningReview));
});

// =====================================================================
// QUICK MATCH - random online opponent with a similar Elo + same time control.
// Queue: matchmaking/{timeControl}/{uid}. A matched pair plays through the
// normal rooms/{code} flow (same board, clocks, chat, voice and results).
// If nobody suitable is online in time, the game starts against the engine
// presented as a regular opponent.
// =====================================================================
const QUICK_MATCH_SEARCH_MS = 25000;   // then fall back to the engine opponent
const QUICK_MATCH_TICK_MS = 2000;
const QUICK_MATCH_STALE_MS = 12000;    // queue entries not refreshed for this long are offline
const QUICK_MATCH_JOIN_WAIT_MS = 12000;
const QUICK_BOT_NAMES = [
  'Arjun_Chess', 'KnightMaster', 'RapidKing', 'ChessBlaze', 'RookHunter', 'PawnStorm', 'BishopPilot',
  'CastleCrusher', 'TacticTiger', 'EndgameEagle', 'SicilianSam', 'BlitzBaron', 'ForkFury', 'PinMaster',
  'MidnightRook', 'SilentKnight', 'Vikram_Moves', 'QueenSideQueen', 'GambitGuru', 'Karthik64'
];

function quickMatchRange(elapsed) {
  if (elapsed < 6000) return 50;
  if (elapsed < 12000) return 100;
  if (elapsed < 18000) return 200;
  return 400;
}

function startQuickMatch() {
  if (!currentUserId) {
    alert('Please Sign in with Google first!');
    return triggerGoogleLogin();
  }
  if (!requireTermsAccepted()) return;
  ensureNotificationPermission();
  if (currentRoomCode || quickMatch || (quickBot && !quickBot.over)) return alert('You are already in a game.');
  showFriendTimeModal((seconds) => beginQuickMatchSearch(Number(seconds) || 600), { quick: true });
}

function beginQuickMatchSearch(tc, startedAt = Date.now()) {
  if (!currentUserId) return;
  if (quickBot) cleanupFriendGame(false);
  closeFriendMatchResult();
  if (currentMode !== 'friend') setGameMode('friend');
  stopQuickMatchSearch();

  game.reset();
  redoStack = [];
  moveQualityHistory = [];
  board.orientation('white');
  board.start();
  updateUI();
  lockModeButtons(true);

  const entryRef = database.ref('matchmaking/' + tc + '/' + currentUserId);
  quickMatch = { tc, startedAt, entryRef, tickTimer: null, busy: false };
  setWaitingForOpponent(true);
  renderQuickMatchSearching();

  const now = firebase.database.ServerValue.TIMESTAMP;
  entryRef.onDisconnect().remove();
  entryRef.set({ uid: currentUserId, name: currentUserName, rating: currentUserRating, timeControl: tc, status: 'searching', createdAt: now, lastSeen: now })
    .catch(err => console.warn('Quick Match queue unavailable:', err));
  entryRef.on('value', snap => {
    const e = snap.val();
    if (!quickMatch || quickMatch.entryRef !== entryRef) return;
    if (e && e.status === 'matched' && e.roomCode && e.matchedBy && e.matchedBy !== currentUserId) joinQuickMatchRoom(e);
  });
  quickMatch.tickTimer = setInterval(quickMatchTick, QUICK_MATCH_TICK_MS);
  setTimeout(quickMatchTick, 400);
}

function renderQuickMatchSearching() {
  if (!quickMatch) return;
  const range = quickMatchRange(Date.now() - quickMatch.startedAt);
  const r = Number(currentUserRating) || 800;
  setWaitingDetails(
    'Searching for opponent...',
    '⚡ ' + friendTimeLabel(quickMatch.tc) + ' • Your Elo ' + r,
    'Looking for online players rated ' + Math.max(100, r - range) + '–' + (r + range) + '...'
  );
}

function quickMatchTick() {
  if (!quickMatch) return;
  if (Date.now() - quickMatch.startedAt >= QUICK_MATCH_SEARCH_MS && !quickMatch.busy) {
    startQuickBotGame(quickMatch.tc);
    return;
  }
  renderQuickMatchSearching();
  quickMatch.entryRef.update({ lastSeen: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
  tryQuickMatchPair();
}

async function tryQuickMatchPair() {
  const qm = quickMatch;
  if (!qm || qm.busy) return;
  qm.busy = true;
  let code = null;
  try {
    const tc = qm.tc;
    const myRating = Number(currentUserRating) || 800;
    const range = quickMatchRange(Date.now() - qm.startedAt);
    const serverNow = Date.now() + serverTimeOffset;
    const snap = await database.ref('matchmaking/' + tc).once('value');
    if (quickMatch !== qm) return;
    const candidate = Object.values(snap.val() || {})
      .filter(e => e && e.uid && e.uid !== currentUserId && e.status === 'searching'
        && serverNow - Number(e.lastSeen || 0) < QUICK_MATCH_STALE_MS
        && Math.abs((Number(e.rating) || 800) - myRating) <= range)
      .sort((a, b) => Math.abs((Number(a.rating) || 800) - myRating) - Math.abs((Number(b.rating) || 800) - myRating))[0];
    if (!candidate) return;

    // Lock our own entry so nobody pairs with us while we pair with the candidate.
    const mine = await qm.entryRef.transaction(cur => {
      if (cur === null) return null;
      if (cur.status !== 'searching') return;
      return Object.assign({}, cur, { status: 'claiming' });
    });
    if (!mine.committed || !mine.snapshot.val() || mine.snapshot.val().status !== 'claiming' || quickMatch !== qm) return;

    code = generateRoomCode();
    await database.ref('rooms/' + code).set(buildRoomPayload(tc, { quickMatch: true }));
    const claim = await database.ref('matchmaking/' + tc + '/' + candidate.uid).transaction(cur => {
      if (cur === null) return null;
      if (cur.status !== 'searching') return;
      return Object.assign({}, cur, { status: 'matched', roomCode: code, matchedBy: currentUserId, matchedByName: currentUserName, matchedByRating: myRating });
    });
    const claimed = claim.committed && claim.snapshot.val() && claim.snapshot.val().matchedBy === currentUserId && claim.snapshot.val().roomCode === code;
    if (claimed && quickMatch === qm) {
      startQuickMatchAsCreator(code, tc, claim.snapshot.val(), qm.startedAt);
      code = null;
      return;
    }
    if (claimed) {
      // We were cancelled meanwhile: release the opponent back to the queue.
      database.ref('matchmaking/' + tc + '/' + candidate.uid).transaction(cur =>
        (cur && cur.roomCode === code) ? Object.assign({}, cur, { status: 'searching', roomCode: null, matchedBy: null }) : cur).catch(() => {});
    }
    if (quickMatch === qm) {
      await qm.entryRef.transaction(cur => (cur && cur.status === 'claiming') ? Object.assign({}, cur, { status: 'searching' }) : cur);
    }
  } catch (err) {
    console.warn('Quick Match pairing skipped:', err);
  } finally {
    if (code) database.ref('rooms/' + code).remove().catch(() => {});
    qm.busy = false;
  }
}

function startQuickMatchAsCreator(code, tc, opponent, searchStartedAt) {
  stopQuickMatchSearch();
  prepareCreatorRoomState(code, tc, opponent.uid, opponent.name);
  setWaitingForOpponent(true);
  setWaitingDetails('Opponent found!', (opponent.name || 'Player') + ' • ' + (Number(opponent.rating) || 800) + ' Elo • ' + friendTimeLabel(tc), 'Starting match...');
  activateCreatorRoom(code);
  // If the opponent never arrives (closed the app), go back to searching.
  setTimeout(() => {
    if (currentRoomCode !== code || !isWaitingForOpponent) return;
    selfCancellingChallenge = true;
    database.ref('rooms/' + code).transaction(cur => (cur && cur.guestId) ? undefined : null).then(res => {
      if (res.committed && currentRoomCode === code) {
        cleanupFriendGame(false);
        beginQuickMatchSearch(tc, searchStartedAt);
      }
    }).catch(() => {}).finally(() => { selfCancellingChallenge = false; });
  }, QUICK_MATCH_JOIN_WAIT_MS);
}

function joinQuickMatchRoom(entry) {
  const tc = quickMatch.tc;
  const startedAt = quickMatch.startedAt;
  stopQuickMatchSearch();
  setWaitingDetails('Opponent found!', (entry.matchedByName || 'Player') + ' • ' + (Number(entry.matchedByRating) || 800) + ' Elo • ' + friendTimeLabel(tc), 'Starting match...');
  joinFriendRoom(entry.roomCode, () => {
    cleanupFriendGame(false);
    beginQuickMatchSearch(tc, startedAt);
  });
}

function stopQuickMatchSearch() {
  if (!quickMatch) return;
  const qm = quickMatch;
  quickMatch = null;
  clearInterval(qm.tickTimer);
  qm.entryRef.off();
  try { qm.entryRef.onDisconnect().cancel(); } catch (_) {}
  qm.entryRef.remove().catch(() => {});
}

function cancelQuickMatch() {
  stopQuickMatchSearch();
  cleanupFriendGame(false);
}

// ---------- Fallback opponent (engine shown as a regular Quick Match player) ----------
function startQuickBotGame(tc) {
  stopQuickMatchSearch();
  let name = QUICK_BOT_NAMES[Math.floor(Math.random() * QUICK_BOT_NAMES.length)];
  if (Math.random() < 0.4) name += Math.floor(10 + Math.random() * 89);
  const rating = Math.max(100, Math.round((Number(currentUserRating) || 800) + (Math.random() * 100 - 50)));
  setWaitingDetails('Opponent found!', name + ' • ' + rating + ' Elo • ' + friendTimeLabel(tc), 'Starting match...');
  setTimeout(() => {
    if (!isWaitingForOpponent || currentRoomCode || quickMatch) return; // cancelled or replaced meanwhile
    launchQuickBotGame(tc, name, rating);
  }, 1200);
}

function launchQuickBotGame(tc, name, rating) {
  const myColor = Math.random() < 0.5 ? 'w' : 'b';
  setWaitingForOpponent(false);
  lockModeButtons(false);
  setGameMode('bot');
  botRating = Object.keys(BOT_PROFILES).map(Number)
    .reduce((best, r) => Math.abs(r - rating) < Math.abs(best - rating) ? r : best, 1400);
  playerColor = myColor;
  myOnlineColor = myColor;
  quickBot = {
    code: generateRoomCode(), tc, name, rating, myColor,
    botColor: myColor === 'w' ? 'b' : 'w',
    botId: 'qm_' + name.toLowerCase(),
    clock: { w: tc, b: tc, turn: 'w', startedAt: Date.now() },
    interval: null, micOn: false, over: false
  };

  game.reset();
  redoStack = [];
  moveQualityHistory = [];
  selectedSquare = null;
  isBotThinking = false;
  clearClickHighlights();
  clearHighlights();
  const me = { name: currentUserName, rating: currentUserRating };
  const opp = { name, rating };
  boardPlayerInfo = myColor === 'w' ? { w: me, b: opp } : { w: opp, b: me };
  board.orientation(myColor === 'w' ? 'white' : 'black');
  board.start();
  friendTimeControl = tc;
  resetFriendClockUI();
  const chatBox = document.getElementById('chatMessages');
  if (chatBox) chatBox.innerHTML = '';
  renderMicControls(false);
  applyQuickBotChrome();
  lockModeButtons(true);
  updateEvalBar(0, '0.0');
  document.getElementById('evalScore').textContent = '+0.00';
  document.getElementById('bestMoveText').textContent = 'Match started';
  document.getElementById('engineSubtext').textContent = `${currentUserName} vs ${name} • ${friendTimeLabel(tc)}`;
  document.getElementById('pvLineText').textContent = 'Good luck!';
  updateGameReview();
  updateUI();
  quickBot.interval = setInterval(renderQuickBotClock, 250);
  renderQuickBotClock();
  if (quickBot.botColor === 'w') checkBotTrigger();
}

// Same screen as an online friend match (room bar, clocks, chat, mic) - no bot controls.
function applyQuickBotChrome() {
  if (!quickBot) return;
  const el = (id) => document.getElementById(id);
  if (el('botControls')) el('botControls').style.display = 'none';
  if (el('friendControls')) el('friendControls').style.display = 'flex';
  if (el('activeRoomInfo')) el('activeRoomInfo').style.display = 'flex';
  if (el('activeRoomCode')) el('activeRoomCode').textContent = quickBot.code;
  ['undoBtn', 'redoBtn', 'resetBtn', 'playBestBtn'].forEach(id => { if (el(id)) el(id).style.display = 'none'; });
  if (el('chatTabBtn')) el('chatTabBtn').style.display = 'inline-block';
  if (el('chatOpponentName')) el('chatOpponentName').textContent = quickBot.name + ' (' + quickBot.rating + ')';
  el('panelPrimaryLabel').textContent = 'Friend Match';
  el('bestMoveArrow').setAttribute('visibility', 'hidden');
  if (el('modeBotBtn')) el('modeBotBtn').classList.remove('active');
  if (el('modeAnalyzeBtn')) el('modeAnalyzeBtn').classList.remove('active');
  if (el('modeFriendBtn')) el('modeFriendBtn').classList.add('active');
  updateTimeControlUI();
  updateBoardMicButtons();
}

function quickBotThinkDelay() {
  if (!quickBot) return 250;
  if (quickBotTimeLeft(quickBot.botColor) < 20) return 250 + Math.random() * 400;
  const base = game.history().length < 8 ? 400 : 900;
  return base + Math.random() * (quickBot.tc <= 300 ? 1500 : 2800);
}

function playRandomQuickBotMove() {
  const moves = game.moves({ verbose: true });
  if (!moves.length) return;
  const m = moves[Math.floor(Math.random() * moves.length)];
  executeBotMove(m.from + m.to + (m.promotion || ''));
}

function quickBotTimeLeft(color) {
  const c = quickBot.clock;
  const elapsed = c.turn === color ? (Date.now() - c.startedAt) / 1000 : 0;
  return Math.max(0, c[color] - elapsed);
}

function renderQuickBotClock() {
  if (!quickBot || quickBot.over) return;
  const turn = quickBot.clock.turn;
  const w = quickBotTimeLeft('w');
  const b = quickBotTimeLeft('b');
  const wEl = document.getElementById('whiteClock');
  const bEl = document.getElementById('blackClock');
  if (wEl) { wEl.textContent = formatClock(w); wEl.classList.toggle('active-clock', turn === 'w'); wEl.classList.toggle('low-clock', w <= 10); }
  if (bEl) { bEl.textContent = formatClock(b); bEl.classList.toggle('active-clock', turn === 'b'); bEl.classList.toggle('low-clock', b <= 10); }
  if ((turn === 'w' ? w : b) <= 0) finishQuickBotGame('timeout', turn === 'w' ? 'b' : 'w');
}

// Called after every move (yours or the opponent's) in a fallback Quick Match.
function quickBotAfterMove() {
  if (!quickBot || quickBot.over) return;
  const mover = quickBot.clock.turn;
  quickBot.clock[mover] = quickBotTimeLeft(mover);
  quickBot.clock.turn = game.turn();
  quickBot.clock.startedAt = Date.now();
  renderQuickBotClock();
  if (game.in_checkmate()) finishQuickBotGame('checkmate', mover);
  else if (game.game_over()) finishQuickBotGame('draw', null);
}

function finishQuickBotGame(result, winnerColor) {
  if (!quickBot || quickBot.over) return;
  const qb = quickBot;
  qb.over = true;
  clearInterval(qb.interval);
  qb.interval = null;
  isBotThinking = false;
  try { if (stockfish) stockfish.postMessage('stop'); } catch (_) {}
  ['whiteClock', 'blackClock'].forEach(id => { const c = document.getElementById(id); if (c) c.classList.remove('active-clock'); });

  const me = { id: currentUserId, name: currentUserName, rating: currentUserRating };
  const opp = { id: qb.botId, name: qb.name, rating: qb.rating };
  const white = qb.myColor === 'w' ? me : opp;
  const black = qb.myColor === 'w' ? opp : me;
  const winnerId = winnerColor ? (winnerColor === 'w' ? white.id : black.id) : null;
  // Same rating rule as online matches: checkmate / resignation move the rating by 8.
  if ((result === 'checkmate' || result === 'resigned') && winnerId) {
    const won = winnerId === currentUserId;
    database.ref('users/' + currentUserId + '/rating').transaction(r => won ? (r || 800) + 8 : Math.max(100, (r || 800) - 8));
  }
  const roomValue = {
    creatorId: white.id, creatorName: white.name, creatorRating: white.rating,
    guestId: black.id, guestName: black.name, guestRating: black.rating,
    result, winner: winnerId, timeControl: qb.tc, moveHistory: game.history(),
    gameOver: true, quickMatch: true
  };
  saveFriendMatchHistory(roomValue, qb.code);
  lockModeButtons(false);
  showFriendMatchResult(roomValue, qb.code);
}

function endQuickBotGame() {
  if (!quickBot) return;
  clearInterval(quickBot.interval);
  quickBot = null;
  isBotThinking = false;
  boardPlayerInfo = null;
  document.getElementById('bestMoveText').textContent = '—';
  document.getElementById('engineSubtext').textContent = '';
  document.getElementById('pvLineText').textContent = '';
  updateBoardMicButtons();
}

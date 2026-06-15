const els = {
  status: document.querySelector('#status'),
  joinForm: document.querySelector('#joinForm'),
  nameInput: document.querySelector('#nameInput'),
  roomInput: document.querySelector('#roomInput'),
  startBtn: document.querySelector('#startBtn'),
  sitOutBtn: document.querySelector('#sitOutBtn'),
  modeSelect: document.querySelector('#modeSelect'),
  helpBtn: document.querySelector('#helpBtn'),
  helpDialog: document.querySelector('#helpDialog'),
  closeHelpBtn: document.querySelector('#closeHelpBtn'),
  helpTitle: document.querySelector('#helpTitle'),
  rankingList: document.querySelector('#rankingList'),
  helpNote: document.querySelector('#helpNote'),
  players: document.querySelector('#players'),
  community: document.querySelector('#community'),
  hole: document.querySelector('#hole'),
  phase: document.querySelector('#phase'),
  pot: document.querySelector('#pot'),
  log: document.querySelector('#log'),
  raiseAmount: document.querySelector('#raiseAmount'),
  transferForm: document.querySelector('#transferForm'),
  transferTarget: document.querySelector('#transferTarget'),
  transferAmount: document.querySelector('#transferAmount'),
  localVideo: document.querySelector('#localVideo'),
  remoteVideos: document.querySelector('#remoteVideos'),
};
els.actionButtons = [...document.querySelectorAll('[data-action]')];

let ws;
let myId = '';
let localStream;
let state = { players: [] };
const peers = new Map();

const handRankings = {
  holdem: [
    '同花顺',
    '四条',
    '葫芦',
    '同花',
    '顺子',
    '三条',
    '两对',
    '一对',
    '高牌',
  ],
  shortdeck: [
    '同花顺',
    '四条',
    '同花',
    '葫芦',
    '三条',
    '顺子',
    '两对',
    '一对',
    '高牌',
  ],
};

function log(message) {
  const li = document.createElement('li');
  li.textContent = message;
  els.log.prepend(li);
  while (els.log.children.length > 80) els.log.lastElementChild.remove();
}

function send(payload) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.addEventListener('open', () => {
    els.status.textContent = '已连接，等待入座';
  });
  ws.addEventListener('close', () => {
    els.status.textContent = '连接已断开';
    setTimeout(connect, 1200);
  });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    handleMessage(msg);
  });
}

async function handleMessage(msg) {
  if (msg.type === 'hello') {
    myId = msg.id;
    return;
  }
  if (msg.type === 'welcome') {
    myId = msg.id;
    els.status.textContent = `房间 ${msg.room}，我的座位 ${msg.id}`;
    return;
  }
  if (msg.type === 'state') {
    state = msg;
    renderState();
    await syncPeers();
    return;
  }
  if (msg.type === 'private') {
    renderCards(els.hole, msg.cards || []);
    return;
  }
  if (msg.type === 'event') {
    log(msg.message);
    return;
  }
  if (msg.type === 'rtc-offer') {
    await onOffer(msg);
    return;
  }
  if (msg.type === 'rtc-answer') {
    const pc = peers.get(msg.from);
    if (pc) await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
    return;
  }
  if (msg.type === 'rtc-ice') {
    const pc = peers.get(msg.from);
    if (pc && msg.candidate) {
      await pc.addIceCandidate({
        candidate: msg.candidate,
        sdpMid: msg.sdpMid,
        sdpMLineIndex: msg.sdpMLineIndex,
      });
    }
  }
}

function renderState() {
  els.phase.textContent = state.phase || 'waiting';
  els.pot.textContent = `${state.mode === 'shortdeck' ? '短牌 6+' : '标准德州'} · 底池 ${state.pot || 0}`;
  renderCards(els.community, state.community || []);
  const me = state.players?.find((player) => player.id === myId);
  els.sitOutBtn.textContent = me?.sittingOut ? '回到牌局' : '旁观';
  els.modeSelect.value = state.mode || 'holdem';
  els.modeSelect.disabled = state.phase !== 'waiting';
  els.transferForm.classList.toggle('disabled', state.phase !== 'waiting');
  renderTransferTargets();
  renderActionControls(me);

  els.players.innerHTML = '';
  for (const player of state.players || []) {
    const item = document.createElement('article');
    item.className = 'player';
    if (player.id === state.toAct && state.phase !== 'waiting') item.classList.add('active');
    if (player.folded) item.classList.add('folded');
    if (player.sittingOut) item.classList.add('sitting-out');
    item.innerHTML = `
      <strong>${escapeHtml(player.name)} ${player.id === myId ? '(我)' : ''}</strong>
      <span>筹码 ${player.chips}</span>
      <span>下注 ${player.bet}</span>
      ${player.committed ? `<span>本手 ${player.committed}</span>` : ''}
      ${player.allIn ? '<span>All-in</span>' : ''}
      ${player.sittingOut ? '<span>旁观</span>' : ''}
    `;
    els.players.append(item);
  }
}

function renderHelp() {
  const mode = state.mode || els.modeSelect.value || 'holdem';
  els.helpTitle.textContent = mode === 'shortdeck' ? '短牌 6+ 牌型大小' : '标准德州牌型大小';
  els.rankingList.innerHTML = '';
  for (const item of handRankings[mode]) {
    const li = document.createElement('li');
    li.textContent = item;
    els.rankingList.append(li);
  }
  els.helpNote.textContent = mode === 'shortdeck'
    ? '短牌使用 6 到 A 共 36 张牌；A 可以组成 A-6-7-8-9 顺子；本项目采用同花大于葫芦、三条大于顺子的短牌排序。'
    : '标准德州使用 52 张牌；A 可以组成 A-2-3-4-5 顺子；同花小于葫芦，顺子大于三条。';
}

function renderActionControls(me) {
  const activeHand = state.phase && state.phase !== 'waiting';
  const myTurn = activeHand && state.toAct === myId && me && !me.sittingOut && !me.folded && !me.allIn;
  const toCall = me ? Math.max(0, (state.highestBet || 0) - (me.bet || 0)) : 0;
  const stackTotal = me ? (me.bet || 0) + (me.chips || 0) : 0;
  const bigBlind = state.bigBlind || 20;
  const minRaise = state.minRaise || bigBlind;
  const minRaiseTo = (state.highestBet || 0) === 0 || (state.highestBet || 0) < bigBlind
    ? bigBlind
    : (state.highestBet || 0) + minRaise;
  const shortAllInMin = (state.highestBet || 0) + 1;
  const legalRaiseMin = stackTotal >= minRaiseTo ? minRaiseTo : shortAllInMin;

  for (const button of els.actionButtons) {
    const action = button.dataset.action;
    let enabled = Boolean(myTurn);
    if (action === 'check') enabled = enabled && toCall === 0;
    if (action === 'call') enabled = enabled && toCall > 0;
    if (action === 'raise') enabled = enabled && stackTotal > (state.highestBet || 0);
    button.disabled = !enabled;

    if (action === 'call') {
      button.textContent = toCall > 0 ? `跟注 ${Math.min(toCall, me?.chips || 0)}` : '跟注';
    }
  }

  els.raiseAmount.min = String(legalRaiseMin);
  els.raiseAmount.max = String(Math.max(0, stackTotal));
  els.raiseAmount.disabled = !myTurn || stackTotal <= (state.highestBet || 0);
  if (myTurn && Number(els.raiseAmount.value || 0) < legalRaiseMin) {
    els.raiseAmount.value = String(Math.min(minRaiseTo, stackTotal));
  }
}

function renderTransferTargets() {
  const current = els.transferTarget.value;
  els.transferTarget.innerHTML = '';
  const targets = (state.players || []).filter((player) => player.id !== myId);
  for (const player of targets) {
    const option = document.createElement('option');
    option.value = player.id;
    option.textContent = `${player.name} (${player.chips})`;
    els.transferTarget.append(option);
  }
  if (targets.some((player) => player.id === current)) {
    els.transferTarget.value = current;
  }
  const disabled = state.phase !== 'waiting' || targets.length === 0;
  els.transferTarget.disabled = disabled;
  els.transferAmount.disabled = disabled;
  els.transferForm.querySelector('button').disabled = disabled;
}

function renderCards(target, cards) {
  target.innerHTML = '';
  for (const value of cards) {
    const card = document.createElement('div');
    card.className = 'card';
    if (value.endsWith('h') || value.endsWith('d')) card.classList.add('red');
    card.textContent = value.replace('s', '♠').replace('h', '♥').replace('d', '♦').replace('c', '♣');
    target.append(card);
  }
  if (!cards.length) {
    const empty = document.createElement('div');
    empty.className = 'card';
    empty.textContent = '?';
    target.append(empty);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[c]));
}

async function ensureMedia() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  els.localVideo.srcObject = localStream;
  return localStream;
}

function createPeer(remoteId) {
  if (peers.has(remoteId)) return peers.get(remoteId);
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });

  if (localStream) {
    for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
  }

  pc.addEventListener('icecandidate', (event) => {
    if (!event.candidate) return;
    send({
      type: 'rtc-ice',
      to: remoteId,
      candidate: event.candidate.candidate,
      sdpMid: event.candidate.sdpMid,
      sdpMLineIndex: event.candidate.sdpMLineIndex,
    });
  });

  pc.addEventListener('track', (event) => {
    let video = document.querySelector(`video[data-peer="${remoteId}"]`);
    if (!video) {
      video = document.createElement('video');
      video.dataset.peer = remoteId;
      video.autoplay = true;
      video.playsInline = true;
      els.remoteVideos.append(video);
    }
    video.srcObject = event.streams[0];
  });

  pc.addEventListener('connectionstatechange', () => {
    if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
      removePeer(remoteId);
    }
  });

  peers.set(remoteId, pc);
  return pc;
}

function removePeer(remoteId) {
  const pc = peers.get(remoteId);
  if (pc) pc.close();
  peers.delete(remoteId);
  document.querySelector(`video[data-peer="${remoteId}"]`)?.remove();
}

async function syncPeers() {
  if (!myId || !state.players?.length) return;
  const ids = state.players.map((p) => p.id).filter((id) => id !== myId);

  for (const id of peers.keys()) {
    if (!ids.includes(id)) removePeer(id);
  }

  if (!localStream) return;
  for (const id of ids) {
    const shouldOffer = myId < id;
    if (!peers.has(id) && shouldOffer) {
      const pc = createPeer(id);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ type: 'rtc-offer', to: id, sdp: offer.sdp });
    }
  }
}

async function onOffer(msg) {
  await ensureMedia();
  const pc = createPeer(msg.from);
  await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  send({ type: 'rtc-answer', to: msg.from, sdp: answer.sdp });
}

els.joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await ensureMedia();
  } catch (err) {
    log(`音视频不可用：${err.message}`);
  }
  send({
    type: 'join',
    name: els.nameInput.value || `玩家${Math.floor(Math.random() * 1000)}`,
    room: els.roomInput.value || 'demo',
  });
});

els.startBtn.addEventListener('click', () => send({ type: 'start' }));

els.modeSelect.addEventListener('change', () => {
  send({ type: 'mode', mode: els.modeSelect.value });
  renderHelp();
});

els.helpBtn.addEventListener('click', () => {
  renderHelp();
  els.helpDialog.showModal();
});

els.closeHelpBtn.addEventListener('click', () => els.helpDialog.close());

els.sitOutBtn.addEventListener('click', () => {
  const me = state.players?.find((player) => player.id === myId);
  send({ type: 'sitout', sittingOut: !me?.sittingOut });
});

els.transferForm.addEventListener('submit', (event) => {
  event.preventDefault();
  send({
    type: 'transfer',
    to: els.transferTarget.value,
    amount: Number(els.transferAmount.value || 0),
  });
});

els.actionButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.action;
    send({
      type: 'action',
      action,
      amount: Number(els.raiseAmount.value || 0),
    });
  });
});

connect();

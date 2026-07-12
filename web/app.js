import { Device } from 'https://esm.sh/mediasoup-client@3.21.0';

const els = {
  loginScreen: document.querySelector('#loginScreen'),
  loginForm: document.querySelector('#loginForm'),
  loginMessage: document.querySelector('#loginMessage'),
  loginBtn: document.querySelector('#loginBtn'),
  gameApp: document.querySelector('#gameApp'),
  gameLobby: document.querySelector('#gameLobby'),
  texasLobby: document.querySelector('#texasLobby'),
  texasGameBtn: document.querySelector('#texasGameBtn'),
  backGameLobbyBtn: document.querySelector('#backGameLobbyBtn'),
  backLobbyBtn: document.querySelector('#backLobbyBtn'),
  createRoomForm: document.querySelector('#createRoomForm'),
  createNameInput: document.querySelector('#createNameInput'),
  createRoomInput: document.querySelector('#createRoomInput'),
  createInviteInput: document.querySelector('#createInviteInput'),
  joinRoomForm: document.querySelector('#joinRoomForm'),
  joinNameInput: document.querySelector('#joinNameInput'),
  joinRoomInput: document.querySelector('#joinRoomInput'),
  joinInviteInput: document.querySelector('#joinInviteInput'),
  refreshRoomsBtn: document.querySelector('#refreshRoomsBtn'),
  roomList: document.querySelector('#roomList'),
  recentRooms: document.querySelector('#recentRooms'),
  roomTitle: document.querySelector('#roomTitle'),
  status: document.querySelector('#status'),
  accountInput: document.querySelector('#accountInput'),
  startBtn: document.querySelector('#startBtn'),
  sitOutBtn: document.querySelector('#sitOutBtn'),
  modeSelect: document.querySelector('#modeSelect'),
  anteForm: document.querySelector('#anteForm'),
  anteAmount: document.querySelector('#anteAmount'),
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
  turnNotice: document.querySelector('#turnNotice'),
  turnTimer: document.querySelector('#turnTimer'),
  sidePots: document.querySelector('#sidePots'),
  log: document.querySelector('#log'),
  raiseAmount: document.querySelector('#raiseAmount'),
  transferForm: document.querySelector('#transferForm'),
  transferTarget: document.querySelector('#transferTarget'),
  transferAmount: document.querySelector('#transferAmount'),
  localVideo: document.querySelector('#localVideo'),
  remoteVideos: document.querySelector('#remoteVideos'),
};
els.actionButtons = [...document.querySelectorAll('[data-action]')];
els.quickRaiseButtons = [...document.querySelectorAll('[data-quick-raise]')];

let ws;
let myId = '';
let mediaClient;
let joinedGameRoom = '';
let state = { players: [] };
let loggedIn = false;
let lobbyRooms = [];
let turnInterval = null;
let activeTurnSerial = null;

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
    els.loginMessage.textContent = '请输入访问码';
  });
  ws.addEventListener('close', () => {
    loggedIn = false;
    document.title = '私人空间';
    els.accountInput.disabled = false;
    els.loginBtn.disabled = false;
    els.loginScreen.hidden = false;
    els.gameLobby.hidden = true;
    els.texasLobby.hidden = true;
    els.gameApp.hidden = true;
    els.loginMessage.textContent = '连接已断开，正在重连';
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
  if (msg.type === 'login-ok') {
    loggedIn = true;
    document.title = '游戏大厅';
    els.loginScreen.hidden = true;
    els.gameLobby.hidden = false;
    els.gameApp.hidden = true;
    return;
  }
  if (msg.type === 'login-error') {
    els.loginBtn.disabled = false;
    els.loginMessage.textContent = msg.message;
    return;
  }
  if (msg.type === 'rooms') {
    lobbyRooms = msg.rooms || [];
    renderRoomList();
    return;
  }
  if (msg.type === 'welcome') {
    if (mediaClient && joinedGameRoom !== msg.room) {
      mediaClient.close();
      mediaClient = null;
    }
    myId = msg.id;
    joinedGameRoom = msg.room;
    rememberRoom(msg.room);
    els.roomTitle.textContent = `房间：${msg.room}`;
    els.status.textContent = `· 座位 ${msg.id}`;
    els.texasLobby.hidden = true;
    els.gameApp.hidden = false;
    connectMediasoup(msg.room).catch((err) => log(`音视频不可用：${err.message}`));
    return;
  }
  if (msg.type === 'state') {
    state = msg;
    renderState();
    return;
  }
  if (msg.type === 'private') {
    renderCards(els.hole, msg.cards || []);
    return;
  }
  if (msg.type === 'event') {
    if (!joinedGameRoom && !els.texasLobby.hidden) window.alert(msg.message);
    else log(msg.message);
    return;
  }
  if (msg.type === 'peer-left') {
    return;
  }
}

function recentRoomIds() {
  try {
    return JSON.parse(localStorage.getItem('dzRecentRooms') || '[]').filter((item) => typeof item === 'string').slice(0, 5);
  } catch {
    return [];
  }
}

function rememberRoom(roomId) {
  const rooms = [roomId, ...recentRoomIds().filter((item) => item !== roomId)].slice(0, 5);
  try {
    localStorage.setItem('dzRecentRooms', JSON.stringify(rooms));
  } catch {
    // Recent rooms are optional when browser storage is unavailable.
  }
  renderRoomList();
}

function renderRoomList() {
  const phaseNames = {
    waiting: '等待中', preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '结算中',
  };
  els.roomList.innerHTML = '';
  if (!lobbyRooms.length) {
    els.roomList.innerHTML = '<div class="room-empty">暂无房间，可以创建一个</div>';
  }
  for (const room of lobbyRooms) {
    const row = document.createElement('div');
    row.className = 'room-row';
    row.innerHTML = `
      <strong>${escapeHtml(room.id)} ${room.private ? '🔒' : ''}</strong>
      <span>${room.players}/9 · ${room.mode === 'shortdeck' ? '短牌' : room.mode === 'ante' ? `无盲底注 ${room.ante}` : '标准'} · ${phaseNames[room.phase] || room.phase}</span>
      <button type="button">填写</button>
    `;
    row.querySelector('button').addEventListener('click', () => {
      els.joinRoomInput.value = room.id;
      els.joinRoomInput.focus();
    });
    els.roomList.append(row);
  }

  const recent = recentRoomIds();
  els.recentRooms.innerHTML = recent.length
    ? `<strong>最近房间：</strong> ${recent.map((room) => `<button class="light-button" type="button" data-recent-room="${escapeHtml(room)}">${escapeHtml(room)}</button>`).join(' ')}`
    : '';
  els.recentRooms.querySelectorAll('[data-recent-room]').forEach((button) => {
    button.addEventListener('click', () => {
      els.joinRoomInput.value = button.dataset.recentRoom;
    });
  });
}

function renderState() {
  const phaseNames = {
    waiting: '等待开局', preflop: '翻牌前', flop: '翻牌圈', turn: '转牌圈', river: '河牌圈', showdown: '结算展示',
  };
  els.phase.textContent = phaseNames[state.phase] || state.phase || '等待开局';
  const modeName = state.mode === 'shortdeck' ? '短牌 6+'
    : state.mode === 'ante' ? `无盲底注 · 每人 ${state.ante || 0}` : '标准德州';
  els.pot.textContent = `${modeName} · 底池 ${state.pot || 0}`;
  renderCards(els.community, state.community || []);
  const me = state.players?.find((player) => player.id === myId);
  const actor = state.players?.find((player) => player.id === state.toAct);
  const myTurn = state.toAct === myId && state.phase !== 'waiting' && state.phase !== 'showdown';
  els.turnNotice.textContent = state.phase === 'showdown'
    ? '本手结算中…'
    : myTurn ? '轮到你行动' : actor ? `等待 ${actor.name} 行动` : '';
  updateTurnCountdown(myTurn, me);
  renderSidePots();
  const isHost = state.host === myId;
  els.startBtn.disabled = state.phase !== 'waiting' || !isHost;
  els.startBtn.title = isHost ? '' : '只有房主可以开局';
  els.sitOutBtn.textContent = me?.sittingOut ? '回到牌局' : '旁观';
  els.modeSelect.value = state.mode || 'holdem';
  els.modeSelect.disabled = state.phase !== 'waiting' || !isHost;
  els.modeSelect.title = isHost ? '' : '只有房主可以切换玩法';
  els.anteForm.hidden = state.mode !== 'ante';
  els.anteAmount.value = String(state.ante || 20);
  els.anteAmount.disabled = state.phase !== 'waiting' || !isHost;
  els.anteForm.querySelector('button').disabled = state.phase !== 'waiting' || !isHost;
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
    if (player.connected === false) item.classList.add('disconnected');
    const badges = [
      player.id === state.dealer ? '庄' : '',
      player.id === state.smallBlindPlayer ? '小盲' : '',
      player.id === state.bigBlindPlayer ? '大盲' : '',
      player.connected === false ? '断线' : '在线',
      player.sittingOut ? '旁观' : '',
    ].filter(Boolean);
    item.innerHTML = `
      <strong>${escapeHtml(player.name)} ${player.isHost ? '👑 房主' : ''} ${player.id === myId ? '(我)' : ''}</strong>
      <div class="player-badges">${badges.map((badge) => `<span class="player-badge">${badge}</span>`).join('')}</div>
      <span>筹码 ${player.chips}</span>
      <span>下注 ${player.bet}</span>
      ${player.committed ? `<span>本手 ${player.committed}</span>` : ''}
      ${player.allIn ? '<span>All-in</span>' : ''}
      ${player.sittingOut ? '<span>旁观</span>' : ''}
      ${(player.cards || []).length ? `<div class="revealed-cards">手牌：${player.cards.map(formatCardText).join(' ')}</div>` : ''}
      ${(player.bestCards || []).length ? `<div class="best-hand">最佳五张（${escapeHtml(player.handName || '')}）：${player.bestCards.map(formatCardText).join(' ')}</div>` : ''}
    `;
    els.players.append(item);
  }
}

function formatCardText(value) {
  return escapeHtml(value.replace('s', '♠').replace('h', '♥').replace('d', '♦').replace('c', '♣'));
}

function renderSidePots() {
  els.sidePots.innerHTML = '';
  for (const [index, pot] of (state.sidePots || []).entries()) {
    const names = (pot.eligible || []).map((id) => state.players?.find((player) => player.id === id)?.name || id);
    const item = document.createElement('span');
    item.className = 'side-pot';
    item.textContent = `${index === 0 ? '主池' : `边池 ${index}`} ${pot.amount} · ${names.join('、') || '无人可争夺'}`;
    els.sidePots.append(item);
  }
}

function playTurnAlert() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.3);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.3);
  } catch {
    // Audio alerts are best-effort.
  }
}

function updateTurnCountdown(myTurn, me) {
  if (!myTurn) {
    clearInterval(turnInterval);
    turnInterval = null;
    activeTurnSerial = null;
    els.turnTimer.textContent = '';
    return;
  }
  if (activeTurnSerial === state.actionSerial) return;
  clearInterval(turnInterval);
  activeTurnSerial = state.actionSerial;
  let remaining = 20;
  els.turnTimer.textContent = `${remaining} 秒`;
  playTurnAlert();
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('轮到你行动', { body: `房间 ${state.room}` });
  }
  turnInterval = setInterval(() => {
    remaining -= 1;
    els.turnTimer.textContent = `${remaining} 秒`;
    if (remaining > 0) return;
    clearInterval(turnInterval);
    turnInterval = null;
    const toCall = Math.max(0, (state.highestBet || 0) - (me?.bet || 0));
    send({ type: 'action', action: toCall === 0 ? 'check' : 'fold', amount: 0 });
    els.turnTimer.textContent = toCall === 0 ? '超时自动过牌' : '超时自动弃牌';
  }, 1000);
}

function renderHelp() {
  const mode = state.mode || els.modeSelect.value || 'holdem';
  const rankingMode = mode === 'shortdeck' ? 'shortdeck' : 'holdem';
  els.helpTitle.textContent = mode === 'shortdeck' ? '短牌 6+ 牌型大小'
    : mode === 'ante' ? '无盲注底注德州规则' : '标准德州牌型大小';
  els.rankingList.innerHTML = '';
  for (const item of handRankings[rankingMode]) {
    const li = document.createElement('li');
    li.textContent = item;
    els.rankingList.append(li);
  }
  els.helpNote.textContent = mode === 'shortdeck'
    ? '短牌使用 6 到 A 共 36 张牌；A 可以组成 A-6-7-8-9 顺子；本项目采用同花大于葫芦、三条大于顺子的短牌排序。'
    : mode === 'ante'
      ? `使用标准 52 张牌和标准牌型。没有大小盲，每手开始所有参局玩家先投入 ${state.ante || 20} 底注，随后从庄家左侧开始行动。`
      : '标准德州使用 52 张牌；A 可以组成 A-2-3-4-5 顺子；同花小于葫芦，顺子大于三条。';
}

function renderActionControls(me) {
  const activeHand = state.phase && state.phase !== 'waiting' && state.phase !== 'showdown';
  const myTurn = activeHand && state.toAct === myId && me && !me.sittingOut && !me.folded && !me.allIn;
  const toCall = me ? Math.max(0, (state.highestBet || 0) - (me.bet || 0)) : 0;
  const stackTotal = me ? (me.bet || 0) + (me.chips || 0) : 0;
  const minimumBet = state.mode === 'ante' ? (state.ante || 20) : (state.bigBlind || 20);
  const minRaise = state.minRaise || minimumBet;
  const minRaiseTo = (state.highestBet || 0) === 0 || (state.highestBet || 0) < minimumBet
    ? minimumBet
    : (state.highestBet || 0) + minRaise;
  const shortAllInMin = (state.highestBet || 0) + 1;
  const legalRaiseMin = stackTotal >= minRaiseTo ? minRaiseTo : shortAllInMin;

  for (const button of els.actionButtons) {
    const action = button.dataset.action;
    let enabled = Boolean(myTurn);
    if (action === 'check') enabled = enabled && toCall === 0;
    if (action === 'call') enabled = enabled && toCall > 0;
    if (action === 'raise') enabled = enabled && me?.canRaise && stackTotal > (state.highestBet || 0);
    button.disabled = !enabled;

    if (action === 'call') {
      button.textContent = toCall > 0 ? `跟注 ${Math.min(toCall, me?.chips || 0)}` : '跟注';
    }
  }

  els.raiseAmount.min = String(legalRaiseMin);
  els.raiseAmount.max = String(Math.max(0, stackTotal));
  els.raiseAmount.disabled = !myTurn || stackTotal <= (state.highestBet || 0);
  for (const button of els.quickRaiseButtons) {
    button.disabled = !myTurn || !me?.canRaise || stackTotal <= (state.highestBet || 0);
  }
  if (myTurn && Number(els.raiseAmount.value || 0) < legalRaiseMin) {
    els.raiseAmount.value = String(Math.min(minRaiseTo, stackTotal));
  }
}

function renderTransferTargets() {
  const current = els.transferTarget.value;
  const me = state.players?.find((player) => player.id === myId);
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
  const available = Math.max(0, me?.chips || 0);
  els.transferAmount.max = String(available);
  if (Number(els.transferAmount.value || 0) > available) {
    els.transferAmount.value = String(available);
  }
  const disabled = state.phase !== 'waiting' || targets.length === 0 || available <= 0;
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

function waitForSocketOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('mediasoup 信令连接失败')), { once: true });
  });
}

function resolveMediasoupUrl() {
  const config = window.DZ_CONFIG || {};
  if (config.mediasoupUrl && config.mediasoupUrl !== 'auto') return config.mediasoupUrl;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (location.protocol === 'https:') {
    return `${protocol}//${location.host}${config.mediasoupPath || '/mediasoup'}`;
  }

  const host = location.hostname.includes(':') ? `[${location.hostname}]` : location.hostname;
  return `${protocol}//${host}:${config.mediasoupDevPort || 3001}`;
}

class MediasoupClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextRequestId = 1;
    this.pending = new Map();
    this.producers = new Map();
    this.consumers = new Map();
    this.device = new Device();
    this.socket.addEventListener('message', (event) => this.handleMessage(JSON.parse(event.data)));
    this.socket.addEventListener('close', () => {
      this.close();
      if (mediaClient === this) mediaClient = null;
      log('mediasoup 信令已断开');
    });
  }

  async start({ roomId, peerId, name }) {
    await waitForSocketOpen(this.socket);
    const joined = await this.request('join', { roomId, peerId, name });
    await this.device.load({ routerRtpCapabilities: joined.routerRtpCapabilities });
    await this.createTransports();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    els.localVideo.srcObject = stream;

    for (const track of stream.getTracks()) {
      const producer = await this.sendTransport.produce({ track });
      this.producers.set(producer.id, producer);
      producer.on('trackended', () => this.closeProducer(producer.id));
      producer.on('transportclose', () => this.producers.delete(producer.id));
    }

    for (const producerId of joined.producers || []) {
      await this.consume(producerId);
    }
  }

  async createTransports() {
    const sendOptions = await this.request('createWebRtcTransport', { direction: 'send' });
    this.sendTransport = this.device.createSendTransport(sendOptions);
    this.sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.request('connectTransport', {
        transportId: this.sendTransport.id,
        dtlsParameters,
      }).then(callback).catch(errback);
    });
    this.sendTransport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
      this.request('produce', {
        transportId: this.sendTransport.id,
        kind,
        rtpParameters,
      }).then(({ id }) => callback({ id })).catch(errback);
    });

    const recvOptions = await this.request('createWebRtcTransport', { direction: 'recv' });
    this.recvTransport = this.device.createRecvTransport(recvOptions);
    this.recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
      this.request('connectTransport', {
        transportId: this.recvTransport.id,
        dtlsParameters,
      }).then(callback).catch(errback);
    });
  }

  request(action, data = {}) {
    const id = this.nextRequestId++;
    this.socket.send(JSON.stringify({ id, action, data }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`${action} 超时`));
      }, 10000);
    });
  }

  async consume(producerId) {
    if (!this.recvTransport || this.consumers.has(producerId)) return;
    const data = await this.request('consume', {
      producerId,
      rtpCapabilities: this.device.rtpCapabilities,
    });
    const consumer = await this.recvTransport.consume(data);
    this.consumers.set(producerId, consumer);
    const element = document.createElement(consumer.kind === 'video' ? 'video' : 'audio');
    element.dataset.producer = producerId;
    element.autoplay = true;
    element.playsInline = true;
    element.srcObject = new MediaStream([consumer.track]);
    els.remoteVideos.append(element);
    consumer.on('transportclose', () => this.removeConsumer(producerId));
    await this.request('resumeConsumer', { consumerId: consumer.id });
  }

  handleMessage(message) {
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.data);
      else pending.reject(new Error(message.error || 'mediasoup 请求失败'));
      return;
    }
    if (message.action === 'newProducer') {
      this.consume(message.data.producerId).catch((err) => log(`订阅远端音视频失败：${err.message}`));
      return;
    }
    if (message.action === 'producerClosed') {
      this.removeConsumer(message.data.producerId);
    }
  }

  removeConsumer(producerId) {
    const consumer = this.consumers.get(producerId);
    if (consumer) consumer.close();
    this.consumers.delete(producerId);
    document.querySelectorAll(`[data-producer="${producerId}"]`).forEach((el) => el.remove());
  }

  closeProducer(producerId) {
    this.producers.get(producerId)?.close();
    this.producers.delete(producerId);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const producer of this.producers.values()) producer.close();
    for (const consumer of this.consumers.values()) consumer.close();
    this.producers.clear();
    this.consumers.clear();
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.sendTransport = null;
    this.recvTransport = null;
    for (const pending of this.pending.values()) pending.reject(new Error('mediasoup 连接已关闭'));
    this.pending.clear();
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    }
    els.localVideo.srcObject?.getTracks().forEach((track) => track.stop());
    els.localVideo.srcObject = null;
    els.remoteVideos.innerHTML = '';
  }
}

async function connectMediasoup(gameRoom) {
  if (mediaClient || !myId) return;
  const mediasoupUrl = resolveMediasoupUrl();
  if (!mediasoupUrl) throw new Error('缺少 DZ_CONFIG.mediasoupUrl');
  const player = state.players?.find((item) => item.id === myId);
  mediaClient = new MediasoupClient(mediasoupUrl);
  try {
    await mediaClient.start({
      roomId: `dz-${gameRoom}`,
      peerId: myId,
      name: player?.name || myId,
    });
  } catch (err) {
    mediaClient.close();
    mediaClient = null;
    throw err;
  }
}

els.loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const account = els.accountInput.value.trim();
  if (!/^\d{6}$/.test(account)) {
    els.loginMessage.textContent = '访问码必须是 6 位数字';
    return;
  }
  if (ws?.readyState !== WebSocket.OPEN) {
    els.loginMessage.textContent = '连接尚未建立，请稍后重试';
    return;
  }
  els.loginBtn.disabled = true;
  els.loginMessage.textContent = '登录中…';
  send({ type: 'login', account });
});

els.texasGameBtn.addEventListener('click', () => {
  document.title = 'Web 德州 Hold\'em';
  els.gameLobby.hidden = true;
  els.texasLobby.hidden = false;
  els.gameApp.hidden = true;
  send({ type: 'list-rooms' });
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
});

els.backGameLobbyBtn.addEventListener('click', () => {
  document.title = '游戏大厅';
  els.texasLobby.hidden = true;
  els.gameLobby.hidden = false;
});

els.refreshRoomsBtn.addEventListener('click', () => send({ type: 'list-rooms' }));

els.createRoomForm.addEventListener('submit', (event) => {
  event.preventDefault();
  send({
    type: 'create-room',
    name: els.createNameInput.value || `玩家${Math.floor(Math.random() * 1000)}`,
    room: els.createRoomInput.value.trim(),
    invite: els.createInviteInput.value.trim(),
  });
});

els.joinRoomForm.addEventListener('submit', (event) => {
  event.preventDefault();
  send({
    type: 'join',
    name: els.joinNameInput.value || `玩家${Math.floor(Math.random() * 1000)}`,
    room: els.joinRoomInput.value.trim(),
    invite: els.joinInviteInput.value.trim(),
  });
});

els.backLobbyBtn.addEventListener('click', () => {
  if (joinedGameRoom && !window.confirm('返回房间大厅会离开当前房间；牌局进行中将按弃牌处理。确定返回吗？')) return;
  if (joinedGameRoom) send({ type: 'leave' });
  mediaClient?.close();
  mediaClient = null;
  joinedGameRoom = '';
  state = { players: [] };
  clearInterval(turnInterval);
  turnInterval = null;
  document.title = '德州扑克';
  els.gameApp.hidden = true;
  els.texasLobby.hidden = false;
  send({ type: 'list-rooms' });
});

els.startBtn.addEventListener('click', () => send({ type: 'start' }));

els.modeSelect.addEventListener('change', () => {
  send({ type: 'mode', mode: els.modeSelect.value });
  renderHelp();
});

els.anteForm.addEventListener('submit', (event) => {
  event.preventDefault();
  send({ type: 'ante', amount: Number(els.anteAmount.value || 0) });
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
  const amount = Number(els.transferAmount.value || 0);
  const me = state.players?.find((player) => player.id === myId);
  const largeTransfer = amount >= 1000 || (me?.chips && amount >= me.chips * 0.25);
  if (largeTransfer && !window.confirm(`确定转移 ${amount} 筹码吗？此操作不可撤销。`)) return;
  send({
    type: 'transfer',
    to: els.transferTarget.value,
    amount,
  });
});

els.actionButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.action;
    const amount = Number(els.raiseAmount.value || 0);
    const me = state.players?.find((player) => player.id === myId);
    const stackTotal = (me?.bet || 0) + (me?.chips || 0);
    const toCall = Math.max(0, (state.highestBet || 0) - (me?.bet || 0));
    if (action === 'call' && (me?.chips || 0) <= toCall
        && !window.confirm(`跟注需要投入剩余全部 ${me?.chips || 0} 筹码，确定 All-in 吗？`)) return;
    if (action === 'raise' && amount >= stackTotal
        && !window.confirm(`确定 All-in 到 ${stackTotal} 吗？`)) return;
    send({
      type: 'action',
      action,
      amount,
    });
  });
});

els.quickRaiseButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const me = state.players?.find((player) => player.id === myId);
    if (!me) return;
    const stackTotal = (me.bet || 0) + (me.chips || 0);
    if (button.dataset.quickRaise === 'allin') {
      if (!window.confirm(`确定 All-in 到 ${stackTotal} 吗？`)) return;
      send({ type: 'action', action: 'raise', amount: stackTotal });
      return;
    }
    const fraction = Number(button.dataset.quickRaise);
    const toCall = Math.max(0, (state.highestBet || 0) - (me.bet || 0));
    const potAfterCall = (state.pot || 0) + toCall;
    const rawTarget = (me.bet || 0) + toCall + Math.ceil(potAfterCall * fraction);
    const minimum = Number(els.raiseAmount.min || 0);
    const target = Math.min(stackTotal, Math.max(minimum, rawTarget));
    els.raiseAmount.value = String(target);
  });
});

connect();

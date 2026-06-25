import { Device } from 'https://esm.sh/mediasoup-client@3.21.0';

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
let mediaClient;
let joinedGameRoom = '';
let state = { players: [] };

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
    if (mediaClient && joinedGameRoom !== msg.room) {
      mediaClient.close();
      mediaClient = null;
    }
    myId = msg.id;
    joinedGameRoom = msg.room;
    els.status.textContent = `房间 ${msg.room}，我的座位 ${msg.id}`;
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
    log(msg.message);
    return;
  }
  if (msg.type === 'peer-left') {
    return;
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

function waitForSocketOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('mediasoup 信令连接失败')), { once: true });
  });
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
    for (const producer of this.producers.values()) producer.close();
    for (const consumer of this.consumers.values()) consumer.close();
    this.producers.clear();
    this.consumers.clear();
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.sendTransport = null;
    this.recvTransport = null;
    els.localVideo.srcObject?.getTracks().forEach((track) => track.stop());
    els.localVideo.srcObject = null;
    els.remoteVideos.innerHTML = '';
  }
}

async function connectMediasoup(gameRoom) {
  if (mediaClient || !myId) return;
  const mediasoupUrl = window.DZ_CONFIG?.mediasoupUrl;
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

els.joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
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

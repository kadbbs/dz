import os from 'node:os';
import process from 'node:process';
import WebSocket, { WebSocketServer } from 'ws';
import * as mediasoup from 'mediasoup';

const port = Number(process.env.MEDIASOUP_SIGNAL_PORT || 3001);
const listenIp = process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0';
const announcedIp = process.env.MEDIASOUP_ANNOUNCED_IP || firstNonInternalIp();
const rtcMinPort = Number(process.env.MEDIASOUP_MIN_PORT || 40000);
const rtcMaxPort = Number(process.env.MEDIASOUP_MAX_PORT || 49999);

const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
];

const worker = await mediasoup.createWorker({
  rtcMinPort,
  rtcMaxPort,
});
worker.on('died', () => {
  console.error('mediasoup worker died, exiting');
  process.exit(1);
});

const rooms = new Map();
const wss = new WebSocketServer({ port });

wss.on('connection', (socket) => {
  const peer = {
    id: '',
    name: '',
    room: null,
    socket,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
  };

  socket.on('message', async (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
      const data = await handleRequest(peer, message.action, message.data || {});
      send(socket, { id: message.id, ok: true, data });
    } catch (err) {
      send(socket, {
        id: message?.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  socket.on('close', () => closePeer(peer));
});

console.log(`mediasoup signaling listening on ws://0.0.0.0:${port}`);
console.log(`WebRTC listenIp=${listenIp} announcedIp=${announcedIp || '(none)'} ports=${rtcMinPort}-${rtcMaxPort}`);

async function handleRequest(peer, action, data) {
  switch (action) {
    case 'join':
      return join(peer, data);
    case 'createWebRtcTransport':
      return createWebRtcTransport(peer, data.direction);
    case 'connectTransport':
      return connectTransport(peer, data);
    case 'produce':
      return produce(peer, data);
    case 'consume':
      return consume(peer, data);
    case 'resumeConsumer':
      return resumeConsumer(peer, data.consumerId);
    default:
      throw new Error(`unknown action: ${action}`);
  }
}

async function join(peer, { roomId, peerId, name }) {
  if (!roomId || !peerId) throw new Error('roomId and peerId are required');
  if (peer.room) closePeer(peer);

  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      router: await worker.createRouter({ mediaCodecs }),
      peers: new Map(),
    };
    rooms.set(roomId, room);
  }

  const existingPeer = room.peers.get(String(peerId));
  if (existingPeer) closePeer(existingPeer);

  peer.id = String(peerId);
  peer.name = String(name || peerId);
  peer.room = room;
  room.peers.set(peer.id, peer);

  return {
    routerRtpCapabilities: room.router.rtpCapabilities,
    producers: [...room.peers.values()]
      .filter((item) => item !== peer)
      .flatMap((item) => [...item.producers.keys()]),
  };
}

async function createWebRtcTransport(peer, direction) {
  assertJoined(peer);
  const listenIps = announcedIp ? [{ ip: listenIp, announcedIp }] : [{ ip: listenIp }];
  const transport = await peer.room.router.createWebRtcTransport({
    listenIps,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    appData: { peerId: peer.id, direction },
  });
  peer.transports.set(transport.id, transport);
  transport.on('dtlsstatechange', (state) => {
    if (state === 'closed') transport.close();
  });
  transport.on('close', () => peer.transports.delete(transport.id));

  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };
}

async function connectTransport(peer, { transportId, dtlsParameters }) {
  const transport = peer.transports.get(transportId);
  if (!transport) throw new Error('transport not found');
  await transport.connect({ dtlsParameters });
  return {};
}

async function produce(peer, { transportId, kind, rtpParameters }) {
  const transport = peer.transports.get(transportId);
  if (!transport) throw new Error('transport not found');
  const producer = await transport.produce({ kind, rtpParameters, appData: { peerId: peer.id } });
  peer.producers.set(producer.id, producer);
  producer.on('transportclose', () => peer.producers.delete(producer.id));
  producer.on('close', () => {
    peer.producers.delete(producer.id);
    broadcast(peer.room, peer, 'producerClosed', { producerId: producer.id });
  });
  broadcast(peer.room, peer, 'newProducer', {
    peerId: peer.id,
    producerId: producer.id,
    kind: producer.kind,
  });
  return { id: producer.id };
}

async function consume(peer, { producerId, rtpCapabilities }) {
  assertJoined(peer);
  if (!peer.room.router.canConsume({ producerId, rtpCapabilities })) {
    throw new Error('cannot consume producer');
  }
  const recvTransport = [...peer.transports.values()].find((transport) => transport.appData.direction === 'recv');
  if (!recvTransport) throw new Error('receive transport not found');

  const consumer = await recvTransport.consume({
    producerId,
    rtpCapabilities,
    paused: true,
    appData: { peerId: peer.id },
  });
  peer.consumers.set(consumer.id, consumer);
  consumer.on('transportclose', () => peer.consumers.delete(consumer.id));
  consumer.on('producerclose', () => {
    peer.consumers.delete(consumer.id);
    send(peer.socket, { action: 'producerClosed', data: { producerId } });
  });

  return {
    id: consumer.id,
    producerId,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
  };
}

async function resumeConsumer(peer, consumerId) {
  const consumer = peer.consumers.get(consumerId);
  if (!consumer) throw new Error('consumer not found');
  await consumer.resume();
  return {};
}

function closePeer(peer) {
  for (const consumer of peer.consumers.values()) consumer.close();
  for (const producer of peer.producers.values()) producer.close();
  for (const transport of peer.transports.values()) transport.close();
  peer.consumers.clear();
  peer.producers.clear();
  peer.transports.clear();

  const room = peer.room;
  if (!room) return;
  room.peers.delete(peer.id);
  peer.room = null;
  if (room.peers.size === 0) {
    room.router.close();
    rooms.delete(room.id);
  }
}

function assertJoined(peer) {
  if (!peer.room) throw new Error('join a room first');
}

function broadcast(room, exceptPeer, action, data) {
  if (!room) return;
  for (const peer of room.peers.values()) {
    if (peer === exceptPeer || peer.socket.readyState !== WebSocket.OPEN) continue;
    send(peer.socket, { action, data });
  }
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function firstNonInternalIp() {
  for (const items of Object.values(os.networkInterfaces())) {
    for (const item of items || []) {
      if (item.family === 'IPv4' && !item.internal) return item.address;
    }
  }
  return undefined;
}

import { randomBytes, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 5181);
const duration = 90_000;
const syncGrace = 12_000;
const roundCount = 3;
const foundation = [0, 1000];
const visibleStories = 18;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/game.js', ['game.js', 'text/javascript; charset=utf-8']],
  ['/audio.js', ['audio.js', 'text/javascript; charset=utf-8']],
  ['/party.js', ['party.js', 'text/javascript; charset=utf-8']],
  ['/assets/city.jpg', ['assets/city.jpg', 'image/jpeg']],
  ['/assets/harbor.jpg', ['assets/harbor.jpg', 'image/jpeg']],
  ['/assets/night.jpg', ['assets/night.jpg', 'image/jpeg']],
  ['/assets/floor.webp', ['assets/floor.webp', 'image/webp']],
  ['/assets/lobby.webp', ['assets/lobby.webp', 'image/webp']],
]);

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('Expected JSON.');
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2048) throw new Error('Request too large.');
    chunks.push(chunk);
  }
  const data = JSON.parse(Buffer.concat(chunks).toString());
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Expected an object.');
  return data;
}

function snapshot(room) {
  return {
    code: room.code, phase: room.phase, round: room.round, now: Date.now(),
    start: room.start, end: room.end, host: room.host,
    players: room.players.map(({ seat, name, floors, total, done, left, stream, stories }) => ({
      seat, name, floors, total, done, left, stories: stories.slice(-visibleStories), online: Boolean(stream),
    })),
  };
}

function broadcast(room) {
  const message = 'data: ' + JSON.stringify(snapshot(room)) + '\n\n';
  for (const player of room.players) {
    const stream = player.stream;
    if (!stream) continue;
    if (stream.writableLength > 8192) stream.destroy();
    else stream.write(message);
  }
}

function pruneLobby(room) {
  if (room.phase !== 'lobby') return;
  const livePlayers = room.players.filter(player => player.stream || Date.now() - player.seen < 25_000);
  if (!livePlayers.some(player => player.seat === room.host)) room.host = livePlayers[0]?.seat;
  room.players = livePlayers;
}

function schedule(room, delay, callback) {
  clearTimeout(room.timer);
  room.timer = setTimeout(callback, delay);
  room.timer.unref();
}

function startRound(room) {
  room.round++;
  room.phase = 'round';
  room.start = Date.now() + 2400;
  room.end = room.start + duration;
  for (const player of room.players) {
    player.floors = 0;
    player.stories = [foundation];
    player.done = player.left;
  }
  schedule(room, room.end - Date.now() + syncGrace, () => finishRound(room));
  broadcast(room);
}

function finishRound(room) {
  if (room.phase !== 'round') return;
  clearTimeout(room.timer);
  for (const player of room.players) {
    player.total += player.floors;
    player.done = true;
  }
  const activePlayers = room.players.filter(player => !player.left).length;
  room.phase = room.round === roundCount || activePlayers < 2 ? 'finished' : 'between';
  room.updated = Date.now();
  if (room.phase === 'between') {
    schedule(room, 4600, () => {
      if (room.players.filter(player => !player.left).length < 2) {
        room.phase = 'finished';
        broadcast(room);
      } else {
        startRound(room);
      }
    });
  }
  broadcast(room);
}

function checkRound(room) {
  if (room.phase === 'round' && (room.players.every(player => player.done)
    || room.players.filter(player => !player.left).length < 2)) finishRound(room);
  else broadcast(room);
}

function createRoom() {
  let code;
  do {
    code = Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join('');
  } while (rooms.has(code));
  return { code, phase: 'lobby', round: 0, start: null, end: null, host: 0, players: [], updated: Date.now() };
}

function join(room, name) {
  const seat = [0, 1, 2, 3, 4, 5].find(index => !room.players.some(player => player.seat === index));
  const player = { seat, name, token: randomBytes(24).toString('base64url'), floors: 0, total: 0, done: false,
    stories: [foundation], left: false, seen: Date.now() };
  room.players.push(player);
  room.host ??= seat;
  room.updated = Date.now();
  broadcast(room);
  return { code: room.code, token: player.token, seat, name };
}

async function command(request, response) {
  let body;
  try { body = await readBody(request); }
  catch { return send(response, 400, { error: 'Invalid room request.' }); }
  const name = typeof body.name === 'string' ? Array.from(body.name.trim()).slice(0, 18).join('') : '';
  if (body.type === 'create') {
    if (!name) return send(response, 400, { error: 'Enter your name.' });
    if (rooms.size >= 200) return send(response, 503, { error: 'Too many rooms. Try again shortly.' });
    const room = createRoom();
    rooms.set(room.code, room);
    return send(response, 201, join(room, name));
  }

  const room = rooms.get(body.code);
  if (!room) return send(response, 404, { error: 'Room not found.' });
  if (body.type === 'join') {
    pruneLobby(room);
    if (!name) return send(response, 400, { error: 'Enter your name.' });
    if (room.phase !== 'lobby') return send(response, 409, { error: 'This match already started.' });
    if (room.players.length >= 6) return send(response, 409, { error: 'This room is full.' });
    return send(response, 200, join(room, name));
  }

  const player = room.players.find(member => member.token === body.token && !member.left);
  if (!player) return send(response, 403, { error: 'Your seat is no longer available.' });

  if (body.type === 'start') {
    if (room.phase !== 'lobby' || player.seat !== room.host || room.players.filter(member => member.stream).length < 2) {
      return send(response, 409, { error: 'The host can start once at least two players connect.' });
    }
    room.players = room.players.filter(member => member.stream);
    startRound(room);
  } else if (body.type === 'progress') {
    if (body.round !== room.round || room.phase !== 'round') return send(response, 200, { accepted: false });
    const now = Date.now();
    const elapsed = body.elapsed ?? Math.min(duration, now - room.start);
    if (now < room.start || now > room.end + syncGrace
      || (now > room.end + 800 && body.elapsed === undefined)
      || !Number.isInteger(elapsed) || elapsed < 0 || elapsed > duration || elapsed > now - room.start + 800
      || !Number.isInteger(body.floors) || body.floors < 0 || body.floors > Math.floor(elapsed / 210) + 1) {
      return send(response, 400, { error: 'Invalid round progress.' });
    }
    if (body.floors < player.floors || (body.floors === player.floors && (player.done || body.done !== true))) {
      return send(response, 200, { accepted: true });
    }
    if (player.done || body.floors > player.floors + 1) return send(response, 409, { error: 'Round progress is out of sequence.' });
    if (body.floors > player.floors) {
      const previous = player.stories.at(-1);
      const shape = body.shape ?? previous;
      if (!Array.isArray(shape) || ![2, 3].includes(shape.length) || !shape.every(Number.isInteger)
        || shape[0] < previous[0] || shape[1] > previous[1] || shape[0] >= shape[1]
        || (shape.length === 3 && (shape[2] < 0 || shape[2] + shape[1] - shape[0] > 1001))) {
        return send(response, 400, { error: 'Invalid tower shape.' });
      }
      player.stories.push(shape);
    }
    player.floors = body.floors;
    player.done = body.done === true;
    room.updated = now;
    checkRound(room);
  } else if (body.type === 'leave') {
    player.left = player.done = true;
    player.stream?.end();
    player.stream = null;
    if (room.phase === 'lobby') {
      room.players = room.players.filter(member => member !== player);
      if (room.host === player.seat) room.host = room.players[0]?.seat;
    }
    checkRound(room);
  } else {
    return send(response, 400, { error: 'Unknown room command.' });
  }

  send(response, 200, { accepted: true });
}

function subscribe(url, response) {
  const room = rooms.get(url.searchParams.get('code'));
  const player = room?.players.find(member => member.token === url.searchParams.get('token') && !member.left);
  if (!player) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('event: expired\ndata: {}\n\n');
    return;
  }
  const previous = player.stream;
  player.stream = response;
  previous?.end('event: replaced\ndata: {}\n\n');
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
  });
  response.write('retry: 2000\n\n');
  response.write('event: resume\ndata: ' + JSON.stringify({ room: snapshot(room), stories: player.stories }) + '\n\n');
  room.updated = Date.now();
  broadcast(room);
  response.on('close', () => {
    if (player.stream !== response) return;
    player.stream = null;
    player.seen = Date.now();
    broadcast(room);
  });
}

const server = createServer(async (request, response) => {
  let url;
  try { url = new URL(request.url, 'http://localhost'); }
  catch { response.writeHead(400).end(); return; }
  if (request.method === 'POST' && url.pathname === '/party') return command(request, response);
  if (request.method === 'GET' && url.pathname === '/events') return subscribe(url, response);
  const asset = files.get(url.pathname);
  if (!asset || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const [filename, type] = asset;
    const content = await readFile(new URL(filename, import.meta.url));
    response.writeHead(200, { 'Content-Type': type, 'Content-Length': content.length, 'Cache-Control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(500).end();
  }
});
setInterval(() => {
  for (const room of rooms.values()) {
    const online = room.players.some(player => player.stream);
    if (!online && Date.now() - room.updated > 10 * 60_000) {
      clearTimeout(room.timer);
      rooms.delete(room.code);
      continue;
    }
    if (room.phase === 'lobby') {
      const size = room.players.length;
      pruneLobby(room);
      if (size !== room.players.length) broadcast(room);
    }
    for (const player of room.players) player.stream?.write(': keepalive\n\n');
  }
}, 15_000).unref();

server.listen(port, host, () => {
  const address = server.address();
  console.log('Tower Stack at http://' + host + ':' + address.port);
});

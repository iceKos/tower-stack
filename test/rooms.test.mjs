import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';

const roster = Array.from({ length: 6 }, (_, seat) => ({ userId: 'user-' + seat, username: 'Builder ' + seat }));

async function until(read, predicate) {
  const deadline = Date.now() + 8500;
  do {
    const value = await read();
    if (predicate(value)) return value;
    await pause(25);
  } while (Date.now() < deadline);
  assert.fail('Condition did not arrive in time');
}

test('six-player standalone and verified Naka Lite rooms', { timeout: 45_000 }, async t => {
  const results = [];
  const directory = await mkdtemp(join(tmpdir(), 'tower-stack-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pending = join(directory, 'pending.json');
  const mock = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    let status = 403;
    let data;
    if (request.headers.authorization === 'Bearer local-test-key') {
      if (request.url === '/api/internal/game-sessions/identify') {
        const player = roster.find(member => member.userId === body.token);
        if (player) {
          status = 200;
          data = { player, session: { sessionId: 'six-players', roster, status: 'launching' } };
        }
      } else if (request.url === '/api/internal/game-sessions/six-players/result') {
        results.push(body);
        status = results.length === 1 ? 503 : 200;
        data = { replayed: false };
      }
    }
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data }));
  });
  mock.listen(0, '127.0.0.1');
  await once(mock, 'listening');
  t.after(() => { mock.close(); mock.closeAllConnections(); });

  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', PLATFORM: 'naka',
      NAKA_SERVER_KEY: 'local-test-key', NAKA_PENDING_FILE: pending,
      NAKA_API_URL: 'http://127.0.0.1:' + mock.address().port + '/api' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => child.kill());
  const output = createInterface({ input: child.stdout });
  const [line] = await once(output, 'line');
  const base = line.split(' at ')[1];
  assert.equal((await fetch(base + '/healthz')).status, 200);
  const library = base + '/vendor/three.module.js';
  const raw = await fetch(library, { method: 'HEAD', headers: { 'Accept-Encoding': 'identity' } });
  const gzip = await fetch(library, { method: 'HEAD', headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(gzip.headers.get('content-encoding'), 'gzip');
  assert.ok(Number(gzip.headers.get('content-length')) < Number(raw.headers.get('content-length')) / 2);
  assert.equal((await fetch(library, { headers: { 'If-None-Match': gzip.headers.get('etag') } })).status, 304);
  t.diagnostic(`Three.js transfer: ${raw.headers.get('content-length')} → ${gzip.headers.get('content-length')} bytes`);

  async function command(data, status = 200) {
    const response = await fetch(base + '/party', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data), signal: AbortSignal.timeout(6000),
    });
    const result = await response.json();
    assert.equal(response.status, status, result.error ?? data.type);
    return result;
  }

  async function listen(member, format = 'delta') {
    const controller = new AbortController();
    t.after(() => controller.abort());
    const { code, token } = member;
    const response = await fetch(base + '/events?' + new URLSearchParams({ code, token, format }), { signal: controller.signal });
    const state = { close: () => controller.abort() };
    void (async () => {
      let pendingData = '';
      try {
        for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
          pendingData += chunk;
          let end;
          while ((end = pendingData.indexOf('\n\n')) !== -1) {
            const lines = pendingData.slice(0, end).split('\n');
            pendingData = pendingData.slice(end + 2);
            const data = lines.find(row => row.startsWith('data: '));
            if (!data) continue;
            const event = JSON.parse(data.slice(6));
            if (lines[0] === 'event: resume') {
              state.resume = event;
              state.room = event.room;
            } else if (lines[0] === 'event: progress') {
              const player = state.room.players.find(member => member.seat === event.seat);
              player.floors = event.floors;
              player.done = event.done;
              if (event.story) player.stories = [...player.stories, event.story].slice(-18);
              state.progress = { ...event, bytes: Buffer.byteLength(lines.join('\n') + '\n\n') };
            } else if (!lines[0].startsWith('event:')) {
              state.room = event;
              state.fullBytes = Buffer.byteLength(lines.join('\n') + '\n\n');
            }
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) state.error = error;
      }
    })();
    await until(() => state.room, Boolean);
    return state;
  }

  const soloHost = await command({ type: 'create', name: 'Host' }, 201);
  const local = [soloHost, ...await Promise.all(roster.slice(1).map(({ username: name }) =>
    command({ type: 'join', code: soloHost.code, name })))];
  await command({ type: 'join', code: soloHost.code, name: 'Too many' }, 409);
  const localStreams = await Promise.all(local.map((member, seat) => listen(member, seat === 0 ? 'full' : 'delta')));
  await command({ ...soloHost, type: 'start' });
  const localMatch = await until(() => localStreams[0].room, state => state?.phase === 'round' && state.players.length === 6);
  await pause(Math.max(0, localMatch.start - Date.now() + 20));
  const shape = [100, 900, 100];
  await command({ ...soloHost, type: 'progress', round: 1, floors: 1, shape });
  const update = await until(() => localStreams[1].progress, Boolean);
  await until(() => localStreams[0].room.players[0].floors, floors => floors === 1);
  assert.deepEqual(update.story, shape);
  assert.deepEqual(localStreams[1].room.players[0].stories, localStreams[0].room.players[0].stories);
  assert.ok(update.bytes < localStreams[0].fullBytes / 4);
  t.diagnostic(`Six-player room update: ${localStreams[0].fullBytes} → ${update.bytes} bytes per recipient`);
  localStreams[1].close();
  localStreams[1] = await listen(local[1]);
  assert.deepEqual(localStreams[1].resume.room.players[0].stories.at(-1), shape);
  localStreams.forEach(stream => stream.close());

  const launch = (launchToken, sessionId = 'six-players', status = 200) =>
    command({ type: 'launch', launchToken, sessionId }, status);
  await launch('unknown', undefined, 403);
  await launch(roster[0].userId, 'wrong-session', 403);
  const players = await Promise.all(roster.map(player => launch(player.userId)));
  assert.equal(new Set(players.map(player => player.code)).size, 1);
  assert.equal(new Set(players.map(player => player.seat)).size, 6);
  assert.deepEqual(await launch(roster[0].userId), players[0]);
  await command({ type: 'join', code: players[0].code, name: 'Guest' }, 404);
  await command({ ...players[0], type: 'start' }, 409);

  const streams = await Promise.all(players.slice(0, 5).map(member => listen(member)));
  assert.equal(streams[0].room.phase, 'lobby');
  streams.push(await listen(players[5]));
  await until(() => streams[0].room, room => room.phase === 'round');
  await command({ ...players[5], type: 'leave' });
  await command({ ...players[0], type: 'progress', round: 1, floors: 100 }, 409);

  for (let round = 1; round <= 3; round++) {
    const room = await until(() => streams[0].room, state => state.phase === 'round' && state.round === round);
    await Promise.all(players.slice(0, 5).map(async (player, seat) => {
      let floor = 1;
      let nextAt = room.start;
      while (!streams[seat].room.players[seat].done && floor <= 6) {
        const elapsed = seat === 0 && floor === 1 ? Math.floor((2300 - (round - 1) * 75) / 2) : 8;
        const delayedAtHarbor = seat === 0 && round === 2 && floor === 1;
        const drop = { ...player, type: 'drop', round, floor, elapsed };
        await pause(Math.max(0, nextAt + elapsed - Date.now() + (delayedAtHarbor ? 300 : 5)));
        if (delayedAtHarbor) {
          await command({ ...drop, elapsed: 0 }, 409);
          await command({ ...drop, elapsed: elapsed + 3000 }, 409);
        }
        const placed = await command(drop);
        if (delayedAtHarbor) {
          assert.ok(placed.now - (nextAt + elapsed) >= 250);
          assert.ok(Math.abs(placed.x + 174) < 1, 'the server lands the floor at the centered input frame');
          assert.equal(placed.nextAt, nextAt + elapsed + 210);
        }
        if (round === 1 && floor === 1 && seat === 0) {
          assert.deepEqual(await command(drop), placed);
          streams[seat].close();
          streams[seat] = await listen(player);
          assert.equal(streams[seat].resume.tower.length, 2);
          assert.equal(streams[seat].resume.nextAt, placed.nextAt);
        }
        await until(() => streams[seat].room.players[seat], state => state.floors === floor || state.done);
        floor++;
        nextAt = placed.nextAt;
      }
      assert.equal(streams[seat].room.players[seat].done, true);
    }));
  }

  await until(() => results.length, length => length === 1);
  const queued = JSON.parse(await readFile(pending, 'utf8'));
  assert.deepEqual(queued[0].body, results[0]);
  await until(() => results.length, length => length === 2);
  assert.deepEqual(results[0], results[1]);
  const { players: rankings } = results[0];
  assert.deepEqual(rankings.map(player => player.userId), roster.map(player => player.userId));
  assert.equal(rankings[0].rank, 1);
  assert.equal(rankings[5].rank, 6);
  assert.equal(rankings[0].score, 9);
  assert.deepEqual(rankings.slice(1, 5).map(player => player.rank), [2, 2, 2, 2]);
  assert.deepEqual(await until(async () => JSON.parse(await readFile(pending, 'utf8')), jobs => !jobs.length), []);
});

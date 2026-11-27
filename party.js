'use strict';

function createTowerParty(onRoom, primeAudio, floorArt, lobbyArt) {
  const dialog = document.querySelector('#party-dialog');
  const form = document.querySelector('#party-form');
  const resumeList = document.querySelector('#party-resume');
  const lobby = document.querySelector('#party-lobby');
  const launcher = document.querySelector('#party-open');
  const codeInput = document.querySelector('#party-code');
  const nameInput = document.querySelector('#party-name');
  const status = document.querySelector('#party-status');
  const roomCode = document.querySelector('#party-room-code');
  const members = document.querySelector('#party-members');
  const hostStart = document.querySelector('#party-start');
  const close = document.querySelector('#party-close');
  const retryLaunch = document.querySelector('#naka-retry');
  const exit = document.querySelector('#party-exit');
  const rivals = document.querySelector('#rivals');
  const rivalList = document.querySelector('#rival-list');
  const connection = document.querySelector('#party-connection');
  const palette = ['#9deffd', '#ffdd62', '#ffad9a', '#d5b5ff', '#97edac', '#ffd394'];
  const hues = [0, 197, 152, 66, 268, 178];
  const cards = new Map();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let session;
  let room;
  let stream;
  const storagePrefix = 'tower-stack-seat:';
  const tabKey = nakaLaunch ? 'tower-stack-naka-seat:' + nakaLaunch.sessionId : 'tower-stack-current-seat';
  let connected = false;
  let flushing;
  let retryTimer;
  let reconnectTimer;
  const available = location.protocol === 'http:' || location.protocol === 'https:';

  function notice(message) {
    status.textContent = message;
  }

  function readSeat(token) {
    if (!/^[\w-]{32}$/.test(token ?? '')) return null;
    try {
      const saved = JSON.parse(localStorage.getItem(storagePrefix + token));
      if (saved?.token !== token || !Array.isArray(saved.queue)) return null;
      return saved;
    } catch { return null; }
  }

  function saveSeat(member = session) {
    try { localStorage.setItem(storagePrefix + member.token, JSON.stringify(member)); }
    catch { /* The live session still works when storage is unavailable. */ }
  }

  function tabSeat(token) {
    try {
      if (token) sessionStorage.setItem(tabKey, token);
      else sessionStorage.removeItem(tabKey);
    } catch { /* Automatic restoration is optional. */ }
  }

  function credentials({ code, token, seat }) {
    return { code, token, seat };
  }

  function renderResume() {
    const savedSeats = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(storagePrefix)) continue;
        const saved = readSeat(key.slice(storagePrefix.length));
        if (saved && !saved.naka && Date.now() - saved.savedAt < 24 * 60 * 60_000) savedSeats.push(saved);
      }
    } catch { /* A new room can still be created. */ }
    resumeList.replaceChildren(...savedSeats.sort((a, b) => b.savedAt - a.savedAt).map(saved => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `Resume ${saved.name} · ${saved.code}`;
      button.addEventListener('click', () => {
        primeAudio();
        openSeat(readSeat(saved.token) ?? saved);
      });
      return button;
    }));
    resumeList.hidden = savedSeats.length === 0;
  }

  async function command(data) {
    const response = await fetch('./party', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(data.type === 'launch' ? 12_000 : 3500),
    });
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('Start the Tower Stack room server to play with friends.');
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  }

  function paintBuilding(card, drop = 1) {
    const { canvas, stories, tint } = card;
    const ctx = card.context;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    const floorHeight = Math.min(18, 100 / stories.length);
    const baseWidth = 132;
    const origin = (width - baseWidth) / 2;
    const ground = height - 10;
    ctx.fillStyle = '#4a435033';
    ctx.fillRect(origin - 27, ground + 4, baseWidth + 54, 3);
    ctx.fillStyle = '#e5d7b9';
    ctx.fillRect(origin - 22, ground - 1, baseWidth + 44, 6);
    const hasLobby = card.floors < stories.length && lobbyArt.naturalWidth > 0;
    if (hasLobby) ctx.drawImage(lobbyArt, origin - 19, ground - floorHeight, baseWidth + 38, floorHeight + 5);
    if (!floorArt.naturalWidth) return;

    ctx.filter = tint;
    for (const [index, [left, right]] of stories.entries()) {
      if (index === 0 && hasLobby) continue;
      const span = right - left;
      const x = origin + left * baseWidth / 1000;
      const y = ground - (index + 1) * floorHeight;
      const newest = index === stories.length - 1;
      const offset = newest ? Math.min(24, (1 - drop ** 2) * 24, y - 1) : 0;
      ctx.drawImage(floorArt, left * floorArt.naturalWidth / 1000, 0,
        span * floorArt.naturalWidth / 1000, floorArt.naturalHeight,
        x, y - offset, Math.max(1, span * baseWidth / 1000), floorHeight + 0.5);
    }
    ctx.filter = 'none';
  }

  function renderRivals() {
    const opponents = room.players.filter(player => player.seat !== session.seat);
    const seats = new Set(opponents.map(player => player.seat));
    for (const [seat, card] of cards) {
      if (seats.has(seat)) continue;
      cancelAnimationFrame(card.frame);
      card.row.remove();
      cards.delete(seat);
    }
    rivals.dataset.count = opponents.length;
    for (const player of opponents) {
      let card = cards.get(player.seat);
      if (!card) {
        const row = document.createElement('li');
        row.style.setProperty('--rival-color', palette[player.seat]);
        const header = document.createElement('div');
        header.className = 'rival-heading';
        const label = document.createElement('span');
        label.className = 'rival-name';
        label.textContent = player.name;
        const count = document.createElement('strong');
        header.append(label, count);
        const note = document.createElement('small');
        note.className = 'rival-state';
        const canvas = document.createElement('canvas');
        canvas.className = 'rival-building';
        canvas.width = 240;
        canvas.height = 142;
        canvas.setAttribute('aria-hidden', 'true');
        row.append(header, note, canvas);
        rivalList.append(row);
        card = { row, note, count, canvas, context: canvas.getContext('2d'), tint: `hue-rotate(${hues[player.seat]}deg)` };
        cards.set(player.seat, card);
      }
      const displayed = room.phase === 'finished' ? player.total : player.floors;
      const note = player.left ? 'Left' : !player.online ? 'Offline' : room.phase === 'finished' ? 'Total floors' : player.done ? 'Finished' : 'Floors';
      if (card.count.textContent !== String(displayed)) card.count.textContent = displayed;
      if (card.note.textContent !== note) card.note.textContent = note;
      if (card.round === room.round && card.floors === player.floors) continue;
      const animate = card.round === room.round && player.floors === card.floors + 1 && !reducedMotion.matches;
      card.round = room.round;
      card.floors = player.floors;
      card.stories = player.stories ?? [[0, 1000]];
      cancelAnimationFrame(card.frame);
      if (!animate) {
        paintBuilding(card);
        continue;
      }
      const start = performance.now();
      function land(now) {
        const drop = Math.min(1, (now - start) / 220);
        paintBuilding(card, drop);
        if (drop < 1) card.frame = requestAnimationFrame(land);
      }
      card.frame = requestAnimationFrame(land);
    }
  }

  function paintLoadedArt() {
    for (const card of cards.values()) paintBuilding(card);
  }
  floorArt.addEventListener('load', paintLoadedArt);
  lobbyArt.addEventListener('load', paintLoadedArt);

  function render() {
    const inLobby = room?.phase === 'lobby';
    const inMatch = Boolean(room && !inLobby && room.phase !== 'cancelled');
    launcher.hidden = Boolean(nakaLaunch || session) || !available;
    exit.hidden = !inMatch || (Boolean(nakaLaunch) && room?.phase === 'finished');
    exit.textContent = nakaLaunch ? 'Back to lobby' : 'Leave room';
    rivals.hidden = !inMatch;
    document.querySelector('.game').classList.toggle('with-rivals', inMatch);
    form.hidden = Boolean(nakaLaunch || session);
    if (session) resumeList.hidden = true;
    lobby.hidden = !inLobby || Boolean(nakaLaunch);
    close.textContent = nakaLaunch ? 'Back to lobby' : inLobby ? 'Leave room' : 'Back';
    if (nakaLaunch && inLobby) {
      const online = room.players.filter(player => player.online).length;
      notice(`Waiting for builders · ${online}/${room.players.length} connected`);
    } else if (inLobby) {
      roomCode.textContent = room.code;
      members.replaceChildren(...room.players.map(player => {
        const row = document.createElement('li');
        row.textContent = player.name + (player.seat === room.host ? ' · Host' : '') + (!player.online ? ' · Offline' : '');
        return row;
      }));
      const host = room.host === session.seat;
      const online = room.players.filter(player => player.online).length;
      hostStart.hidden = !host;
      hostStart.disabled = online < 2;
      notice(host ? (online < 2 ? 'Share the code with a friend to start.' : 'Everyone ready? Start the match.') : 'Waiting for the host to start…');
    }
    if (inMatch) renderRivals();
  }

  function subscribe() {
    clearTimeout(reconnectTimer);
    stream?.close();
    const active = session;
    const events = new EventSource('./events?' + new URLSearchParams({ code: active.code, token: active.token, format: 'delta' }));
    stream = events;
    function receive(next, recovery = null) {
      if (session !== active) return;
      connected = true;
      connection.hidden = true;
      room = next;
      if (recovery) {
        const saved = readSeat(active.token);
        if (saved) {
          active.queue = saved.queue;
          active.draft = saved.draft;
        }
      }
      if (room.phase !== 'lobby') {
        const openRound = room.phase === 'round' ? room.round : room.round + 1;
        const current = active.queue.filter(entry => entry.round >= openRound);
        if (current.length !== active.queue.length || active.draft?.round < openRound) {
          active.queue = current;
          if (active.draft?.round < openRound) active.draft = null;
          saveSeat();
        }
      }
      render();
      if (room.phase === 'cancelled') {
        showLaunchMessage('The full party did not join. Return to the Naka Lite lobby.');
        events.close();
        return;
      }
      if (room.phase === 'lobby' && !dialog.open) dialog.showModal();
      if (room.phase !== 'lobby' && dialog.open) dialog.close();
      onRoom(room, active.seat, recovery ? { ...recovery, queue: active.queue, draft: active.draft } : null);
      void flushProgress();
    }
    events.addEventListener('resume', event => {
      const restored = JSON.parse(event.data);
      receive(restored.room, restored);
    });
    events.onmessage = event => receive(JSON.parse(event.data));
    events.addEventListener('progress', event => {
      if (session !== active || stream !== events) return;
      const { round, seat, floors, done, story } = JSON.parse(event.data);
      const player = room?.players.find(member => member.seat === seat);
      if (!player || room.phase !== 'round' || room.round !== round
        || floors !== player.floors + (story ? 1 : 0)) {
        subscribe();
        return;
      }
      player.floors = floors;
      player.done = done;
      if (story) {
        player.stories.push(story);
        if (player.stories.length > stackRules.visibleStories) player.stories.shift();
      }
      if (seat !== active.seat) renderRivals();
    });
    events.addEventListener('replaced', () => {
      if (session !== active) return;
      reset(false);
      if (nakaLaunch) return showLaunchMessage('This match was opened in another tab.');
      renderResume();
      notice('This seat was resumed in another tab.');
      if (!dialog.open) dialog.showModal();
    });
    events.addEventListener('expired', () => {
      if (session !== active) return;
      reset();
      if (nakaLaunch) return showLaunchMessage('This match has expired. Return to the Naka Lite lobby.');
      renderResume();
      notice('This room or seat has expired. Join a new room.');
      if (!dialog.open) dialog.showModal();
    });
    events.onerror = () => {
      if (session !== active || stream !== events) return;
      connected = false;
      if (events.readyState === EventSource.CLOSED) {
        // Browsers can close a stream while reloading, even though the seat is still valid.
        reconnectTimer = setTimeout(() => {
          if (session === active && stream === events) subscribe();
        }, 2000);
      }
      if (dialog.open) {
        notice('Reconnecting to the room…');
      } else {
        connection.textContent = 'Reconnecting…';
        connection.hidden = false;
      }
    };
  }

  function reset(forget = true) {
    stream?.close();
    stream = null;
    if (forget && session) {
      try { localStorage.removeItem(storagePrefix + session.token); } catch { /* Storage is optional. */ }
    }
    tabSeat(null);
    session = room = null;
    connected = false;
    clearTimeout(retryTimer);
    clearTimeout(reconnectTimer);
    retryTimer = undefined;
    connection.hidden = true;
    for (const card of cards.values()) cancelAnimationFrame(card.frame);
    cards.clear();
    rivalList.replaceChildren();
    render();
    onRoom(null);
  }

  function leave() {
    if (nakaLaunch) {
      const active = session;
      const phase = room?.phase;
      departed = true;
      reset();
      showLaunchMessage('Returning to the Naka Lite lobby…');
      if (active && phase !== 'cancelled' && phase !== 'finished') {
        void fetch('./party', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...credentials(active), type: 'leave' }), keepalive: true,
        }).catch(() => {});
      }
      nakaLaunch.notify('leave');
      return;
    }
    if (!session) return;
    void command({ ...credentials(session), type: 'leave' }).catch(() => {});
    reset();
  }

  function openSeat(member) {
    session = member;
    member.naka = Boolean(nakaLaunch);
    member.savedAt = Date.now();
    saveSeat();
    tabSeat(member.token);
    render();
    notice('Connecting to the room…');
    retryLaunch.hidden = true;
    subscribe();
  }

  function showLaunchMessage(message, retry = false) {
    retryLaunch.hidden = !retry;
    notice(message);
    if (!dialog.open) dialog.showModal();
  }

  let launching = false;
  let departed = false;
  async function launch() {
    if (launching || departed) return;
    if (!nakaLaunch.sessionId || !nakaLaunch.token) {
      showLaunchMessage('Open this match from the Naka Lite lobby.');
      return;
    }
    launching = true;
    showLaunchMessage('Connecting to Naka Lite…');
    try {
      const member = await command({
        type: 'launch', sessionId: nakaLaunch.sessionId, launchToken: nakaLaunch.token,
      });
      if (!departed) openSeat({ ...(readSeat(member.token) ?? {}), ...member, queue: [], draft: null });
    } catch (error) {
      if (!departed) showLaunchMessage(error.message || 'Could not connect to Naka Lite.', true);
    } finally {
      launching = false;
    }
  }

  function drop(round, floor, elapsed) {
    if (!connected || !session) return null;
    const active = session;
    return command({ ...credentials(active), type: 'drop', round, floor, elapsed }).catch(() => {
      if (session === active) subscribe();
      return null;
    });
  }

  async function flushProgress() {
    if (!connected || !session?.queue.length || flushing === session) return;
    const active = session;
    flushing = active;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    try {
      while (active === session && connected && active.queue.length) {
        const entry = active.queue[0];
        await command({ ...credentials(active), ...entry, type: 'progress' });
        if (active !== session) return;
        if (active.queue[0] === entry) active.queue.shift();
        saveSeat(active);
      }
      if (active === session && connected) connection.hidden = true;
    } catch {
      if (active !== session) return;
      connection.textContent = 'Score saved · Syncing when connected…';
      connection.hidden = false;
      if (connected) retryTimer ??= setTimeout(flushProgress, 1600);
    } finally {
      if (flushing === active) flushing = null;
    }
  }

  function rememberDrop(round, x, elapsed) {
    if (!session) return;
    session.draft = { round, x, elapsed };
    saveSeat();
  }

  function report(round, floors, done, shape, elapsed) {
    if (!session) return;
    session.draft = null;
    session.queue.push({ round, floors, done, shape, elapsed });
    saveSeat();
    void flushProgress();
  }

  launcher.addEventListener('click', () => {
    notice('');
    renderResume();
    dialog.showModal();
    nameInput.focus();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const type = event.submitter?.value ?? 'join';
    const code = codeInput.value.trim().toUpperCase();
    if (type === 'join' && code.length !== 5) {
      notice('Enter the 5-character room code.');
      codeInput.focus();
      return;
    }
    primeAudio();
    const buttons = Array.from(form.querySelectorAll('button'));
    buttons.forEach(button => { button.disabled = true; });
    notice('Connecting…');
    try {
      const membership = await command({ type, code, name: nameInput.value });
      if (!dialog.open) {
        void command({ ...membership, type: 'leave' }).catch(() => {});
        return;
      }
      openSeat({ ...membership, name: membership.name ?? nameInput.value.trim(), queue: [], draft: null });
    } catch (error) {
      notice(error.message || 'Could not connect to the room.');
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  });

  hostStart.addEventListener('click', async () => {
    hostStart.disabled = true;
    try { await command({ ...credentials(session), type: 'start' }); }
    catch (error) {
      notice(error.message);
      hostStart.disabled = false;
    }
  });

  retryLaunch.addEventListener('click', launch);
  close.addEventListener('click', () => nakaLaunch ? leave() : dialog.close());
  dialog.addEventListener('cancel', event => { if (nakaLaunch) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    if (nakaLaunch) return;
    if (room?.phase === 'lobby') leave();
    else if (session && !room) reset(false);
  });
  exit.addEventListener('click', leave);
  window.addEventListener('online', () => { void flushProgress(); });
  window.addEventListener('pagehide', () => {
    connected = false;
    clearTimeout(reconnectTimer);
    stream?.close();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted && session) subscribe();
  });
  render();

  return { report, leave, rememberDrop, drop, restore() {
    if (!available) return;
    let saved;
    try { saved = readSeat(sessionStorage.getItem(tabKey)); } catch { /* Storage is optional. */ }
    if (nakaLaunch?.token) {
      void launch();
    } else if (saved) {
      dialog.showModal();
      openSeat(saved);
    } else if (nakaLaunch) {
      showLaunchMessage('Open this match from the Naka Lite lobby.');
    }
  } };
}

'use strict';

const { roundCount: ROUND_COUNT, roundMs: ROUND_MS, floorHeight: FLOOR_HEIGHT,
  baseWidth: BASE_WIDTH, dropMs: DROP_MS } = stackRules;
const PERFECT_EFFECT_MS = 760;
const DROP_DISTANCE = 132;
const SITES = [
  { id: 'city', name: 'City Site', file: 'city.jpg', sky: '#4accfe' },
  { id: 'harbor', name: 'Sunset Harbor', file: 'harbor.jpg', sky: '#f0a8b4' },
  { id: 'night', name: 'Night Skyline', file: 'night.jpg', sky: '#080755' },
].map(site => {
  const image = new Image();
  image.src = './assets/' + site.file;
  return { ...site, image };
});

const gameSurface = document.querySelector('.game');
const canvas = document.querySelector('#site');
const canvas3d = document.querySelector('#site-3d');
const context = canvas.getContext('2d');
const action = document.querySelector('#action');
const hint = document.querySelector('#hint');
const floorsLabel = document.querySelector('#floors');
const roundLabel = document.querySelector('#round');
const siteName = document.querySelector('#site-name');
const timer = document.querySelector('#timer');
const bestLabel = document.querySelector('#best');
const feedback = document.querySelector('#feedback');
const audio = createTowerAudio(document.querySelector('#sound'));
const summary = document.querySelector('#summary');
const summaryTitle = document.querySelector('#summary-title');
const summaryScore = document.querySelector('#summary-score');
const summaryTotal = document.querySelector('#summary-total');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const partyResults = document.querySelector('#party-results');

let best = readBest();
let round = 1;
let total = 0;
let deadline = 0;
let phase = 'ready';
let tower;
let motion;
let falling;
let scraps = [];
let perfectEffect;
let camera = 0;
let width = 0;
let height = 0;
let pixels = 1;
let wasLow = false;
let remainingSeconds = 90;
let partyRoom = null;
let partyStart = 0;
let partyEnd = 0;
let activeSite = SITES[0];
let renderer3d;

const floorArt = new Image();
floorArt.src = './assets/floor.webp';
const lobbyArt = new Image();
lobbyArt.src = './assets/lobby.webp';

function readBest() {
  try {
    const stored = Number(localStorage.getItem('tower-stack-best'));
    return Number.isSafeInteger(stored) && stored > 0 ? stored : 0;
  } catch {
    return 0;
  }
}

function saveBest() {
  try {
    localStorage.setItem('tower-stack-best', String(best));
  } catch {
    // A browser can block storage when the prototype is opened as a file.
  }
}

function setPhase(next, buttonText, instructions = '') {
  phase = next;
  if (action.textContent !== buttonText) action.textContent = buttonText;
  hint.textContent = instructions;
  action.setAttribute('aria-disabled', String(['dropping', 'drop-request', 'room', 'countdown', 'party-wait'].includes(next)));
  gameSurface.classList.toggle('solo-playing', !partyRoom && ['moving', 'dropping'].includes(next));
}

function updateFloors() {
  const count = tower.length - 1;
  floorsLabel.textContent = `YOU · ${count} ${count === 1 ? 'FLOOR' : 'FLOORS'}`;
}

function reportPartyFloor(done = false) {
  if (partyRoom.naka) return;
  const shape = stackRules.encodeStory(tower.at(-1));
  party.report(round, tower.length - 1, done, shape, roundElapsed(performance.now()));
}

function roundElapsed(now) {
  return Math.max(0, Math.min(ROUND_MS, Math.round(now - deadline + ROUND_MS)));
}

function updateClock(seconds) {
  if (seconds !== remainingSeconds) {
    remainingSeconds = seconds;
    timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    if (seconds > 0 && seconds <= 3) audio.play('tick');
  }
  const low = seconds <= 10;
  if (low !== wasLow) {
    timer.classList.toggle('urgent', low);
    wasLow = low;
  }
}

function prepareRound(now) {
  activeSite = SITES[round - 1];
  gameSurface.dataset.site = activeSite.id;
  siteName.textContent = activeSite.name;
  tower = [stackRules.foundation];
  camera = 0;
  scraps = [];
  falling = null;
  perfectEffect = null;
  summary.hidden = true;
  partyResults.hidden = true;
  feedback.textContent = '';
  roundLabel.textContent = `ROUND ${round} / ${ROUND_COUNT}`;
  updateFloors();
  updateClock(90);
  nextFloor(now);
}

function nextFloor(now) {
  motion = { ...stackRules.nextFloor(tower, round), started: now };
  motion.x = stackRules.positionAt(motion, 0);
}

function startRound(now, finishAt = now + ROUND_MS) {
  audio.start();
  prepareRound(now);
  deadline = finishAt;
  setPhase('moving', 'DROP');
}

function pressAction() {
  const now = performance.now();
  if (phase === 'ready') {
    startRound(now);
    return;
  }
  if (phase === 'summary') {
    if (round === ROUND_COUNT) {
      round = 1;
      total = 0;
    } else {
      round++;
    }
    startRound(now);
    return;
  }
  if (phase === 'party-results') {
    party.leave();
    return;
  }
  if (phase !== 'moving') return;
  if (now >= deadline) {
    updateClock(0);
    endRound('Time’s up!');
    return;
  }
  if (partyRoom?.naka) {
    void dropForNaka();
    return;
  }
  falling = { ...motion, started: now };
  if (partyRoom) party.rememberDrop(round, falling.x, roundElapsed(now));
  audio.play('drop');
  setPhase('dropping', 'DROP');
}

async function dropForNaka() {
  const dropRound = round;
  const currentMotion = motion;
  setPhase('drop-request', 'DROP');
  const placement = await party.drop(dropRound, tower.length);
  if (phase !== 'drop-request' || round !== dropRound || motion !== currentMotion) return;
  if (!placement) {
    setPhase('moving', 'DROP');
    return;
  }
  const started = performance.now();
  falling = { ...motion, x: placement.x, started,
    nextAt: partyStart + placement.nextAt - partyRoom.start };
  audio.play('drop');
  setPhase('dropping', 'DROP');
}

function settleFloor(now) {
  const top = tower.at(-1);
  const { x, width: floorWidth, artLeft, y, nextAt } = falling;
  const { story, left, right, perfect } = stackRules.land(top, x);
  if (!story) {
    scraps.push({ x, width: floorWidth, artLeft, y, started: now, direction: Math.sign(x - top.x) });
    endRound('Missed the tower!', 'miss');
    return;
  }

  tower.push(story);
  audio.play(perfect ? 'perfect' : 'land');
  if (perfect) {
    feedback.textContent = 'PERFECT!';
    perfectEffect = { x: top.x, y: -y - FLOOR_HEIGHT, width: top.width, started: now };
  } else if (!reduceMotion.matches) {
    const direction = x < top.x ? -1 : 1;
    scraps.push({
      x: direction < 0 ? x : right,
      width: Math.abs(x - top.x),
      artLeft: direction < 0 ? artLeft : artLeft + right - x,
      y,
      started: now,
      direction,
    });
  }
  falling = null;
  updateFloors();

  if (now >= deadline) {
    updateClock(0);
    endRound('Time’s up!');
    return;
  }
  if (partyRoom) reportPartyFloor();
  nextFloor(nextAt ?? now);
  setPhase('moving', 'DROP');
}

function endRound(reason, cue = 'finish') {
  audio.play(cue);
  const count = tower.length - 1;
  if (partyRoom) {
    reportPartyFloor(true);
    showPartyWait(reason, count);
    return;
  }
  total += count;
  const final = round === ROUND_COUNT;
  if (final && total > best) {
    best = total;
    saveBest();
    bestLabel.textContent = `BEST ${best}`;
  }
  falling = null;
  perfectEffect = null;
  feedback.textContent = '';
  summaryTitle.textContent = final ? 'Tower complete!' : reason;
  summaryScore.textContent = `${count} ${count === 1 ? 'floor' : 'floors'} this round`;
  summaryTotal.textContent = final ? `${total} total · Best ${best}` : `${total} total so far`;
  summary.hidden = false;
  setPhase('summary', final ? 'PLAY AGAIN' : 'NEXT ROUND');
  summary.focus({ preventScroll: true });
}

function showPartyWait(reason, count) {
  falling = null;
  perfectEffect = null;
  feedback.textContent = '';
  summaryTitle.textContent = reason;
  summaryScore.textContent = `${count} ${count === 1 ? 'floor' : 'floors'} this round`;
  summaryTotal.textContent = 'Waiting for the other builders…';
  summary.hidden = false;
  setPhase('party-wait', 'WAITING');
}

function restoreTower(recovery, now) {
  const source = [...recovery.stories];
  for (const entry of recovery.queue) {
    if (entry.round === round && entry.floors === source.length && Array.isArray(entry.shape)) source.push(entry.shape);
  }
  tower = source.map(([left, right, artLeft = left]) => ({
    x: (left / 1000 - 0.5) * BASE_WIDTH,
    width: (right - left) / 1000 * BASE_WIDTH,
    artLeft: artLeft / 1000 * BASE_WIDTH,
  }));
  updateFloors();
  nextFloor(now);
}

function updateParty(next, seat, recovery) {
  const previous = partyRoom;
  partyRoom = next;
  const now = performance.now();
  if (!next) {
    round = 1;
    total = 0;
    prepareRound(now);
    if (nakaLaunch) setPhase('room', 'WAITING');
    else setPhase('ready', 'START', 'Line up the floor with the one below.');
    return;
  }
  if (next.phase === 'lobby') {
    setPhase('room', 'WAITING');
    return;
  }
  const player = next.players.find(member => member.seat === seat);
  if (!player) {
    party.leave();
    return;
  }
  const newRound = next.round !== previous?.round;
  if (newRound && next.round > 0) {
    round = next.round;
    prepareRound(now);
    if (recovery) restoreTower(recovery, now);
  }
  if (next.phase === 'round' && (newRound || (next.naka && recovery))) {
    partyStart = now + (next.start - next.now);
    partyEnd = now + (next.end - next.now);
    if (partyStart > now) {
      setPhase('countdown', 'GET READY', 'The round starts together.');
    } else {
      deadline = partyEnd;
      if (recovery?.tower) {
        tower = recovery.tower;
        updateFloors();
        nextFloor(now + recovery.nextAt - next.now);
        falling = null;
        summary.hidden = true;
      }
      updateClock(Math.max(0, Math.ceil((deadline - now) / 1000)));
      audio.start();
      const pendingFinish = recovery?.queue.some(entry => entry.round === round && entry.done);
      if (player.done || pendingFinish) {
        showPartyWait('Round complete!', tower.length - 1);
      } else if (recovery?.draft?.round === round && Number.isFinite(recovery.draft.x)) {
        falling = { ...motion, x: recovery.draft.x, started: now - DROP_MS };
        setPhase('dropping', 'DROP');
      } else {
        setPhase('moving', 'DROP');
      }
    }
    action.focus({ preventScroll: true });
  } else if (next.phase === 'between') {
    falling = null;
    summaryTitle.textContent = 'Round complete!';
    summaryScore.textContent = `${player.floors} floors this round`;
    summaryTotal.textContent = `${player.total} total · Next round starts shortly`;
    summary.hidden = false;
    setPhase('party-wait', 'WAITING');
  } else if (next.phase === 'finished' && previous?.phase !== 'finished') {
    falling = null;
    summaryTitle.textContent = 'Match complete!';
    summaryScore.textContent = `You placed ${player.total} floors`;
    summaryTotal.textContent = '';
    const finished = next.players.filter(member => !member.left).sort((a, b) => b.total - a.total);
    const departed = next.players.filter(member => member.left).sort((a, b) => b.total - a.total);
    let rank = 1;
    partyResults.replaceChildren(...[...finished, ...departed].map((member, index) => {
      if (index && member.total !== finished[index - 1]?.total) rank = index + 1;
      const row = document.createElement('li');
      row.textContent = `${member.left ? 'Left' : rank + '.'} ${member.name} · ${member.total}`;
      return row;
    }));
    partyResults.hidden = false;
    summary.hidden = false;
    setPhase('party-results', next.naka ? 'BACK TO LOBBY' : 'BACK TO SOLO');
    if (next.naka) nakaLaunch?.notify('ended');
    summary.focus({ preventScroll: true });
  }
}

const party = createTowerParty(updateParty, () => audio.prime(), floorArt, lobbyArt);

function resize() {
  width = canvas.clientWidth;
  height = canvas.clientHeight;
  pixels = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * pixels);
  canvas.height = Math.round(height * pixels);
}

function drawBackdrop(ground, scale) {
  const { image, sky } = activeSite;
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);
  if (!image.naturalWidth) return;

  const imageScale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const imageWidth = image.naturalWidth * imageScale;
  const imageHeight = image.naturalHeight * imageScale;
  const top = ground - imageHeight * 0.855 + camera * scale * 0.6;
  context.drawImage(image, (width - imageWidth) / 2, top, imageWidth, imageHeight);
}

function drawStory(story, y, x = story.x) {
  if (!floorArt.naturalWidth) return;
  const artScale = floorArt.naturalWidth / BASE_WIDTH;
  const sourceX = story.artLeft * artScale;
  const sourceWidth = Math.min(floorArt.naturalWidth - sourceX, story.width * artScale);
  context.drawImage(floorArt, sourceX, 0, sourceWidth, floorArt.naturalHeight, x, y - FLOOR_HEIGHT - 2, story.width, FLOOR_HEIGHT + 3);
}

function drawFoundation(x, y, foundationWidth) {
  if (!lobbyArt.naturalWidth) return;
  const overhang = foundationWidth * 0.143;
  context.drawImage(lobbyArt, x - overhang, y - FLOOR_HEIGHT - 2, foundationWidth + overhang * 2, FLOOR_HEIGHT + 16);
}

function strokeLine(points, color, lineWidth, dash = []) {
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.setLineDash(dash);
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) context.lineTo(x, y);
  context.stroke();
  context.setLineDash([]);
}

function drawCrane(beamY, trolleyX, cargoY, cargoWidth, showCable) {
  const x = -275;
  const mastWidth = 27;
  const mastLength = -beamY;
  const beamStart = -329;
  const beamEnd = 315;
  const beamDepth = 17;

  context.fillStyle = '#aea8a0';
  context.fillRect(x - 18, -17, mastWidth + 36, 17);
  context.fillStyle = '#c6bfb1';
  context.fillRect(x - 13, -24, mastWidth + 26, 9);
  for (let y = -26; y > beamY; y -= 25) {
    const end = Math.max(beamY, y - 25);
    strokeLine([[x, y], [x + mastWidth, end], [x + mastWidth, y], [x, end]], '#e88e1e', 2.7);
  }
  strokeLine([[x, -24], [x, -mastLength - 13], [x + mastWidth, beamY - 50], [x + mastWidth, -24]], '#ffb426', 4);
  strokeLine([[x + mastWidth, beamY - 50], [beamEnd, beamY], [beamStart, beamY]], '#785b42', 1.1);
  context.fillStyle = '#ffb025';
  context.fillRect(beamStart, beamY - 2, beamEnd - beamStart, 4);
  context.fillRect(beamStart, beamY + beamDepth, beamEnd - beamStart, 4);
  for (let section = beamStart; section < beamEnd; section += 27) {
    strokeLine([[section, beamY + beamDepth], [Math.min(beamEnd, section + 13), beamY], [Math.min(beamEnd, section + 27), beamY + beamDepth]], '#ffbd30', 2.5);
  }
  context.fillStyle = '#b47b49';
  context.fillRect(beamStart - 4, beamY + 5, 26, 21);
  context.fillStyle = '#eb9e29';
  context.fillRect(x - 6, beamY + beamDepth + 2, mastWidth + 21, 31);
  context.fillStyle = '#29718c';
  context.fillRect(x - 1, beamY + beamDepth + 8, mastWidth + 11, 19);
  context.fillStyle = '#83c4dc';
  context.fillRect(x + 3, beamY + beamDepth + 11, 12, 10);

  if (showCable) {
    const hookY = cargoY - 19;
    const span = Math.min(65, cargoWidth * 0.34);
    strokeLine([[trolleyX, beamY + beamDepth], [trolleyX, hookY], [trolleyX - span, cargoY]], '#354c54', 1.8);
    strokeLine([[trolleyX, hookY], [trolleyX + span, cargoY]], '#354c54', 1.8);
    context.fillStyle = '#eaa71c';
    context.fillRect(trolleyX - 10, beamY + beamDepth - 1, 20, 9);
    context.fillRect(trolleyX - 5, hookY - 5, 10, 6);
  }
}

function drawGuide(top, next) {
  const cargoY = -next.y - DROP_DISTANCE;
  const roofY = -next.y;
  const center = top.x + top.width / 2;
  strokeLine([[center, cargoY + 4], [center, roofY - 3]], '#ffffffda', 2.4, [5, 7]);
  const travelCenter = next.center + next.width / 2;
  const laneY = cargoY - 14;
  strokeLine([[travelCenter - next.range, laneY], [travelCenter + next.range, laneY]], '#ffffffbb', 2.5, [6, 9]);
  for (const side of [-1, 1]) {
    const end = travelCenter + next.range * side;
    strokeLine([[end - 9 * side, laneY - 6], [end, laneY], [end - 9 * side, laneY + 6]], '#fff', 2.5);
  }
}

function drawPerfectEffect(effect, now) {
  const progress = (now - effect.started) / PERFECT_EFFECT_MS;
  const fade = 1 - progress;
  context.save();
  context.globalAlpha = fade;
  context.shadowColor = '#ffda59';
  context.shadowBlur = 14;
  context.strokeStyle = '#fff09e';
  context.lineWidth = 3;
  context.strokeRect(effect.x - 1, effect.y - 1, effect.width + 2, FLOOR_HEIGHT + 2);
  context.restore();
  if (reduceMotion.matches) return;

  for (let i = 0; i < 14; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const spread = Math.floor(i / 2) / 6;
    const x = effect.x + (side === -1 ? 0 : effect.width) + side * (8 + progress * (28 + 38 * spread));
    const y = effect.y + FLOOR_HEIGHT / 2 + (spread - 0.5) * (18 + progress * 130) - progress * 27;
    const size = (3 + i % 4) * fade;
    context.save();
    context.globalAlpha = fade;
    strokeLine([[x - size, y], [x + size, y]], '#fff3b0', 2);
    strokeLine([[x, y - size], [x, y + size]], '#fff3b0', 2);
    context.restore();
  }
}

function render(now) {
  const scale = Math.min(height / 810, width / 650);
  const ground = height * 0.855;
  const peak = Math.max(510, tower.length * FLOOR_HEIGHT + DROP_DISTANCE + FLOOR_HEIGHT + 135);
  const lift = Math.max(0, peak - (ground - height * 0.14) / scale);
  camera += (lift - camera) * (reduceMotion.matches ? 1 : 0.16);
  context.setTransform(pixels, 0, 0, pixels, 0, 0);
  drawBackdrop(ground, scale);

  const cargo = falling ?? motion;
  const progress = falling ? Math.min(1, (now - falling.started) / DROP_MS) : 0;
  const activeCargo = ['ready', 'moving', 'dropping', 'drop-request', 'countdown'].includes(phase);
  scraps = scraps.filter((piece) => now - piece.started < 760);
  if (renderer3d) {
    renderer3d.render({
      width, height, scale, lift: camera, baseline: ground, site: activeSite.id,
      stories: tower, moving: cargo, fallingProgress: progress, activeCargo,
      showGuide: activeCargo && !falling, scraps, effect: perfectEffect,
      reduced: reduceMotion.matches, now,
    });
    return;
  }

  context.save();
  context.translate(width / 2, ground + camera * scale);
  context.scale(scale, scale);
  const cargoBottom = -cargo.y - DROP_DISTANCE;
  const top = tower.at(-1);
  const craneY = Math.min(-455, cargoBottom - FLOOR_HEIGHT - 80);

  drawCrane(craneY, cargo.x + cargo.width / 2, cargoBottom - FLOOR_HEIGHT, cargo.width, activeCargo && !falling);
  drawFoundation(tower[0].x, 0, tower[0].width);
  tower.slice(1).forEach((story, index) => drawStory(story, -(index + 1) * FLOOR_HEIGHT));
  if (perfectEffect) drawPerfectEffect(perfectEffect, now);
  if (activeCargo) {
    if (!falling) drawGuide(top, cargo);
    drawStory(cargo, cargoBottom + DROP_DISTANCE * progress ** 2);
  }
  for (const piece of scraps) {
    const t = (now - piece.started) / 760;
    const y = -piece.y + 570 * t ** 2;
    context.save();
    context.globalAlpha = 1 - t;
    context.translate(piece.x + piece.width / 2 + piece.direction * 85 * t, y);
    if (!reduceMotion.matches) context.rotate(piece.direction * t);
    drawStory(piece, 0, -piece.width / 2);
    context.restore();
  }
  context.restore();
}

async function enable3d() {
  if (location.protocol === 'file:') return;
  try {
    const { createTowerScene } = await import('./scene3d.js');
    renderer3d = createTowerScene(canvas3d, {
      floorArt, lobbyArt, floorHeight: FLOOR_HEIGHT, baseWidth: BASE_WIDTH,
      dropDistance: DROP_DISTANCE, effectMs: PERFECT_EFFECT_MS,
    });
    canvas3d.hidden = false;
    gameSurface.dataset.renderer = '3d';
  } catch {
    // The Canvas 2D renderer can run without WebGL or the Three.js module.
  }
}

function frame(now) {
  if (phase === 'countdown') {
    if (now >= partyStart) startRound(partyStart, partyEnd);
    else {
      const label = `STARTS IN ${Math.ceil((partyStart - now) / 1000)}`;
      if (action.textContent !== label) action.textContent = label;
    }
  }
  if (['moving', 'dropping', 'drop-request'].includes(phase)) {
    const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
    updateClock(seconds);
    if (falling && now - falling.started >= DROP_MS) {
      settleFloor(now);
    } else if (phase === 'moving' && !seconds) {
      endRound('Time’s up!');
    } else if (!falling) {
      motion.x = stackRules.positionAt(motion, now - motion.started);
    }
  }
  if (perfectEffect && now - perfectEffect.started >= PERFECT_EFFECT_MS) {
    perfectEffect = null;
    feedback.textContent = '';
  }
  if (width && height) render(now);
  requestAnimationFrame(frame);
}

action.addEventListener('click', pressAction);
document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' && event.key !== 'Enter') return;
  if (event.target !== action && event.target.closest?.('button, input, dialog')) return;
  if (document.querySelector('#party-dialog').open) return;
  event.preventDefault();
  if (!event.repeat) pressAction();
});
new ResizeObserver(resize).observe(canvas);
canvas3d.addEventListener('webglcontextlost', () => {
  renderer3d = null;
  canvas3d.hidden = true;
  gameSurface.dataset.renderer = '2d';
});

bestLabel.textContent = `BEST ${best}`;
prepareRound(performance.now());
resize();
const rendererReady = enable3d();
requestAnimationFrame(frame);
if (nakaLaunch) {
  setPhase('room', 'WAITING');
  const waitForArt = Promise.allSettled([...SITES.map(site => site.image), floorArt, lobbyArt]
    .map(image => image.decode?.()));
  void Promise.race([Promise.all([rendererReady, waitForArt]), new Promise(resolve => setTimeout(resolve, 5000))])
    .then(() => {
      party.restore();
      requestAnimationFrame(() => requestAnimationFrame(() => nakaLaunch.notify('ready')));
    });
} else {
  party.restore();
}

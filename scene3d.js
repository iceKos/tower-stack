import * as THREE from './vendor/three.module.js';

const scenes = {
  city: { sun: 0xffe4b5, sky: 0xd8f4ff, ground: 0xb5a894, daylight: 2.65, ambient: 1.85, glow: 0 },
  harbor: { sun: 0xffae76, sky: 0xffdedd, ground: 0xa47872, daylight: 2.45, ambient: 1.95, glow: 0.04 },
  night: { sun: 0x97c4ff, sky: 0xb8b3ff, ground: 0x382d73, daylight: 1.7, ambient: 1.7, glow: 0.33 },
};

export function createTowerScene(canvas, { floorArt, lobbyArt, floorHeight, baseWidth, dropDistance, effectMs }) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
  const ambient = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  sun.position.set(-430, 830, 540);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -680, right: 680, top: 660, bottom: -420, near: 50, far: 1800 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.7;
  scene.add(ambient, sun, sun.target);

  const cube = new THREE.BoxGeometry(1, 1, 1);
  const sphere = new THREE.SphereGeometry(1, 8, 6);
  const steel = new THREE.MeshStandardMaterial({ color: 0xffb92c, roughness: 0.56 });
  const beamTrim = new THREE.MeshStandardMaterial({ color: 0xbc651d, roughness: 0.6 });
  const cableMaterial = new THREE.MeshStandardMaterial({ color: 0x414855, roughness: 0.8 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xe9c8a7, roughness: 0.88 });
  const stone = new THREE.MeshStandardMaterial({ color: 0xaca0a0, roughness: 1 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x337f9f, roughness: 0.27, metalness: 0.2 });
  const darkGlass = new THREE.MeshStandardMaterial({ color: 0x24536b, roughness: 0.48 });
  const edgeFrame = new THREE.MeshStandardMaterial({ color: 0x296e75, roughness: 0.55 });
  const gold = new THREE.MeshBasicMaterial({ color: 0xffde73, transparent: true, depthWrite: false });

  function textureFor(image) {
    const texture = new THREE.Texture();
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    function upload() {
      texture.image = image;
      texture.needsUpdate = true;
    }
    if (image.complete && image.naturalWidth) upload();
    else image.addEventListener('load', upload, { once: true });
    return texture;
  }
  const floorFront = new THREE.MeshStandardMaterial({
    map: textureFor(floorArt), transparent: true, alphaTest: 0.32, roughness: 0.8, color: 0xeeeeee,
    emissive: 0x689bd5,
  });
  const lobbyFront = new THREE.MeshStandardMaterial({
    map: textureFor(lobbyArt), transparent: true, alphaTest: 0.32, roughness: 0.8, color: 0xeeeeee,
    emissive: 0x80a5d7,
  });
  const depth = 80;

  function block(parent, material, x, y, z, width, height, length, shadows = false) {
    const mesh = new THREE.Mesh(cube, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, length);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    parent.add(mesh);
    return mesh;
  }

  const axis = new THREE.Vector3(0, 1, 0);
  const difference = new THREE.Vector3();
  function placeRod(mesh, a, b, size) {
    difference.subVectors(b, a);
    mesh.scale.set(size, difference.length(), size);
    mesh.position.copy(a).addScaledVector(difference, 0.5);
    mesh.quaternion.setFromUnitVectors(axis, difference.normalize());
  }
  function rod(parent, material, a, b, size) {
    const mesh = new THREE.Mesh(cube, material);
    parent.add(mesh);
    placeRod(mesh, new THREE.Vector3(...a), new THREE.Vector3(...b), size);
    return mesh;
  }

  const foundation = new THREE.Group();
  scene.add(foundation);
  block(foundation, concrete, 0, -2, 0, baseWidth * 1.3, 6, depth + 20, true);
  block(foundation, darkGlass, 0, floorHeight / 2, 0, baseWidth - 7, floorHeight - 8, depth - 5, true);
  block(foundation, concrete, 0, floorHeight - 3, 0, baseWidth, 6, depth, true);
  for (const side of [-1, 1]) {
    for (let n = -3; n <= 3; n++) {
      block(foundation, edgeFrame, side * (baseWidth / 2 - 1.4), floorHeight / 2, n * 10, 3, floorHeight - 8, 1.8);
    }
  }
  const entrance = new THREE.Mesh(new THREE.PlaneGeometry(baseWidth * 1.286, floorHeight + 16), lobbyFront);
  entrance.position.set(0, (floorHeight - 12) / 2, depth / 2 + 0.4);
  foundation.add(entrance);

  function makeFloor() {
    const model = new THREE.Group();
    scene.add(model);
    const body = block(model, glass, 0, floorHeight / 2, 0, 1, floorHeight - 8, depth - 4, true);
    const roof = block(model, concrete, 0, floorHeight - 2, 0, 1, 4, depth, true);
    const sill = block(model, concrete, 0, 2, 0, 1, 4, depth, true);
    const sides = [];
    for (const side of [-1, 1]) {
      for (let n = -2; n <= 2; n++) {
        sides.push({ side, mesh: block(model, edgeFrame, 0, floorHeight / 2, n * 13, 1.7, floorHeight - 8, 1.65) });
      }
    }
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1, floorHeight), floorFront);
    face.position.set(0, floorHeight / 2, depth / 2 + 0.2);
    model.add(face);
    return { model, body, roof, sill, sides, face };
  }

  function fitFloor(view, story, y) {
    const width = story.width;
    view.model.position.set(story.x + width / 2, y, 0);
    if (view.width === width && view.artLeft === story.artLeft) return;
    view.width = width;
    view.artLeft = story.artLeft;
    view.body.scale.x = Math.max(1, width - 2);
    view.roof.scale.x = view.sill.scale.x = view.face.scale.x = width;
    for (const {side, mesh} of view.sides) mesh.position.x = side * (width / 2 - 0.7);
    const uv = view.face.geometry.attributes.uv;
    const left = story.artLeft / baseWidth;
    const right = Math.min(1, left + width / baseWidth);
    for (let i = 0; i < uv.count; i++) uv.setX(i, i % 2 === 0 ? left : right);
    uv.needsUpdate = true;
  }

  const cargo = makeFloor();
  const placed = [];
  const debris = [];
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 840), new THREE.ShadowMaterial({ opacity: 0.21 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -5.2;
  ground.receiveShadow = true;
  scene.add(ground);

  const mastX = -268;
  const mastZ = -38;
  const mastSize = 27;
  const beam = new THREE.Group();
  scene.add(beam);
  block(scene, stone, mastX, 5, mastZ, 63, 19, 63, true);
  block(scene, concrete, mastX, 16, mastZ, 47, 11, 47, true);
  block(beam, steel, mastX, 19, mastZ, 32, 72, 32);
  block(beam, steel, -14, 7, mastZ, 642, 5, 23);
  block(beam, beamTrim, -14, -9, mastZ, 642, 4, 23);
  for (const z of [mastZ - 11, mastZ + 11]) {
    for (let x = -335; x < 306; x += 28) {
      rod(beam, steel, [x, -8, z], [x + 14, 7, z], 2.9);
      rod(beam, beamTrim, [x + 14, 7, z], [Math.min(307, x + 28), -8, z], 2.6);
    }
    rod(beam, cableMaterial, [-324, 8, z], [mastX, 55, z], 1.4);
    rod(beam, cableMaterial, [mastX, 55, z], [307, 7, z], 1.25);
  }
  block(beam, steel, mastX + 1, -26, mastZ + 19, 42, 27, 32, true);
  block(beam, darkGlass, mastX + 1, -26, mastZ + 36, 31, 16, 2);
  block(beam, stone, -328, -12, mastZ, 31, 29, 29, true);
  block(beam, stone, -308, -12, mastZ, 12, 23, 29);
  const trolley = block(beam, steel, 0, -13, mastZ + 13, 25, 11, 35);
  const hook = block(scene, steel, 0, 0, 0, 14, 10, 10);
  const cables = Array.from({ length: 3 }, () => block(scene, cableMaterial, 0, 0, 0, 1, 1, 1));
  const crew = new THREE.Group();
  scene.add(crew);
  const mastBays = [];
  function mastBay() {
    const bay = new THREE.Group();
    const half = mastSize / 2;
    for (const z of [-half, half]) {
      block(bay, steel, -half, 13, z, 4.1, 26, 4.1);
      block(bay, steel, half, 13, z, 4.1, 26, 4.1);
      rod(bay, beamTrim, [-half, 1, z], [half, 25, z], 2.6);
      rod(bay, steel, [half, 1, z], [-half, 25, z], 2.6);
    }
    block(bay, beamTrim, 0, 25, 0, mastSize + 2, 2.4, mastSize + 2);
    crew.add(bay);
    return bay;
  }

  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  function cable(mesh, a, b, size) {
    placeRod(mesh, from.set(...a), to.set(...b), size);
  }

  const guideGeometry = new THREE.BufferGeometry();
  const guidePoints = new THREE.BufferAttribute(new Float32Array(12), 3);
  guideGeometry.setAttribute('position', guidePoints);
  const guides = new THREE.LineSegments(guideGeometry, new THREE.LineDashedMaterial({
    color: 0xffffff, transparent: true, opacity: 0.78, dashSize: 6, gapSize: 7, depthTest: false,
  }));
  guides.frustumCulled = false;
  guides.renderOrder = 4;
  scene.add(guides);
  let guideKey = '';

  const effectFrame = new THREE.Group();
  const edge = new THREE.EdgesGeometry(cube);
  const rim = new THREE.LineSegments(edge, new THREE.LineBasicMaterial({
    color: 0xffdf70, transparent: true, depthWrite: false, depthTest: false,
  }));
  rim.renderOrder = 5;
  effectFrame.add(rim);
  const sparks = Array.from({ length: 14 }, () => {
    const spark = new THREE.Mesh(sphere, gold);
    effectFrame.add(spark);
    return spark;
  });
  scene.add(effectFrame);

  function drawEffects(effect, now, reduced) {
    effectFrame.visible = Boolean(effect);
    if (!effect) return;
    const progress = (now - effect.started) / effectMs;
    const fade = 1 - progress;
    const x = effect.x + effect.width / 2;
    const y = -effect.y - floorHeight / 2;
    rim.position.set(x, y, 0);
    rim.scale.set(effect.width + 4 + 10 * progress, floorHeight + 4 + 10 * progress, depth + 4);
    rim.material.opacity = fade;
    gold.opacity = fade;
    sparks.forEach((spark, index) => {
      spark.visible = !reduced;
      const side = index % 2 ? 1 : -1;
      const position = Math.floor(index / 2) / 6;
      const spread = effect.width / 2 + 5 + progress * (18 + position * 58);
      spark.position.set(x + side * spread, y + (position - 0.5) * (28 + progress * 126) + progress * 26, depth / 2 + 8);
      spark.scale.setScalar((2.7 + index % 3) * fade);
    });
  }

  let selectedSite = '';
  let prevW = -1;
  let prevH = -1;
  let prevRatio = -1;
  function render(frame) {
    const { width, height, scale, lift, baseline, site, stories, moving, fallingProgress, activeCargo,
      showGuide, scraps, effect, reduced, now } = frame;
    const pixelRatio = Math.min(devicePixelRatio || 1, 1.5);
    if (width !== prevW || height !== prevH || pixelRatio !== prevRatio) {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      prevW = width; prevH = height; prevRatio = pixelRatio;
    }
    if (selectedSite !== site) {
      selectedSite = site;
      const mood = scenes[site];
      sun.color.setHex(mood.sun);
      sun.intensity = mood.daylight;
      ambient.color.setHex(mood.sky);
      ambient.groundColor.setHex(mood.ground);
      ambient.intensity = mood.ambient;
      floorFront.emissiveIntensity = mood.glow;
      lobbyFront.emissiveIntensity = mood.glow;
    }

    const focusY = lift + (baseline - height / 2) / scale;
    camera.left = -width / (2 * scale);
    camera.right = -camera.left;
    camera.top = height / (2 * scale);
    camera.bottom = -camera.top;
    camera.position.set(204, focusY + 150, 1360);
    camera.lookAt(0, focusY, 0);
    camera.updateProjectionMatrix();

    foundation.visible = lift < 140;
    ground.visible = lift < 130;
    sun.castShadow = ground.visible;

    const visibleFrom = Math.max(1, Math.floor((lift - 120) / floorHeight));
    const visible = stories.length - visibleFrom;
    for (let i = 0; i < Math.max(visible, placed.length); i++) {
      const view = placed[i] ?? (placed[i] = makeFloor());
      view.model.visible = i < visible;
      if (i < visible) fitFloor(view, stories[visibleFrom + i], (visibleFrom + i) * floorHeight);
    }

    const bottom = moving.y + dropDistance - dropDistance * fallingProgress ** 2;
    cargo.model.visible = activeCargo;
    if (activeCargo) fitFloor(cargo, moving, bottom);
    const mastTop = Math.max(455, moving.y + dropDistance + floorHeight + 80);
    beam.position.y = mastTop;
    const mastBottom = Math.max(20, Math.floor((lift - 120) / 26) * 26);
    const numberOfBays = Math.ceil((mastTop - mastBottom) / 26);
    for (let i = 0; i < Math.max(numberOfBays, mastBays.length); i++) {
      const bay = mastBays[i] ?? (mastBays[i] = mastBay());
      bay.visible = i < numberOfBays;
      if (i >= numberOfBays) continue;
      const y = mastBottom + i * 26;
      bay.position.set(mastX, y, mastZ);
      bay.scale.y = Math.min(1, (mastTop - y) / 26);
    }

    const trolleyX = moving.x + moving.width / 2;
    trolley.position.x = trolleyX;
    const suspended = activeCargo && fallingProgress === 0;
    hook.visible = suspended;
    cables.forEach(mesh => { mesh.visible = suspended; });
    if (suspended) {
      const hookY = bottom + floorHeight + 21;
      const reach = Math.min(65, moving.width * 0.34);
      hook.position.set(trolleyX, hookY, 0);
      cable(cables[0], [trolleyX, mastTop - 12, mastZ + 10], [trolleyX, hookY, 0], 1.8);
      cable(cables[1], [trolleyX, hookY, 0], [trolleyX - reach, bottom + floorHeight, 0], 1.7);
      cable(cables[2], [trolleyX, hookY, 0], [trolleyX + reach, bottom + floorHeight, 0], 1.7);
    }

    guides.visible = showGuide;
    if (showGuide) {
      const center = moving.center + moving.width / 2;
      const lane = moving.y + dropDistance + floorHeight * 0.42;
      const key = [center, lane, moving.range].join(':');
      if (key !== guideKey) {
        guideKey = key;
        const left = center - moving.range;
        const right = center + moving.range;
        guidePoints.array.set([left, lane, 46, right, lane, 46,
          center, moving.y, 46, center, lane - 6, 46]);
        guidePoints.needsUpdate = true;
        guides.computeLineDistances();
      }
    }

    for (let i = 0; i < Math.max(scraps.length, debris.length); i++) {
      const view = debris[i] ?? (debris[i] = makeFloor());
      const piece = scraps[i];
      view.model.visible = Boolean(piece);
      if (!piece) continue;
      const t = (now - piece.started) / 760;
      fitFloor(view, piece, piece.y - 570 * t ** 2);
      view.model.position.x += piece.direction * 85 * t;
      view.model.rotation.z = reduced ? 0 : -piece.direction * t;
      view.model.rotation.y = reduced ? 0 : piece.direction * t * 0.75;
    }

    drawEffects(effect, now, reduced);
    renderer.render(scene, camera);
  }

  return { render };
}

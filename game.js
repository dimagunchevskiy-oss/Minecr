// MAP3D Builder — game.js
// Full 3D builder + player mode, offline PWA

'use strict';

// ═══════════════════════════════════════════
// GLOBALS
// ═══════════════════════════════════════════
let renderer, scene, camera, raycaster, clock;
let objects = [];           // все объекты на сцене
let selectedObj = null;
let currentShape = 'box';
let currentColor = '#4a7fff';
let currentTool = 'add';
let currentMapId = null;
let history = [];           // для undo

// Камера редактора
let camDist = 12, camTheta = 0.7, camPhi = 1.1;
let camTarget = new THREE.Vector3(0, 0, 0);
let isDraggingCam = false, lastTouch = null;
let pointers = {};

// Игровой режим
let isPlaying = false;
let player, playerVel = new THREE.Vector3();
let playerOnGround = false;
let joystickActive = false, joystickDelta = {x:0, y:0};
let jBaseRect;
let camYaw = 0, camPitch = 0.3;
let lookTouchId = null, lookStart = {x:0, y:0};
let isRunning = false;

// ═══════════════════════════════════════════
// INIT THREE.JS
// ═══════════════════════════════════════════
function initThree() {
  const canvas = document.getElementById('c');

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x05050f);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05050f, 0.04);

  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
  raycaster = new THREE.Raycaster();
  clock = new THREE.Clock();

  // Свет
  const ambient = new THREE.AmbientLight(0x334466, 0.8);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(10, 20, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = 100;
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x4466ff, 0.3);
  fill.position.set(-5, 5, -10);
  scene.add(fill);

  // Земля (плоскость)
  addGround();

  // Сетка
  addGrid();

  // Старт
  resize();
  requestAnimationFrame(loop);
}

function addGround() {
  const geo = new THREE.PlaneGeometry(100, 100);
  const mat = new THREE.MeshLambertMaterial({ color: 0x0a0e1a });
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  ground.userData.isGround = true;
  scene.add(ground);
}

function addGrid() {
  const grid = new THREE.GridHelper(60, 60, 0x1a2240, 0x0d1530);
  grid.userData.isHelper = true;
  scene.add(grid);
}

// ═══════════════════════════════════════════
// RESIZE
// ═══════════════════════════════════════════
function resize() {
  const bottomH = document.getElementById('bottom-bar').offsetHeight;
  const topH = document.getElementById('top-bar').offsetHeight;
  const canvas = document.getElementById('c');
  const W = window.innerWidth;
  const H = window.innerHeight - topH - bottomH;
  canvas.style.marginTop = topH + 'px';
  canvas.style.height = H + 'px';
  renderer.setSize(W, H);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', resize);

// ═══════════════════════════════════════════
// ГЛАВНЫЙ ЦИКЛ
// ═══════════════════════════════════════════
function loop() {
  requestAnimationFrame(loop);
  const dt = clock.getDelta();

  if (isPlaying) {
    updatePlayer(dt);
  } else {
    updateEditorCamera();
  }

  // Пульс выбранного объекта
  if (selectedObj && !isPlaying) {
    selectedObj.material.emissive.setHex(
      0x222244 + Math.floor(Math.sin(Date.now() * 0.003) * 0x111111)
    );
  }

  renderer.render(scene, camera);
}

// ═══════════════════════════════════════════
// КАМЕРА РЕДАКТОРА
// ═══════════════════════════════════════════
function updateEditorCamera() {
  const x = camTarget.x + camDist * Math.sin(camPhi) * Math.sin(camTheta);
  const y = camTarget.y + camDist * Math.cos(camPhi);
  const z = camTarget.z + camDist * Math.sin(camPhi) * Math.cos(camTheta);
  camera.position.set(x, y, z);
  camera.lookAt(camTarget);
}

// ═══════════════════════════════════════════
// TOUCH / MOUSE — РЕДАКТОР
// ═══════════════════════════════════════════
const canvas = document.getElementById('c');

canvas.addEventListener('touchstart', onTouchStart, { passive: false });
canvas.addEventListener('touchmove', onTouchMove, { passive: false });
canvas.addEventListener('touchend', onTouchEnd, { passive: false });
canvas.addEventListener('click', onCanvasClick);

let pinchStartDist = 0;
let touchMoved = false;
let touchStartPos = {x:0, y:0};

function onTouchStart(e) {
  e.preventDefault();
  touchMoved = false;

  if (e.touches.length === 1) {
    const t = e.touches[0];
    touchStartPos = {x: t.clientX, y: t.clientY};
    lastTouch = {x: t.clientX, y: t.clientY};
    isDraggingCam = true;
    pointers[t.identifier] = {x: t.clientX, y: t.clientY};
  } else if (e.touches.length === 2) {
    isDraggingCam = false;
    const a = e.touches[0], b = e.touches[1];
    pinchStartDist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    pointers[a.identifier] = {x: a.clientX, y: a.clientY};
    pointers[b.identifier] = {x: b.clientX, y: b.clientY};
  }
}

function onTouchMove(e) {
  e.preventDefault();
  if (e.touches.length === 1) {
    const t = e.touches[0];
    const dx = t.clientX - lastTouch.x;
    const dy = t.clientY - lastTouch.y;
    if (Math.abs(t.clientX - touchStartPos.x) > 5 || Math.abs(t.clientY - touchStartPos.y) > 5) {
      touchMoved = true;
    }
    if (isDraggingCam) {
      camTheta -= dx * 0.012;
      camPhi = Math.max(0.15, Math.min(Math.PI * 0.85, camPhi + dy * 0.012));
    }
    lastTouch = {x: t.clientX, y: t.clientY};
  } else if (e.touches.length === 2) {
    const a = e.touches[0], b = e.touches[1];
    const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    const delta = pinchStartDist - dist;
    camDist = Math.max(2, Math.min(40, camDist + delta * 0.04));
    pinchStartDist = dist;
    touchMoved = true;
  }
}

function onTouchEnd(e) {
  isDraggingCam = false;
  for (let t of e.changedTouches) delete pointers[t.identifier];
}

function onCanvasClick(e) {
  if (touchMoved) return;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  handleCanvasInteraction(x, y);
}

function handleCanvasInteraction(nx, ny) {
  raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);

  if (currentTool === 'add') {
    // Найти точку на земле или объекте
    const hits = raycaster.intersectObjects(
      scene.children.filter(o => o.userData.isGround || objects.includes(o))
    );
    if (hits.length > 0) {
      const pt = hits[0].point;
      // Snap to grid
      const sx = Math.round(pt.x), sz = Math.round(pt.z);
      const size = getCurrentSize();
      addObject(currentShape, sx, pt.y + size.y / 2 + 0.01, sz, currentColor, size);
    }
  } else if (currentTool === 'select' || currentTool === 'move') {
    const hits = raycaster.intersectObjects(objects);
    if (hits.length > 0) {
      selectObject(hits[0].object);
    } else {
      deselectObject();
    }
  } else if (currentTool === 'delete') {
    const hits = raycaster.intersectObjects(objects);
    if (hits.length > 0) {
      removeObject(hits[0].object);
    }
  }
}

// ═══════════════════════════════════════════
// ДОБАВЛЕНИЕ ОБЪЕКТОВ
// ═══════════════════════════════════════════
function addObject(shape, x, y, z, color, size, fromHistory = false) {
  let geo;
  const w = size.x, h = size.y, d = size.z;

  switch(shape) {
    case 'box':
      geo = new THREE.BoxGeometry(w, h, d); break;
    case 'sphere':
      geo = new THREE.SphereGeometry(w/2, 16, 12); break;
    case 'cylinder':
      geo = new THREE.CylinderGeometry(w/2, w/2, h, 16); break;
    case 'cone':
      geo = new THREE.ConeGeometry(w/2, h, 16); break;
    case 'ramp':
      geo = buildRampGeo(w, h, d); break;
    case 'torus':
      geo = new THREE.TorusGeometry(w/2, w/6, 8, 24); break;
    default:
      geo = new THREE.BoxGeometry(w, h, d);
  }

  const mat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(0x000000)
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { shape, color, size: {...size} };
  scene.add(mesh);
  objects.push(mesh);

  if (!fromHistory) {
    history.push({ type: 'add', obj: mesh });
  }
  return mesh;
}

function buildRampGeo(w, h, d) {
  // Треугольная призма (пандус)
  const geo = new THREE.BufferGeometry();
  const v = new Float32Array([
    // передняя грань
    -w/2, 0, d/2,   w/2, 0, d/2,   w/2, h, d/2,   -w/2, h, d/2,
    // задняя грань
    -w/2, 0, -d/2,  w/2, 0, -d/2,  w/2, 0, -d/2,  -w/2, 0, -d/2,
    // низ
    -w/2, 0, d/2,   w/2, 0, d/2,   w/2, 0, -d/2,  -w/2, 0, -d/2,
    // наклонный верх
    -w/2, h, d/2,   w/2, h, d/2,   w/2, 0, -d/2,  -w/2, 0, -d/2,
    // лев
    -w/2, 0, d/2,   -w/2, h, d/2,  -w/2, 0, -d/2,
    // прав
    w/2, 0, d/2,    w/2, h, d/2,   w/2, 0, -d/2,
  ]);
  const idx = new Uint16Array([
    0,1,2, 0,2,3,
    4,6,5, 4,7,6,
    8,9,10, 8,10,11,
    12,13,14, 12,14,15,
    16,17,18,
    19,21,20
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  return geo;
}

function getCurrentSize() {
  return {
    x: parseFloat(document.getElementById('slW').value),
    y: parseFloat(document.getElementById('slH').value),
    z: parseFloat(document.getElementById('slD').value),
  };
}

// ═══════════════════════════════════════════
// ВЫБОР / УДАЛЕНИЕ
// ═══════════════════════════════════════════
function selectObject(obj) {
  if (selectedObj) deselectObject();
  selectedObj = obj;
  obj.material.emissive.setHex(0x222244);

  // Обновить слайдеры
  const s = obj.userData.size;
  if (s) {
    document.getElementById('slW').value = s.x;
    document.getElementById('slH').value = s.y;
    document.getElementById('slD').value = s.z;
    updateSizeLabels();
  }
  showToast('Выбрано: ' + obj.userData.shape);
}

function deselectObject() {
  if (selectedObj) {
    selectedObj.material.emissive.setHex(0x000000);
    selectedObj = null;
  }
}

function removeObject(obj) {
  history.push({ type: 'remove', obj, pos: obj.position.clone(), userData: {...obj.userData} });
  scene.remove(obj);
  objects = objects.filter(o => o !== obj);
  if (selectedObj === obj) selectedObj = null;
  showToast('Удалено');
}

function deleteSelected() {
  if (selectedObj) removeObject(selectedObj);
  else showToast('Ничего не выбрано');
}

function undoAction() {
  if (history.length === 0) { showToast('Нечего отменять'); return; }
  const last = history.pop();
  if (last.type === 'add') {
    scene.remove(last.obj);
    objects = objects.filter(o => o !== last.obj);
    if (selectedObj === last.obj) selectedObj = null;
  } else if (last.type === 'remove') {
    scene.add(last.obj);
    objects.push(last.obj);
  }
  showToast('Отменено');
}

function clearMap() {
  for (const o of objects) scene.remove(o);
  objects = [];
  history = [];
  selectedObj = null;
  hideMenu();
  showToast('Карта очищена');
}

// ═══════════════════════════════════════════
// DRAG / MOVE объектов (пальцем)
// ═══════════════════════════════════════════
let isDraggingObj = false, dragPlane, dragOffset;

canvas.addEventListener('touchstart', (e) => {
  if (isPlaying) return;
  if (currentTool !== 'move' || !selectedObj) return;
  e.preventDefault();
  const t = e.touches[0];
  const rect = canvas.getBoundingClientRect();
  const nx = ((t.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((t.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const hits = raycaster.intersectObject(selectedObj);
  if (hits.length > 0) {
    isDraggingObj = true;
    dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -selectedObj.position.y);
    dragOffset = new THREE.Vector3();
    const pt = new THREE.Vector3();
    raycaster.ray.intersectPlane(dragPlane, pt);
    dragOffset.subVectors(selectedObj.position, pt);
    isDraggingCam = false;
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  if (!isDraggingObj || !selectedObj) return;
  e.preventDefault();
  const t = e.touches[0];
  const rect = canvas.getBoundingClientRect();
  const nx = ((t.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((t.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const pt = new THREE.Vector3();
  raycaster.ray.intersectPlane(dragPlane, pt);
  if (pt) {
    selectedObj.position.x = Math.round(pt.x + dragOffset.x);
    selectedObj.position.z = Math.round(pt.z + dragOffset.z);
  }
}, { passive: false });

canvas.addEventListener('touchend', () => { isDraggingObj = false; });

// ═══════════════════════════════════════════
// UI — Tabs, Shape, Color, Size, Tool
// ═══════════════════════════════════════════
function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t,i) => {
    const names = ['shapes','colors','size','tools'];
    t.classList.toggle('active', names[i] === name);
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  resize();
}

function selectShape(s) {
  currentShape = s;
  document.querySelectorAll('[id^=shape-]').forEach(b => b.classList.remove('active'));
  document.getElementById('shape-' + s)?.classList.add('active');
}

function selectColor(c) {
  currentColor = c;
  document.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.c === c);
  });
  if (selectedObj) {
    selectedObj.material.color.set(c);
    selectedObj.userData.color = c;
  }
}

function selectTool(t) {
  currentTool = t;
  document.querySelectorAll('[id^=tool-]').forEach(b => b.classList.remove('active'));
  document.getElementById('tool-' + t)?.classList.add('active');
  showToast({add:'Режим: добавить', select:'Режим: выбрать', move:'Режим: двигать', delete:'Режим: удалить'}[t]);
}

function updateSize() {
  updateSizeLabels();
  if (selectedObj) {
    // Перестроить геометрию
    const s = getCurrentSize();
    const pos = selectedObj.position.clone();
    const col = selectedObj.userData.color;
    const sh = selectedObj.userData.shape;
    const idx = objects.indexOf(selectedObj);
    scene.remove(selectedObj);
    objects.splice(idx, 1);
    selectedObj = null;
    const newObj = addObject(sh, pos.x, pos.y, pos.z, col, s, true);
    selectObject(newObj);
    history.push({ type: 'add', obj: newObj });
  }
}

function updateSizeLabels() {
  document.getElementById('vW').textContent = parseFloat(document.getElementById('slW').value).toFixed(1);
  document.getElementById('vH').textContent = parseFloat(document.getElementById('slH').value).toFixed(1);
  document.getElementById('vD').textContent = parseFloat(document.getElementById('slD').value).toFixed(1);
}

// ═══════════════════════════════════════════
// ИГРОВОЙ РЕЖИМ
// ═══════════════════════════════════════════
function playMode() {
  isPlaying = true;
  deselectObject();

  // Показать HUD
  document.getElementById('play-hud').classList.add('active');
  document.getElementById('joystick-zone').classList.add('active');
  document.getElementById('action-btns').classList.add('active');
  document.getElementById('play-overlay').classList.add('active');
  document.getElementById('top-bar').style.display = 'none';
  document.getElementById('bottom-bar').style.display = 'none';

  // Создать игрока
  const pGeo = new THREE.CapsuleGeometry(0.3, 0.7, 4, 8);
  const pMat = new THREE.MeshLambertMaterial({ color: 0x4aff9f, emissive: 0x1a4422 });
  player = new THREE.Mesh(pGeo, pMat);
  player.position.set(0, 1.5, 0);
  player.castShadow = true;
  scene.add(player);
  playerVel.set(0, 0, 0);
  playerOnGround = false;
  camYaw = 0; camPitch = 0.3;

  // Джойстик
  setupJoystick();
  setupLookTouch();

  showToast('▶ Начали!');
}

function stopPlay() {
  isPlaying = false;
  if (player) { scene.remove(player); player = null; }
  document.getElementById('play-hud').classList.remove('active');
  document.getElementById('joystick-zone').classList.remove('active');
  document.getElementById('action-btns').classList.remove('active');
  document.getElementById('play-overlay').classList.remove('active');
  document.getElementById('top-bar').style.display = '';
  document.getElementById('bottom-bar').style.display = '';
  resize();
}

// ── Физика игрока
function updatePlayer(dt) {
  if (!player) return;
  const speed = isRunning ? 8 : 4;
  const GRAVITY = -18;
  const JUMP = 7;

  // Джойстик → направление
  let dx = joystickDelta.x * speed;
  let dz = joystickDelta.y * speed;

  // Повернуть по направлению камеры
  const cos = Math.cos(camYaw), sin = Math.sin(camYaw);
  const mx = cos * dx - sin * dz;
  const mz = sin * dx + cos * dz;

  player.position.x += mx * dt;
  player.position.z += mz * dt;

  // Гравитация
  playerVel.y += GRAVITY * dt;
  player.position.y += playerVel.y * dt;

  // Проверка земли и объектов
  playerOnGround = false;
  const pbb = new THREE.Box3().setFromObject(player);

  // Земля
  if (player.position.y < 1.0) {
    player.position.y = 1.0;
    playerVel.y = 0;
    playerOnGround = true;
  }

  // Коллизии с объектами
  for (const obj of objects) {
    const obb = new THREE.Box3().setFromObject(obj);
    const expanded = obb.clone().expandByScalar(0.15);
    if (pbb.intersectsBox(expanded)) {
      // Простая коллизия — отталкивание по Y
      const playerBottom = player.position.y - 0.95;
      const objTop = obb.max.y;
      const playerTop = player.position.y + 0.65;
      const objBottom = obb.min.y;

      if (playerBottom < objTop && playerTop > objBottom) {
        const overlapY = objTop - playerBottom;
        if (overlapY < 1.2 && playerVel.y <= 0) {
          player.position.y = objTop + 0.95;
          playerVel.y = 0;
          playerOnGround = true;
        } else {
          // Боковое отталкивание
          const cx = (pbb.min.x + pbb.max.x) / 2;
          const cz = (pbb.min.z + pbb.max.z) / 2;
          const ox = (obb.min.x + obb.max.x) / 2;
          const oz = (obb.min.z + obb.max.z) / 2;
          const pushX = cx - ox, pushZ = cz - oz;
          const len = Math.sqrt(pushX*pushX + pushZ*pushZ) || 1;
          player.position.x += (pushX / len) * 0.1;
          player.position.z += (pushZ / len) * 0.1;
        }
      }
    }
  }

  // Камера за игроком
  const camX = player.position.x + Math.sin(camYaw) * Math.cos(camPitch) * 6;
  const camY = player.position.y + Math.sin(camPitch) * 6 + 1;
  const camZ = player.position.z + Math.cos(camYaw) * Math.cos(camPitch) * 6;
  camera.position.set(camX, camY, camZ);
  camera.lookAt(player.position.x, player.position.y + 0.5, player.position.z);

  // HUD позиции
  const p = player.position;
  document.getElementById('playerPos').textContent =
    `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;

  // Поворот игрока по движению
  if (Math.abs(mx) > 0.01 || Math.abs(mz) > 0.01) {
    player.rotation.y = Math.atan2(mx, mz);
  }
}

function doJump() {
  if (playerOnGround) {
    playerVel.y = 7;
    playerOnGround = false;
  }
}

// ── Джойстик
function setupJoystick() {
  const zone = document.getElementById('joystick-zone');
  const thumb = document.getElementById('jThumb');

  zone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    joystickActive = true;
    jBaseRect = document.getElementById('jBase').getBoundingClientRect();
  }, { passive: false });

  zone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!joystickActive) return;
    const t = e.touches[0];
    const cx = jBaseRect.left + jBaseRect.width / 2;
    const cy = jBaseRect.top + jBaseRect.height / 2;
    let dx = t.clientX - cx, dy = t.clientY - cy;
    const dist = Math.min(Math.sqrt(dx*dx + dy*dy), 40);
    const angle = Math.atan2(dy, dx);
    const nx = Math.cos(angle) * dist, ny = Math.sin(angle) * dist;
    thumb.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
    joystickDelta.x = dx / 40;
    joystickDelta.y = dy / 40;
    const len = Math.sqrt(joystickDelta.x**2 + joystickDelta.y**2);
    if (len > 1) { joystickDelta.x /= len; joystickDelta.y /= len; }
  }, { passive: false });

  zone.addEventListener('touchend', () => {
    joystickActive = false;
    joystickDelta.x = 0; joystickDelta.y = 0;
    thumb.style.transform = 'translate(-50%, -50%)';
  });
}

// ── Взгляд (правая сторона экрана)
function setupLookTouch() {
  const overlay = document.getElementById('play-overlay');
  overlay.addEventListener('touchstart', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.clientX > window.innerWidth / 2 && lookTouchId === null) {
        lookTouchId = t.identifier;
        lookStart.x = t.clientX; lookStart.y = t.clientY;
      }
    }
  }, { passive: false });

  overlay.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === lookTouchId) {
        const dx = t.clientX - lookStart.x;
        const dy = t.clientY - lookStart.y;
        camYaw -= dx * 0.006;
        camPitch = Math.max(0.1, Math.min(1.2, camPitch + dy * 0.006));
        lookStart.x = t.clientX; lookStart.y = t.clientY;
      }
    }
  }, { passive: false });

  overlay.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === lookTouchId) lookTouchId = null;
    }
  });
}

document.getElementById('btn-run').addEventListener('touchstart', () => { isRunning = true; });
document.getElementById('btn-run').addEventListener('touchend', () => { isRunning = false; });

// ═══════════════════════════════════════════
// СОХРАНЕНИЕ / ЗАГРУЗКА
// ═══════════════════════════════════════════
function mapToJSON() {
  return {
    name: document.getElementById('mapName').value,
    version: 1,
    objects: objects.map(o => ({
      shape: o.userData.shape,
      color: o.userData.color,
      size: o.userData.size,
      pos: { x: o.position.x, y: o.position.y, z: o.position.z },
      rot: { x: o.rotation.x, y: o.rotation.y, z: o.rotation.z },
    }))
  };
}

function loadFromJSON(data) {
  for (const o of objects) scene.remove(o);
  objects = []; history = []; selectedObj = null;
  document.getElementById('mapName').value = data.name || 'Карта';
  for (const obj of (data.objects || [])) {
    addObject(obj.shape, obj.pos.x, obj.pos.y, obj.pos.z, obj.color, obj.size, true);
    if (obj.rot) {
      const last = objects[objects.length - 1];
      last.rotation.set(obj.rot.x, obj.rot.y, obj.rot.z);
    }
  }
}

function saveMap() {
  const data = mapToJSON();
  const id = currentMapId || ('map_' + Date.now());
  currentMapId = id;
  localStorage.setItem('map3d_' + id, JSON.stringify(data));
  // Индекс карт
  let index = JSON.parse(localStorage.getItem('map3d_index') || '[]');
  if (!index.includes(id)) index.push(id);
  localStorage.setItem('map3d_index', JSON.stringify(index));
  localStorage.setItem('map3d_last', id);
  hideMenu();
  showToast('💾 Сохранено!');
}

function loadSavedMap(id) {
  const raw = localStorage.getItem('map3d_' + id);
  if (!raw) return;
  currentMapId = id;
  loadFromJSON(JSON.parse(raw));
  showEditor();
}

function exportMap() {
  const data = JSON.stringify(mapToJSON(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (document.getElementById('mapName').value || 'map') + '.json';
  a.click();
  URL.revokeObjectURL(url);
  hideMenu();
  showToast('📤 Экспортировано');
}

function importMapTrigger() {
  document.getElementById('importFile').click();
}

function importMap(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      loadFromJSON(data);
      hideMenu();
      showToast('📥 Импортировано');
    } catch { showToast('Ошибка импорта'); }
  };
  reader.readAsText(file);
}

// ═══════════════════════════════════════════
// НАВИГАЦИЯ ЭКРАНОВ
// ═══════════════════════════════════════════
function showSplash() {
  document.getElementById('splash').classList.remove('hidden');
  document.getElementById('editor').classList.add('hidden');

  // Загрузить список карт
  const index = JSON.parse(localStorage.getItem('map3d_index') || '[]');
  const sec = document.getElementById('saved-section');
  const list = document.getElementById('savedList');
  if (index.length > 0) {
    sec.style.display = 'flex';
    list.innerHTML = '';
    for (const id of index.slice().reverse()) {
      const raw = localStorage.getItem('map3d_' + id);
      if (!raw) continue;
      const d = JSON.parse(raw);
      const item = document.createElement('div');
      item.className = 'saved-map-item';
      item.innerHTML = `<span class="saved-map-name">${d.name || 'Карта'}</span><span class="saved-map-info">${(d.objects||[]).length} объектов</span>`;
      item.onclick = () => loadSavedMap(id);
      list.appendChild(item);
    }
  } else {
    sec.style.display = 'none';
  }
}

function showEditor() {
  document.getElementById('splash').classList.add('hidden');
  document.getElementById('editor').classList.remove('hidden');
  resize();
}

function newMap() {
  currentMapId = null;
  for (const o of objects) scene.remove(o);
  objects = []; history = []; selectedObj = null;
  document.getElementById('mapName').value = 'Моя карта';
  showEditor();
}

function goHome() {
  hideMenu();
  if (isPlaying) stopPlay();
  showSplash();
}

function showMenu() { document.getElementById('menu-overlay').classList.add('active'); }
function hideMenu() { document.getElementById('menu-overlay').classList.remove('active'); }

// ═══════════════════════════════════════════
// УТИЛИТЫ
// ═══════════════════════════════════════════
function showToast(msg, duration = 2000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), duration);
}

// Логотип на заставке
function buildLogo() {
  const grid = document.getElementById('logoGrid');
  const colors = ['#4a7fff','#ff4a7f','#4aff9f','#ffcc4a','#cc4aff','#ff6a4a','#4a7fff','#4aff9f',
                  '#ff4a7f','#4a7fff','#ffcc4a','#ff4a7f','#4aff9f','#cc4aff','#ff6a4a','#4a7fff'];
  colors.forEach((c, i) => {
    const d = document.createElement('div');
    d.style.cssText = `background:${c}; animation-delay:${i*0.12}s`;
    grid.appendChild(d);
  });
}

// ═══════════════════════════════════════════
// ЗАПУСК
// ═══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  buildLogo();
  initThree();
  showSplash();
  updateSizeLabels();

  // Добавить несколько демо-объектов
  setTimeout(() => {
    addObject('box', 0, 0.5, 0, '#4a7fff', {x:2, y:1, z:2}, true);
    addObject('box', 3, 0.5, 0, '#ff4a7f', {x:1, y:1, z:1}, true);
    addObject('sphere', -3, 0.5, 1, '#4aff9f', {x:1, y:1, z:1}, true);
    addObject('cylinder', 0, 1, -3, '#ffcc4a', {x:1, y:2, z:1}, true);
  }, 100);
});

// Регистрация Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(() => console.log('SW registered'))
      .catch(e => console.log('SW error:', e));
  });
}

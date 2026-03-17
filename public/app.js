const board = document.getElementById('board');
const boardContainer = document.getElementById('boardContainer');
const uploadForm = document.getElementById('uploadForm');
const imageInput = document.getElementById('imageInput');
const timelineSlider = document.getElementById('timelineSlider');
const timelineBlips = document.getElementById('timelineBlips');
const timelineLabel = document.getElementById('timelineLabel');
const modeToggle = document.getElementById('modeToggle');
const singleView = document.getElementById('singleView');
const singleImage = document.getElementById('singleImage');
const singleEmpty = document.getElementById('singleEmpty');

const GRID_SIZE = 40;
const historyUtils = window.PinboardHistory || {};

const state = {
  scale: 1,
  minScale: 0.2,
  maxScale: 4,
  x: window.innerWidth / 2,
  y: (window.innerHeight - 108) / 2,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  pointers: new Map(),
  pinchStartDistance: 0,
  pinchStartScale: 1,
  pinchCenter: { x: 0, y: 0 },
  pinchWorldStart: { x: 0, y: 0 },
  allPins: [],
  visibleCount: 0,
  mode: 'board',
  knownPinIds: new Set()
};

function clampVisibleCount(totalPins, nextCount) {
  if (historyUtils.clampVisibleCount) return historyUtils.clampVisibleCount(totalPins, nextCount);
  return Math.max(0, Math.min(totalPins, nextCount));
}

function timelineStatusLabel(visibleCount, totalPins) {
  if (historyUtils.timelineStatusLabel) return historyUtils.timelineStatusLabel(visibleCount, totalPins);
  return visibleCount === totalPins ? 'Latest' : `${visibleCount}/${totalPins} pinned`;
}

function latestPinAtOrBeforeCutoff(items, visibleCount) {
  if (historyUtils.latestPinAtOrBeforeCutoff) {
    return historyUtils.latestPinAtOrBeforeCutoff(items, visibleCount);
  }
  const clamped = clampVisibleCount(items.length, visibleCount);
  if (clamped === 0) return null;
  return items[clamped - 1] || null;
}

function syncBackgroundTransform() {
  boardContainer.style.backgroundPosition = `${state.x}px ${state.y}px`;
  const scaledGrid = Math.max(4, GRID_SIZE * state.scale);
  boardContainer.style.backgroundSize = `${scaledGrid}px ${scaledGrid}px`;
}

function applyTransform() {
  board.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
  syncBackgroundTransform();
}

function hashString(str = '') {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return Math.abs(h >>> 0);
}

function fallbackVariation(item) {
  const h = hashString(item.id || item.url || item.originalName || 'pin');
  const rotation = ((h % 161) / 10) - 8;
  const scale = 0.75 + ((h >> 8) % 71) / 100;
  return { rotation, scale };
}

function createPinNode(item) {
  const pin = document.createElement('div');
  pin.className = 'pin';
  pin.style.left = `${item.x}px`;
  pin.style.top = `${item.y}px`;

  const variation = fallbackVariation(item);
  const rotation = Number.isFinite(item.rotation) ? item.rotation : variation.rotation;
  const scale = Number.isFinite(item.scale) ? item.scale : variation.scale;
  pin.style.transform = `rotate(${rotation}deg) scale(${scale})`;

  const img = document.createElement('img');
  img.src = item.url;
  img.alt = item.originalName || 'Pinned image';
  img.loading = 'lazy';

  pin.appendChild(img);
  return pin;
}

function renderPins() {
  board.textContent = '';
  const visible = state.allPins.slice(0, state.visibleCount);
  visible.forEach((item) => board.appendChild(createPinNode(item)));
}

function renderSingleView() {
  const item = latestPinAtOrBeforeCutoff(state.allPins, state.visibleCount);
  if (!item) {
    singleImage.removeAttribute('src');
    singleImage.hidden = true;
    singleEmpty.hidden = false;
    return;
  }

  singleImage.src = item.url;
  singleImage.alt = item.originalName || 'Pinned image';
  singleImage.hidden = false;
  singleEmpty.hidden = true;
}

function renderTimeline() {
  if (!timelineSlider || !timelineBlips || !timelineLabel) return;

  const total = state.allPins.length;
  timelineSlider.max = String(total);
  timelineSlider.value = String(clampVisibleCount(total, state.visibleCount));

  timelineBlips.textContent = '';
  for (let i = 0; i < total; i++) {
    const blip = document.createElement('span');
    blip.className = `blip${i < state.visibleCount ? ' active' : ''}`;
    timelineBlips.appendChild(blip);
  }

  timelineLabel.textContent = timelineStatusLabel(state.visibleCount, total);
}

function applyModeUi() {
  const isSingle = state.mode === 'single';
  board.hidden = isSingle;
  singleView.hidden = !isSingle;
  modeToggle.setAttribute('aria-pressed', String(isSingle));
  modeToggle.classList.toggle('active', isSingle);
}

function setVisibleCount(nextCount) {
  const clamped = clampVisibleCount(state.allPins.length, nextCount);
  state.visibleCount = clamped;
  renderPins();
  renderSingleView();
  renderTimeline();
}

function addPinIfNew(item) {
  if (!item || !item.id || state.knownPinIds.has(item.id)) return false;
  state.knownPinIds.add(item.id);
  const wasAtLatest = state.visibleCount === state.allPins.length;
  state.allPins.push(item);
  setVisibleCount(wasAtLatest ? state.allPins.length : state.visibleCount);
  return true;
}

async function loadPins() {
  const res = await fetch('/api/images');
  const items = await res.json();
  state.allPins = [...items];
  state.knownPinIds = new Set(items.map((item) => item.id));
  setVisibleCount(state.allPins.length);
}

function connectRealtime() {
  if (!window.EventSource) return;
  const stream = new EventSource('/api/stream');

  stream.addEventListener('pin-created', (event) => {
    try {
      const item = JSON.parse(event.data);
      addPinIfNew(item);
    } catch {}
  });
}

function zoomAt(clientX, clientY, nextScale) {
  const rect = boardContainer.getBoundingClientRect();
  const cx = clientX - rect.left;
  const cy = clientY - rect.top;

  const worldX = (cx - state.x) / state.scale;
  const worldY = (cy - state.y) / state.scale;

  state.scale = nextScale;
  state.x = cx - worldX * state.scale;
  state.y = cy - worldY * state.scale;
  applyTransform();
}

boardContainer.addEventListener('pointerdown', (e) => {
  if (state.mode === 'single') return;
  boardContainer.setPointerCapture(e.pointerId);
  state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (state.pointers.size === 1) {
    state.dragging = true;
    state.dragStartX = e.clientX - state.x;
    state.dragStartY = e.clientY - state.y;
    boardContainer.classList.add('dragging');
  }

  if (state.pointers.size === 2) {
    const [p1, p2] = [...state.pointers.values()];
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    state.pinchStartDistance = Math.hypot(dx, dy) || 1;
    state.pinchStartScale = state.scale;

    const rect = boardContainer.getBoundingClientRect();
    const cx = (p1.x + p2.x) / 2 - rect.left;
    const cy = (p1.y + p2.y) / 2 - rect.top;
    state.pinchCenter = { x: cx, y: cy };
    state.pinchWorldStart = {
      x: (cx - state.x) / state.scale,
      y: (cy - state.y) / state.scale
    };

    state.dragging = false;
    boardContainer.classList.remove('dragging');
  }
});

boardContainer.addEventListener('pointermove', (e) => {
  if (state.mode === 'single') return;
  if (!state.pointers.has(e.pointerId)) return;
  state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (state.pointers.size === 1 && state.dragging) {
    state.x = e.clientX - state.dragStartX;
    state.y = e.clientY - state.dragStartY;
    applyTransform();
    return;
  }

  if (state.pointers.size === 2) {
    const [p1, p2] = [...state.pointers.values()];
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const distance = Math.hypot(dx, dy) || 1;

    const nextScale = Math.min(
      state.maxScale,
      Math.max(state.minScale, state.pinchStartScale * (distance / state.pinchStartDistance))
    );

    state.scale = nextScale;
    state.x = state.pinchCenter.x - state.pinchWorldStart.x * state.scale;
    state.y = state.pinchCenter.y - state.pinchWorldStart.y * state.scale;
    applyTransform();
  }
});

function endPointer(pointerId) {
  state.pointers.delete(pointerId);

  if (state.pointers.size < 2) state.pinchStartDistance = 0;

  if (state.pointers.size === 0) {
    state.dragging = false;
    boardContainer.classList.remove('dragging');
  }
}

boardContainer.addEventListener('pointerup', (e) => endPointer(e.pointerId));
boardContainer.addEventListener('pointercancel', (e) => endPointer(e.pointerId));

boardContainer.addEventListener('wheel', (e) => {
  if (state.mode === 'single') return;
  e.preventDefault();
  const delta = -e.deltaY;
  const zoomIntensity = 0.001;
  const nextScale = Math.min(
    state.maxScale,
    Math.max(state.minScale, state.scale * (1 + delta * zoomIntensity))
  );
  zoomAt(e.clientX, e.clientY, nextScale);
}, { passive: false });

timelineSlider.addEventListener('input', () => {
  setVisibleCount(Number(timelineSlider.value));
});

modeToggle.addEventListener('click', () => {
  state.mode = state.mode === 'board' ? 'single' : 'board';
  applyModeUi();
  renderSingleView();
});

uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = imageInput.files[0];
  if (!file) return;

  const fd = new FormData();
  fd.append('image', file);

  const res = await fetch('/api/images', {
    method: 'POST',
    body: fd
  });

  if (!res.ok) {
    alert('Upload failed');
    return;
  }

  const item = await res.json();
  addPinIfNew(item);
  uploadForm.reset();
});

window.addEventListener('resize', () => {
  applyTransform();
});

async function initialize() {
  applyTransform();
  applyModeUi();
  try {
    await loadPins();
  } finally {
    connectRealtime();
  }
}

initialize();

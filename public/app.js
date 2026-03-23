const board = document.getElementById('board');
const boardContainer = document.getElementById('boardContainer');
const timelineSlider = document.getElementById('timelineSlider');
const timelineBlips = document.getElementById('timelineBlips');
const timelineRuler = document.getElementById('timelineRuler');
const timelinePlayhead = document.getElementById('timelinePlayhead');
const timelineLane = timelinePlayhead?.parentElement || null;
const timelineLabel = document.getElementById('timelineLabel');
const timelineToStart = document.getElementById('timelineToStart');
const timelineStepBack = document.getElementById('timelineStepBack');
const timelineStepForward = document.getElementById('timelineStepForward');
const timelineToEnd = document.getElementById('timelineToEnd');
const settingsButton = document.getElementById('settingsButton');
const settingsMenu = document.getElementById('settingsMenu');
const menuUpload = document.getElementById('menuUpload');
const modeToggle = document.getElementById('modeToggle');
const themeToggle = document.getElementById('themeToggle');
const singleView = document.getElementById('singleView');
const singleImage = document.getElementById('singleImage');
const singleEmpty = document.getElementById('singleEmpty');
const imageModal = document.getElementById('imageModal');
const imageModalImage = document.getElementById('imageModalImage');
const imageModalClose = document.getElementById('imageModalClose');

const GRID_SIZE = 40;
const historyUtils = window.PinboardHistory || {};

const state = {
  scale: 1,
  minScale: 0.2,
  maxScale: 4,
  x: window.innerWidth / 2,
  y: (window.innerHeight - 126) / 2,
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
  knownPinIds: new Set(),
  sliderDragging: false,
  timelineBlipNodes: [],
  timelineRenderScheduled: false,
  pendingVisibleCount: null,
  timelineDragging: false,
  timelinePointerId: null,
  menuOpen: false,
  theme: window.localStorage.getItem('pinboard-theme') || 'dark',
  modalPinId: null,
  pinDrag: null,
  positionPersistTimers: new Map()
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

function updateLocalPinPosition(id, x, y) {
  const item = state.allPins.find((entry) => entry.id === id);
  if (!item) return;
  item.x = x;
  item.y = y;
}

async function persistPinPosition(id, x, y) {
  try {
    const res = await fetch(`/api/images/${encodeURIComponent(id)}/position`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y })
    });

    if (!res.ok) return;
    const updated = await res.json();
    updateLocalPinPosition(updated.id, updated.x, updated.y);
  } catch {}
}

function schedulePinPositionPersist(id, x, y) {
  const prev = state.positionPersistTimers.get(id);
  if (prev) window.clearTimeout(prev);

  const timer = window.setTimeout(() => {
    state.positionPersistTimers.delete(id);
    persistPinPosition(id, x, y);
  }, 150);

  state.positionPersistTimers.set(id, timer);
}

function createPinNode(item) {
  const pin = document.createElement('div');
  pin.className = 'pin';
  pin.dataset.pinId = item.id;
  pin.style.left = `${item.x}px`;
  pin.style.top = `${item.y}px`;
  pin.style.touchAction = 'none';

  const variation = fallbackVariation(item);
  const rotation = Number.isFinite(item.rotation) ? item.rotation : variation.rotation;
  const scale = Number.isFinite(item.scale) ? item.scale : variation.scale;
  pin.style.transform = `rotate(${rotation}deg) scale(${scale})`;

  const img = document.createElement('img');
  img.src = item.url;
  img.alt = item.originalName || 'Pinned image';
  img.loading = 'lazy';

  pin.appendChild(img);

  pin.addEventListener('pointerdown', (e) => {
    if (state.mode === 'single') return;
    if (e.button !== 0) return;
    if (state.pinDrag || state.pointers.size > 0) return;

    e.preventDefault();
    e.stopPropagation();
    pin.setPointerCapture(e.pointerId);

    state.pinDrag = {
      pointerId: e.pointerId,
      id: item.id,
      offsetX: e.clientX - Number.parseFloat(pin.style.left || '0'),
      offsetY: e.clientY - Number.parseFloat(pin.style.top || '0')
    };

    boardContainer.classList.add('dragging');
  });

  pin.addEventListener('pointermove', (e) => {
    if (!state.pinDrag || state.pinDrag.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();

    const nextX = Math.round(e.clientX - state.pinDrag.offsetX);
    const nextY = Math.round(e.clientY - state.pinDrag.offsetY);
    pin.style.left = `${nextX}px`;
    pin.style.top = `${nextY}px`;
    updateLocalPinPosition(item.id, nextX, nextY);
  });

  const finishPinDrag = (e) => {
    if (!state.pinDrag || state.pinDrag.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();

    const finalX = Number.parseFloat(pin.style.left || '0');
    const finalY = Number.parseFloat(pin.style.top || '0');
    schedulePinPositionPersist(item.id, finalX, finalY);

    state.pinDrag = null;
    boardContainer.classList.remove('dragging');
  };

  pin.addEventListener('pointerup', finishPinDrag);
  pin.addEventListener('pointercancel', finishPinDrag);

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

function ensureTimelineBlips(total) {
  if (state.timelineBlipNodes.length === total) return;

  timelineBlips.textContent = '';
  state.timelineBlipNodes = [];

  for (let i = 0; i < total; i++) {
    const blip = document.createElement('span');
    blip.className = 'blip';
    state.timelineBlipNodes.push(blip);
    timelineBlips.appendChild(blip);
  }
}

function renderTimelineRuler(total) {
  if (!timelineRuler) return;
  timelineRuler.textContent = '';

  if (total <= 1) {
    const only = document.createElement('span');
    only.className = 'ruler-tick major';
    timelineRuler.appendChild(only);
    return;
  }

  const tickCount = Math.max(8, Math.min(24, total + 1));
  for (let i = 0; i < tickCount; i++) {
    const tick = document.createElement('span');
    tick.className = i % 4 === 0 ? 'ruler-tick major' : 'ruler-tick minor';
    timelineRuler.appendChild(tick);
  }
}

function updateTimelinePlayhead(clampedVisible, total) {
  if (!timelinePlayhead) return;

  const lane = timelinePlayhead.parentElement;
  const laneWidth = lane ? lane.clientWidth : 0;
  const inset = 10;
  const usableWidth = Math.max(0, laneWidth - inset * 2);

  if (total <= 0 || usableWidth <= 0) {
    timelinePlayhead.style.left = `${inset}px`;
    return;
  }

  const ratio = Math.max(0, Math.min(1, clampedVisible / total));
  const x = inset + usableWidth * ratio;
  timelinePlayhead.style.left = `${x}px`;
}

function timelineClientXToVisibleCount(clientX) {
  if (!timelineLane) return state.visibleCount;
  const rect = timelineLane.getBoundingClientRect();
  const inset = 10;
  const usableWidth = Math.max(1, rect.width - inset * 2);
  const x = Math.max(inset, Math.min(rect.width - inset, clientX - rect.left));
  const ratio = (x - inset) / usableWidth;
  return Math.round(ratio * state.allPins.length);
}

function updateTimelineFromPointer(clientX) {
  setVisibleCount(timelineClientXToVisibleCount(clientX));
}

function renderTimeline() {
  if (!timelineSlider || !timelineBlips || !timelineLabel) return;

  const total = state.allPins.length;
  const clampedVisible = clampVisibleCount(total, state.visibleCount);

  timelineSlider.max = String(total);
  if (!state.sliderDragging || document.activeElement !== timelineSlider) {
    if (timelineSlider.value !== String(clampedVisible)) {
      timelineSlider.value = String(clampedVisible);
    }
  }

  renderTimelineRuler(total);
  ensureTimelineBlips(total);
  for (let i = 0; i < state.timelineBlipNodes.length; i++) {
    state.timelineBlipNodes[i].classList.toggle('active', i < clampedVisible);
  }

  updateTimelinePlayhead(clampedVisible, total);
  timelineLabel.textContent = timelineStatusLabel(clampedVisible, total);

  if (timelineToStart) timelineToStart.disabled = clampedVisible <= 0;
  if (timelineStepBack) timelineStepBack.disabled = clampedVisible <= 0;
  if (timelineStepForward) timelineStepForward.disabled = clampedVisible >= total;
  if (timelineToEnd) timelineToEnd.disabled = clampedVisible >= total;
}

function applyModeUi() {
  const isSingle = state.mode === 'single';
  board.hidden = isSingle;
  singleView.hidden = !isSingle;
  modeToggle.textContent = isSingle ? 'Switch to board mode' : 'Switch to single mode';
}

function applyThemeUi() {
  document.body.dataset.theme = state.theme;
  themeToggle.textContent = state.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}

function closeImageModal() {
  if (!imageModal || imageModal.hidden) return;
  imageModal.hidden = true;
  state.modalPinId = null;
  imageModalImage?.removeAttribute('src');
  imageModalImage?.removeAttribute('alt');
}

function openImageModal(item) {
  if (!item || !imageModal || !imageModalImage) return;
  imageModalImage.src = item.url;
  imageModalImage.alt = item.originalName || 'Pinned image preview';
  imageModal.hidden = false;
  state.modalPinId = item.id || null;
}

function closeMenu() {
  state.menuOpen = false;
  settingsButton.setAttribute('aria-expanded', 'false');
  settingsMenu.hidden = true;
}

function openMenu() {
  state.menuOpen = true;
  settingsButton.setAttribute('aria-expanded', 'true');
  settingsMenu.hidden = false;
}

function toggleMenu() {
  if (state.menuOpen) {
    closeMenu();
  } else {
    openMenu();
  }
}

function commitVisibleCount(nextCount) {
  const clamped = clampVisibleCount(state.allPins.length, nextCount);
  if (clamped === state.visibleCount) {
    renderTimeline();
    return;
  }

  state.visibleCount = clamped;
  renderPins();
  renderSingleView();
  renderTimeline();
}

function setVisibleCount(nextCount) {
  state.pendingVisibleCount = nextCount;

  if (state.timelineRenderScheduled) return;
  state.timelineRenderScheduled = true;

  window.requestAnimationFrame(() => {
    state.timelineRenderScheduled = false;
    const pending = state.pendingVisibleCount;
    state.pendingVisibleCount = null;
    commitVisibleCount(pending);
  });
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

async function addImageFromUrl() {
  const imageUrl = window.prompt('Enter an image URL to pin');
  if (!imageUrl) return;

  const promptText = window.prompt('Optional prompt or notes for this image')?.trim();
  const body = { imageUrl };
  if (promptText) body.prompt = promptText;

  const res = await fetch('/api/images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    alert(payload?.error || 'Pin failed');
    return;
  }

  const item = await res.json();
  addPinIfNew(item);
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

  stream.addEventListener('pin-updated', (event) => {
    try {
      const item = JSON.parse(event.data);
      updateLocalPinPosition(item.id, item.x, item.y);
      if (state.mode === 'board') renderPins();
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
  if (state.pinDrag) return;
  if (e.target.closest('.pin')) return;
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
  if (state.pinDrag) return;
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

timelineSlider.addEventListener('pointerdown', () => {
  state.sliderDragging = true;
});

function finishSliderDrag() {
  if (!state.sliderDragging) return;
  state.sliderDragging = false;
  renderTimeline();
}

function stopTimelinePointerDrag() {
  if (!state.timelineDragging) return;
  state.timelineDragging = false;
  state.timelinePointerId = null;
  timelineLane?.classList.remove('dragging-playhead');
  renderTimeline();
}

timelineSlider.addEventListener('pointerup', finishSliderDrag);
timelineSlider.addEventListener('pointercancel', finishSliderDrag);
timelineSlider.addEventListener('blur', finishSliderDrag);

timelineSlider.addEventListener('input', () => {
  setVisibleCount(Number(timelineSlider.value));
});

timelineSlider.addEventListener('change', () => {
  setVisibleCount(Number(timelineSlider.value));
});

timelineLane?.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (e.target === timelineSlider) return;
  state.timelineDragging = true;
  state.timelinePointerId = e.pointerId;
  timelineLane.setPointerCapture(e.pointerId);
  timelineLane.classList.add('dragging-playhead');
  updateTimelineFromPointer(e.clientX);
  timelineSlider.focus({ preventScroll: true });
});

timelineLane?.addEventListener('pointermove', (e) => {
  if (!state.timelineDragging || e.pointerId !== state.timelinePointerId) return;
  updateTimelineFromPointer(e.clientX);
});

timelineLane?.addEventListener('pointerup', (e) => {
  if (e.pointerId !== state.timelinePointerId) return;
  stopTimelinePointerDrag();
});

timelineLane?.addEventListener('pointercancel', (e) => {
  if (e.pointerId !== state.timelinePointerId) return;
  stopTimelinePointerDrag();
});

function updateFromControl(nextCount) {
  finishSliderDrag();
  stopTimelinePointerDrag();
  setVisibleCount(nextCount);
  timelineSlider.focus({ preventScroll: true });
}

timelineToStart?.addEventListener('click', () => updateFromControl(0));
timelineStepBack?.addEventListener('click', () => updateFromControl(state.visibleCount - 1));
timelineStepForward?.addEventListener('click', () => updateFromControl(state.visibleCount + 1));
timelineToEnd?.addEventListener('click', () => updateFromControl(state.allPins.length));

modeToggle.addEventListener('click', () => {
  state.mode = state.mode === 'board' ? 'single' : 'board';
  applyModeUi();
  renderSingleView();
  closeImageModal();
  closeMenu();
});

themeToggle.addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  window.localStorage.setItem('pinboard-theme', state.theme);
  applyThemeUi();
  closeMenu();
});

menuUpload.addEventListener('click', async () => {
  closeMenu();
  await addImageFromUrl();
});

settingsButton.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMenu();
});

board.addEventListener('click', (e) => {
  if (state.mode !== 'board') return;
  const pin = e.target.closest('.pin');
  if (!pin) return;
  const pinId = pin.dataset.pinId;
  const item = state.allPins.find((entry) => entry.id === pinId);
  if (!item) return;
  openImageModal(item);
});

imageModalClose?.addEventListener('click', () => {
  closeImageModal();
});

imageModal?.addEventListener('click', (e) => {
  if (e.target !== imageModal) return;
  closeImageModal();
});

document.addEventListener('click', (e) => {
  if (settingsMenu.hidden) return;
  if (settingsMenu.contains(e.target) || settingsButton.contains(e.target)) return;
  closeMenu();
});

window.addEventListener('keydown', (e) => {
  const target = e.target;
  const isTypingTarget = target && (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );

  if (e.key === 'Escape' && !imageModal?.hidden) {
    e.preventDefault();
    closeImageModal();
    return;
  }

  if (isTypingTarget && target !== timelineSlider) return;

  if (e.key === 'Escape' && state.menuOpen) {
    e.preventDefault();
    closeMenu();
    return;
  }

  if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    modeToggle.click();
    return;
  }

  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    updateFromControl(state.visibleCount - 1);
    return;
  }

  if (e.key === 'ArrowRight') {
    e.preventDefault();
    updateFromControl(state.visibleCount + 1);
  }
});

window.addEventListener('resize', () => {
  applyTransform();
});

async function initialize() {
  applyTransform();
  applyModeUi();
  applyThemeUi();
  closeMenu();
  closeImageModal();
  try {
    await loadPins();
  } finally {
    connectRealtime();
  }
}

initialize();

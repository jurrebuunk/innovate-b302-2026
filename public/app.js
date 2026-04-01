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
const menuTakePicture = document.getElementById('menuTakePicture');
const modeToggle = document.getElementById('modeToggle');
const themeToggle = document.getElementById('themeToggle');
const singleView = document.getElementById('singleView');
const singleImage = document.getElementById('singleImage');
const singleEmpty = document.getElementById('singleEmpty');
const imageModal = document.getElementById('imageModal');
const imageModalPanel = document.getElementById('imageModalPanel');
const imageModalImage = document.getElementById('imageModalImage');
const imageModalClose = document.getElementById('imageModalClose');
const captureModal = document.getElementById('captureModal');
const captureModalFrame = document.getElementById('captureModalFrame');
const captureModalClose = document.getElementById('captureModalClose');
const captureWorkflowStatus = document.getElementById('captureWorkflowStatus');
const captureWorkflowStatusText = document.getElementById('captureWorkflowStatusText');
const captureWorkflowInfo = document.getElementById('captureWorkflowInfo');

const GRID_SIZE = 40;
const BOARD_TEXTURE_SCALE_MULTIPLIER = 25;
const historyUtils = window.PinboardHistory || {};
const IMAGE_PLACEHOLDER = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#e2e8f0"/>
        <stop offset="100%" stop-color="#cbd5e1"/>
      </linearGradient>
    </defs>
    <rect width="640" height="640" fill="url(#bg)"/>
    <rect x="80" y="80" width="480" height="480" rx="20" fill="#f8fafc" stroke="#94a3b8" stroke-width="12"/>
    <path d="M170 430L275 315L360 400L435 325L510 430" fill="none" stroke="#64748b" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="255" cy="235" r="38" fill="#94a3b8"/>
    <text x="320" y="520" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" fill="#334155">Image unavailable</text>
  </svg>`
)}`;

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
  positionPersistTimers: new Map(),
  suppressPinClickUntil: 0,
  pinNodes: new Map(),
  newPinIds: new Set(),
  allowPinIntroAnimation: false,
  nextPinZ: 1,
  awaitingWorkflowUpdate: false,
  latestWorkflowUpdateId: null
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
  const scaledTexture = Math.max(40, GRID_SIZE * BOARD_TEXTURE_SCALE_MULTIPLIER * state.scale);
  boardContainer.style.backgroundSize = `${scaledTexture}px ${scaledTexture}px`;
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

function applyPinTransform(pin, sway = 0) {
  const baseRotation = Number.parseFloat(pin.dataset.baseRotation || '0');
  const baseScale = Number.parseFloat(pin.dataset.baseScale || '1');
  pin.style.transform = `rotate(${baseRotation + sway}deg) scale(${baseScale})`;
}

function setImageSourceWithFallback(img, src, alt) {
  if (!img) return;
  const nextSrc = src || IMAGE_PLACEHOLDER;
  img.dataset.fallback = nextSrc === IMAGE_PLACEHOLDER ? '1' : '0';
  img.src = nextSrc;
  img.alt = alt;
}

function attachImageFallback(img) {
  if (!img || img.dataset.hasFallbackHandler === '1') return;
  img.dataset.hasFallbackHandler = '1';
  img.addEventListener('error', () => {
    if (img.dataset.fallback === '1') return;
    img.dataset.fallback = '1';
    img.src = IMAGE_PLACEHOLDER;
  });
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
  if (!Number.isFinite(item.zOrder)) item.zOrder = ++state.nextPinZ;
  pin.style.zIndex = String(item.zOrder);
  pin.style.left = `${item.x}px`;
  pin.style.top = `${item.y}px`;
  pin.style.touchAction = 'none';

  const variation = fallbackVariation(item);
  const rotation = Number.isFinite(item.rotation) ? item.rotation : variation.rotation;
  const scale = Number.isFinite(item.scale) ? item.scale : variation.scale;
  pin.dataset.baseRotation = String(rotation);
  pin.dataset.baseScale = String(scale);
  applyPinTransform(pin);

  const content = document.createElement('div');
  content.className = 'pin-content';

  const img = document.createElement('img');
  img.src = item.url || IMAGE_PLACEHOLDER;
  img.alt = item.originalName || 'Pinned image';
  img.loading = 'lazy';
  img.decoding = 'async';

  img.addEventListener('error', () => {
    if (img.dataset.fallback === '1') return;
    img.dataset.fallback = '1';
    img.src = IMAGE_PLACEHOLDER;
    pin.classList.add('is-placeholder');
  });

  img.addEventListener('load', () => {
    if (img.dataset.fallback === '1') {
      pin.classList.add('is-placeholder');
    } else {
      pin.classList.remove('is-placeholder');
    }
  });

  content.appendChild(img);
  pin.appendChild(content);

  if (state.newPinIds.has(item.id)) {
    content.classList.add('pin-content--intro');
    content.addEventListener('animationend', () => {
      content.classList.remove('pin-content--intro');
    }, { once: true });
    state.newPinIds.delete(item.id);
  }

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
      startClientX: e.clientX,
      startClientY: e.clientY,
      lastClientX: e.clientX,
      lastTimestamp: performance.now(),
      velocityX: 0,
      sway: 0,
      moved: false,
      offsetX: 0,
      offsetY: 0
    };

    const liftedZ = ++state.nextPinZ;
    item.zOrder = liftedZ;
    pin.style.zIndex = String(liftedZ);

    pin.classList.add('is-dragging');

    const rect = boardContainer.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;
    const worldX = (pointerX - state.x) / state.scale;
    const worldY = (pointerY - state.y) / state.scale;

    state.pinDrag.offsetX = worldX - Number.parseFloat(pin.style.left || '0');
    state.pinDrag.offsetY = worldY - Number.parseFloat(pin.style.top || '0');

    boardContainer.classList.add('dragging');
  });

  pin.addEventListener('pointermove', (e) => {
    if (!state.pinDrag || state.pinDrag.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();

    const dx = Math.abs(e.clientX - state.pinDrag.startClientX);
    const dy = Math.abs(e.clientY - state.pinDrag.startClientY);
    if (dx > 4 || dy > 4) {
      state.pinDrag.moved = true;
    }

    const now = performance.now();
    const dt = Math.max(8, now - state.pinDrag.lastTimestamp);
    const instantVelocityX = (e.clientX - state.pinDrag.lastClientX) / dt;
    state.pinDrag.velocityX = (state.pinDrag.velocityX * 0.9) + (instantVelocityX * 0.1);
    state.pinDrag.lastClientX = e.clientX;
    state.pinDrag.lastTimestamp = now;

    const rect = boardContainer.getBoundingClientRect();
    const pointerX = e.clientX - rect.left;
    const pointerY = e.clientY - rect.top;
    const worldX = (pointerX - state.x) / state.scale;
    const worldY = (pointerY - state.y) / state.scale;

    const nextX = Math.round(worldX - state.pinDrag.offsetX);
    const nextY = Math.round(worldY - state.pinDrag.offsetY);
    pin.style.left = `${nextX}px`;
    pin.style.top = `${nextY}px`;
    const speedPxPerSec = Math.abs(state.pinDrag.velocityX) * 1000;
    const minTiltSpeed = 120;
    const maxTiltSpeed = 1800;
    const speedProgress = Math.max(0, Math.min(1, (speedPxPerSec - minTiltSpeed) / (maxTiltSpeed - minTiltSpeed)));
    const targetMagnitude = Math.pow(speedProgress, 0.9) * 20;
    const targetSway = Math.sign(state.pinDrag.velocityX) * targetMagnitude;
    state.pinDrag.sway = (state.pinDrag.sway * 0.7) + (targetSway * 0.3);
    pin.style.transition = 'none';
    applyPinTransform(pin, state.pinDrag.sway);
    updateLocalPinPosition(item.id, nextX, nextY);
  });

  const finishPinDrag = (e) => {
    if (!state.pinDrag || state.pinDrag.pointerId !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();

    const finalX = Number.parseFloat(pin.style.left || '0');
    const finalY = Number.parseFloat(pin.style.top || '0');

    if (state.pinDrag.moved) {
      state.suppressPinClickUntil = performance.now() + 300;
    }

    schedulePinPositionPersist(item.id, finalX, finalY);

    pin.style.transition = 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)';
    applyPinTransform(pin);
    window.setTimeout(() => {
      pin.style.transition = '';
    }, 280);

    state.pinDrag = null;
    pin.classList.remove('is-dragging');
    boardContainer.classList.remove('dragging');
  };

  pin.addEventListener('pointerup', finishPinDrag);
  pin.addEventListener('pointercancel', finishPinDrag);

  return pin;
}

function syncPinNode(pin, item) {
  pin.style.left = `${item.x}px`;
  pin.style.top = `${item.y}px`;
  if (!Number.isFinite(item.zOrder)) item.zOrder = ++state.nextPinZ;
  pin.style.zIndex = String(item.zOrder);

  const variation = fallbackVariation(item);
  const rotation = Number.isFinite(item.rotation) ? item.rotation : variation.rotation;
  const scale = Number.isFinite(item.scale) ? item.scale : variation.scale;
  pin.dataset.baseRotation = String(rotation);
  pin.dataset.baseScale = String(scale);
  applyPinTransform(pin);

  const img = pin.querySelector('img');
  if (img) {
    const nextSrc = item.url || IMAGE_PLACEHOLDER;
    if (img.getAttribute('src') !== nextSrc) {
      img.dataset.fallback = nextSrc === IMAGE_PLACEHOLDER ? '1' : '0';
      img.src = nextSrc;
    }
    img.alt = item.originalName || 'Pinned image';
  }
}

function renderPins() {
  const visible = state.allPins.slice(0, state.visibleCount);
  const visibleIds = new Set(visible.map((item) => item.id));

  for (const [id, node] of state.pinNodes.entries()) {
    if (visibleIds.has(id)) continue;
    if (node.parentElement === board) board.removeChild(node);
  }

  for (let i = 0; i < visible.length; i++) {
    const item = visible[i];
    let pin = state.pinNodes.get(item.id);
    if (!pin) {
      pin = createPinNode(item);
      state.pinNodes.set(item.id, pin);
    } else {
      syncPinNode(pin, item);
    }

    const currentNodeAtIndex = board.children[i] || null;
    if (currentNodeAtIndex !== pin) {
      board.insertBefore(pin, currentNodeAtIndex);
    }
  }
}

function renderSingleView() {
  const item = latestPinAtOrBeforeCutoff(state.allPins, state.visibleCount);
  if (!item) {
    singleImage.removeAttribute('src');
    singleImage.hidden = true;
    singleEmpty.hidden = false;
    return;
  }

  setImageSourceWithFallback(singleImage, item.url, item.originalName || 'Pinned image');
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
    const img = document.createElement('img');
    img.className = 'blip-image';
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      if (img.dataset.fallback === '1') return;
      img.dataset.fallback = '1';
      img.src = IMAGE_PLACEHOLDER;
    });
    blip.appendChild(img);
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
    const node = state.timelineBlipNodes[i];
    const img = node.firstElementChild;
    const item = state.allPins[i];
    const nextSrc = item?.url || IMAGE_PLACEHOLDER;
    if (img && img.getAttribute('src') !== nextSrc) {
      img.dataset.fallback = nextSrc === IMAGE_PLACEHOLDER ? '1' : '0';
      img.setAttribute('src', nextSrc);
    }
    node.classList.toggle('active', i < clampedVisible);
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
  imageModalPanel?.style.removeProperty('--modal-tilt');
}

function closeCaptureModal() {
  if (!captureModal || captureModal.hidden) return;
  captureModal.hidden = true;
  captureModalFrame?.removeAttribute('src');
  if (captureModalFrame) captureModalFrame.hidden = false;
  if (captureWorkflowStatus) captureWorkflowStatus.hidden = true;
  if (captureWorkflowStatusText) captureWorkflowStatusText.textContent = 'Waiting for n8n update…';
  if (captureWorkflowInfo) captureWorkflowInfo.textContent = '';
  state.awaitingWorkflowUpdate = false;
}

function openCaptureModal() {
  if (!captureModal) return;
  const nonce = Date.now();
  state.awaitingWorkflowUpdate = false;
  state.latestWorkflowUpdateId = null;
  if (captureModalFrame) captureModalFrame.hidden = false;
  if (captureWorkflowStatus) captureWorkflowStatus.hidden = true;
  if (captureWorkflowStatusText) captureWorkflowStatusText.textContent = 'Waiting for n8n update…';
  if (captureWorkflowInfo) captureWorkflowInfo.textContent = '';
  captureModalFrame?.setAttribute('src', `/capture.html?embedded=1&t=${nonce}`);
  captureModal.hidden = false;
}

function formatWorkflowStatus(status) {
  if (status == null) return 'Update received';
  if (typeof status === 'string') return status;
  try {
    return JSON.stringify(status);
  } catch {
    return 'Update received';
  }
}

function formatWorkflowInfo(info, payload) {
  const source = info != null ? info : payload;
  if (source == null) return '';
  if (typeof source === 'string') return source;
  try {
    return JSON.stringify(source, null, 2);
  } catch {
    return String(source);
  }
}

function renderWorkflowUpdate(update) {
  if (!update || !captureWorkflowStatus) return;
  if (captureModalFrame) captureModalFrame.hidden = true;
  captureWorkflowStatus.hidden = false;
  if (captureWorkflowStatusText) {
    captureWorkflowStatusText.textContent = `Status: ${formatWorkflowStatus(update.status)}`;
  }
  if (captureWorkflowInfo) {
    captureWorkflowInfo.textContent = formatWorkflowInfo(update.info, update.payload);
  }
}

async function loadLatestWorkflowUpdate() {
  try {
    const res = await fetch('/api/n8n-updates/latest');
    if (!res.ok) return;
    const payload = await res.json();
    if (!payload?.ok || !payload.data) return;
    if (state.latestWorkflowUpdateId && state.latestWorkflowUpdateId === payload.data.id) return;
    state.latestWorkflowUpdateId = payload.data.id;
    renderWorkflowUpdate(payload.data);
    state.awaitingWorkflowUpdate = false;
  } catch {}
}

function openImageModal(item) {
  if (!item || !imageModal || !imageModalImage) return;
  const variation = fallbackVariation(item);
  const baseRotation = Number.isFinite(item.rotation) ? item.rotation : variation.rotation;
  const modalTilt = Math.max(-5, Math.min(5, baseRotation * 0.6));
  imageModalPanel?.style.setProperty('--modal-tilt', `${modalTilt}deg`);
  setImageSourceWithFallback(imageModalImage, item.url, item.originalName || 'Pinned image preview');
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
  if (!Number.isFinite(item.zOrder)) item.zOrder = ++state.nextPinZ;
  if (state.allowPinIntroAnimation) state.newPinIds.add(item.id);
  const wasAtLatest = state.visibleCount === state.allPins.length;
  state.allPins.push(item);
  setVisibleCount(wasAtLatest ? state.allPins.length : state.visibleCount);
  return true;
}

async function loadPins() {
  const res = await fetch('/api/images');
  const items = await res.json();
  let maxZ = state.nextPinZ;
  for (let i = 0; i < items.length; i++) {
    if (!Number.isFinite(items[i].zOrder)) items[i].zOrder = i + 1;
    if (items[i].zOrder > maxZ) maxZ = items[i].zOrder;
  }
  state.nextPinZ = maxZ;
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

  stream.addEventListener('pin-updated', (event) => {
    try {
      const item = JSON.parse(event.data);
      updateLocalPinPosition(item.id, item.x, item.y);
      if (state.mode === 'board') renderPins();
    } catch {}
  });

  stream.addEventListener('workflow-update', (event) => {
    try {
      const update = JSON.parse(event.data);
      state.latestWorkflowUpdateId = update.id || null;
      if (!state.awaitingWorkflowUpdate || captureModal?.hidden) return;
      renderWorkflowUpdate(update);
      state.awaitingWorkflowUpdate = false;
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

menuTakePicture?.addEventListener('click', () => {
  closeMenu();
  openCaptureModal();
});

settingsButton.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMenu();
});

board.addEventListener('click', (e) => {
  if (state.mode !== 'board') return;
  if (performance.now() < state.suppressPinClickUntil) return;
  const pin = e.target.closest('.pin');
  if (!pin) return;
  const pinId = pin.dataset.pinId;
  const item = state.allPins.find((entry) => entry.id === pinId);
  if (!item) return;
  openImageModal(item);
});

imageModal?.addEventListener('click', (e) => {
  if (e.target !== imageModal) return;
  closeImageModal();
});

imageModalClose?.addEventListener('click', () => {
  closeImageModal();
});

captureModalClose?.addEventListener('click', () => {
  closeCaptureModal();
});

captureModal?.addEventListener('click', (e) => {
  if (e.target !== captureModal) return;
  closeCaptureModal();
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

  if (e.key === 'Escape' && !captureModal?.hidden) {
    e.preventDefault();
    closeCaptureModal();
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

window.addEventListener('message', (event) => {
  if (event.source !== captureModalFrame?.contentWindow) return;
  const data = event.data;
  if (!data || data.type !== 'capture-submitted') return;
  if (captureModal?.hidden) return;

  state.awaitingWorkflowUpdate = true;
  if (captureModalFrame) captureModalFrame.hidden = true;
  if (captureWorkflowStatus) captureWorkflowStatus.hidden = false;
  if (captureWorkflowStatusText) captureWorkflowStatusText.textContent = 'Status: Waiting for n8n update…';
  if (captureWorkflowInfo) captureWorkflowInfo.textContent = '';
  loadLatestWorkflowUpdate();
});

async function initialize() {
  attachImageFallback(imageModalImage);
  attachImageFallback(singleImage);
  applyTransform();
  applyModeUi();
  applyThemeUi();
  closeMenu();
  closeImageModal();
  closeCaptureModal();
  try {
    await loadPins();
  } finally {
    state.allowPinIntroAnimation = true;
    connectRealtime();
  }
}

initialize();

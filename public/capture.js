const video = document.getElementById('captureVideo');
const captureStatus = document.getElementById('captureStatus');
const shutterButton = document.getElementById('shutterButton');
const capturePolaroid = document.getElementById('capturePolaroid');
const capturePolaroidCard = document.getElementById('capturePolaroidCard');
const captureLoadingVideo = document.getElementById('captureLoadingVideo');
const captureDebug = document.getElementById('captureDebug');

const webcamTriggerEndpoint = '/api/webcam-trigger';
const themeStorageKey = 'pinboard-theme';

const canvas = document.createElement('canvas');

let stream = null;
let busy = false;
const isEmbedded = new URLSearchParams(window.location.search).get('embedded') === '1';
const pathMatch = window.location.pathname.match(/^\/capture\/([^/]+)$/);
const captureId = pathMatch ? decodeURIComponent(pathMatch[1]) : null;

function createCaptureId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `job-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

function applyTheme() {
  const theme = window.localStorage.getItem(themeStorageKey) === 'light' ? 'light' : 'dark';
  document.body.dataset.theme = theme;
}

function setStatus(message) {
  if (captureStatus) captureStatus.textContent = message;
}

function setCaptureMode(mode) {
  document.body.dataset.captureMode = mode;
}

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false
    });

    if (video) {
      video.srcObject = stream;
      await video.play();
    }

    setStatus('Camera ready. Press Enter or tap shutter.');
  } catch {
    setStatus('Unable to access the camera.');
  }
}

async function sendCapture(blob, jobId) {
  const imageDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read image data'));
    reader.readAsDataURL(blob);
  });

  const response = await fetch(webcamTriggerEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl, job_id: jobId })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = payload?.error?.message || `Request failed with status ${response.status}`;
    throw new Error(message);
  }
}

function showProcessingPolaroid() {
  if (!capturePolaroid) return;
  if (video) video.hidden = true;
  capturePolaroid.hidden = false;
  if (capturePolaroidCard) {
    const tilt = (Math.random() * 10) - 5;
    capturePolaroidCard.style.setProperty('--capture-polaroid-tilt', `${tilt.toFixed(1)}deg`);
  }
  if (captureLoadingVideo) {
    captureLoadingVideo.currentTime = 0;
    captureLoadingVideo.play().catch(() => {});
  }
}

function formatStatus(status) {
  if (status == null) return 'Processing update received';
  if (typeof status === 'string') return status;
  try {
    return JSON.stringify(status);
  } catch {
    return 'Processing update received';
  }
}

function applyWorkflowUpdate(updatePayload) {
  const status = updatePayload?.data?.status ?? updatePayload?.status ?? null;
  setStatus(`Status: ${formatStatus(status)}`);

  if (captureDebug) {
    const rawPayload = updatePayload?.data?.payload ?? updatePayload?.payload ?? updatePayload;
    try {
      captureDebug.textContent = JSON.stringify(rawPayload, null, 2);
    } catch {
      captureDebug.textContent = String(rawPayload);
    }
    captureDebug.hidden = false;
  }
}

function connectWorkflowUpdates() {
  if (!captureId) return;

  const loadInitial = async () => {
    try {
      const res = await fetch(`/api/n8n-updates/${encodeURIComponent(captureId)}`);
      if (!res.ok) return;
      const payload = await res.json();
      if (!payload?.ok) return;
      applyWorkflowUpdate(payload);
    } catch {}
  };

  loadInitial();

  if (window.EventSource) {
    const stream = new EventSource('/api/stream');
    stream.addEventListener('workflow-update', (event) => {
      try {
        const update = JSON.parse(event.data);
        if (!update || update.job_id !== captureId) return;
        applyWorkflowUpdate(update);
      } catch {}
    });

    window.addEventListener('beforeunload', () => {
      stream.close();
    });
  }
}

async function captureFrame() {
  if (busy) return;
  if (!video || !video.videoWidth || !video.videoHeight) {
    setStatus('Camera is not ready yet.');
    return;
  }

  busy = true;
  shutterButton.disabled = true;
  setStatus('Capturing image…');

  try {
    const nextCaptureId = captureId || createCaptureId();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setStatus('Sending image to API…');
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Failed to create image blob');

    await sendCapture(blob, nextCaptureId);

    if (!captureId) {
      const params = new URLSearchParams(window.location.search);
      const query = params.toString();
      const suffix = query ? `?${query}` : '';
      window.location.replace(`/capture/${encodeURIComponent(nextCaptureId)}${suffix}`);
      return;
    }

    showProcessingPolaroid();
    if (isEmbedded && window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'capture-submitted' }, window.location.origin);
    }
    setStatus('Image sent.');
  } catch (error) {
    setStatus(error.message || 'Failed to send capture.');
  } finally {
    busy = false;
    shutterButton.disabled = false;
  }
}

function stopCamera() {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
  stream = null;
}

shutterButton?.addEventListener('click', captureFrame);

window.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    captureFrame();
  }
});

window.addEventListener('beforeunload', stopCamera);
window.addEventListener('storage', (event) => {
  if (event.key !== themeStorageKey) return;
  applyTheme();
});

applyTheme();
if (captureId) {
  setCaptureMode('processing');
  showProcessingPolaroid();
  if (shutterButton) shutterButton.hidden = true;
  setStatus('Waiting for workflow update...');
  if (captureDebug) {
    captureDebug.hidden = false;
    captureDebug.textContent = `waiting for updates for job_id: ${captureId}`;
  }
  connectWorkflowUpdates();
} else {
  setCaptureMode('camera');
  if (captureDebug) captureDebug.hidden = true;
  startCamera();
}

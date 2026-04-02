const video = document.getElementById('captureVideo');
const captureStatus = document.getElementById('captureStatus');
const capturePolaroidCaption = document.getElementById('capturePolaroidCaption');
const shutterButton = document.getElementById('shutterButton');
const capturePolaroid = document.getElementById('capturePolaroid');
const capturePolaroidCard = document.getElementById('capturePolaroidCard');
const captureLoadingVideo = document.getElementById('captureLoadingVideo');
const captureResultImage = document.getElementById('captureResultImage');
const captureBackButton = document.getElementById('captureBackButton');
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
  document.body.dataset.theme = 'dark';
  window.localStorage.setItem(themeStorageKey, 'dark');
}

function setStatus(message) {
  if (captureStatus) captureStatus.textContent = message;
  if (capturePolaroidCaption) capturePolaroidCaption.textContent = message;
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
  if (captureResultImage) {
    captureResultImage.hidden = true;
    captureResultImage.removeAttribute('src');
  }
  if (captureLoadingVideo) {
    captureLoadingVideo.hidden = false;
  }
  if (captureBackButton) captureBackButton.hidden = true;
  if (capturePolaroidCard) {
    const tilt = (Math.random() * 10) - 5;
    capturePolaroidCard.style.setProperty('--capture-polaroid-tilt', `${tilt.toFixed(1)}deg`);
  }
  if (captureLoadingVideo) {
    captureLoadingVideo.currentTime = 0;
    captureLoadingVideo.play().catch(() => {});
  }
}

function showGeneratedImage(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return;
  if (captureLoadingVideo) {
    captureLoadingVideo.pause?.();
    captureLoadingVideo.hidden = true;
  }
  if (captureResultImage) {
    captureResultImage.src = imageUrl;
    captureResultImage.hidden = false;
  }
  if (captureBackButton) captureBackButton.hidden = false;
}

function captureRootUrl() {
  const params = new URLSearchParams(window.location.search);
  const embedded = params.get('embedded');
  const suffix = embedded ? `?embedded=${encodeURIComponent(embedded)}` : '';
  return `/capture${suffix}`;
}

function imageUrlFromUpdate(updatePayload) {
  const payload = updatePayload?.data?.payload ?? updatePayload?.payload ?? updatePayload;
  const direct = payload?.imageUrl ?? payload?.image_url ?? null;
  return typeof direct === 'string' && direct.trim().length > 0 ? direct.trim() : null;
}

function formatStatus(status) {
  if (status == null) return 'We received your capture and are processing it.';
  if (typeof status === 'string') {
    const key = status.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!key) return 'We received your capture and are processing it.';

    if (key === 'flow_started') return 'Inspiratie opdoen van uw foto ...';
    if (key === 'inspected_image') return 'Geinspireerd!';
    if (key === 'generated_prompt') return 'Kwasten klaarleggen!';
    if (key === 'comfyui_triggered') return 'Aan het schilderen...';
    if (key === 'generation_completed') return 'Uw meesterwerk is klaar!';
    if (key.includes('queue')) return 'Your request is queued and will start shortly.';
    if (key.includes('upload')) return 'Uploading your generated image.';
    if (key.includes('fail') || key.includes('error')) return 'Something went wrong while generating the image.';

    const readable = status.replace(/[_-]+/g, ' ').trim();
    return readable ? `Update: ${readable.charAt(0).toUpperCase()}${readable.slice(1)}.` : 'We received your capture and are processing it.';
  }

  try {
    return `Update received: ${JSON.stringify(status)}`;
  } catch {
    return 'We received your capture and are processing it.';
  }
}

function applyWorkflowUpdate(updatePayload) {
  const status = updatePayload?.data?.status ?? updatePayload?.status ?? null;
  setStatus(formatStatus(status));
  const key = typeof status === 'string' ? status.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
  const imageUrl = imageUrlFromUpdate(updatePayload);
  if (imageUrl && key === 'generation_completed') {
    showGeneratedImage(imageUrl);
  }

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
captureBackButton?.addEventListener('click', () => {
  window.location.assign(captureRootUrl());
});

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

const video = document.getElementById('captureVideo');
const captureStatus = document.getElementById('captureStatus');
const shutterButton = document.getElementById('shutterButton');

const webcamTriggerEndpoint = '/api/webcam-trigger';
const themeStorageKey = 'pinboard-theme';

const canvas = document.createElement('canvas');

let stream = null;
let busy = false;

function applyTheme() {
  const theme = window.localStorage.getItem(themeStorageKey) === 'light' ? 'light' : 'dark';
  document.body.dataset.theme = theme;
}

function setStatus(message) {
  if (captureStatus) captureStatus.textContent = message;
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

async function sendCapture(blob) {
  const imageDataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read image data'));
    reader.readAsDataURL(blob);
  });

  const response = await fetch(webcamTriggerEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = payload?.error?.message || `Request failed with status ${response.status}`;
    throw new Error(message);
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
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    setStatus('Sending image to API…');
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Failed to create image blob');

    await sendCapture(blob);
    if (window.parent && window.parent !== window) {
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
startCamera();

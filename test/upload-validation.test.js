const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(baseUrl, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/images`);
      if (res.ok) return;
    } catch {}
    await wait(100);
  }
  throw new Error('Server did not start in time');
}

function startServer(port) {
  return spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore'
  });
}

test('POST /api/images rejects non-image uploads', async () => {
  const port = 4310;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startServer(port);

  try {
    await waitForServer(baseUrl);

    const form = new FormData();
    form.append('image', new Blob(['not an image'], { type: 'text/plain' }), 'not-image.txt');

    const res = await fetch(`${baseUrl}/api/images`, {
      method: 'POST',
      body: form
    });

    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, 'Only image files are allowed');
  } finally {
    server.kill('SIGTERM');
  }
});

test('POST /api/images/script returns stable error envelope on invalid upload', async () => {
  const port = 4311;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startServer(port);

  try {
    await waitForServer(baseUrl);

    const form = new FormData();
    form.append('image', new Blob(['not an image'], { type: 'text/plain' }), 'not-image.txt');

    const res = await fetch(`${baseUrl}/api/images/script`, {
      method: 'POST',
      body: form
    });

    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'ONLY_IMAGES_ALLOWED');
    assert.equal(body.error.message, 'Only image files are allowed');
  } finally {
    server.kill('SIGTERM');
  }
});

test('SSE stream emits pin-created after successful script upload', async () => {
  const port = 4312;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startServer(port);

  try {
    await waitForServer(baseUrl);

    const streamRes = await fetch(`${baseUrl}/api/stream`);
    assert.equal(streamRes.status, 200);

    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let raw = '';

    const readUntilPinCreated = async () => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        if (raw.includes('event: pin-created')) return true;
      }
      return false;
    };

    const form = new FormData();
    form.append('image', new Blob(['fake-bytes'], { type: 'image/png' }), 'ok.png');

    const uploadRes = await fetch(`${baseUrl}/api/images/script`, {
      method: 'POST',
      body: form
    });
    const uploadBody = await uploadRes.json();
    assert.equal(uploadRes.status, 201);
    assert.equal(uploadBody.ok, true);

    const gotPinEvent = await readUntilPinCreated();
    assert.equal(gotPinEvent, true);
    assert.match(raw, /event: pin-created/);
    assert.match(raw, /"id"/);
  } finally {
    server.kill('SIGTERM');
  }
});

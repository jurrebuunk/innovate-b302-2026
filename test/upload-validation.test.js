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


test('PATCH /api/images/:id/position persists new coordinates', async () => {
  const port = 4313;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startServer(port);

  try {
    await waitForServer(baseUrl);

    const form = new FormData();
    form.append('image', new Blob(['fake-bytes'], { type: 'image/png' }), 'drag-me.png');

    const uploadRes = await fetch(`${baseUrl}/api/images/script`, {
      method: 'POST',
      body: form
    });
    const uploadBody = await uploadRes.json();
    assert.equal(uploadRes.status, 201);
    assert.equal(uploadBody.ok, true);

    const id = uploadBody.data.id;

    const patchRes = await fetch(`${baseUrl}/api/images/${encodeURIComponent(id)}/position`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 321, y: -222 })
    });
    assert.equal(patchRes.status, 200);

    const listRes = await fetch(`${baseUrl}/api/images`);
    const items = await listRes.json();
    const updated = items.find((item) => item.id === id);

    assert.equal(updated.x, 321);
    assert.equal(updated.y, -222);
  } finally {
    server.kill('SIGTERM');
  }
});

test('POST /api/images stores prompt alongside the uploaded image', async () => {
  const port = 4314;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startServer(port);

  try {
    await waitForServer(baseUrl);

    const prompt = 'a neon-lit skyline at dusk';
    const form = new FormData();
    form.append('image', new Blob(['fake-bytes'], { type: 'image/png' }), 'prompted.png');
    form.append('prompt', prompt);

    const uploadRes = await fetch(`${baseUrl}/api/images`, {
      method: 'POST',
      body: form
    });
    const uploadBody = await uploadRes.json();

    assert.equal(uploadRes.status, 201);
    assert.equal(uploadBody.prompt, prompt);

    const rawLatestRes = await fetch(`${baseUrl}/api/images/latest`);
    assert.equal(rawLatestRes.status, 200);
    assert.equal(rawLatestRes.headers.get('x-image-prompt'), prompt);
    assert.match(rawLatestRes.headers.get('content-type') || '', /^image\//);

    const latestRes = await fetch(`${baseUrl}/api/images/latest?metadata=1`);
    const latestBody = await latestRes.json();

    assert.equal(latestRes.status, 200);
    assert.equal(latestBody.prompt, prompt);
    assert.equal(latestBody.originalName, 'prompted.png');
  } finally {
    server.kill('SIGTERM');
  }
});

test('POST /api/images parses JSON prompt text and stores structured data', async () => {
  const port = 4316;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startServer(port);

  try {
    await waitForServer(baseUrl);

    const prompt = { mood: 'calm', style: 'minimal', tags: ['blue', 'soft'] };
    const form = new FormData();
    form.append('image', new Blob(['fake-bytes'], { type: 'image/png' }), 'json-prompted.png');
    form.append('prompt', JSON.stringify(prompt));

    const uploadRes = await fetch(`${baseUrl}/api/images`, {
      method: 'POST',
      body: form
    });
    const uploadBody = await uploadRes.json();

    assert.equal(uploadRes.status, 201);
    assert.deepEqual(uploadBody.prompt, prompt);

    const rawLatestRes = await fetch(`${baseUrl}/api/images/latest`);
    assert.equal(rawLatestRes.status, 200);
    assert.equal(rawLatestRes.headers.get('x-image-prompt'), JSON.stringify(prompt));

    const latestRes = await fetch(`${baseUrl}/api/images/latest?metadata=1`);
    const latestBody = await latestRes.json();

    assert.equal(latestRes.status, 200);
    assert.deepEqual(latestBody.prompt, prompt);
    assert.equal(latestBody.originalName, 'json-prompted.png');
  } finally {
    server.kill('SIGTERM');
  }
});

test('POST /api/images/script stores prompt and exposes it in the response data', async () => {
  const port = 4315;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startServer(port);

  try {
    await waitForServer(baseUrl);

    const prompt = 'a minimal red robot on a white background';
    const form = new FormData();
    form.append('image', new Blob(['fake-bytes'], { type: 'image/png' }), 'script-prompted.png');
    form.append('prompt', prompt);

    const uploadRes = await fetch(`${baseUrl}/api/images/script`, {
      method: 'POST',
      body: form
    });
    const uploadBody = await uploadRes.json();

    assert.equal(uploadRes.status, 201);
    assert.equal(uploadBody.ok, true);
    assert.equal(uploadBody.data.prompt, prompt);
  } finally {
    server.kill('SIGTERM');
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');

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

function startServer(port, extraEnv = {}) {
  return spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv, PORT: String(port) },
    stdio: 'ignore'
  });
}

async function startWebhookServer(port) {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];

    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        headers: req.headers,
        body: Buffer.concat(chunks).toString('latin1')
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { server, requests };
}

async function startImageHost(port, responseBody = 'fake-bytes', contentType = 'image/png') {
  const server = createServer((_req, res) => {
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    res.end(responseBody);
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return server;
}

test('POST /api/images rejects invalid image URLs', async () => {
  const port = 4310;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startServer(port);

  try {
    await waitForServer(baseUrl);

    const res = await fetch(`${baseUrl}/api/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: 'ftp://example.com/not-allowed.png' })
    });

    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.error, 'Image URL must be an absolute http or https URL');
  } finally {
    server.kill('SIGTERM');
  }
});

test('POST /api/images/script returns stable error envelope on invalid image URL', async () => {
  const port = 4311;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startServer(port);

  try {
    await waitForServer(baseUrl);

    const res = await fetch(`${baseUrl}/api/images/script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: 'not-a-url' })
    });

    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'INVALID_IMAGE_URL');
    assert.equal(body.error.message, 'Image URL must be an absolute http or https URL');
  } finally {
    server.kill('SIGTERM');
  }
});

test('SSE stream emits pin-created after successful URL pin', async () => {
  const port = 4312;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  const imageHostPort = 5312;
  const imageHost = await startImageHost(imageHostPort);

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

    const imageUrl = `http://127.0.0.1:${imageHostPort}/ok.png`;

    const uploadRes = await fetch(`${baseUrl}/api/images/script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl })
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
    imageHost.close();
  }
});


test('PATCH /api/images/:id/position persists new coordinates', async () => {
  const port = 4313;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  const imageHostPort = 5313;
  const imageHost = await startImageHost(imageHostPort);

  try {
    await waitForServer(baseUrl);

    const imageUrl = `http://127.0.0.1:${imageHostPort}/drag-me.png`;

    const uploadRes = await fetch(`${baseUrl}/api/images/script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl })
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
    imageHost.close();
  }
});

test('POST /api/images stores prompt alongside the external image URL', async () => {
  const port = 4314;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  const imageHostPort = 5314;
  const imageHost = await startImageHost(imageHostPort);

  try {
    await waitForServer(baseUrl);

    const imageUrl = `http://127.0.0.1:${imageHostPort}/prompted.png`;
    const prompt = 'a neon-lit skyline at dusk';
    const uploadRes = await fetch(`${baseUrl}/api/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, prompt })
    });
    const uploadBody = await uploadRes.json();

    assert.equal(uploadRes.status, 201);
    assert.equal(uploadBody.prompt, prompt);

    const rawLatestRes = await fetch(`${baseUrl}/api/images/latest`, { redirect: 'manual' });
    assert.equal(rawLatestRes.status, 302);
    assert.equal(rawLatestRes.headers.get('location'), imageUrl);

    const latestRes = await fetch(`${baseUrl}/api/images/latest?metadata=1`);
    const latestBody = await latestRes.json();

    assert.equal(latestRes.status, 200);
    assert.equal(latestBody.prompt, prompt);
    assert.equal(latestBody.url, imageUrl);
  } finally {
    server.kill('SIGTERM');
    imageHost.close();
  }
});

test('POST /api/images parses JSON prompt text and stores structured data', async () => {
  const port = 4316;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  const imageHostPort = 5316;
  const imageHost = await startImageHost(imageHostPort);

  try {
    await waitForServer(baseUrl);

    const imageUrl = `http://127.0.0.1:${imageHostPort}/json-prompted.png`;
    const prompt = { mood: 'calm', style: 'minimal', tags: ['blue', 'soft'] };
    const uploadRes = await fetch(`${baseUrl}/api/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, prompt: JSON.stringify(prompt) })
    });
    const uploadBody = await uploadRes.json();

    assert.equal(uploadRes.status, 201);
    assert.deepEqual(uploadBody.prompt, prompt);

    const rawLatestRes = await fetch(`${baseUrl}/api/images/latest`, { redirect: 'manual' });
    assert.equal(rawLatestRes.status, 302);
    assert.equal(rawLatestRes.headers.get('location'), imageUrl);

    const latestRes = await fetch(`${baseUrl}/api/images/latest?metadata=1`);
    const latestBody = await latestRes.json();

    assert.equal(latestRes.status, 200);
    assert.deepEqual(latestBody.prompt, prompt);
    assert.equal(latestBody.url, imageUrl);
  } finally {
    server.kill('SIGTERM');
    imageHost.close();
  }
});

test('POST /api/images/script stores prompt and exposes it in the response data', async () => {
  const port = 4315;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  const imageHostPort = 5315;
  const imageHost = await startImageHost(imageHostPort);

  try {
    await waitForServer(baseUrl);

    const imageUrl = `http://127.0.0.1:${imageHostPort}/script-prompted.png`;
    const prompt = 'a minimal red robot on a white background';
    const uploadRes = await fetch(`${baseUrl}/api/images/script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, prompt })
    });
    const uploadBody = await uploadRes.json();

    assert.equal(uploadRes.status, 201);
    assert.equal(uploadBody.ok, true);
    assert.equal(uploadBody.data.prompt, prompt);
  } finally {
    server.kill('SIGTERM');
    imageHost.close();
  }
});

test('POST /api/webcam-trigger forwards captured image as multipart upload', async () => {
  const port = 4317;
  const baseUrl = `http://127.0.0.1:${port}`;
  const webhookPort = 5317;
  const webhookUrl = `http://127.0.0.1:${webhookPort}/webhook`;
  const appUrl = `http://127.0.0.1:${port}`;
  const { server: webhookServer, requests } = await startWebhookServer(webhookPort);
  const server = startServer(port, { WEBHOOK_URL: webhookUrl, APP_URL: appUrl });

  try {
    await waitForServer(baseUrl);

    const imageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2Xn5cAAAAASUVORK5CYII=';
    const res = await fetch(`${baseUrl}/api/webcam-trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl })
    });

    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(typeof body.job_id, 'string');
    assert.match(body.job_id, /^job-/);
    assert.equal(requests.length, 1);
    assert.match(requests[0].headers['content-type'], /multipart\/form-data/);
    assert.match(requests[0].body, /name="file"/);
    assert.match(requests[0].body, /filename="picture\.png"/);
    assert.match(requests[0].body, /name="job_id"/);
    assert.match(requests[0].body, /name="metadata"/);
    assert.match(requests[0].body, new RegExp(`"appUrl":"${appUrl}"`));
    assert.match(requests[0].body, /"job_id":"job-/);
  } finally {
    server.kill('SIGTERM');
    webhookServer.close();
  }
});

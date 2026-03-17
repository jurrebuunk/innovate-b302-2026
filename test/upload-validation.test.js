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

test('POST /api/images rejects non-image uploads', async () => {
  const port = 4310;
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore'
  });

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

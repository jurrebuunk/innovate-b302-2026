const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const boardFile = path.join(__dirname, 'board.json');

function loadBoard() {
  if (!fs.existsSync(boardFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(boardFile, 'utf-8'));
  } catch {
    return [];
  }
}

function saveBoard(items) {
  fs.writeFileSync(boardFile, JSON.stringify(items, null, 2));
}

const CLUSTER_RADIUS = 900;

function randomPos() {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.pow(Math.random(), 0.55) * CLUSTER_RADIUS;

  return {
    x: Math.round(Math.cos(angle) * radius),
    y: Math.round(Math.sin(angle) * radius)
  };
}

const streamClients = new Set();

function sendSse(res, event, data) {
  if (!res || res.writableEnded || res.destroyed) return false;
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function broadcast(event, data) {
  for (const client of streamClients) {
    const ok = sendSse(client, event, data);
    if (!ok) streamClients.delete(client);
  }
}

function normalizePrompt(prompt) {
  if (prompt == null) return null;

  if (typeof prompt === 'string') {
    const trimmed = prompt.trim();
    if (trimmed.length === 0) return null;

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    }

    return trimmed;
  }

  return prompt;
}

function normalizeImageUrl(imageUrl) {
  if (typeof imageUrl !== 'string') return null;

  const trimmed = imageUrl.trim();
  if (trimmed.length === 0) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function normalizeImageUrlError(imageUrl) {
  if (imageUrl == null) {
    return { status: 400, code: 'NO_IMAGE_URL', message: 'No image URL received' };
  }

  if (typeof imageUrl !== 'string' || imageUrl.trim().length === 0) {
    return { status: 400, code: 'NO_IMAGE_URL', message: 'No image URL received' };
  }

  if (!normalizeImageUrl(imageUrl)) {
    return {
      status: 400,
      code: 'INVALID_IMAGE_URL',
      message: 'Image URL must be an absolute http or https URL'
    };
  }

  return null;
}

function createImageFromUrl(imageUrl, prompt) {
  const pos = randomPos();
  return {
    id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    url: normalizeImageUrl(imageUrl),
    x: pos.x,
    y: pos.y,
    rotation: Math.round((Math.random() * 16 - 8) * 10) / 10,
    scale: Math.round((0.75 + Math.random() * 0.7) * 100) / 100,
    createdAt: new Date().toISOString(),
    prompt: normalizePrompt(prompt)
  };
}

let persistQueue = Promise.resolve();

function enqueuePersist(task) {
  const run = persistQueue.then(task, task);
  persistQueue = run.catch(() => {});
  return run;
}

function persistImage(imageUrl, prompt) {
  return enqueuePersist(async () => {
    const items = loadBoard();
    const image = createImageFromUrl(imageUrl, prompt);
    items.push(image);
    saveBoard(items);
    broadcast('pin-created', image);
    return image;
  });
}

function persistImagePosition(id, x, y) {
  return enqueuePersist(async () => {
    const items = loadBoard();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) return null;

    items[index] = { ...items[index], x, y };
    saveBoard(items);
    broadcast('pin-updated', items[index]);
    return items[index];
  });
}

app.get('/api/images', (_req, res) => {
  res.json(loadBoard());
});

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write('event: ready\n');
  res.write(`data: ${JSON.stringify({ ok: true })}\n\n`);

  streamClients.add(res);

  const heartbeat = setInterval(() => {
    if (!sendSse(res, 'keepalive', { ok: true })) {
      clearInterval(heartbeat);
      streamClients.delete(res);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    streamClients.delete(res);
  });
});

app.post('/api/images', (req, res) => {
  const rawImageUrl = req.body?.imageUrl ?? req.body?.url;
  const imageUrlError = normalizeImageUrlError(rawImageUrl);
  if (imageUrlError) return res.status(imageUrlError.status).json({ error: imageUrlError.message });
  const imageUrl = normalizeImageUrl(rawImageUrl);

  persistImage(imageUrl, req.body?.prompt)
    .then((image) => res.status(201).json(image))
    .catch(() => res.status(500).json({ error: 'Failed to persist image' }));
});

app.post('/api/images/script', (req, res) => {
  const rawImageUrl = req.body?.imageUrl ?? req.body?.url;
  const imageUrlError = normalizeImageUrlError(rawImageUrl);
  if (imageUrlError) {
    return res.status(imageUrlError.status).json({
      ok: false,
      error: { code: imageUrlError.code, message: imageUrlError.message }
    });
  }

  const imageUrl = normalizeImageUrl(rawImageUrl);

  return persistImage(imageUrl, req.body?.prompt)
    .then((image) => res.status(201).json({ ok: true, data: image }))
    .catch(() => res.status(500).json({
      ok: false,
      error: { code: 'PERSIST_FAILED', message: 'Failed to persist image' }
    }));
});

app.patch('/api/images/:id/position', (req, res) => {
  const { id } = req.params;
  const x = Number(req.body?.x);
  const y = Number(req.body?.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return res.status(400).json({ error: 'x and y must be finite numbers' });
  }

  return persistImagePosition(id, Math.round(x), Math.round(y))
    .then((image) => {
      if (!image) return res.status(404).json({ error: 'Image not found' });
      return res.json(image);
    })
    .catch(() => res.status(500).json({ error: 'Failed to persist image position' }));
});

// Serve the latest pinned image by redirecting to its source URL. Callers can
// request metadata with `?metadata=1` while preserving the record by default.
app.get('/api/images/latest', (req, res) => {
  const items = loadBoard();
  if (!items || items.length === 0) {
    return res.status(404).json({ error: 'No images found' });
  }

  const latest = items[items.length - 1];
  if (!latest?.url) return res.status(404).json({ error: 'Latest image not found' });

  if (req.query.metadata === '1' || req.query.metadata === 'true') {
    return res.json({ ...latest, prompt: latest.prompt ?? null });
  }

  return res.redirect(302, latest.url);
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  const baseUrl = HOST === '0.0.0.0' ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`Pinboard running on ${baseUrl} (bound to ${HOST}:${PORT})`);
});

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

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

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('ONLY_IMAGES_ALLOWED'));
    }
    cb(null, true);
  }
});

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

function normalizeUploadError(err) {
  if (!err) return null;
  if (err.message === 'ONLY_IMAGES_ALLOWED') {
    return { status: 400, code: 'ONLY_IMAGES_ALLOWED', message: 'Only image files are allowed' };
  }
  return { status: 400, code: 'INVALID_UPLOAD', message: 'Invalid upload payload' };
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

function promptToHeaderValue(prompt) {
  if (prompt == null) return null;
  return typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
}

function createImageFromFile(file, prompt) {
  const pos = randomPos();
  return {
    id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    url: `/uploads/${file.filename}`,
    x: pos.x,
    y: pos.y,
    rotation: Math.round((Math.random() * 16 - 8) * 10) / 10,
    scale: Math.round((0.75 + Math.random() * 0.7) * 100) / 100,
    createdAt: new Date().toISOString(),
    originalName: file.originalname,
    prompt: normalizePrompt(prompt)
  };
}

let persistQueue = Promise.resolve();

function enqueuePersist(task) {
  const run = persistQueue.then(task, task);
  persistQueue = run.catch(() => {});
  return run;
}

function persistImage(file, prompt) {
  return enqueuePersist(async () => {
    const items = loadBoard();
    const image = createImageFromFile(file, prompt);
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
  upload.single('image')(req, res, (err) => {
    const uploadError = normalizeUploadError(err);
    if (uploadError) return res.status(uploadError.status).json({ error: uploadError.message });
    if (!req.file) return res.status(400).json({ error: 'No image file received' });

    persistImage(req.file, req.body?.prompt)
      .then((image) => res.status(201).json(image))
      .catch(() => res.status(500).json({ error: 'Failed to persist image' }));
  });
});

app.post('/api/images/script', (req, res) => {
  upload.single('image')(req, res, (err) => {
    const uploadError = normalizeUploadError(err);
    if (uploadError) {
      return res.status(uploadError.status).json({
        ok: false,
        error: { code: uploadError.code, message: uploadError.message }
      });
    }

    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: { code: 'NO_IMAGE_FILE', message: 'No image file received' }
      });
    }

    return persistImage(req.file, req.body?.prompt)
      .then((image) => res.status(201).json({ ok: true, data: image }))
      .catch(() => res.status(500).json({
        ok: false,
        error: { code: 'PERSIST_FAILED', message: 'Failed to persist image' }
      }));
  });
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

// Serve the latest pinned image as a raw image file. Callers can request
// metadata with `?metadata=1` while preserving the image response by default.
app.get('/api/images/latest', (req, res) => {
  const items = loadBoard();
  if (!items || items.length === 0) {
    return res.status(404).json({ error: 'No images found' });
  }

  const latest = items[items.length - 1];
  const filename = latest?.url ? path.basename(latest.url) : null;
  if (!filename) return res.status(404).json({ error: 'Latest image not found' });

  const filePath = path.join(uploadsDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Image file not found on disk' });

  if (req.query.metadata === '1' || req.query.metadata === 'true') {
    return res.json({ ...latest, prompt: latest.prompt ?? null });
  }

  const promptHeader = promptToHeaderValue(latest.prompt);
  if (promptHeader) {
    res.setHeader('X-Image-Prompt', promptHeader);
  }
  res.setHeader('X-Image-Id', latest.id);
  if (latest.originalName) {
    res.setHeader('X-Image-Original-Name', latest.originalName);
  }

  return res.sendFile(filePath);
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, HOST, () => {
  const baseUrl = HOST === '0.0.0.0' ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`Pinboard running on ${baseUrl} (bound to ${HOST}:${PORT})`);
});

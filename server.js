const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.get('/api/images', (_req, res) => {
  res.json(loadBoard());
});

app.post('/api/images', (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      if (err.message === 'ONLY_IMAGES_ALLOWED') {
        return res.status(400).json({ error: 'Only image files are allowed' });
      }
      return res.status(400).json({ error: 'Invalid upload payload' });
    }

    if (!req.file) return res.status(400).json({ error: 'No image file received' });

    const items = loadBoard();
    const pos = randomPos();

    const image = {
      id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      url: `/uploads/${req.file.filename}`,
      x: pos.x,
      y: pos.y,
      rotation: Math.round((Math.random() * 16 - 8) * 10) / 10,
      scale: Math.round((0.75 + Math.random() * 0.7) * 100) / 100,
      createdAt: new Date().toISOString(),
      originalName: req.file.originalname
    };

    items.push(image);
    saveBoard(items);
    res.status(201).json(image);
  });
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Pinboard running on http://localhost:${PORT}`);
});

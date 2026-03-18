# Giant Pinboard

Interactive pinboard app with timeline history, single-image mode, and realtime updates.

## Current features

- Infinite-style pinboard with drag + zoom navigation
- Background grid moves/scales in sync with board transforms
- Randomized pin placement (clustered)
- Bottom timeline with blips for each pin
- Timeline slider to scrub historical states
- Topbar icon toggle for **Board mode** and **Single-image mode**
- Single-image mode shows the latest image at or before the selected timeline cutoff
- Realtime updates via SSE, new uploads appear instantly without reload
- Image upload validation (image files only)
- Script-friendly upload endpoint with structured JSON response

## Run

```bash
npm install
npm run dev
```

or:

```bash
npm start
```

Open: `http://localhost:3000`

## API

### `GET /api/images`
Returns all stored pins.

### `POST /api/images`
Upload one image via `multipart/form-data` (field name: `image`).

Example:

```bash
curl -X POST http://localhost:3000/api/images \
  -F "image=@/path/to/file.jpg"
```

Success response (`201`):

```json
{
  "id": "1710000000000-12345",
  "url": "/uploads/1710000000000-file.jpg",
  "x": 134,
  "y": -82,
  "rotation": -1.5,
  "scale": 1.02,
  "createdAt": "2026-03-18T00:00:00.000Z",
  "originalName": "file.jpg"
}
```

Error response (`400`):

```json
{ "error": "Only image files are allowed" }
```

### `POST /api/images/script`
Script-oriented upload endpoint (same multipart upload format).

Example:

```bash
curl -X POST http://localhost:3000/api/images/script \
  -F "image=@/path/to/file.jpg"
```

Success response (`201`):

```json
{
  "ok": true,
  "data": {
    "id": "1710000000000-12345",
    "url": "/uploads/1710000000000-file.jpg"
  }
}
```

Error response (`400`):

```json
{
  "ok": false,
  "error": {
    "code": "ONLY_IMAGES_ALLOWED",
    "message": "Only image files are allowed"
  }
}
```

### `GET /api/stream`
Server-Sent Events stream for realtime pin events.

Events:
- `ready`
- `keepalive`
- `pin-created` (payload = new pin object)

## Tests

```bash
npm test
```

Includes timeline/history logic and upload validation coverage.

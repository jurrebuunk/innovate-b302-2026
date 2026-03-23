# Giant Pinboard

A web app that behaves like a giant infinite pinboard.

## Features
- Upload images via API endpoint (`POST /api/images`)
- Images are pinned at random coordinates on a large world
- Pan by dragging, zoom in/out with mouse wheel (Google Maps-style feel)
- Existing pins load from API (`GET /api/images`)

## Run
```bash
npm install
npm start
```
The server binds to `0.0.0.0` by default, so it is reachable from your LAN.
Open `http://localhost:3000` locally, or `http://<your-machine-ip>:3000` from another device on the same network.

## API
### `GET /api/images`
Returns all pinned images, including each stored `prompt` when present.

### `POST /api/images`
`multipart/form-data` with fields: `image`, optional `prompt`

`prompt` can be plain text or JSON text. If it starts with `{` or `[`, the server attempts to parse and store it as JSON.

Example:
```bash
curl -X POST http://localhost:3000/api/images \
  -F "image=@/path/to/file.jpg" \
  -F "prompt=a clean product composition"
```

Structured prompt example:
```bash
curl -X POST http://localhost:3000/api/images \
  -F "image=@/path/to/file.jpg" \
  -F 'prompt={"mood":"calm","style":"minimal"}'
```

Response example:
```json
{
  "id": "1710000000000-12345",
  "url": "/uploads/1710000000000-file.jpg",
  "x": 1342,
  "y": -823,
  "createdAt": "2026-03-13T15:00:00.000Z",
  "originalName": "file.jpg",
  "prompt": {
    "mood": "calm",
    "style": "minimal"
  }
}
```

### `GET /api/images/latest`
Returns the latest image as raw bytes by default so it still works as an image URL.
Add `?metadata=1` to return the stored JSON record, including `prompt`.

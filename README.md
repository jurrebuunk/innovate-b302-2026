# Giant Pinboard

A web app that behaves like a giant infinite pinboard.

## Features
- Pin images from external URLs via API endpoint (`POST /api/images`)
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
`application/json` with fields: `imageUrl`, optional `prompt`

`imageUrl` must be an absolute `http://` or `https://` URL pointing to an externally hosted image.

`prompt` can be plain text or JSON text. If it starts with `{` or `[`, the server attempts to parse and store it as JSON.

Example:
```bash
curl -X POST http://localhost:3000/api/images \
  -H 'Content-Type: application/json' \
  -d '{"imageUrl":"https://example.com/image.jpg","prompt":"a clean product composition"}'
```

Structured prompt example:
```bash
curl -X POST http://localhost:3000/api/images \
  -H 'Content-Type: application/json' \
  -d '{"imageUrl":"https://example.com/image.jpg","prompt":{"mood":"calm","style":"minimal"}}'
```

Response example:
```json
{
  "id": "1710000000000-12345",
  "url": "https://example.com/image.jpg",
  "x": 1342,
  "y": -823,
  "createdAt": "2026-03-13T15:00:00.000Z",
  "prompt": {
    "mood": "calm",
    "style": "minimal"
  }
}
```

### `GET /api/images/latest`
Redirects to the latest stored image URL by default.
Add `?metadata=1` to return the stored JSON record, including `prompt` and `url`.

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
Then open `http://localhost:3000`.

## API
### `GET /api/images`
Returns all pinned images.

### `POST /api/images`
`multipart/form-data` with field: `image`

Example:
```bash
curl -X POST http://localhost:3000/api/images \
  -F "image=@/path/to/file.jpg"
```

Response example:
```json
{
  "id": "1710000000000-12345",
  "url": "/uploads/1710000000000-file.jpg",
  "x": 1342,
  "y": -823,
  "createdAt": "2026-03-13T15:00:00.000Z",
  "originalName": "file.jpg"
}
```

# TIMELINE_TEST_REPORT

Date: 2026-03-17 (Europe/Amsterdam)
Branch: `feat/issues-1-2-background-timeline`
Environment: local app served via `node server.js`, browser automation via Playwright (Chromium, headless)

## Scope
Validated timeline and drag behavior for:
1. Blip creation on each pin
2. Selector scrubbing backward/forward
3. Historical image count per selector position
4. Latest state at timeline end
5. UI stability while dragging board/background

## Test Steps and Results

| # | Step | Expected | Actual | Result |
|---|------|----------|--------|--------|
| 1 | Loaded app, recorded baseline blip/pin count, pinned 3 images via upload form | Blip count increases by exactly 1 per pin | Blips `21 -> 24`, pins `21 -> 24` after 3 pin actions | PASS |
| 2 | Moved timeline selector across multiple positions (0..6) | Scrubbing backward/forward updates visible board state smoothly | Selector positions produced visible pin counts `0,1,2,3,4,5,6` respectively | PASS |
| 3 | Compared visible pin count to selected timeline position | Visible pin count matches selected historical point | At each tested position, count matched exactly (`position N => N pins`) | PASS |
| 4 | Set selector to timeline end (`max`) | Latest/full board state restored at end | End position showed `24` pins (max `24`) and label was `Latest` | PASS |
| 5 | Dragged board after timeline interactions and observed board/background + runtime stability | Board and background move together; timeline remains visible; no runtime JS errors | `boardChanged=true`, `bgChanged=true`, `timelineVisible=true`, `runtimeErrors=[]` | PASS |

## Notes
- Existing dataset already contained pinned images from prior runs; validation used delta checks and per-position assertions to avoid false positives.
- During browser run, some image URLs from historic data may 404 if backing upload files are absent; this did not produce runtime script errors and did not affect timeline behavior checks.
- Automated browser test scenario executed successfully end-to-end.

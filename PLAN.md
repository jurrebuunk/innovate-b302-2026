# PLAN

## Goal
Implement single-image mode + realtime timeline updates + script-friendly upload API for `jurrebuunk/innovate-b302-2026`.

## Steps
1. Create feature branch from latest `origin/master` and baseline-check existing behavior. ✅
2. Add topbar icon-only single-image mode toggle and mode-specific rendering while keeping topbar + timeline visible. ✅
3. Ensure timeline cutoff drives both modes (board history and single latest-at-cutoff image). ✅
4. Add SSE realtime feed and wire client updates so new uploads appear instantly in both modes. ✅
5. Add script-friendly multipart upload endpoint with stable response + validation. ✅
6. Apply UX/perf polish for timeline/mode switching smoothness. ✅
7. Add/extend tests for cutoff logic and API realtime behavior; run full test suite. ✅ (`npm test`: 7 passed)
8. Commit logical changes, push branch, open PR, comment on issue #4 with PR link + summary. ⏳

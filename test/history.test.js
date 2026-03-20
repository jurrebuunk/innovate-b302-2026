const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clampVisibleCount,
  timelineStatusLabel,
  backgroundTransform,
  timelineStepOffset,
  timelineVisibleCountFromOffset,
  latestPinAtOrBeforeCutoff
} = require('../public/history.js');

test('clampVisibleCount clamps to valid timeline range', () => {
  assert.equal(clampVisibleCount(5, -1), 0);
  assert.equal(clampVisibleCount(5, 3), 3);
  assert.equal(clampVisibleCount(5, 10), 5);
});

test('timelineStatusLabel returns Latest only at end', () => {
  assert.equal(timelineStatusLabel(5, 5), 'Latest');
  assert.equal(timelineStatusLabel(2, 5), '2/5 pinned');
});

test('backgroundTransform aligns grid position and scaled size', () => {
  assert.deepEqual(backgroundTransform(120, -40, 2, 40), {
    position: '120px -40px',
    size: '80px 80px'
  });

  assert.deepEqual(backgroundTransform(0, 0, 0.01, 40), {
    position: '0px 0px',
    size: '4px 4px'
  });
});

test('timeline step offsets and offset-to-step conversion stay aligned', () => {
  const laneWidth = 310;
  const totalPins = 6;
  const inset = 10;

  assert.equal(timelineStepOffset(0, totalPins, laneWidth, inset), 10);
  assert.equal(timelineStepOffset(6, totalPins, laneWidth, inset), 300);

  for (let visibleCount = 0; visibleCount <= totalPins; visibleCount++) {
    const offset = timelineStepOffset(visibleCount, totalPins, laneWidth, inset);
    assert.equal(timelineVisibleCountFromOffset(offset, totalPins, laneWidth, inset), visibleCount);
  }
});

test('latestPinAtOrBeforeCutoff resolves latest historical item at cutoff', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(latestPinAtOrBeforeCutoff(items, 0), null);
  assert.deepEqual(latestPinAtOrBeforeCutoff(items, 1), { id: 'a' });
  assert.deepEqual(latestPinAtOrBeforeCutoff(items, 2), { id: 'b' });
  assert.deepEqual(latestPinAtOrBeforeCutoff(items, 999), { id: 'c' });
});

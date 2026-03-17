const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clampVisibleCount,
  timelineStatusLabel,
  backgroundTransform
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

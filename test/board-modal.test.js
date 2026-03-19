const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

test('board modal markup exists with visible close button', () => {
  assert.match(indexHtml, /id="imageModal"/);
  assert.match(indexHtml, /id="imageModalClose"/);
  assert.match(indexHtml, /id="imageModalImage"/);
});

test('board modal supports escape and backdrop close interactions', () => {
  assert.match(appJs, /if \(e\.key === 'Escape' && !imageModal\?\.hidden\)/);
  assert.match(appJs, /imageModal\?\.addEventListener\('click', \(e\) => \{/);
  assert.match(appJs, /if \(e\.target !== imageModal\) return;/);
});

test('clicking a pin in board mode opens the image modal', () => {
  assert.match(appJs, /board\.addEventListener\('click', \(e\) => \{/);
  assert.match(appJs, /if \(state\.mode !== 'board'\) return;/);
  assert.match(appJs, /const pin = e\.target\.closest\('\.pin'\);/);
  assert.match(appJs, /openImageModal\(item\);/);
});

test('dragging a pin suppresses modal open on release click', () => {
  assert.match(appJs, /if \(!state\.pinDrag\.moved && Math\.hypot\(moveDx, moveDy\) > 4\) \{/);
  assert.match(appJs, /state\.suppressModalForPinId = item\.id;/);
  assert.match(appJs, /Date\.now\(\) <= state\.suppressModalUntil/);
});

test('timeline blips are positioned by index ratio across lane', () => {
  assert.match(appJs, /const ratio = total <= 1 \? 0 : i \/ maxIndex;/);
  assert.match(appJs, /blip\.style\.left = `\$\{ratio \* 100\}%`;/);
});

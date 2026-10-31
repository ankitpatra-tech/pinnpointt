import { stripJpegExifLossless, isMetadataStrippable } from '../src/lib/privacyShield';
import { detectClipboardContentType, formatClipboardSnippet, isClipboardSyncMessage } from '../src/lib/clipboardSync';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

console.log('Testing Privacy Shield & Clipboard Sync...');

// 1. isMetadataStrippable
const dummyJpeg = new File([new Uint8Array(10)], 'photo.JPG', { type: 'image/jpeg' });
const dummyPng = new File([new Uint8Array(10)], 'image.png', { type: 'image/png' });
const dummyTxt = new File([new Uint8Array(10)], 'doc.txt', { type: 'text/plain' });

assert(isMetadataStrippable(dummyJpeg), 'JPEG should be strippable');
assert(isMetadataStrippable(dummyPng), 'PNG should be strippable');
assert(!isMetadataStrippable(dummyTxt), 'TXT should not be strippable');
console.log('✓ isMetadataStrippable tests passed');

// 2. stripJpegExifLossless
// Construct JPEG buffer: SOI (FF D8) + APP1 EXIF (FF E1 00 0A ...) + SOF0 (FF C0 00 0B ...) + SOS (FF DA ...) + data + EOI (FF D9)
const fakeJpeg = new Uint8Array([
  0xff, 0xd8, // SOI
  0xff, 0xe1, 0x00, 0x0a, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x01, 0x02, // APP1 (length 10 including length bytes)
  0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46, // APP0 (JFIF)
  0xff, 0xda, 0x00, 0x04, 0x01, 0x02, // SOS (entropy start)
  0x11, 0x22, 0x33, // entropy bytes
  0xff, 0xd9, // EOI
]);

const stripped = stripJpegExifLossless(fakeJpeg.buffer);
assert(stripped.stripped, 'Lossless strip should succeed');
assert(stripped.removedBytes === 12, `Removed bytes should be 12 (FF E1 + 10 bytes), got ${stripped.removedBytes}`);

// Verify APP1 is gone and APP0 + SOS remain
const strippedBytes = new Uint8Array(stripped.buffer);
assert(strippedBytes[0] === 0xff && strippedBytes[1] === 0xd8, 'Must start with SOI');
let hasApp1 = false;
for (let i = 0; i < strippedBytes.length - 1; i++) {
  if (strippedBytes[i] === 0xff && strippedBytes[i + 1] === 0xe1) {
    hasApp1 = true;
  }
}
assert(!hasApp1, 'APP1 marker must not exist in stripped JPEG');
console.log('✓ stripJpegExifLossless tests passed');

// 3. detectClipboardContentType
assert(detectClipboardContentType('https://example.com/test') === 'url', 'Should detect valid URL');
assert(detectClipboardContentType('http://localhost:5173') === 'url', 'Should detect localhost URL');
assert(
  detectClipboardContentType('function hello() {\n  const x = 10;\n  return x;\n}') === 'code',
  'Should detect code block',
);
assert(
  detectClipboardContentType('import React from "react";\nexport default App;') === 'code',
  'Should detect import code',
);
assert(detectClipboardContentType('Just a simple note for you.') === 'text', 'Should detect plain text');
console.log('✓ detectClipboardContentType tests passed');

// 4. formatClipboardSnippet
assert(formatClipboardSnippet('Hello world') === 'Hello world', 'Snippet within length unchanged');
assert(formatClipboardSnippet('a'.repeat(200), 20).length === 20, 'Snippet truncated with ellipsis');
console.log('✓ formatClipboardSnippet tests passed');

// 5. isClipboardSyncMessage
assert(
  isClipboardSyncMessage({
    type: 'clipboard-sync',
    item: { id: '1', type: 'text', content: 'test', timestamp: 123, sender: 'alice' },
  }),
  'Valid clipboard message',
);
assert(!isClipboardSyncMessage({ type: 'other' }), 'Invalid clipboard message');
console.log('✓ isClipboardSyncMessage tests passed');

console.log('\nALL PRIVACY & CLIPBOARD TESTS PASSED!');

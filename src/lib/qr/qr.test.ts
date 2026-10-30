declare const process: { exit: (code: number) => void } | undefined;

/**
 * Smoke test — run with: npx tsx src/lib/qr/qr.test.ts
 *
 * Validates GF(2^8) tables, Reed-Solomon EC output, and QREngine matrix dimensions.
 */

import { EXP_TABLE, LOG_TABLE, gfMul, gfPow, gfAdd } from './GaloisField';
import { computeECBytes } from './ReedSolomon';
import { QREngine } from './QREngine';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${msg}`);
  }
}

// --- GF(2^8) basic checks ---
assert(EXP_TABLE[0] === 1, 'α^0 = 1');
assert(EXP_TABLE[1] === 2, 'α^1 = 2');
assert(EXP_TABLE[8] === 29, 'α^8 = 29  (x^8 mod 0x11D)');
assert(LOG_TABLE[1] === 0, 'log(1) = 0');
assert(LOG_TABLE[2] === 1, 'log(2) = 1');

// α^255 should equal α^0 = 1 in the multiplicative group
assert(gfPow(2, 255) === 1, 'α^255 = 1 (field order)');

// Multiply / add identity
assert(gfMul(0, 123) === 0, '0 × anything = 0');
assert(gfMul(1, 123) === 123, '1 × anything = itself');
assert(gfAdd(0, 123) === 123, '0 ⊕ anything = itself');

// --- Reed-Solomon ---
// For all-zero data, the EC should also be all zeros (since 0 * g(x) = 0).
const zeroData = new Uint8Array(28);
const zeroEC = computeECBytes(zeroData, 16);
assert(zeroEC.every(b => b === 0), 'EC of all-zero data = all zeros');

// Non-trivial: compute EC for a one-byte message [1, 0, 0, …] and verify length.
const oneData = new Uint8Array(28);
oneData[0] = 1;
const oneEC = computeECBytes(oneData, 16);
assert(oneEC.length === 16, 'EC length = 16');
assert(oneEC.some(b => b !== 0), 'EC of non-zero data is non-zero');

// --- QREngine ---
const engine = new QREngine();
const matrix = engine.encode('HELLO');
assert(matrix.length === 25, 'Matrix has 25 rows');
assert(matrix[0].length === 25, 'Matrix has 25 columns');

// Check finder pattern corners — top-left 7×7 outer ring should be dark.
assert(matrix[0][0] === true, 'Top-left finder corner (0,0) is dark');
assert(matrix[0][6] === true, 'Top-left finder corner (0,6) is dark');
assert(matrix[6][0] === true, 'Top-left finder corner (6,0) is dark');
assert(matrix[6][6] === true, 'Top-left finder corner (6,6) is dark');

// Top-right finder
assert(matrix[0][24] === true, 'Top-right finder corner (0,24) is dark');
assert(matrix[0][18] === true, 'Top-right finder corner (0,18) is dark');

// Bottom-left finder
assert(matrix[24][0] === true, 'Bottom-left finder corner (24,0) is dark');
assert(matrix[18][0] === true, 'Bottom-left finder corner (18,0) is dark');

// Alignment pattern center
assert(matrix[18][18] === true, 'Alignment pattern center (18,18) is dark');

// Dark module (V2: row 17, col 8)
assert(matrix[17][8] === true, 'Dark module at (17,8) is dark');

// Timing patterns — row 6 and col 6 should alternate dark/light starting dark at even indices
assert(matrix[6][8] === true, 'Horizontal timing at (6,8) is dark (even col)');
assert(matrix[6][9] === false, 'Horizontal timing at (6,9) is light (odd col)');
assert(matrix[8][6] === true, 'Vertical timing at (8,6) is dark (even row)');
assert(matrix[9][6] === false, 'Vertical timing at (9,6) is light (odd row)');

// Print ASCII representation
console.log('\nQR Code for "HELLO" (V2-M):');
for (const row of matrix) {
  console.log(row.map(m => m ? '██' : '  ').join(''));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  if (typeof process !== 'undefined' && typeof process.exit === 'function') {
    process.exit(1);
  } else {
    throw new Error(`${failed} tests failed`);
  }
}

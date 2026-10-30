/**
 * Galois Field GF(2^8) arithmetic for QR Code Reed-Solomon encoding.
 *
 * Primitive polynomial: 0x11D  →  x^8 + x^4 + x^3 + x^2 + 1
 * This is the polynomial specified by ISO/IEC 18004 (QR Code standard).
 *
 * All elements are integers in the range [0, 255].
 * α (alpha) is the primitive element, represented as the integer 2.
 */

const PRIMITIVE_POLY = 0x11D;
const FIELD_SIZE = 256;

/**
 * EXP_TABLE[i] = α^i  (mod primitive polynomial), for i in [0, 255].
 * Note: α^255 = 1 (the multiplicative group has order 255).
 */
export const EXP_TABLE: readonly number[] = buildExpTable();

/**
 * LOG_TABLE[v] = i such that α^i = v, for v in [1, 255].
 * LOG_TABLE[0] is undefined (log of zero does not exist); we store 0 as a sentinel.
 */
export const LOG_TABLE: readonly number[] = buildLogTable();

// ---------------------------------------------------------------------------
// Table construction
// ---------------------------------------------------------------------------

function buildExpTable(): number[] {
  const table = new Array<number>(FIELD_SIZE);
  let value = 1; // α^0 = 1
  for (let i = 0; i < FIELD_SIZE; i++) {
    table[i] = value;
    value <<= 1; // multiply by α (i.e. by 2)
    if (value >= FIELD_SIZE) {
      value ^= PRIMITIVE_POLY; // reduce modulo the primitive polynomial
    }
  }
  return table;
}

function buildLogTable(): number[] {
  const table = new Array<number>(FIELD_SIZE).fill(0);
  for (let i = 0; i < FIELD_SIZE - 1; i++) {
    table[EXP_TABLE[i]] = i;
  }
  return table;
}

// ---------------------------------------------------------------------------
// Arithmetic operations
// ---------------------------------------------------------------------------

/**
 * Addition (and subtraction) in GF(2^8) is XOR.
 */
export function gfAdd(a: number, b: number): number {
  return a ^ b;
}

/**
 * Multiply two elements in GF(2^8).
 * Returns 0 when either operand is 0.
 */
export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  const logSum = LOG_TABLE[a] + LOG_TABLE[b];
  // Reduce modulo 255 (the order of the multiplicative group).
  return EXP_TABLE[logSum % 255];
}

/**
 * Divide a by b in GF(2^8).  b must not be 0.
 * Returns 0 when a is 0.
 */
export function gfDiv(a: number, b: number): number {
  if (b === 0) throw new RangeError('Division by zero in GF(2^8)');
  if (a === 0) return 0;
  let logDiff = LOG_TABLE[a] - LOG_TABLE[b];
  if (logDiff < 0) logDiff += 255;
  return EXP_TABLE[logDiff % 255];
}

/**
 * Raise an element to a power in GF(2^8).
 * gfPow(a, 0) = 1 for all a (including 0^0 = 1 by convention here).
 */
export function gfPow(a: number, exp: number): number {
  if (exp === 0) return 1;
  if (a === 0) return 0;
  const logResult = (LOG_TABLE[a] * exp) % 255;
  return EXP_TABLE[((logResult % 255) + 255) % 255];
}

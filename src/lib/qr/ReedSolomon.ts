/**
 * Reed-Solomon error correction for QR Codes.
 *
 * Generates EC codewords by polynomial division in GF(2^8)
 * using the QR Code generator polynomial convention:
 *   g(x) = ∏_{i=0}^{ecCount-1} (x − α^i)
 *
 * All math delegated to GaloisField.ts (no external libs).
 */

import { EXP_TABLE, gfMul, gfAdd } from './GaloisField';

// ---------------------------------------------------------------------------
// Generator polynomial
// ---------------------------------------------------------------------------

/**
 * Build the generator polynomial for `ecCount` error-correction codewords.
 *
 * The polynomial is represented as an array of coefficients where
 * index 0 is the highest-degree coefficient (leading coeff is always 1,
 * but we keep it explicit for clarity).
 *
 * g(x) = (x − α^0)(x − α^1) … (x − α^{ecCount−1})
 *
 * In GF(2^8) subtraction is identical to addition (XOR), so
 * (x − α^i) = (x + α^i) = (x ⊕ α^i).
 */
function buildGeneratorPoly(ecCount: number): Uint8Array {
  // Start with g(x) = 1  (a degree-0 polynomial)
  let gen = new Uint8Array([1]);

  for (let i = 0; i < ecCount; i++) {
    // Multiply gen by (x + α^i)
    const next = new Uint8Array(gen.length + 1);
    const alphaI = EXP_TABLE[i % 255];

    for (let j = 0; j < gen.length; j++) {
      // Contribution to x^{degree} term  (multiply by x)
      next[j] = gfAdd(next[j], gen[j]);
      // Contribution to x^{degree-1} term  (multiply by α^i)
      next[j + 1] = gfAdd(next[j + 1], gfMul(gen[j], alphaI));
    }
    gen = next;
  }

  return gen;
}

// Cache generator polynomials by ecCount (we almost always need 16).
const generatorCache = new Map<number, Uint8Array>();

function getGeneratorPoly(ecCount: number): Uint8Array {
  let g = generatorCache.get(ecCount);
  if (!g) {
    g = buildGeneratorPoly(ecCount);
    generatorCache.set(ecCount, g);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute `ecCount` Reed-Solomon error correction codewords for `data`.
 *
 * This performs synthetic (polynomial long) division of the message polynomial
 * m(x) · x^{ecCount} by the generator polynomial g(x), returning the remainder
 * as a Uint8Array of length `ecCount`.
 *
 * @param data    Data codewords (message polynomial coefficients, high-degree first).
 * @param ecCount Number of EC codewords to produce.
 * @returns       Uint8Array of `ecCount` error-correction codewords.
 */
export function computeECBytes(data: Uint8Array, ecCount: number): Uint8Array {
  const gen = getGeneratorPoly(ecCount);

  // Working buffer for the remainder; initialised to zero.
  const remainder = new Uint8Array(ecCount);

  for (let i = 0; i < data.length; i++) {
    // XOR the next data byte into the leading coefficient of the remainder.
    const lead = gfAdd(data[i], remainder[0]);

    // Shift the remainder left by one position.
    for (let j = 0; j < ecCount - 1; j++) {
      remainder[j] = remainder[j + 1];
    }
    remainder[ecCount - 1] = 0;

    // Subtract (XOR) lead × g[j] from remainder.
    // gen[0] is always 1 (leading coefficient), so we start at j = 1.
    for (let j = 1; j < gen.length; j++) {
      remainder[j - 1] = gfAdd(remainder[j - 1], gfMul(lead, gen[j]));
    }
  }

  return remainder;
}

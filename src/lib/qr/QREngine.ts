/**
 * High-reliability QR Code Generator (ISO/IEC 18004:2015).
 *
 * Supports Versions 1 to 40 with auto-scaling to fit any string or URL length.
 * Features optimal mask selection (lowest penalty score) for instant camera recognition.
 * Zero external dependencies.
 */

export enum Ecc {
  LOW = 0,
  MEDIUM = 1,
  QUARTILE = 2,
  HIGH = 3,
}

export class QREngine {
  /**
   * Encodes an ASCII string or URL into a boolean[][] QR matrix.
   * `true` = dark module, `false` = light module.
   *
   * @param data - The text or URL to encode.
   * @param minVersion - Minimum version to use (default 2 to preserve 25x25 base).
   * @param ecc - Error correction level (default MEDIUM).
   */
  encode(data: string, minVersion = 2, ecc = Ecc.MEDIUM): boolean[][] {
    const textBytes: number[] = [];
    for (let i = 0; i < data.length; i++) {
      const code = data.charCodeAt(i);
      if (code < 128) {
        textBytes.push(code);
      } else if (code < 2048) {
        textBytes.push((code >> 6) | 192, (code & 63) | 128);
      } else {
        textBytes.push((code >> 12) | 224, ((code >> 6) & 63) | 128, (code & 63) | 128);
      }
    }

    // Find the smallest version (between minVersion and 40) that fits the data
    let version = minVersion;
    for (; version <= 40; version++) {
      const capacityBits = getNumDataCodewords(version, ecc) * 8;
      const countBits = version < 10 ? 8 : 16;
      const headerBits = 4 + countBits;
      const totalBitsNeeded = headerBits + textBytes.length * 8;
      if (totalBitsNeeded <= capacityBits) {
        break;
      }
    }

    if (version > 40) {
      throw new RangeError(`Data too long for QR Code (length: ${data.length} characters)`);
    }

    const qr = QrCode.encodeBinary(new Uint8Array(textBytes), ecc, version);
    const size = qr.size;
    const matrix: boolean[][] = [];
    for (let y = 0; y < size; y++) {
      const row: boolean[] = [];
      for (let x = 0; x < size; x++) {
        row.push(qr.getModule(x, y));
      }
      matrix.push(row);
    }
    return matrix;
  }
}

// ---------------------------------------------------------------------------
// QR Code Generator Engine Core (ISO/IEC 18004 Standard)
// ---------------------------------------------------------------------------

class QrCode {
  readonly size: number;
  private readonly modules: boolean[][];
  private readonly isFunction: boolean[][];

  constructor(
    readonly version: number,
    readonly errorCorrectionLevel: Ecc,
    dataCodewords: Uint8Array,
    msk = -1,
  ) {
    if (version < 1 || version > 40) throw new RangeError('Version value out of range');
    this.size = version * 4 + 17;

    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));

    this.drawFunctionPatterns();
    const allCodewords = this.addEccAndInterleave(dataCodewords);
    this.drawCodewords(allCodewords);

    // If mask is -1, evaluate all 8 masks and pick the one with the lowest penalty score
    if (msk === -1) {
      let minPenalty = 1e9;
      let bestMask = 0;
      for (let i = 0; i < 8; i++) {
        this.applyMask(i);
        this.drawFormatBits(i);
        const penalty = this.getPenaltyScore();
        if (penalty < minPenalty) {
          minPenalty = penalty;
          bestMask = i;
        }
        this.applyMask(i); // undo mask
      }
      msk = bestMask;
    }

    this.applyMask(msk);
    this.drawFormatBits(msk);
  }

  getModule(x: number, y: number): boolean {
    return x >= 0 && x < this.size && y >= 0 && y < this.size && this.modules[y][x];
  }

  static encodeBinary(data: Uint8Array, ecl: Ecc, targetVersion: number): QrCode {
    const bitBuf: number[] = [];

    // Mode: Byte (0100)
    appendBits(0b0100, 4, bitBuf);

    // Character count indicator
    const countBits = targetVersion < 10 ? 8 : 16;
    appendBits(data.length, countBits, bitBuf);

    // Data payload
    for (const b of data) {
      appendBits(b, 8, bitBuf);
    }

    const dataCapacityBits = getNumDataCodewords(targetVersion, ecl) * 8;

    // Terminator (up to 4 zeroes)
    appendBits(0, Math.min(4, dataCapacityBits - bitBuf.length), bitBuf);

    // Pad to byte boundary
    while (bitBuf.length % 8 !== 0) {
      bitBuf.push(0);
    }

    // Pad with alternating 0xEC and 0x11
    const padBytes = [0xec, 0x11];
    let padIdx = 0;
    while (bitBuf.length < dataCapacityBits) {
      appendBits(padBytes[padIdx], 8, bitBuf);
      padIdx ^= 1;
    }

    // Pack into bytes
    const dataCodewords = new Uint8Array(bitBuf.length / 8);
    for (let i = 0; i < bitBuf.length; i++) {
      dataCodewords[i >>> 3] |= bitBuf[i] << (7 - (i & 7));
    }

    return new QrCode(targetVersion, ecl, dataCodewords);
  }

  private drawFunctionPatterns(): void {
    // Timing patterns
    for (let i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }

    // Finder patterns & separators
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    // Alignment patterns
    const alignPos = getAlignmentPatternPositions(this.version);
    const numAlign = alignPos.length;
    for (let i = 0; i < numAlign; i++) {
      for (let j = 0; j < numAlign; j++) {
        // Exclude finder corners
        if (
          (i === 0 && j === 0) ||
          (i === 0 && j === numAlign - 1) ||
          (i === numAlign - 1 && j === 0)
        ) {
          continue;
        }
        this.drawAlignmentPattern(alignPos[i], alignPos[j]);
      }
    }

    // Reserve format bits area
    this.drawFormatBits(0);
    this.drawVersion();
  }

  private drawFinderPattern(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const px = x + dx;
        const py = y + dy;
        if (px >= 0 && px < this.size && py >= 0 && py < this.size) {
          this.setFunctionModule(px, py, dist !== 2 && dist !== 4);
        }
      }
    }
  }

  private drawAlignmentPattern(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  private setFunctionModule(x: number, y: number, isDark: boolean): void {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  }

  private drawFormatBits(mask: number): void {
    // ECC bits: L=01, M=00, Q=11, H=10
    const eccBits = [1, 0, 3, 2][this.errorCorrectionLevel];
    const data = (eccBits << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) {
      rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    }
    const bits = ((data << 10) | rem) ^ 0x5412;

    // Draw 15 format bits around finders
    for (let i = 0; i <= 5; i++) this.setFunctionModule(8, i, getBit(bits, i));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, getBit(bits, i));

    for (let i = 0; i < 8; i++) this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
    this.setFunctionModule(8, this.size - 8, true); // Dark module
  }

  private drawVersion(): void {
    if (this.version < 7) return;

    let rem = this.version;
    for (let i = 0; i < 12; i++) {
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    }
    const bits = (this.version << 12) | rem;

    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunctionModule(a, b, bit);
      this.setFunctionModule(b, a, bit);
    }
  }

  private addEccAndInterleave(data: Uint8Array): Uint8Array {
    const ver = this.version;
    const ecl = this.errorCorrectionLevel;
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][ver];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][ver];
    const rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);

    const blocks: Uint8Array[] = [];
    const rs = new ReedSolomonGenerator(blockEccLen);

    let k = 0;
    for (let i = 0; i < numBlocks; i++) {
      const datLen = shortBlockLen - blockEccLen + (i >= numShortBlocks ? 1 : 0);
      const dat = data.slice(k, k + datLen);
      k += datLen;
      const ecc = rs.getRemainder(dat);
      const fullBlock = new Uint8Array(dat.length + ecc.length);
      fullBlock.set(dat, 0);
      fullBlock.set(ecc, dat.length);
      blocks.push(fullBlock);
    }

    const result = new Uint8Array(rawCodewords);
    let idx = 0;
    for (let i = 0; i < shortBlockLen + 1; i++) {
      for (let j = 0; j < numBlocks; j++) {
        if (i < blocks[j].length) {
          result[idx++] = blocks[j][i];
        }
      }
    }
    return result;
  }

  private drawCodewords(data: Uint8Array): void {
    let bitIdx = 0;
    const numBits = data.length * 8;

    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip timing pattern col
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && bitIdx < numBits) {
            this.modules[y][x] = getBit(data[bitIdx >>> 3], 7 - (bitIdx & 7));
            bitIdx++;
          }
        }
      }
    }
  }

  private applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y][x]) continue;
        let invert = false;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (invert) {
          this.modules[y][x] = !this.modules[y][x];
        }
      }
    }
  }

  private getPenaltyScore(): number {
    let result = 0;
    const size = this.size;

    // Adjacent runs of 5 or more same-color modules
    for (let y = 0; y < size; y++) {
      let runColor = false;
      let runLen = 0;
      for (let x = 0; x < size; x++) {
        const color = this.modules[y][x];
        if (color === runColor) {
          runLen++;
        } else {
          if (runLen >= 5) result += 3 + (runLen - 5);
          runColor = color;
          runLen = 1;
        }
      }
      if (runLen >= 5) result += 3 + (runLen - 5);
    }

    for (let x = 0; x < size; x++) {
      let runColor = false;
      let runLen = 0;
      for (let y = 0; y < size; y++) {
        const color = this.modules[y][x];
        if (color === runColor) {
          runLen++;
        } else {
          if (runLen >= 5) result += 3 + (runLen - 5);
          runColor = color;
          runLen = 1;
        }
      }
      if (runLen >= 5) result += 3 + (runLen - 5);
    }

    // 2x2 blocks of same color
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const color = this.modules[y][x];
        if (
          color === this.modules[y][x + 1] &&
          color === this.modules[y + 1][x] &&
          color === this.modules[y + 1][x + 1]
        ) {
          result += 3;
        }
      }
    }

    // Proportion of dark modules
    let dark = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (this.modules[y][x]) dark++;
      }
    }
    const total = size * size;
    const k = Math.floor(Math.abs(dark * 20 - total * 10) / total);
    result += k * 10;

    return result;
  }
}

class ReedSolomonGenerator {
  private readonly coefficients: Uint8Array;

  constructor(readonly degree: number) {
    let poly = new Uint8Array([1]);
    for (let i = 0; i < degree; i++) {
      const next = new Uint8Array(poly.length + 1);
      const root = expTable(i);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= mul(poly[j], root);
      }
      poly = next;
    }
    this.coefficients = poly;
  }

  getRemainder(data: Uint8Array): Uint8Array {
    const rem = new Uint8Array(this.degree);
    for (const b of data) {
      const factor = b ^ rem[0];
      for (let i = 0; i < this.degree - 1; i++) {
        rem[i] = rem[i + 1] ^ mul(this.coefficients[i + 1], factor);
      }
      rem[this.degree - 1] = mul(this.coefficients[this.degree], factor);
    }
    return rem;
  }
}

// ---------------------------------------------------------------------------
// GF(2^8) math helpers
// ---------------------------------------------------------------------------

function expTable(n: number): number {
  let val = 1;
  for (let i = 0; i < (n % 255); i++) {
    val = (val << 1) ^ (val >= 128 ? 0x11d : 0);
  }
  return val;
}

function mul(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ (z >= 256 ? 0x11d : 0);
    if ((y >>> i) & 1) z ^= x;
  }
  return z;
}

function appendBits(val: number, len: number, bitBuf: number[]): void {
  for (let i = len - 1; i >= 0; i--) {
    bitBuf.push((val >>> i) & 1);
  }
}

function getBit(val: number, i: number): boolean {
  return ((val >>> i) & 1) !== 0;
}

// ---------------------------------------------------------------------------
// ISO/IEC 18004 Specification Tables
// ---------------------------------------------------------------------------

function getNumRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function getNumDataCodewords(ver: number, ecl: Ecc): number {
  return Math.floor(getNumRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[ecl][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecl][ver];
}

function getAlignmentPatternPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  // Low
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // Medium
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  // Quartile
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // High
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

const NUM_ERROR_CORRECTION_BLOCKS: number[][] = [
  // Low
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  // Medium
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  // Quartile
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  // High
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

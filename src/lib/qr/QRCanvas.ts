/**
 * QR Code canvas renderer.
 *
 * Renders a boolean[][] QR matrix onto an HTML5 <canvas> element,
 * with HiDPI support and crisp (non-anti-aliased) module edges.
 */

export interface QRRenderOptions {
  /** Pixel size of each module (default 8). */
  moduleSize?: number;
  /** Quiet zone width in modules (default 4). */
  quietZone?: number;
  /** CSS colour for dark (true) modules (default '#EDEDED'). */
  darkColor?: string;
  /** CSS colour for light (false) modules (default '#121214'). */
  lightColor?: string;
}

const DEFAULT_OPTIONS: Required<QRRenderOptions> = {
  moduleSize: 8,
  quietZone: 4,
  darkColor: '#EDEDED',
  lightColor: '#121214',
};

export class QRCanvas {
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /**
   * Render a QR code matrix onto the canvas.
   *
   * @param matrix  2-D boolean array where `true` = dark module.
   * @param options Optional rendering parameters.
   */
  render(matrix: boolean[][], options?: QRRenderOptions): void {
    const opts: Required<QRRenderOptions> = { ...DEFAULT_OPTIONS, ...options };
    const { moduleSize, quietZone, darkColor, lightColor } = opts;

    const matrixSize = matrix.length;
    const totalModules = matrixSize + quietZone * 2;
    const cssSize = totalModules * moduleSize;

    // --- HiDPI handling ---------------------------------------------------
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const physicalSize = cssSize * dpr;

    this.canvas.width = physicalSize;
    this.canvas.height = physicalSize;
    this.canvas.style.width = `${cssSize}px`;
    this.canvas.style.height = `${cssSize}px`;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to obtain 2D rendering context from canvas');
    }

    ctx.scale(dpr, dpr);

    // Disable image smoothing for sharp module edges.
    ctx.imageSmoothingEnabled = false;

    // --- Background (light colour covers entire canvas incl. quiet zone) ---
    ctx.fillStyle = lightColor;
    ctx.fillRect(0, 0, cssSize, cssSize);

    // --- Draw dark modules -------------------------------------------------
    ctx.fillStyle = darkColor;
    for (let row = 0; row < matrixSize; row++) {
      for (let col = 0; col < matrixSize; col++) {
        if (matrix[row][col]) {
          const x = (col + quietZone) * moduleSize;
          const y = (row + quietZone) * moduleSize;
          ctx.fillRect(x, y, moduleSize, moduleSize);
        }
      }
    }
  }
}

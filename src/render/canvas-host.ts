/**
 * Owns a canvas: device pixel ratio, resizing, and a coalesced draw loop.
 *
 * Framework-agnostic by rule (D11) — no React, no imports from `src/ui`. React
 * mounts this in an effect and otherwise never touches it, which is what keeps
 * the renderer portable if the framework choice is ever revisited.
 */

export interface CanvasSize {
  /** CSS pixels */
  width: number;
  height: number;
  /** devicePixelRatio actually applied to the backing store */
  dpr: number;
}

export type DrawFn = (ctx: CanvasRenderingContext2D, size: CanvasSize) => void;

export class CanvasHost {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly draw: DrawFn;
  private readonly observer: ResizeObserver;
  private frame: number | null = null;
  private size: CanvasSize = { width: 0, height: 0, dpr: 1 };
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, draw: DrawFn) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2d canvas context unavailable');

    this.canvas = canvas;
    this.ctx = ctx;
    this.draw = draw;

    this.observer = new ResizeObserver(() => this.measure());
    this.observer.observe(canvas);
    this.measure();
  }

  /** Current size in CSS pixels. The renderer works in these, never in device pixels. */
  getSize(): CanvasSize {
    return this.size;
  }

  /** Schedules a draw. Repeated calls within a frame collapse into one. */
  requestDraw(): void {
    if (this.destroyed || this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.paint();
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.observer.disconnect();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private measure(): void {
    const rect = this.canvas.getBoundingClientRect();
    // Cap DPR at 2: beyond that the fill rate cost is real and the density curve
    // gains nothing visible from it.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    if (width === this.size.width && height === this.size.height && dpr === this.size.dpr) return;

    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.size = { width, height, dpr };
    this.requestDraw();
  }

  private paint(): void {
    if (this.destroyed) return;
    const { width, height, dpr } = this.size;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, width, height);
    this.draw(this.ctx, this.size);
  }
}

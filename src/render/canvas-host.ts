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

/**
 * Paints one frame. Returning `true` asks for another — that is how an animation
 * runs without the renderer owning a timer of its own, which would keep firing
 * after the canvas was destroyed.
 */
export type DrawFn = (ctx: CanvasRenderingContext2D, size: CanvasSize) => boolean | void;

export class CanvasHost {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly draw: DrawFn;
  private readonly observer: ResizeObserver;
  private frame: number | null = null;
  private size: CanvasSize = { width: 0, height: 0, dpr: 1 };
  private destroyed = false;
  /** The query that fires when the device pixel ratio leaves its current value. */
  private dprQuery: MediaQueryList | null = null;

  constructor(canvas: HTMLCanvasElement, draw: DrawFn) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2d canvas context unavailable');

    this.canvas = canvas;
    this.ctx = ctx;
    this.draw = draw;

    this.observer = new ResizeObserver(() => this.measure());
    this.observer.observe(canvas);
    this.measure();
    this.watchDpr();
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
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = null;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  /**
   * Watches for the device pixel ratio changing under the canvas.
   *
   * `ResizeObserver` never fires for it: dragging a window to a monitor of a
   * different density, or changing the browser's zoom, leaves the element
   * exactly the same size in CSS pixels while the backing store it needs halves
   * or doubles. Until this existed the canvas kept the ratio it was born with,
   * so the drawing stayed soft for the rest of the session — or, going the other
   * way, cost four times the fill rate it needed.
   *
   * There is no `dprchange` event, so the idiom is a media query on the *current*
   * ratio, which by construction stops matching the moment the ratio moves. That
   * makes it one-shot, which is why every change re-arms it.
   */
  private watchDpr(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = null;
    if (this.destroyed) return;
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.dprQuery.addEventListener('change', this.onDprChange);
  }

  private readonly onDprChange = (): void => {
    this.measure();
    this.watchDpr();
  };

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
    const { dpr } = this.size;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // No `clearRect` first: the context is opaque (`alpha: false`) and every
    // renderer opens its frame by filling the whole canvas with the surface
    // colour, so clearing would only paint the same pixels twice.
    if (this.draw(this.ctx, this.size) === true) this.requestDraw();
  }
}

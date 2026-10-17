/** One owner for live viewport movement; message receipts never own scrolling. */
export class TranscriptFollow {
  private frame = 0;
  private previous = 0;
  private written = 0;
  constructor(readonly node: HTMLElement) {}

  get active() {
    return this.frame !== 0;
  }
  get ownsScroll() {
    return this.active && Math.abs(this.node.scrollTop - this.written) < 1;
  }
  cancel() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.previous = 0;
  }
  snap() {
    this.cancel();
    this.node.scrollTop = this.node.scrollHeight;
    this.written = this.node.scrollTop;
  }
  follow() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.snap();
      return;
    }
    if (this.active) return;
    this.written = this.node.scrollTop;
    this.frame = requestAnimationFrame(this.step);
  }
  private step = (now: number) => {
    const target = Math.max(0, this.node.scrollHeight - this.node.clientHeight);
    const distance = target - this.node.scrollTop;
    // Settle tiny residual offsets without a long animation tail.
    if (Math.abs(distance) < 4) {
      this.node.scrollTop = target;
      this.written = this.node.scrollTop;
      this.frame = 0;
      this.previous = 0;
      return;
    }
    const elapsed = this.previous ? Math.min(48, now - this.previous) : 16;
    this.previous = now;
    const advance = Math.min(
      Math.abs(distance),
      Math.max(1, Math.abs(distance) * (1 - Math.exp(-elapsed / 58))),
    );
    this.node.scrollTop += Math.sign(distance) * advance;
    this.written = this.node.scrollTop;
    this.frame = requestAnimationFrame(this.step);
  };
}

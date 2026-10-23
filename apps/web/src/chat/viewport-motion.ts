/** One owner for live viewport movement; message receipts never own scrolling. */
export class TranscriptFollow {
  private frame = 0;
  private previous = 0;
  private written = 0;
  private suspended = false;
  private resumeFrame = 0;
  constructor(readonly node: HTMLElement) {}

  get active() {
    return this.frame !== 0;
  }
  get ownsScroll() {
    return (
      (this.active || this.resumeFrame !== 0) && Math.abs(this.node.scrollTop - this.written) < 1
    );
  }
  cancel() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.previous = 0;
  }
  pause() {
    this.suspended = true;
    this.cancel();
    cancelAnimationFrame(this.resumeFrame);
    this.resumeFrame = 0;
  }
  resume(follow: boolean) {
    if (!this.suspended || this.resumeFrame) return;
    if (!follow) {
      this.suspended = false;
      return;
    }
    this.snap();
    this.resumeFrame = requestAnimationFrame(() => {
      this.snap();
      this.resumeFrame = requestAnimationFrame(() => {
        this.snap();
        this.resumeFrame = 0;
        this.suspended = false;
      });
    });
  }
  dispose() {
    this.cancel();
    cancelAnimationFrame(this.resumeFrame);
    this.resumeFrame = 0;
  }
  snap() {
    this.cancel();
    this.node.scrollTop = this.node.scrollHeight;
    this.written = this.node.scrollTop;
  }
  follow() {
    if (this.suspended) return;
    if (Math.abs(this.node.scrollHeight - this.node.clientHeight - this.node.scrollTop) < 1) return;
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
    if (distance < 4 || (this.previous && now - this.previous > 250)) {
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

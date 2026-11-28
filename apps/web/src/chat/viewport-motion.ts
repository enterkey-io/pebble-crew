/** One owner for live viewport movement; message receipts never own scrolling. */
export class TranscriptFollow {
  private frame = 0;
  private previous = 0;
  private written: number | undefined;
  private suspended = false;
  private pausedTop = 0;
  private resumeFrame = 0;
  private readerUntil = 0;
  private contentHeight: number;
  private viewportHeight: number;
  private observedViewport: number;

  constructor(readonly node: HTMLElement) {
    this.contentHeight = node.scrollHeight;
    this.viewportHeight = node.clientHeight;
    this.observedViewport = node.clientHeight;
  }

  get active() {
    return this.frame !== 0;
  }
  get ownsScroll() {
    const { scrollHeight, clientHeight, scrollTop } = this.node;
    const layoutChanged =
      scrollHeight !== this.contentHeight || clientHeight !== this.viewportHeight;
    this.contentHeight = scrollHeight;
    this.viewportHeight = clientHeight;
    const now = performance.now();
    const reader = now < this.readerUntil;
    // A resize can move the actual offset before its scroll event arrives.
    // Keep the current reading mode unless an input gesture accompanied it.
    if (this.suspended || (!reader && (layoutChanged || this.active))) {
      this.written = scrollTop;
      return true;
    }
    if (this.written !== undefined && Math.abs(scrollTop - this.written) < 1) return true;
    if (reader) this.readerUntil = now + 750;
    return false;
  }

  readerInput() {
    this.interrupt();
    this.readerUntil = performance.now() + 750;
  }

  cancel() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.previous = 0;
  }
  pause() {
    if (this.suspended) return;
    this.pausedTop = this.node.scrollTop;
    this.suspended = true;
    this.cancel();
    cancelAnimationFrame(this.resumeFrame);
    this.resumeFrame = 0;
  }
  resume(follow: boolean) {
    if (!this.suspended || this.resumeFrame) return;
    const restore = () => {
      if (follow) this.snap();
      else {
        this.node.scrollTop = this.pausedTop;
        this.written = this.node.scrollTop;
      }
    };
    restore();
    this.resumeFrame = requestAnimationFrame(() => {
      restore();
      this.resumeFrame = requestAnimationFrame(() => {
        restore();
        this.resumeFrame = 0;
        this.suspended = false;
      });
    });
  }
  interrupt() {
    this.cancel();
    this.written = undefined;
    cancelAnimationFrame(this.resumeFrame);
    this.resumeFrame = 0;
    this.suspended = false;
  }
  dispose() {
    this.cancel();
    cancelAnimationFrame(this.resumeFrame);
    this.resumeFrame = 0;
  }
  snap(message?: HTMLElement) {
    this.cancel();
    this.node.scrollTop = message
      ? this.node.scrollTop +
        message.getBoundingClientRect().bottom -
        this.node.getBoundingClientRect().bottom
      : this.node.scrollHeight;
    this.written = this.node.scrollTop;
    this.contentHeight = this.node.scrollHeight;
    this.viewportHeight = this.node.clientHeight;
    this.readerUntil = 0;
  }
  /** The pane or its content changed size while following the latest message. When
   *  the pane gets shorter (the composer growing, a keyboard opening), the
   *  conversation moves up by the same amount in the same frame. A taller pane
   *  already keeps its end in place. New content glides. */
  resized() {
    const viewport = this.node.clientHeight;
    const shrunk = this.observedViewport - viewport;
    this.observedViewport = viewport;
    if (this.suspended) return;
    if (shrunk > 0) {
      this.node.scrollTop += shrunk;
      this.written = this.node.scrollTop;
      this.contentHeight = this.node.scrollHeight;
      this.viewportHeight = viewport;
    }
    this.follow();
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

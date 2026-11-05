type Frames = {
  request: (callback: (time: number) => void) => number;
  cancel: (id: number) => void;
};

/** Reply text has one subscriber surface and never drives the application shell. */
export class LiveText {
  #value = '';
  #listeners = new Set<() => void>();
  #frame: number | undefined;
  #published = -Infinity;
  constructor(
    private readonly frames: Frames = {
      request: (callback) => requestAnimationFrame(callback),
      cancel: (id) => cancelAnimationFrame(id),
    },
  ) {}
  get = () => this.#value;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
      if (!this.#listeners.size) this.#cancel();
    };
  };
  set = (value: string | ((previous: string) => string)) => {
    const next = typeof value === 'function' ? value(this.#value) : value;
    if (next === this.#value) return;
    this.#value = next;
    if (this.#listeners.size && this.#frame === undefined)
      this.#frame = this.frames.request(this.#publish);
  };
  #publish = (time: number) => {
    if (time - this.#published < 1000 / 30) {
      this.#frame = this.frames.request(this.#publish);
      return;
    }
    this.#frame = undefined;
    this.#published = time;
    for (const listener of this.#listeners) listener();
  };
  #cancel() {
    if (this.#frame !== undefined) this.frames.cancel(this.#frame);
    this.#frame = undefined;
  }
  dispose() {
    this.#cancel();
    this.#listeners.clear();
    this.#published = -Infinity;
  }
}

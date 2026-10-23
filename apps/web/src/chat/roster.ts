/** Coalesces read-only snapshots. A confirmed mutation queues a fresh read after
 * any older in-flight snapshot; a superseded connection cannot share that flight. */
export class RosterLoader {
  private flight: { key: object; promise: Promise<void>; dirty: boolean } | undefined;
  load(
    key: object,
    read: (isCurrent: () => boolean) => Promise<void>,
    invalidate = false,
  ): Promise<void> {
    if (this.flight?.key === key) {
      this.flight.dirty ||= invalidate;
      return this.flight.promise;
    }
    const flight = { key, dirty: false, promise: Promise.resolve() };
    this.flight = flight;
    flight.promise = (async () => {
      do {
        flight.dirty = false;
        await read(() => this.flight === flight && !flight.dirty);
      } while (flight.dirty && this.flight === flight);
    })().finally(() => {
      if (this.flight === flight) this.flight = undefined;
    });
    return flight.promise;
  }
}

import { it, expect } from 'vitest';
import { RosterLoader } from './roster';
it('refreshes after an overlapping mutation without parallel reads', async () => {
  const loader = new RosterLoader(),
    key = {};
  let finish!: () => void,
    calls = 0;
  const read = async () => {
    calls++;
    if (calls === 1) await new Promise<void>((r) => (finish = r));
  };
  const initial = loader.load(key, read);
  const changed = loader.load(key, read, true);
  expect(calls).toBe(1);
  finish();
  await Promise.all([initial, changed]);
  expect(calls).toBe(2);
});
it('does not reuse a superseded connection flight', async () => {
  const loader = new RosterLoader();
  let finish!: () => void;
  const old = loader.load({}, () => new Promise<void>((r) => (finish = r)));
  let called = false;
  await loader.load({}, async () => {
    called = true;
  });
  expect(called).toBe(true);
  finish();
  await old;
});
it('does not publish a snapshot invalidated by a confirmed mutation', async () => {
  const loader = new RosterLoader(),
    key = {};
  const published: number[] = [];
  let finish!: () => void,
    calls = 0;
  const read = async (current: () => boolean) => {
    const version = ++calls;
    if (version === 1) await new Promise<void>((resolve) => (finish = resolve));
    if (current()) published.push(version);
  };
  const first = loader.load(key, read);
  const changed = loader.load(key, read, true);
  finish();
  await Promise.all([first, changed]);
  expect(published).toEqual([2]);
});

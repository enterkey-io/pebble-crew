import { expect } from '@playwright/test';
import type { Locator } from '@playwright/test';

export async function expectPinnedLayout(pins: Locator) {
  await expect(pins.locator('.pc-pin-title')).toHaveText(['Team lead', 'Executive assistant']);
  const layout = await pins.evaluateAll((tiles) =>
    tiles.map((tile) => {
      const card = tile.getBoundingClientRect();
      const avatar = tile.querySelector('.agent-avatar')!.getBoundingClientRect();
      const name = tile.querySelector('strong')!.getBoundingClientRect();
      const title = tile.querySelector('.pc-pin-title')!.getBoundingClientRect();
      const menu = tile.querySelector('.pc-pin-actions svg')!.getBoundingClientRect();
      return {
        centerOffset: avatar.x + avatar.width / 2 - (card.x + card.width / 2),
        heightRatio: (avatar.y + avatar.height / 2 - card.y) / card.height,
        avatarBottom: avatar.bottom,
        nameTop: name.top,
        nameBottom: name.bottom,
        titleTop: title.top,
        titleBottom: title.bottom,
        cardBottom: card.bottom,
        menuLeft: menu.left,
        avatarRight: avatar.right,
      };
    }),
  );
  for (const tile of layout) {
    expect(Math.abs(tile.centerOffset)).toBeLessThan(1);
    expect(tile.heightRatio).toBeGreaterThanOrEqual(0.28);
    expect(tile.heightRatio).toBeLessThanOrEqual(0.37);
    expect(tile.nameTop).toBeGreaterThanOrEqual(tile.avatarBottom);
    expect(tile.titleTop).toBeGreaterThanOrEqual(tile.nameBottom);
    expect(tile.titleBottom).toBeLessThanOrEqual(tile.cardBottom);
    expect(tile.menuLeft).toBeGreaterThan(tile.avatarRight);
  }
}

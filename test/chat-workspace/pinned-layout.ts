import { expect } from '@playwright/test';
import type { Locator } from '@playwright/test';

export async function expectPinnedLayout(pins: Locator) {
  await expect(pins.locator('.pc-pin-title')).toHaveText(['Team lead', 'Executive assistant']);
  await expectPinRoleContrast(pins);
  const layout = await pins.evaluateAll((tiles) =>
    tiles.map((tile) => {
      const card = tile.getBoundingClientRect();
      const avatar = tile.querySelector('.agent-avatar')!.getBoundingClientRect();
      const graphic = tile
        .querySelector('.agent-avatar svg.avatar,.agent-avatar img')!
        .getBoundingClientRect();
      const nameNode = tile.querySelector('strong')!;
      const name = nameNode.getBoundingClientRect();
      const titleNode = tile.querySelector('.pc-pin-title')!;
      const title = titleNode.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(titleNode);
      const menuCount = tile.querySelectorAll('.pc-pin-actions,.pc-overflow').length;
      const ancestors = [];
      for (
        let node: Element | null = tile.querySelector('.agent-avatar');
        node;
        node = node.parentElement
      )
        ancestors.push(getComputedStyle(node).opacity);
      return {
        avatarTop: avatar.top - card.top,
        graphicRatio: graphic.width / avatar.width,
        nameWidth: name.width,
        nameOffset: name.top - card.top,
        titleOffset: title.top - card.top,
        titleTextHeight: range.getBoundingClientRect().height,
        titleHeight: title.height,
        titleLineHeight: Number.parseFloat(getComputedStyle(titleNode).lineHeight),
        nameColor: getComputedStyle(nameNode).color,
        foreground: getComputedStyle(document.body).color,
        ancestors,
        centerOffset: avatar.x + avatar.width / 2 - (card.x + card.width / 2),
        heightRatio: (avatar.y + avatar.height / 2 - card.y) / card.height,
        avatarBottom: avatar.bottom,
        nameTop: name.top,
        nameBottom: name.bottom,
        titleTop: title.top,
        titleBottom: title.bottom,
        cardBottom: card.bottom,
        menuCount,
        avatarRight: avatar.right,
      };
    }),
  );
  for (const tile of layout) {
    expect(tile.graphicRatio).toBeGreaterThanOrEqual(0.95);
    expect(tile.nameWidth).toBeGreaterThan(24);
    expect(tile.nameColor).toBe(tile.foreground);
    expect(tile.ancestors.every((opacity) => opacity === '1')).toBe(true);
    expect(tile.titleTextHeight).toBeLessThanOrEqual(tile.titleHeight + 1);
    expect(tile.titleHeight).toBeLessThanOrEqual(tile.titleLineHeight + 2);
    expect(tile.avatarTop).toBeCloseTo(layout[0]!.avatarTop, 0);
    expect(tile.nameOffset).toBeCloseTo(layout[0]!.nameOffset, 0);
    expect(tile.titleOffset).toBeCloseTo(layout[0]!.titleOffset, 0);
    expect(Math.abs(tile.centerOffset)).toBeLessThan(1);
    expect(tile.avatarTop).toBeGreaterThanOrEqual(0);
    expect(tile.avatarTop).toBeLessThanOrEqual(12);
    expect(tile.heightRatio).toBeLessThanOrEqual(0.37);
    expect(tile.nameTop).toBeGreaterThanOrEqual(tile.avatarBottom);
    expect(tile.titleTop).toBeGreaterThanOrEqual(tile.nameBottom);
    expect(tile.titleBottom).toBeLessThanOrEqual(tile.cardBottom);
    expect(tile.menuCount).toBe(0);
  }
  expect(Math.min(...layout.map((tile) => tile.cardBottom - tile.titleBottom))).toBeLessThanOrEqual(
    12,
  );
}

export async function expectPinRoleContrast(pins: Locator) {
  const roles = pins.locator('.pc-pin-title');
  await expect(roles.first()).toBeVisible();
  await expect
    .poll(async () =>
      Math.min(
        ...(await roles.evaluateAll((elements) => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const paint = canvas.getContext('2d')!;
          const luminance = (color: string) => {
            paint.fillStyle = color;
            paint.fillRect(0, 0, 1, 1);
            const [r, g, b] = Array.from(paint.getImageData(0, 0, 1, 1).data, (byte) => {
              const channel = byte / 255;
              return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
          };
          return elements.map((element) => {
            const foreground = luminance(getComputedStyle(element).color);
            let surface: Element = element;
            while (
              getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)' &&
              surface.parentElement
            )
              surface = surface.parentElement;
            const background = luminance(getComputedStyle(surface).backgroundColor);
            return (
              (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
            );
          });
        })),
      ),
    )
    .toBeGreaterThanOrEqual(4.5);
  for (const role of await roles.all()) {
    await expect(role).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(role).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
    await expect(role).toHaveCSS('white-space', 'nowrap');
    await expect(role).toHaveCSS('text-overflow', 'ellipsis');
  }
}

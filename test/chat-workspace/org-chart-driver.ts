import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function focusOrgCard(page: Page, name: string) {
  // Keyboard focus brings an offscreen chart card into view at a readable scale.
  await page.keyboard.press('Tab');
  const button = page.getByRole('button', {
    name: new RegExp('^Edit ' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s|$)'),
  });
  await button.focus();
  await expect(button).toBeInViewport();
  return button;
}

export async function touchChart(
  canvas: import('@playwright/test').Locator,
  type: string,
  points: { x: number; y: number }[],
) {
  await canvas.evaluate(
    (element, { type, points }) => {
      const touches = points.map(({ x, y }, identifier) => ({
        identifier,
        target: element,
        clientX: x,
        clientY: y,
        pageX: x + scrollX,
        pageY: y + scrollY,
      }));
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: { value: touches },
        targetTouches: { value: touches },
        changedTouches: { value: touches },
      });
      element.dispatchEvent(event);
    },
    { type, points },
  );
}

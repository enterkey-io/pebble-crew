import { useLayoutEffect } from 'react';

export function useAppViewport() {
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    const style = root.style;
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Reflect.get(navigator, 'standalone') === true;
    const layout = standalone ? document.createElement('div') : null;
    if (layout) {
      // WebKit can subtract the status bar from visualViewport in installed apps.
      // Measure the full CSS canvas independently of the keyboard-sized shell.
      layout.setAttribute('aria-hidden', 'true');
      layout.style.cssText =
        'position:fixed;inset:0 auto auto 0;width:0;height:100vh;visibility:hidden;pointer-events:none;contain:strict;';
      document.body.append(layout);
    }
    let frame = 0;
    const update = () => {
      // Pinch zoom magnifies the existing layout, rather than resizing it.
      if (viewport.scale !== 1) return;
      const editable = document.activeElement?.matches(
        'textarea:not([readonly]), input:not([readonly]), [contenteditable="true"]',
      );
      const fullHeight = layout?.getBoundingClientRect().height ?? window.innerHeight;
      // Status/home-bar differences are smaller than a software keyboard. Focus
      // alone is insufficient: an input can stay focused after keyboard dismissal.
      const keyboard = Boolean(editable && fullHeight - viewport.height > 120);
      const height = standalone && !keyboard ? '100vh' : `${viewport.height}px`;
      const top = standalone && !keyboard ? '0px' : `${viewport.offsetTop}px`;
      if (style.getPropertyValue('--app-viewport-height') !== height)
        style.setProperty('--app-viewport-height', height);
      if (style.getPropertyValue('--app-viewport-top') !== top)
        style.setProperty('--app-viewport-top', top);
      root.toggleAttribute('data-keyboard-visible', keyboard);
    };
    function schedule() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    }
    const observer = layout ? new ResizeObserver(schedule) : null;
    if (layout) observer?.observe(layout);
    update();
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('pageshow', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    document.addEventListener('visibilitychange', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      layout?.remove();
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('pageshow', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      document.removeEventListener('visibilitychange', schedule);
      style.removeProperty('--app-viewport-height');
      style.removeProperty('--app-viewport-top');
      root.removeAttribute('data-keyboard-visible');
    };
  }, []);
}

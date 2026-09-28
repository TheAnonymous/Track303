/**
 * Claims a touch for the app once it moves more sideways than up or down, so
 * a swipe-to-delete starts no browser gesture: Chrome would otherwise leave a
 * fling running that swallows the next tap. Vertical drags keep scrolling.
 */
export function horizontalSwipeGuard(): { start(event: TouchEvent): void; move(event: TouchEvent): void } {
  let origin: { x: number; y: number } | null = null;
  let claimed = false;
  return {
    start(event) {
      const touch = event.touches[0];
      origin = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null;
      claimed = false;
    },
    move(event) {
      const touch = event.touches[0];
      if (!origin || !touch || !event.cancelable) return;
      const dx = Math.abs(touch.clientX - origin.x);
      const dy = Math.abs(touch.clientY - origin.y);
      if (!claimed && dx > 8 && dx > dy) claimed = true;
      if (claimed) event.preventDefault();
    },
  };
}

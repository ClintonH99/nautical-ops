/** A deliberate vertical pull, starting at the top; never a calendar swipe/pinch. */
export function createPullToRefresh() {
  let start: { x: number; y: number } | null = null;
  let distance = 0;
  return {
    start(x: number, y: number, scrollY: number, touches: number) {
      start = scrollY <= 0 && touches === 1 ? { x, y } : null;
      distance = 0;
    },
    move(x: number, y: number, touches: number) {
      if (!start) return;
      const dy = y - start.y;
      if (touches !== 1 || dy < -8 || Math.abs(x - start.x) > 24) {
        start = null;
        distance = 0;
        return;
      }
      distance = dy;
    },
    end() {
      const refresh = start !== null && distance >= 85;
      start = null;
      distance = 0;
      return refresh;
    },
    cancel() {
      start = null;
      distance = 0;
    },
  };
}

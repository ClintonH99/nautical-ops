import { createPullToRefresh as createHomePullRefresh } from '../../src/utils/pullToRefresh';

it('refreshes once for a deliberate pull from the top', () => {
  const gesture = createHomePullRefresh();
  gesture.start(20, 10, 0, 1);
  gesture.move(24, 100, 1);
  expect(gesture.end()).toBe(true);
  expect(gesture.end()).toBe(false);
});

it.each([
  [100, 1, 20, 110, 1], // started part-way down the page
  [0, 2, 20, 110, 2], // pinch
  [0, 1, 70, 110, 1], // horizontal/calendar swipe
  [0, 1, 20, 40, 1], // short tap/drag
  [0, 1, 20, -30, 1], // ordinary upward scrolling
  [0, 1, 20, 110, 2], // second finger added
])('ignores non-refresh gestures (%j)', (scroll, count, x, y, moveCount) => {
  const gesture = createHomePullRefresh();
  gesture.start(20, 10, scroll, count);
  gesture.move(x, y, moveCount);
  expect(gesture.end()).toBe(false);
});

it('cancels interrupted gestures', () => {
  const gesture = createHomePullRefresh();
  gesture.start(20, 10, 0, 1);
  gesture.move(20, 120, 1);
  gesture.cancel();
  expect(gesture.end()).toBe(false);
});

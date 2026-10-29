/** Device/input detection, not viewport width: a narrow laptop is still a laptop. */
export function usesPullRefreshOnly(
  device: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>,
  touchFirst: boolean
): boolean {
  // iPadOS can identify as a Mac, including when a trackpad is attached.
  return (
    /Android|iPhone|iPad|iPod/i.test(device.userAgent) ||
    (device.platform === 'MacIntel' && device.maxTouchPoints > 1) ||
    (device.maxTouchPoints > 0 && touchFirst)
  );
}

/** Native builds retain their existing connection handling. */
export function isOfflineConnection(): boolean {
  return false;
}
export function requireOnlineAction(): void {}
export function allowOnlineAction(_action = 'This action'): boolean {
  return true;
}

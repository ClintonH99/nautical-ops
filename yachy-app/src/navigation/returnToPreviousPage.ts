export type ReturnNavigation = {
  goBack(): void;
  canGoBack(): boolean;
  getState(): { routeNames: readonly string[]; index: number; routes: readonly {name: string; params?: Record<string, unknown>}[] };
  navigate(name: string, params?: Record<string, unknown>): void;
};
// Native stacks retain their existing back behaviour.
export function returnToPreviousPage(navigation: ReturnNavigation): void {
  navigation.goBack();
}

import { getPathFromState } from '@react-navigation/native';
import { createWebLinkingConfig } from '../../src/navigation/webLinking';

describe('web page addresses', () => {
  const linking = createWebLinkingConfig(true);
  const parse = (path: string) => linking.getStateFromPath(path, linking.config)!;
  it.each(['/maintenance/log', '/safety/equipment', '/settings/profile', '/logs/fuel'])(
    'preserves an absolute %s on a direct load',
    (path) => {
      const state = parse(path);
      expect(state.routes[state.routes.length - 1].path).toBe(path);
      expect(getPathFromState(state, linking.config)).toBe(path);
    }
  );
  it('keeps edit identifiers on reload', () => {
    const state = parse('/maintenance/edit?logId=record-123');
    expect(state.routes[0].params).toEqual({ logId: 'record-123' });
  });
  it.each([
    ['/HoursOfRest', '/hours-of-rest'],
    ['/WatchDuties', '/watch-duties'],
    ['/Uniforms', '/uniforms'],
    ['/Notepad', '/notepad'],
  ])('keeps legacy %s bookmarks accessible', (legacy, canonical) => {
    expect(getPathFromState(parse(legacy), linking.config)).toBe(canonical);
    expect(getPathFromState(parse(canonical), linking.config)).toBe(canonical);
  });
  it('uses a dashboard address distinct from the public landing page', () => {
    expect(getPathFromState(parse('/login'), linking.config)).toBe('/app');
    expect(getPathFromState(parse('/app'), linking.config)).toBe('/app');
  });
  it('does not make protected screens accessible when signed out or payment restricted', () => {
    for (const [authenticated, restricted, expected] of [
      [false, false, '/login'],
      [true, true, '/vessel-plans'],
    ] as const) {
      const config = createWebLinkingConfig(authenticated, restricted);
      const state = config.getStateFromPath('/crew', config.config)!;
      expect(getPathFromState(state, config.config)).toBe(expected);
    }
  });
});

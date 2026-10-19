import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { VesselBanner } from '../../src/components/VesselBanner.web';

jest.mock('expo-asset', () => ({ Asset: { fromModule: () => ({ uri: '/default-vessel.png' }) } }));

test('preserves uploaded photos, responsive crops, gradient and error fallback callback', async () => {
  const onError = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <VesselBanner
        source={{ uri: 'https://example.com/custom.jpg' }}
        name="My Vessel"
        onError={onError}
      />
    );
  });
  expect(tree.root.findByType('img').props.src).toBe('https://example.com/custom.jpg');
  expect(tree.root.findByType('h1').children).toEqual(['My Vessel']);
  const css = tree.root.findByType('style').children.join('');
  for (const rule of [
    'aspect-ratio:4/3',
    'aspect-ratio:16/9',
    'aspect-ratio:3/1',
    'object-fit:cover',
    'object-position:50% 74%',
    'linear-gradient',
  ]) {
    expect(css).toContain(rule);
  }
  tree.root.findByType('img').props.onError();
  expect(onError).toHaveBeenCalledTimes(1);
  await act(async () => {
    tree.update(<VesselBanner source={1} name="My Vessel" onError={onError} />);
  });
  expect(tree.root.findByType('img').props.src).toBe('/default-vessel.png');
  await act(async () => tree.unmount());
});

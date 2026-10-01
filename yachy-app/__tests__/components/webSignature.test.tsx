import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import SignaturePad, { type SignatureViewRef } from '../../src/components/SignaturePad.web';

test('touch drawing, clear and PNG output work without a native WebView', async () => {
  const context = {
    clearRect: jest.fn(),
    fillRect: jest.fn(),
    drawImage: jest.fn(),
    beginPath: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
  };
  const node = {
    width: 1000,
    height: 400,
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 200 }),
    setPointerCapture: jest.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: jest.fn(),
  };
  const output = {
    width: 0,
    height: 0,
    getContext: () => context,
    toDataURL: jest.fn(() => 'data:image/png;base64,test'),
  };
  const previousDocument = global.document;
  Object.defineProperty(global, 'document', {
    configurable: true,
    value: { createElement: () => output },
  });
  const onOK = jest.fn(),
    onEmpty = jest.fn();
  const ref = React.createRef<SignatureViewRef>();
  let tree!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => {
      tree = TestRenderer.create(<SignaturePad ref={ref} onOK={onOK} onEmpty={onEmpty} />, {
        createNodeMock: () => node,
      });
    });
    ref.current!.readSignature();
    expect(onEmpty).toHaveBeenCalledTimes(1);
    const canvas = tree.root.findByType('canvas');
    const event = {
      currentTarget: node,
      pointerId: 1,
      button: 0,
      clientX: 25,
      clientY: 30,
      preventDefault: jest.fn(),
    };
    canvas.props.onPointerDown(event);
    canvas.props.onPointerMove({ ...event, clientX: 40 });
    expect(context.moveTo).toHaveBeenCalledWith(50, 60);
    expect(context.lineTo).toHaveBeenCalledWith(80, 60);
    ref.current!.readSignature();
    expect(onOK).toHaveBeenCalledWith('data:image/png;base64,test');
    ref.current!.clearSignature();
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 1000, 400);
    expect(node.releasePointerCapture).toHaveBeenCalledWith(1);
    ref.current!.readSignature();
    expect(onEmpty).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => tree?.unmount());
    Object.defineProperty(global, 'document', { configurable: true, value: previousDocument });
  }
});

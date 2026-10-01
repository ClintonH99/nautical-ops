import React, { forwardRef, useImperativeHandle, useRef } from 'react';

export interface SignatureViewRef {
  readSignature(): void;
  clearSignature(): void;
}
interface Props {
  onOK: (image: string) => void;
  onEmpty: () => void;
  backgroundColor?: string;
  penColor?: string;
  webStyle?: string;
  trimWhitespace?: boolean;
  style?: unknown;
}

/** Fixed-resolution backing store preserves ink when a phone rotates/resizes. */
const SignaturePad = forwardRef<SignatureViewRef, Props>(function SignaturePad(
  { onOK, onEmpty, backgroundColor = '#ffffff', penColor = '#000000' },
  ref
) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const activePointer = useRef<number | null>(null);
  const hasInk = useRef(false);
  useImperativeHandle(
    ref,
    () => ({
      clearSignature() {
        const node = canvas.current;
        if (
          node &&
          activePointer.current !== null &&
          node.hasPointerCapture(activePointer.current)
        ) {
          node.releasePointerCapture(activePointer.current);
        }
        node?.getContext('2d')?.clearRect(0, 0, node.width, node.height);
        hasInk.current = false;
        activePointer.current = null;
      },
      readSignature() {
        if (!hasInk.current || !canvas.current) {
          onEmpty();
          return;
        }
        // Use a white background so the signature is legible in exported documents.
        const output = document.createElement('canvas');
        output.width = canvas.current.width;
        output.height = canvas.current.height;
        const context = output.getContext('2d');
        if (!context) {
          onEmpty();
          return;
        }
        context.fillStyle = backgroundColor;
        context.fillRect(0, 0, output.width, output.height);
        context.drawImage(canvas.current, 0, 0);
        onOK(output.toDataURL('image/png'));
      },
    }),
    [onOK, onEmpty, backgroundColor]
  );

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const node = event.currentTarget;
    const bounds = node.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) * node.width) / bounds.width,
      y: ((event.clientY - bounds.top) * node.height) / bounds.height,
    };
  };
  const end = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  return (
    <canvas
      ref={canvas}
      width={1000}
      height={400}
      aria-label="Draw your signature. You can also use the Type option."
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        touchAction: 'none',
        backgroundColor,
      }}
      onPointerDown={(event) => {
        if (activePointer.current !== null || event.button !== 0) return;
        const context = event.currentTarget.getContext('2d');
        if (!context) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        activePointer.current = event.pointerId;
        const p = point(event);
        context.strokeStyle = penColor;
        context.fillStyle = penColor;
        context.lineWidth = 4;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.beginPath();
        context.arc(p.x, p.y, 2, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.moveTo(p.x, p.y);
        hasInk.current = true;
      }}
      onPointerMove={(event) => {
        if (activePointer.current !== event.pointerId) return;
        const p = point(event);
        const context = event.currentTarget.getContext('2d');
        context?.lineTo(p.x, p.y);
        context?.stroke();
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={() => {
        activePointer.current = null;
      }}
    />
  );
});
export default SignaturePad;

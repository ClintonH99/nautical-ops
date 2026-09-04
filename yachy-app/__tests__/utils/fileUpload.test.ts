/**
 * Regression tests for TestFlight/local-file uploads.
 * @jest-environment node
 */

const mockBytes = jest.fn();
const mockFile = jest.fn();
let mockFileSize: number | undefined;

jest.mock('expo-file-system', () => ({
  File: class MockFile {
    private readonly uri: string;

    constructor(uri: string) {
      this.uri = uri;
      mockFile(uri);
    }

    bytes() {
      return mockBytes(this.uri);
    }

    get size() {
      return mockFileSize;
    }
  },
}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { Platform } from 'react-native';
import { readFileBytesForUpload } from '../../src/utils/fileUpload';

describe('readFileBytesForUpload', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.clearAllMocks();
    mockFileSize = undefined;
    Platform.OS = 'ios';
    global.fetch = originalFetch;
  });

  it('uses Expo FileSystem for a native file URI', async () => {
    const expected = new Uint8Array([1, 2, 3]);
    mockBytes.mockResolvedValue(expected);

    await expect(readFileBytesForUpload('file:///banner.jpg')).resolves.toBe(expected);
    expect(mockFile).toHaveBeenCalledWith('file:///banner.jpg');
    expect(mockBytes).toHaveBeenCalledWith('file:///banner.jpg');
  });

  it('uses fetch for a web picker URI', async () => {
    Platform.OS = 'web';
    const arrayBuffer = Uint8Array.from([4, 5, 6]).buffer;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: jest.fn().mockReturnValue(null) },
      arrayBuffer: jest.fn().mockResolvedValue(arrayBuffer),
    });

    await expect(readFileBytesForUpload('blob:https://example.com/photo')).resolves.toEqual(
      new Uint8Array([4, 5, 6])
    );
    expect(mockFile).not.toHaveBeenCalled();
  });

  it('rejects a native image larger than 10 MB before reading it', async () => {
    mockFileSize = 10 * 1024 * 1024 + 1;

    await expect(readFileBytesForUpload('file:///huge.jpg')).rejects.toThrow(
      'Selected image must be smaller than 10 MB.'
    );
    expect(mockBytes).not.toHaveBeenCalled();
  });

  it('rejects an oversized web image after reading when length is unavailable', async () => {
    Platform.OS = 'web';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: jest.fn().mockReturnValue(null) },
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(10 * 1024 * 1024 + 1)),
    });

    await expect(readFileBytesForUpload('blob:https://example.com/huge')).rejects.toThrow(
      'Selected image must be smaller than 10 MB.'
    );
  });

  it('rejects an unreadable web picker URI', async () => {
    Platform.OS = 'web';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });

    await expect(readFileBytesForUpload('blob:https://example.com/missing')).rejects.toThrow(
      'Could not read selected file (404)'
    );
  });
});

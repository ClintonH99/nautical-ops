/** Only known public vessel-banner/profile images, retained inside the signed account partition. */
export async function downloadOfflineImage(url: string): Promise<string | null> {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'error',
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Image download failed');
    if (!/^image\/(png|jpeg|webp)(?:;|$)/.test(response.headers.get('content-type') ?? ''))
      throw new Error('Unsupported cached image');
    if (Number(response.headers.get('content-length')) > 5 * 1024 * 1024)
      throw new Error('Image too large');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Image body missing');
    const chunks: Uint8Array<ArrayBuffer>[] = [],
      limit = 5 * 1024 * 1024;
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error('Image too large');
        chunks.push(new Uint8Array(value));
      }
    } finally {
      await reader.cancel();
    }
    const blob = new Blob(chunks, { type: response.headers.get('content-type')! });
    return await new Promise<string>((resolve, reject) => {
      const file = new FileReader();
      file.onload = () => resolve(String(file.result));
      file.onerror = () => reject(new Error('Image storage failed'));
      file.readAsDataURL(blob);
    });
  } finally {
    clearTimeout(timer);
  }
}

/** An expired access token is renewable; it does not mean the user signed out. */
export function getRenewableSessionUserId(raw: string | null): string | null {
  try {
    const session = raw ? JSON.parse(raw) : null;
    return typeof session?.access_token === 'string' &&
      session.access_token &&
      typeof session?.refresh_token === 'string' &&
      session.refresh_token &&
      typeof session?.user?.id === 'string' &&
      session.user.id
      ? session.user.id
      : null;
  } catch {
    return null;
  }
}

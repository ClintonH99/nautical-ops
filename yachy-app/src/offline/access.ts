/** Offline permits are NOT API authentication. The server rechecks every sync. */
export const OFFLINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const OFFLINE_FEATURES = [
  'notes',
  'tasks',
  'inventory',
  'shoppingLists',
  'trips',
  'watchKeeping',
  'watchKeepingRules',
  'watchDuties',
  'restEntries',
  'restReview',
  'maintenanceLogs',
  'safetyEquipment',
  'musterStations',
  'preDepartureChecklists',
  'yardJobs',
  'shipyardRecords',
  'contractors',
  'uniforms',
  'crewLeave',
  'seaMiles',
  'fuelLogs',
  'pumpOutLogs',
  'generalWasteLogs',
  'rules',
] as const;
export type OfflineFeature = (typeof OFFLINE_FEATURES)[number];
export type OfflineAction = 'read' | 'create' | 'update';
export type OfflineScope = Readonly<{
  origin: string;
  projectId: string;
  userId: string;
  vesselId: string;
  deviceId: string;
  sessionId: string;
}>;
export type OfflineClaims = Readonly<{
  iss: string;
  aud: string;
  sub: string;
  projectId: string;
  vesselId: string;
  deviceId: string;
  sessionId: string;
  iat: number;
  exp: number;
  accessUntil: number;
  permissions: Partial<Record<OfflineFeature, readonly OfflineAction[]>>;
}>;
declare const verified: unique symbol;
export type VerifiedOfflinePermit = Readonly<{ claims: OfflineClaims; [verified]: true }>;
const verifiedPermits = new WeakSet<object>();
const identifiers = ['origin', 'projectId', 'userId', 'vesselId', 'deviceId', 'sessionId'] as const;

export class OfflineError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
    this.name = 'OfflineError';
  }
}
export function scopeKey(scope: OfflineScope): string {
  if (
    !scope ||
    identifiers.some((k) => typeof scope[k] !== 'string' || !scope[k] || scope[k].length > 256)
  ) {
    throw new OfflineError('INVALID_SCOPE');
  }
  if (new URL(scope.origin).origin !== scope.origin) throw new OfflineError('INVALID_SCOPE');
  return JSON.stringify(identifiers.map((k) => scope[k]));
}
export function sameScope(a: OfflineScope, b: OfflineScope): boolean {
  return scopeKey(a) === scopeKey(b);
}
export function isOfflineFeature(value: unknown): value is OfflineFeature {
  return typeof value === 'string' && (OFFLINE_FEATURES as readonly string[]).includes(value);
}
function decode(part: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new OfflineError('INVALID_PERMIT');
  const str = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(str, (c) => c.charCodeAt(0));
}
function parse(part: string): Record<string, unknown> {
  const value: unknown = JSON.parse(new TextDecoder().decode(decode(part)));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
  return value as Record<string, unknown>;
}

/** Only pinned verification keys enter here, never a JWK supplied inside the token. */
export async function verifyOfflinePermit(
  token: string,
  trustedKeys: Readonly<Record<string, JsonWebKey>>,
  scope: OfflineScope
): Promise<VerifiedOfflinePermit> {
  try {
    scopeKey(scope);
    if (typeof token !== 'string' || token.length > 16_384) throw Error();
    const parts = token.split('.');
    if (parts.length !== 3) throw Error();
    const header = parse(parts[0]);
    if (
      header.alg !== 'ES256' ||
      header.typ !== 'nautical-ops-offline+jwt' ||
      typeof header.kid !== 'string' ||
      !Object.hasOwn(trustedKeys, header.kid) ||
      Object.keys(header).some((k) => !['alg', 'typ', 'kid'].includes(k))
    )
      throw Error();
    const key = await crypto.subtle.importKey(
      'jwk',
      trustedKeys[header.kid],
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    if (
      !(await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        decode(parts[2]),
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
      ))
    )
      throw Error();
    const c = parse(parts[1]);
    if (
      c.iss !== `nautical-ops:${scope.projectId}` ||
      c.aud !== scope.origin ||
      c.sub !== scope.userId ||
      c.projectId !== scope.projectId ||
      c.vesselId !== scope.vesselId ||
      c.deviceId !== scope.deviceId ||
      c.sessionId !== scope.sessionId
    )
      throw Error();
    const { iat, exp, accessUntil } = c;
    if (
      typeof iat !== 'number' ||
      typeof exp !== 'number' ||
      typeof accessUntil !== 'number' ||
      ![iat, exp, accessUntil].every((n) => Number.isSafeInteger(n) && n > 0) ||
      exp <= iat ||
      (exp - iat) * 1000 > OFFLINE_WINDOW_MS ||
      accessUntil < exp ||
      exp > Number.MAX_SAFE_INTEGER / 1000
    )
      throw Error();
    if (!c.permissions || typeof c.permissions !== 'object' || Array.isArray(c.permissions))
      throw Error();
    const permissions: Partial<Record<OfflineFeature, readonly OfflineAction[]>> = {};
    for (const [feature, actions] of Object.entries(c.permissions)) {
      if (
        !isOfflineFeature(feature) ||
        !Array.isArray(actions) ||
        !actions.length ||
        actions.some((a) => !['read', 'create', 'update'].includes(a))
      )
        throw Error();
      permissions[feature] = Object.freeze(actions as OfflineAction[]);
    }
    const claims: OfflineClaims = {
      iss: `nautical-ops:${scope.projectId}`,
      aud: scope.origin,
      sub: scope.userId,
      projectId: scope.projectId,
      vesselId: scope.vesselId,
      deviceId: scope.deviceId,
      sessionId: scope.sessionId,
      iat,
      exp,
      accessUntil,
      permissions: Object.freeze(permissions),
    };
    const permit = Object.freeze({ claims: Object.freeze(claims) }) as VerifiedOfflinePermit;
    verifiedPermits.add(permit);
    return permit;
  } catch {
    throw new OfflineError('INVALID_PERMIT');
  }
}

export type OfflineContext = {
  scope: OfflineScope;
  permit: VerifiedOfflinePermit | null;
  nowMs: number;
  highestObservedMs: number;
  /** Known sign-out, revocation, payment lockout or device denial wins immediately. */
  blocked: boolean;
};
export function requireOfflineAccess(
  context: OfflineContext,
  feature: OfflineFeature,
  action: OfflineAction
): void {
  if (!isOfflineFeature(feature) || !['read', 'create', 'update'].includes(action)) {
    throw new OfflineError('ONLINE_ONLY');
  }
  if (context.blocked) throw new OfflineError('ACCESS_BLOCKED');
  const permit = context.permit;
  if (!permit || !verifiedPermits.has(permit)) throw new OfflineError('ONLINE_CHECK_REQUIRED');
  const c = permit.claims;
  if (
    !sameScope(context.scope, {
      origin: c.aud,
      projectId: c.projectId,
      userId: c.sub,
      vesselId: c.vesselId,
      deviceId: c.deviceId,
      sessionId: c.sessionId,
    })
  ) {
    throw new OfflineError('SCOPE_CHANGED');
  }
  const { nowMs, highestObservedMs } = context;
  if (
    ![nowMs, highestObservedMs].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    nowMs + 120_000 < highestObservedMs ||
    nowMs + 120_000 < c.iat * 1000
  ) {
    throw new OfflineError('CLOCK_CHECK_REQUIRED');
  }
  if (Math.max(nowMs, highestObservedMs) >= Math.min(c.exp, c.accessUntil) * 1000) {
    throw new OfflineError('ONLINE_CHECK_REQUIRED');
  }
  if (!c.permissions[feature]?.includes(action)) throw new OfflineError('ACTION_NOT_ALLOWED');
}

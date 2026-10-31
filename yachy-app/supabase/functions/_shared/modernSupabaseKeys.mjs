/** Read hosted replacement keys without ever falling back to revoked JWT keys. */
export function getModernSupabaseKey(getEnv, kind) {
  const config = {
    publishable: ['SUPABASE_PUBLISHABLE_KEYS', 'sb_publishable_'],
    secret: ['SUPABASE_SECRET_KEYS', 'sb_secret_'],
  }[kind];
  if (!config) throw new Error('Unsupported Supabase key type');
  const [name, prefix] = config;
  let value;
  try {
    const keys = JSON.parse(getEnv(name) || '{}');
    if (keys && typeof keys === 'object' && !Array.isArray(keys)) value = keys.default;
  } catch {
    // Never include the raw environment value or JSON parser details in errors.
  }
  if (typeof value !== 'string' || !value.startsWith(prefix) || value.length <= prefix.length || /\s/.test(value)) {
    throw new Error(`Replacement Supabase ${kind} key is not configured`);
  }
  return value;
}

/** Compatibility adapter for existing handlers; user JWTs and feature flags are unchanged. */
export function withModernSupabaseKeys(getEnv) {
  return (name) => {
    if (name === 'SUPABASE_ANON_KEY') return getModernSupabaseKey(getEnv, 'publishable');
    if (name === 'SUPABASE_SERVICE_ROLE_KEY') return getModernSupabaseKey(getEnv, 'secret');
    return getEnv(name);
  };
}

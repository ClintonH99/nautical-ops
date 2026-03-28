// Overwritten at build time by scripts/inject-pricing-config.mjs (reads EXPO_PUBLIC_* from process.env).
// Repo root vercel.json must run that script before `expo export` so Vercel injects values into this file.
// Safe defaults for local preview without secrets:
window.NAUTICAL_PRICING_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  paddleClientToken: '',
};

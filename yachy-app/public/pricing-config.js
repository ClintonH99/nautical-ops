// Overwritten at build time by scripts/inject-pricing-config.mjs (uses Vercel / local env).
// Safe defaults for local preview without secrets:
window.NAUTICAL_PRICING_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  paddleClientToken: '',
};

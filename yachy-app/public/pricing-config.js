// Overwritten at build time by scripts/inject-pricing-config.mjs (reads EXPO_PUBLIC_* from process.env).
// Repo root vercel.json runs `npm run vercel-build` so Vercel injects values before export + copy to dist.
// Safe defaults for local preview without secrets:
window.NAUTICAL_PRICING_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  paddleClientToken: '',
};

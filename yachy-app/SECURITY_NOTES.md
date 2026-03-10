# Security Notes

## Dependency Audit (npm audit)

Run `npm audit` periodically. CI runs `npm audit --audit-level=critical` (fails only on critical; high-severity issues are reported but non-blocking). Known issues:

### xlsx (SheetJS)

- **Status**: 1 high severity vulnerability (Prototype Pollution, ReDoS)
- **Advisory**: GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9
- **Fix**: No fix available at this time
- **Mitigation**: The xlsx library is used for Excel template export/import (e.g. inventory). Input is controlled (user's own data). Consider migrating to an alternative (e.g. exceljs) if a security fix is not released.

## Supabase Configuration

- Production builds fail immediately if `EXPO_PUBLIC_SUPABASE_URL` or `EXPO_PUBLIC_SUPABASE_ANON_KEY` are not set or still use placeholder values.
- The anon key is safe to include in client builds; RLS enforces server-side access control.

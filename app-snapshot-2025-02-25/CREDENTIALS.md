# 🔐 Yachy App - Credentials & Access

**⚠️ IMPORTANT: This file contains sensitive information. Do NOT commit to Git!**

---

## Supabase Project

### Project Details
- **Project Name:** Yachy App
- **Project URL:** https://grtrcjgsvfsknpnlarxv.supabase.co
- **Project ID:** grtrcjgsvfsknpnlarxv
- **Region:** (Check your Supabase dashboard)

### API Keys
- **Anon/Public Key:** eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdydHJjamdzdmZza25wbmxhcnh2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5NDgzNTAsImV4cCI6MjA4NjUyNDM1MH0._EsvO6djy3Xa8q7U0_s-YKz0P2JNcr6RQtRcS4O-tBs
- **Service Role Key:** (Only in Supabase dashboard - DO NOT USE in app)

### Dashboard Access
- **URL:** https://supabase.com/dashboard/project/grtrcjgsvfsknpnlarxv
- **Login:** Use your Supabase account credentials

---

## Test Data

### Test Vessel
- **Name:** Test Yacht
- **Invite Code:** `YACHT2026`
- **Valid Until:** December 31, 2027

### Creating Additional Vessels
Use SQL Editor in Supabase:
```sql
INSERT INTO vessels (name, invite_code, invite_expiry)
VALUES (
  'Your Yacht Name',
  'UNIQUECODE',
  '2027-12-31 23:59:59+00'
);
```

---

## Environment Files

### `.env` File Location
`/Users/clintonhandford/Desktop/Yachy App/yachy-app/.env`

### Contents
```
EXPO_PUBLIC_SUPABASE_URL=https://grtrcjgsvfsknpnlarxv.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=[Your key here]
```

---

## Security Notes

### ✅ Safe to Share
- Project URL
- Anon/Public API key (used in client apps)
- Invite codes

### ⛔ NEVER Share
- Database password
- Service role key
- Personal Supabase login credentials

### ✅ Git Safety
Make sure `.env` is in `.gitignore` (already configured)

---

## Backup Information

### Database Backup
1. Go to Supabase Dashboard
2. Settings → Database
3. Download backup

### Export Data
Use SQL Editor:
```sql
-- Export all users
COPY (SELECT * FROM users) TO STDOUT WITH CSV HEADER;

-- Export all tasks
COPY (SELECT * FROM tasks) TO STDOUT WITH CSV HEADER;
```

---

**Last Updated:** February 12, 2026

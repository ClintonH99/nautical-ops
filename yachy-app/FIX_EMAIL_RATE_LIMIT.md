# Fix: Email Rate Limit Exceeded Error

## Problem
Supabase has email rate limits by default to prevent spam. The error "email rate limit exceeded" occurs when too many confirmation emails are sent in a short period.

---

## Solution 1: Disable Email Confirmation (Recommended for Development)

This allows users to register without needing to confirm their email address.

### Steps:

1. **Open Supabase Dashboard**
   - Go to https://supabase.com
   - Select your project

2. **Navigate to Authentication Settings**
   - Click "Authentication" in left sidebar
   - Click "Settings" tab
   - Scroll to "Email Auth"

3. **Disable Email Confirmation**
   - Find "Enable email confirmations"
   - **Toggle OFF** (disable it)
   - Click "Save"

4. **Adjust Auto-confirm Settings**
   - Find "Confirm email"
   - Set to **"Disabled"**
   - This allows users to sign up immediately without email verification

### Result:
- Users can register instantly without email confirmation
- No rate limit errors
- Good for development and testing

---

## Solution 2: Increase Rate Limits (For Production)

If you need email confirmation enabled, increase the rate limits.

### Steps:

1. **Open Supabase Dashboard**
   - Go to https://supabase.com
   - Select your project

2. **Navigate to Rate Limits**
   - Click "Settings" in left sidebar
   - Click "Rate Limits"

3. **Adjust Email Rate Limits**
   - Find "Email rate limit"
   - Current default: Usually 3-4 per hour per IP
   - **Increase to higher value** (e.g., 100 per hour)
   - Click "Save"

### Note:
- Rate limit settings may vary by Supabase plan
- Free tier has lower limits
- Paid plans can set higher limits

---

## Solution 3: Configure Custom SMTP (Best for Production)

Use your own email service to bypass Supabase's rate limits entirely.

### Steps:

1. **Get SMTP Credentials**
   - Use services like:
     - SendGrid (free tier: 100 emails/day)
     - Mailgun
     - Amazon SES
     - Gmail SMTP (for testing only)

2. **Configure in Supabase**
   - Dashboard → Authentication → Settings
   - Scroll to "SMTP Settings"
   - Enable "Enable Custom SMTP"
   - Enter your SMTP details:
     - Host
     - Port
     - Username
     - Password
     - Sender email
     - Sender name

3. **Save and Test**
   - Click "Save"
   - Test by registering a new account

### Result:
- Unlimited emails (based on your SMTP provider)
- No Supabase rate limits
- Professional email delivery

---

## Quick Fix for Development (Recommended)

**Just disable email confirmation:**

1. Supabase Dashboard
2. Authentication → Settings
3. Toggle OFF "Enable email confirmations"
4. Save

This is the fastest solution for development and testing.

---

## Alternative: Use SQL to Bypass Email Confirmation

You can also configure this via SQL:

```sql
-- Disable email confirmation requirement
UPDATE auth.config
SET email_confirmations_enabled = false;

-- Allow auto-confirm for new signups
UPDATE auth.config
SET email_autoconfirm = true;
```

Run this in: Supabase Dashboard → SQL Editor → New Query

---

## Verification

After making changes, test by:

1. Register a new account
2. Check if you can log in immediately
3. No "email rate limit exceeded" error should appear

---

## For Production Deployment

**Important:** For production, you should:

1. ✅ Use custom SMTP provider
2. ✅ Enable email confirmation (for security)
3. ✅ Set up proper email templates
4. ✅ Monitor rate limits
5. ✅ Consider paid Supabase plan for higher limits

---

## Common Issues

### "Still getting rate limit error"
- Clear browser cache
- Wait 1 hour and try again
- Check if settings were saved
- Restart Expo app

### "Email confirmation still required"
- Verify "Enable email confirmations" is OFF
- Check SQL config table
- May need to sign out and sign in again

### "Can't find rate limit settings"
- Check your Supabase plan
- Free tier may have limited access
- Some settings require paid plan

---

## Summary

**For Development (Quick Fix):**
```
Supabase Dashboard → Authentication → Settings → 
Disable "Enable email confirmations" → Save
```

**For Production:**
```
Set up custom SMTP → Configure provider → 
Enable email confirmation → Set higher rate limits
```

---

## Current Status

After implementing the new Captain/Crew registration flow:
- Captains: Register without invite code ✅
- Crew: Register with required invite code ✅
- Both: Subject to email rate limits (needs fix above)

**Recommendation:** Disable email confirmation for now to test the new flow, then set up custom SMTP before production deployment.

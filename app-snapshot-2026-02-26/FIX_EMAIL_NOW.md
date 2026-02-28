# CRITICAL: Fix Email Rate Limit - Run This Now

## The Problem
You're getting "email rate limit exceeded" because Supabase is trying to send confirmation emails.

## The Solution (30 Seconds)

### Option 1: Disable Email Confirmation via Dashboard (EASIEST)

1. Go to https://supabase.com
2. Open your Yachy project
3. Click **"Authentication"** in the left sidebar
4. Click **"Providers"** tab
5. Click **"Email"** provider
6. Scroll down to **"Confirm email"**
7. **Toggle it OFF** (disable it)
8. Click **"Save"**

✅ **Done!** Now try registering again.

---

### Option 2: Run This SQL (Alternative)

If you prefer SQL, go to: **SQL Editor** in Supabase and run:

```sql
-- Disable email confirmation
UPDATE auth.config 
SET email_confirmations_enabled = false 
WHERE id = 1;

-- Auto-confirm new signups
UPDATE auth.config 
SET email_autoconfirm = true 
WHERE id = 1;
```

---

## Test It

After disabling email confirmation:

1. Try creating a Captain account
2. You should see "Account created successfully!"
3. No email confirmation needed
4. You can login immediately

---

## Why This Works

- **Before:** Supabase sent confirmation email → Hit rate limit → Registration failed
- **After:** No confirmation email → No rate limit → Registration succeeds

---

## For Production Later

When you're ready to launch, you should:
1. Set up a custom SMTP provider (SendGrid, Mailgun, etc.)
2. Re-enable email confirmation
3. Customize email templates

But for now, **just disable email confirmation** so you can test the app.

---

**Action:** Go to Supabase now and disable email confirmation!

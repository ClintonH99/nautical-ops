# Email Confirmation Customization - Manual Setup

After deploying the code changes, complete these steps in Supabase to enable the custom confirmation flow.

## 1. Customize the confirmation email template

1. Go to [Supabase Dashboard](https://supabase.com/dashboard) → your project
2. **Authentication** → **Email Templates** → **Confirm signup**
3. **Subject**: e.g. `Confirm your Nautical Ops account`
4. **Body**: Replace the default confirmation link with this custom link:

```html
<h2>Confirm your Nautical Ops account</h2>
<p>Hi,</p>
<p>Thanks for signing up. Click the link below to confirm your email:</p>
<p><a href="https://www.nautical-ops.com/auth/confirm?token_hash={{ .TokenHash }}&type=email">Confirm your email</a></p>
<p>If you didn't create an account, you can ignore this email.</p>
<p>— Nautical Ops</p>
```

5. Save

## 2. Add redirect URL

1. **Authentication** → **URL Configuration** → **Redirect URLs**
2. Add: `https://www.nautical-ops.com/auth/confirm`
3. Save

## 3. Deploy

Ensure your web app is deployed to Vercel so `https://www.nautical-ops.com/auth/confirm` is live.

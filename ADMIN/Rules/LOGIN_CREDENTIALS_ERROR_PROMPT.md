# Login Credentials Error Prompt

## Rule

When a user attempts to sign in with an email address or password that is incorrect, the app **must** display a prompt stating:

> **Email Address or Password is Incorrect, Try Again.**

## Implementation

- Detect failed sign-in (e.g. invalid credentials from auth provider)
- Show the exact message: **"Email Address or Password is Incorrect, Try Again."**
- Use the app's standard alert/toast/error UI pattern (e.g. Alert.alert, toast, or inline error)
- Do not reveal whether the email or password was wrong; use the same generic message for both to avoid information disclosure

## Scope

Applies to all sign-in flows: LoginScreen (email/password), and any auth service or API that validates user credentials.

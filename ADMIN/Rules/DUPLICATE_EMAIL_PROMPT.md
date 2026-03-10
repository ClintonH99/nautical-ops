# Duplicate Email Prompt

## Rule

When a user attempts to sign up or register with an email address that is already linked to an existing account, the app **must** display a prompt stating:

> **Email address already in use**

## Implementation

- Detect the duplicate email error (e.g. `duplicate key value violates unique constraint "users_email_key"` or equivalent from auth/database)
- Show the exact message: **"Email address already in use"**
- Use the app's standard alert/toast/error UI pattern (e.g. Alert.alert, toast, or inline error below the email field)

## Scope

Applies to all registration and sign-up flows: RegisterCaptainScreen, RegisterCrewScreen, and any auth service or API that creates new user accounts.

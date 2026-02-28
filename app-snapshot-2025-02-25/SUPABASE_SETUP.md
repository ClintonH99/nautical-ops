# Supabase Setup Guide for Yachy App

Follow these steps to set up your Supabase backend.

## Step 1: Create a Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Sign up or log in
3. Click "New Project"
4. Choose your organization
5. Fill in project details:
   - **Name:** yachy-app (or any name you prefer)
   - **Database Password:** Create a strong password (save it!)
   - **Region:** Choose closest to your users
   - **Pricing Plan:** Free tier is fine for development

## Step 2: Get Your API Keys

1. Once project is created, go to **Settings** → **API**
2. Copy these values:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **anon/public key** (a long string starting with `eyJ...`)

3. Create a `.env` file in your project root:
```bash
cp .env.example .env
```

4. Add your values to `.env`:
```
EXPO_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Step 3: Create Database Tables

Go to **SQL Editor** in Supabase dashboard and run these commands:

### 1. Users Table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  position TEXT NOT NULL,
  department TEXT NOT NULL CHECK (department IN ('BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY')),
  role TEXT NOT NULL DEFAULT 'CREW' CHECK (role IN ('HOD', 'CREW', 'MANAGEMENT')),
  vessel_id UUID REFERENCES vessels(id),
  profile_photo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Users can read their own data
CREATE POLICY "Users can read own data" ON users
  FOR SELECT USING (auth.uid() = id);

-- Users can update their own data
CREATE POLICY "Users can update own data" ON users
  FOR UPDATE USING (auth.uid() = id);
```

### 2. Vessels Table
```sql
CREATE TABLE vessels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  management_company_id UUID,
  invite_code TEXT UNIQUE NOT NULL,
  invite_expiry TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE vessels ENABLE ROW LEVEL SECURITY;

-- Users can read vessels they belong to
CREATE POLICY "Users can read their vessel" ON vessels
  FOR SELECT USING (
    id IN (SELECT vessel_id FROM users WHERE id = auth.uid())
  );
```

### 3. Tasks Table
```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  vessel_id UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  created_by_name TEXT NOT NULL,
  department TEXT NOT NULL CHECK (department IN ('BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY')),
  assigned_to UUID REFERENCES users(id),
  assigned_to_name TEXT,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('1_DAY', '3_DAYS', '1_WEEK', '2_WEEKS', '1_MONTH', 'CUSTOM')),
  deadline TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')),
  priority TEXT NOT NULL DEFAULT 'GREEN' CHECK (priority IN ('GREEN', 'YELLOW', 'RED', 'OVERDUE')),
  claimed_by UUID REFERENCES users(id),
  claimed_by_name TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Users can read tasks from their vessel
CREATE POLICY "Users can read vessel tasks" ON tasks
  FOR SELECT USING (
    vessel_id IN (SELECT vessel_id FROM users WHERE id = auth.uid())
  );

-- Users can create tasks
CREATE POLICY "Users can create tasks" ON tasks
  FOR INSERT WITH CHECK (
    vessel_id IN (SELECT vessel_id FROM users WHERE id = auth.uid())
  );

-- Users can update tasks
CREATE POLICY "Users can update tasks" ON tasks
  FOR UPDATE USING (
    vessel_id IN (SELECT vessel_id FROM users WHERE id = auth.uid())
  );
```

### 4. Inventory Categories Table
```sql
CREATE TABLE inventory_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  department TEXT NOT NULL CHECK (department IN ('BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY')),
  vessel_id UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE inventory_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read vessel inventory categories" ON inventory_categories
  FOR SELECT USING (
    vessel_id IN (SELECT vessel_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can manage inventory categories" ON inventory_categories
  FOR ALL USING (
    vessel_id IN (SELECT vessel_id FROM users WHERE id = auth.uid())
  );
```

### 5. Inventory Items Table
```sql
CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES inventory_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  location TEXT NOT NULL,
  department TEXT NOT NULL CHECK (department IN ('BRIDGE', 'ENGINEERING', 'EXTERIOR', 'INTERIOR', 'GALLEY')),
  vessel_id UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  photo TEXT,
  last_edited_by UUID NOT NULL REFERENCES users(id),
  last_edited_by_name TEXT NOT NULL,
  last_edited_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read vessel inventory items" ON inventory_items
  FOR SELECT USING (
    vessel_id IN (SELECT vessel_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Users can manage inventory items" ON inventory_items
  FOR ALL USING (
    vessel_id IN (SELECT vessel_id FROM users WHERE id = auth.uid())
  );
```

## Step 4: Enable Authentication Providers

1. Go to **Authentication** → **Providers**
2. Enable **Email** (should be enabled by default)
3. For Apple Sign-In (later):
   - Enable "Apple" provider
   - Follow Supabase's guide to set up Apple credentials
4. For Google Sign-In (later):
   - Enable "Google" provider
   - Add OAuth credentials from Google Cloud Console

## Step 5: Storage for Photos (Optional for now)

1. Go to **Storage**
2. Create a bucket named `inventory-photos`
3. Set permissions to allow authenticated users to upload

## Step 6: Test Connection

1. Restart your Expo development server:
```bash
npm start
```

2. Try to register a new user
3. Check Supabase **Authentication** → **Users** to see if user was created

## Troubleshooting

### "Invalid API key" error
- Check that your `.env` file has the correct values
- Restart Expo server after changing `.env`

### "Failed to create user" error
- Check that all tables are created
- Check Row Level Security policies are set up

### Need help?
- Supabase docs: [https://supabase.com/docs](https://supabase.com/docs)
- Check Supabase dashboard logs for errors

## Next Steps

Once Supabase is set up:
1. Test registration with an invite code (you'll need to manually create a vessel first)
2. Test login
3. Start building the Tasks and Inventory modules!

---

**Note:** For production, you'll want to:
- Set up proper database backups
- Configure rate limiting
- Add more sophisticated RLS policies
- Enable email confirmation for sign-ups

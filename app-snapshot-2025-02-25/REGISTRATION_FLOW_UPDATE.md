# Registration & Vessel Join Flow Update

## Changes Made

### Overview
Separated account creation from vessel joining. Users can now:
1. Create an account without an invite code
2. Log in and join a vessel later using an invite code
3. Create their own vessel at any time

### Modified Files

#### 1. `/src/screens/RegisterScreen.tsx`
- **Removed**: Invite code requirement during registration
- **Changed**: Invite code field is now only shown for vessel creators (auto-generated)
- **Added**: Info message explaining users can join vessels after account creation
- **Updated**: Subtitle to "Join the crew" for regular users

#### 2. `/src/services/auth.ts`
- **Updated**: `signUp()` method to allow registration without invite code or vessel
- **Added**: `joinVessel()` method to join a vessel after registration
- **Changed**: vesselId in user profile is now optional during signup

#### 3. `/src/screens/HomeScreen.tsx`
- **Added**: Check for whether user has joined a vessel (`hasVessel`)
- **Added**: "No vessel" card with options to join or create vessel
- **Changed**: Main content only shows if user has joined a vessel
- **Added**: Navigation prop to enable navigation to JoinVessel screen

#### 4. `/src/screens/JoinVesselScreen.tsx` (NEW)
- **Created**: New screen for joining vessels after login
- **Features**:
  - Input field for 8-character invite code
  - Validation and error handling
  - Information card explaining how to get invite codes
  - Option to create own vessel instead
  - Back to home button

#### 5. `/src/navigation/RootNavigator.tsx`
- **Added**: `JoinVessel` screen to authenticated stack
- **Added**: `CreateVessel` screen to authenticated stack (previously only in auth stack)
- **Updated**: Import to include `JoinVesselScreen`

#### 6. `/src/screens/index.ts`
- **Added**: Export for `JoinVesselScreen`

#### 7. `/src/types/index.ts`
- **Updated**: `User` interface - made `vesselId` optional (can be undefined)

### New User Flow

#### Scenario 1: User without invite code
1. User creates account (no invite code required)
2. User logs in → sees "No vessel" card on home screen
3. User clicks "Join Vessel" → enters invite code
4. User successfully joins vessel → home screen shows normal content

#### Scenario 2: Vessel creator
1. User navigates to "Create Vessel" from login/register screen
2. User creates vessel → auto-navigates to Register with vesselId
3. User completes registration → automatically assigned as HOD
4. User logs in → has vessel access immediately

#### Scenario 3: User wants to create vessel after registering
1. User creates account without vessel
2. User logs in → sees "No vessel" card
3. User clicks "Create Vessel" instead of "Join Vessel"
4. User creates vessel → needs to update profile with vessel (future feature)

### API Methods

#### New Method: `authService.joinVessel(userId, inviteCode)`
```typescript
async joinVessel(userId: string, inviteCode: string): Promise<User | null>
```
- Validates invite code
- Updates user's vessel_id in database
- Returns updated user profile

### Database Considerations

The `users` table must allow `vessel_id` to be NULL:
```sql
ALTER TABLE users ALTER COLUMN vessel_id DROP NOT NULL;
```

This allows users to register without being part of a vessel initially.

### UI Components

#### Home Screen - No Vessel State
- Large anchor icon (⚓)
- "You're not part of a vessel yet" message
- Two action buttons:
  - "Join Vessel" (primary)
  - "Create Vessel" (outline)

#### Join Vessel Screen
- Anchor icon header
- Info card explaining invite code requirements
- Input field for 8-character code (uppercase)
- "Join Vessel" button
- Alternative: "Create Your Own Vessel" button
- "Back to Home" text button

### Testing Checklist

- [ ] User can register without invite code
- [ ] User can log in after registering without vessel
- [ ] Home screen shows "no vessel" state correctly
- [ ] User can navigate to Join Vessel screen
- [ ] User can successfully join vessel with valid invite code
- [ ] Error shown for invalid/expired invite codes
- [ ] User can navigate to Create Vessel from home screen
- [ ] After joining vessel, home screen shows normal content
- [ ] Vessel creator flow still works (register → auto-assigned HOD)

### Future Enhancements

1. **Settings page** - Allow users to leave vessels or switch vessels
2. **Vessel info on home** - Display vessel name and crew count
3. **Multiple vessels** - Allow users to be part of multiple vessels
4. **Invite code sharing** - Built-in sharing options (SMS, email, clipboard)
5. **QR codes** - Generate QR codes for invite codes
6. **Push notifications** - Notify when someone joins vessel

## Notes

- Invite codes are still validated and must be valid
- Invite codes still expire after 1 year
- Users without vessels have limited functionality (can't see tasks, inventory, etc.)
- The CreateVessel flow remains unchanged - still generates auto invite code

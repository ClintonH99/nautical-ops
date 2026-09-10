export interface TripNotificationRecord {
  id: string;
  vessel_id: string;
  type: string;
  title: string;
  start_date: string;
  end_date: string;
}

export interface ChecklistNotificationRecord {
  id: string;
  vessel_id: string;
  trip_id: string | null;
  title: string;
}

export type NotificationData = Record<string, string>;

export interface PushContent {
  title: string;
  body: string;
  data: NotificationData;
}

export interface PushUserRecord {
  id: string;
  push_token: string | null;
  notification_preferences: Record<string, unknown> | null;
}

export interface PushDeviceRecord {
  user_id: string;
  expo_push_token: string | null;
}

export interface NotificationRecipient {
  token: string;
  userId: string;
  source: 'device' | 'legacy';
}

export type NotificationPreferenceRule = 'trips' | 'preDeparture' | 'dayBefore';

export function formatTripType(type: string): string {
  const labels: Record<string, string> = {
    GUEST: 'Guest',
    BOSS: 'Boss',
    DELIVERY: 'Delivery',
    YARD_PERIOD: 'Yard period',
  };
  return labels[type] || type;
}

export function isExpoPushToken(token: unknown): token is string {
  return (
    typeof token === 'string' &&
    (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[')) &&
    token.endsWith(']')
  );
}

function preferenceAllows(
  preferences: Record<string, unknown> | null,
  rule: NotificationPreferenceRule
): boolean {
  const prefs = preferences || {};
  if (rule === 'dayBefore') {
    return prefs.trips !== false || prefs.preDeparture !== false;
  }
  return prefs[rule] !== false;
}

export function collectNotificationRecipients(
  users: PushUserRecord[],
  devices: PushDeviceRecord[],
  preferenceRule: NotificationPreferenceRule
): NotificationRecipient[] {
  const allowedUsers = users.filter((user) =>
    preferenceAllows(user.notification_preferences, preferenceRule)
  );
  const allowedUserIds = new Set(allowedUsers.map((user) => user.id));
  const recipientsByToken = new Map<string, NotificationRecipient>();

  for (const device of devices) {
    if (allowedUserIds.has(device.user_id) && isExpoPushToken(device.expo_push_token)) {
      recipientsByToken.set(device.expo_push_token, {
        token: device.expo_push_token,
        userId: device.user_id,
        source: 'device',
      });
    }
  }

  // Older app versions only have users.push_token. Preserve that token unless
  // the same installation token was already collected above.
  for (const user of allowedUsers) {
    if (isExpoPushToken(user.push_token) && !recipientsByToken.has(user.push_token)) {
      recipientsByToken.set(user.push_token, {
        token: user.push_token,
        userId: user.id,
        source: 'legacy',
      });
    }
  }

  return [...recipientsByToken.values()];
}

export function buildTripNotification(
  trip: TripNotificationRecord,
  event: 'created' | 'updated'
): PushContent {
  const created = event === 'created';
  return {
    title: `${created ? 'New trip' : 'Trip updated'}: ${trip.title}`,
    body: created
      ? `${formatTripType(trip.type)} trip added. ${trip.start_date} – ${trip.end_date}. Tap to view.`
      : `${formatTripType(trip.type)} trip details changed. Tap to view the latest information.`,
    data: {
      kind: created ? 'trip_created' : 'trip_updated',
      screen: 'UpcomingTrips',
      tripId: trip.id,
    },
  };
}

export function buildChecklistNotification(
  checklist: ChecklistNotificationRecord,
  trip: TripNotificationRecord
): PushContent {
  return {
    title: 'Pre-departure checklist',
    body: `Look at the pre-departure checklist for this trip: ${trip.title}.`,
    data: {
      kind: 'pre_departure_checklist_linked',
      screen: 'ViewPreDepartureChecklist',
      checklistId: checklist.id,
      tripId: trip.id,
    },
  };
}

export function buildDayBeforeNotification(trip: TripNotificationRecord): PushContent {
  return {
    title: `Trip tomorrow: ${trip.title}`,
    body: `${formatTripType(trip.type)} trip starts tomorrow. Review your pre-departure checklist.`,
    data: {
      kind: 'trip_day_before',
      screen: 'UpcomingTrips',
      tripId: trip.id,
    },
  };
}

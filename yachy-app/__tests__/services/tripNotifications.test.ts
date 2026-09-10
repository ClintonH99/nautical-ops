import {
  buildChecklistNotification,
  buildDayBeforeNotification,
  buildTripNotification,
  collectNotificationRecipients,
  isExpoPushToken,
} from '../../supabase/functions/send-trip-push/notification-logic';

const trip = {
  id: 'trip-1',
  vessel_id: 'vessel-1',
  type: 'DELIVERY',
  title: 'Fort Lauderdale to Sag Harbor',
  start_date: '2026-09-11',
  end_date: '2026-09-14',
};

describe('trip notification content', () => {
  it('creates distinct immediate notifications for new and updated trips', () => {
    expect(buildTripNotification(trip, 'created')).toMatchObject({
      title: 'New trip: Fort Lauderdale to Sag Harbor',
      data: { kind: 'trip_created', tripId: 'trip-1', screen: 'UpcomingTrips' },
    });
    expect(buildTripNotification(trip, 'updated')).toMatchObject({
      title: 'Trip updated: Fort Lauderdale to Sag Harbor',
      data: { kind: 'trip_updated', tripId: 'trip-1', screen: 'UpcomingTrips' },
    });
  });

  it('directs a linked-checklist notification to the checklist preview', () => {
    const content = buildChecklistNotification(
      {
        id: 'checklist-1',
        vessel_id: 'vessel-1',
        trip_id: 'trip-1',
        title: 'Delivery departure checks',
      },
      trip
    );

    expect(content.body).toBe(
      'Look at the pre-departure checklist for this trip: Fort Lauderdale to Sag Harbor.'
    );
    expect(content.data).toEqual({
      kind: 'pre_departure_checklist_linked',
      screen: 'ViewPreDepartureChecklist',
      checklistId: 'checklist-1',
      tripId: 'trip-1',
    });
  });

  it('creates a day-before reminder linked to Upcoming Trips', () => {
    expect(buildDayBeforeNotification(trip)).toMatchObject({
      title: 'Trip tomorrow: Fort Lauderdale to Sag Harbor',
      data: { kind: 'trip_day_before', tripId: 'trip-1', screen: 'UpcomingTrips' },
    });
  });

  it('accepts Expo token formats and rejects unrelated strings', () => {
    expect(isExpoPushToken('ExponentPushToken[abc123]')).toBe(true);
    expect(isExpoPushToken('ExpoPushToken[abc123]')).toBe(true);
    expect(isExpoPushToken('not-a-push-token')).toBe(false);
  });

  it('delivers to both registered devices and de-duplicates the legacy token', () => {
    const recipients = collectNotificationRecipients(
      [
        {
          id: 'user-1',
          push_token: 'ExponentPushToken[iphone]',
          notification_preferences: { trips: true },
        },
      ],
      [
        { user_id: 'user-1', expo_push_token: 'ExponentPushToken[iphone]' },
        { user_id: 'user-1', expo_push_token: 'ExponentPushToken[web]' },
      ],
      'trips'
    );

    expect(recipients).toEqual([
      {
        token: 'ExponentPushToken[iphone]',
        userId: 'user-1',
        source: 'device',
      },
      {
        token: 'ExponentPushToken[web]',
        userId: 'user-1',
        source: 'device',
      },
    ]);
  });

  it('respects notification preferences for every device on the account', () => {
    const recipients = collectNotificationRecipients(
      [
        {
          id: 'user-1',
          push_token: 'ExponentPushToken[legacy]',
          notification_preferences: { preDeparture: false },
        },
      ],
      [{ user_id: 'user-1', expo_push_token: 'ExponentPushToken[iphone]' }],
      'preDeparture'
    );

    expect(recipients).toEqual([]);
  });
});

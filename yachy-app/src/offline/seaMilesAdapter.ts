import type { OfflineAdapter } from './outbox';
import { validTripDate } from './tripsAdapter.ts';
export const seaFields = [
  'voyage_date',
  'vessel_name',
  'vessel_length',
  'from_location',
  'to_location',
  'capacity_role',
  'miles_logged',
  'day_hours',
  'night_hours',
  'tidal',
];
export const seaServerFields = [
  'owner_name',
  'review_vessel_id',
  'submitted_at',
  'reviewed_by',
  'reviewer_name',
  'reviewer_signature_type',
  'reviewer_signature_image',
  'reviewer_typed_name',
  'reviewed_at',
  'created_at',
  'updated_at',
  'reviewer_contact_first_name',
  'reviewer_contact_last_name',
  'reviewer_contact_cell_number',
  'reviewer_contact_email_address',
];
const fields = [
  'id',
  'user_id',
  ...seaFields,
  ...seaServerFields,
  'status',
  'decline_comment',
  'review_context_revision',
];
export function seaMilesAdapter(review = false): OfflineAdapter {
  return {
    serverFields: seaServerFields,
    authorizeReplay: (s, kind, v, _old, c) =>
      (review
        ? v.user_id !== s.userId && v.review_vessel_id === s.vesselId
        : v.user_id === s.userId) &&
      (kind === 'create'
        ? !review && ['DRAFT', 'PENDING'].includes(String(v.status))
        : review || ['APPROVED', 'DECLINED'].includes(String(v.status))
          ? c?.permit?.claims.permissions.seaMilesReview?.includes('update') === true
          : true),
    validate(v) {
      if (!fields.every((k) => k in v) || !Object.keys(v).every((k) => fields.includes(k)))
        return false;
      if (
        !['id', 'user_id', 'owner_name', 'created_at', 'updated_at'].every(
          (k) => typeof v[k] === 'string'
        ) ||
        !validTripDate(v.voyage_date)
      )
        return false;
      if (
        !['vessel_name', 'vessel_length', 'from_location', 'to_location', 'capacity_role'].every(
          (k) => typeof v[k] === 'string' && !!String(v[k]).trim()
        )
      )
        return false;
      if (
        !['miles_logged', 'day_hours', 'night_hours'].every(
          (k) => typeof v[k] === 'number' && Number.isFinite(v[k]) && Number(v[k]) >= 0
        ) ||
        typeof v.tidal !== 'boolean'
      )
        return false;
      if (!['DRAFT', 'PENDING', 'APPROVED', 'DECLINED'].includes(String(v.status))) return false;
      return (
        [
          ...seaServerFields.filter((k) => !['owner_name', 'created_at', 'updated_at'].includes(k)),
          'decline_comment',
          'review_context_revision',
        ].every((k) => v[k] === null || typeof v[k] === 'string') &&
        (v.status !== 'DECLINED' ||
          (typeof v.decline_comment === 'string' && !!v.decline_comment.trim()))
      );
    },
    authorizeRead: (s, v) =>
      review ? v.user_id !== s.userId && v.review_vessel_id === s.vesselId : v.user_id === s.userId,
    authorize(s, kind, v, old, context) {
      if (kind === 'create')
        return !review && v.user_id === s.userId && ['DRAFT', 'PENDING'].includes(String(v.status));
      if (!old || old.value.id !== v.id || old.value.user_id !== v.user_id) return false;
      if (old.value.status === 'PENDING')
        return (
          context?.permit?.claims.permissions.seaMilesReview?.includes('update') === true &&
          old.value.review_vessel_id === s.vesselId &&
          ['PENDING', 'APPROVED', 'DECLINED'].includes(String(v.status))
        );
      return (
        !review &&
        v.user_id === s.userId &&
        ['DRAFT', 'DECLINED'].includes(String(old.value.status)) &&
        ['DRAFT', 'PENDING'].includes(String(v.status))
      );
    },
  };
}

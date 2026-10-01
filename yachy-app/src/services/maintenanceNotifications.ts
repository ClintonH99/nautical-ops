import { supabase } from './supabase';

export interface MaintenanceRecipients {
  crew: Array<{ id: string; name: string }>;
  recipientIds: string[];
  revision: number;
}

export function canManageMaintenanceNotifications(role?: string): boolean {
  return role === 'CAPTAIN_MOV' || role === 'HOD';
}

export async function getMaintenanceRecipients(vesselId: string): Promise<MaintenanceRecipients> {
  const { data, error } = await supabase.rpc('get_maintenance_notification_recipients', {
    p_vessel_id: vesselId,
  });
  if (error) throw error;
  if (
    !data ||
    !Array.isArray(data.crew) ||
    !Array.isArray(data.recipientIds) ||
    !Number.isInteger(data.revision)
  ) {
    throw new Error('Could not load notification recipients.');
  }
  return data;
}

export async function setMaintenanceRecipients(
  vesselId: string,
  recipientIds: string[],
  revision: number
): Promise<void> {
  const { error } = await supabase.rpc('set_maintenance_notification_recipients', {
    p_vessel_id: vesselId,
    p_recipient_ids: [...new Set(recipientIds)],
    p_revision: revision,
  });
  if (error) throw error;
}

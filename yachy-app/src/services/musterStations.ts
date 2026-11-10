/**
 * Muster Stations Service
 * Published muster station plans for vessels
 */

import { offlinePublications } from '../offline/publicationsService';
const offline = offlinePublications('musterStations');
import { supabase } from './supabase';

export interface MusterStationData {
  vesselName: string;
  /** Legacy primary location retained for older app builds and saved records. */
  musterStation: string;
  /** All configured muster-station locations. */
  musterStationLocations?: string[];
  medicalChest: string[];
  grabBag: string[];
  grabBagContents: string;
  lifeRings: string[];
  emergencySignals: {
    fire: string;
    manOverboard: string;
    grounding: string;
    abandonShip: string;
    medical: string;
  };
  crewMembers: Array<{
    roleName: string;
    fire: string;
    manOverboard: string;
    grounding: string;
    abandonShip: string;
    medical: string;
  }>;
}

export function getMusterStationLocations(data: Partial<MusterStationData> | null): string[] {
  const rawLocations = data?.musterStationLocations;
  const locations = Array.isArray(rawLocations)
    ? rawLocations
        .filter((location): location is string => typeof location === 'string')
        .map((location) => location.trim())
        .filter(Boolean)
    : [];
  if (locations.length > 0) return locations;

  const legacyLocation = typeof data?.musterStation === 'string' ? data.musterStation.trim() : '';
  return legacyLocation ? [legacyLocation] : [];
}

export interface MusterStation {
  id: string;
  vesselId: string;
  title: string;
  data: MusterStationData;
  createdAt: string;
  offlineLocalVersion?: number;
}

class MusterStationsService {
  private mapRow(row: any): MusterStation {
    const rawData = (row.data || {}) as Partial<MusterStationData>;
    const musterStationLocations = getMusterStationLocations(rawData);
    return {
      id: row.id,
      vesselId: row.vessel_id,
      title: row.title,
      data: {
        ...rawData,
        musterStation: musterStationLocations[0] ?? '',
        musterStationLocations,
      } as MusterStationData,
      createdAt: row.created_at,
      offlineLocalVersion: row.offlineLocalVersion,
    };
  }

  subscribe = offline.subscribe;
  async getVesselName(vesselId: string): Promise<string> {
    if (offline.enabled()) return offline.vesselName(vesselId);
    const { data, error } = await supabase
      .from('vessels')
      .select('id,name')
      .eq('id', vesselId)
      .single();
    if (error) throw error;
    return typeof data?.name === 'string' ? data.name : '';
  }
  async getByVessel(vesselId: string): Promise<MusterStation[]> {
    if (offline.enabled()) return (await offline.list(vesselId)).map((row) => this.mapRow(row));
    const { data, error } = await supabase
      .from('muster_stations')
      .select('*')
      .eq('vessel_id', vesselId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map((r) => this.mapRow(r));
  }

  async getById(id: string): Promise<MusterStation | null> {
    if (offline.enabled()) {
      const row = await offline.read(id);
      return row ? this.mapRow(row) : null;
    }
    const { data, error } = await supabase
      .from('muster_stations')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return null;
    return this.mapRow(data);
  }

  async create(
    vesselId: string,
    title: string,
    data: MusterStationData,
    createdBy?: string
  ): Promise<MusterStation> {
    if (offline.enabled())
      return this.mapRow(
        await offline.create({ vessel_id: vesselId, title, data: JSON.parse(JSON.stringify(data)) })
      );
    const { data: row, error } = await supabase
      .from('muster_stations')
      .insert([{ vessel_id: vesselId, title, data, created_by: createdBy || null }])
      .select()
      .single();

    if (error) throw error;
    return this.mapRow(row);
  }

  async update(
    id: string,
    title: string,
    data: MusterStationData,
    version?: number
  ): Promise<MusterStation> {
    if (offline.enabled())
      return this.mapRow(
        await offline.update(id, { title, data: JSON.parse(JSON.stringify(data)) }, version)
      );
    const { data: row, error } = await supabase
      .from('muster_stations')
      .update({ title, data })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return this.mapRow(row);
  }

  async delete(id: string): Promise<void> {
    if (offline.enabled()) await offline.beforeDelete(id);
    const { data, error } = await supabase
      .from('muster_stations')
      .delete()
      .eq('id', id)
      .select('id');

    if (error) throw error;
    if (!data?.length) throw new Error('Muster station not found or you do not have permission.');
    if (offline.enabled()) await offline.refresh();
  }
}

export default new MusterStationsService();

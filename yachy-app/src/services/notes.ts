/**
 * Notes Service
 * CRUD operations for personal notes (Notepad feature) - private to each
 * user, not shared across the vessel.
 */
import { supabase } from './supabase';
import { requireAffectedRows } from './mutationResult';
import { offlineNotes } from '../offline/notesService';

export interface Note {
  offlineLocalVersion?: number;
  id: string;
  vessel_id: string;
  user_id: string;
  title: string;
  content: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

const notesService = {
  async getMyNotes(userId: string): Promise<Note[]> {
    if (offlineNotes.enabled()) return offlineNotes.list(userId);
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async getNoteById(id: string): Promise<Note | null> {
    if (offlineNotes.enabled()) return offlineNotes.get(id);
    const { data, error } = await supabase.from('notes').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  async createNote(
    vesselId: string,
    userId: string,
    title: string,
    content: string,
    createdByName: string
  ): Promise<Note> {
    if (offlineNotes.enabled())
      return offlineNotes.create(vesselId, userId, title, content, createdByName);
    const { data, error } = await supabase
      .from('notes')
      .insert({
        vessel_id: vesselId,
        user_id: userId,
        title,
        content,
        created_by_name: createdByName,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateNote(
    id: string,
    title: string,
    content: string,
    offlineLocalVersion?: number
  ): Promise<Note> {
    if (offlineNotes.enabled()) return offlineNotes.update(id, title, content, offlineLocalVersion);
    const { data, error } = await supabase
      .from('notes')
      .update({ title, content, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteNote(id: string): Promise<void> {
    if (offlineNotes.enabled()) await offlineNotes.beforeDelete(id);
    const { data, error } = await supabase.from('notes').delete().eq('id', id).select('id');
    requireAffectedRows(data, error, 'Deleting the note');
  },
};

export default notesService;

/**
 * Notes Service
 * CRUD operations for personal notes (Notepad feature) - private to each
 * user, not shared across the vessel.
 */
import { supabase } from './supabase';

export interface Note {
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
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async getNoteById(id: string): Promise<Note | null> {
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('id', id)
      .single();
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

  async updateNote(id: string, title: string, content: string): Promise<Note> {
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
    const { error } = await supabase.from('notes').delete().eq('id', id);
    if (error) throw error;
  },
};

export default notesService;

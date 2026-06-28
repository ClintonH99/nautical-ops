/**
 * Notes Service
 * CRUD operations for vessel notes (Notepad feature)
 */

import { supabase } from './supabase';

export interface Note {
  id: string;
  vessel_id: string;
  title: string;
  content: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

const notesService = {
  async getNotesByVessel(vesselId: string): Promise<Note[]> {
    const { data, error } = await supabase
      .from('notes')
      .select('*')
      .eq('vessel_id', vesselId)
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
    title: string,
    content: string,
    createdByName: string
  ): Promise<Note> {
    const { data, error } = await supabase
      .from('notes')
      .insert({
        vessel_id: vesselId,
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

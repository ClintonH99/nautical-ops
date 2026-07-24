/**
 * E-signatures
 * One signature per user (drawn or typed), stored once via ProfileScreen
 * and reused automatically whenever that person confirms a document -
 * they never sign the same thing twice. Read access extends to
 * vessel-mates (via RLS) so a crew member's PDF export can also pull in
 * the confirming officer's signature, not just their own.
 */
import { supabase } from './supabase';

export type SignatureType = 'drawn' | 'typed';

export interface UserSignature {
  userId: string;
  signatureType: SignatureType;
  signatureImage: string | null;
  typedName: string | null;
}

export async function getSignatureForUser(userId: string): Promise<UserSignature | null> {
  const { data } = await supabase
    .from('user_signatures')
    .select('user_id, signature_type, signature_image, typed_name')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return null;

  return {
    userId: data.user_id,
    signatureType: data.signature_type,
    signatureImage: data.signature_image,
    typedName: data.typed_name,
  };
}

export async function saveSignature(
  userId: string,
  signatureType: SignatureType,
  signatureImage: string | null,
  typedName: string | null
): Promise<void> {
  const { error } = await supabase
    .from('user_signatures')
    .upsert(
      {
        user_id: userId,
        signature_type: signatureType,
        signature_image: signatureImage,
        typed_name: typedName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
  if (error) throw error;
}

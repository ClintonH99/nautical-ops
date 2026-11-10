import { useEffect, useState } from 'react';
import { offlineDocuments } from '../offline/documentService';
import { offlineNotes } from '../offline/notesService';
import { useAuthStore } from '../store';

/** Never render a previous account or vessel's cached image while a lookup resolves. */
export function useOfflineImage(url: string | null): string | null {
  const userId = useAuthStore((s) => s.user?.id);
  const vesselId = useAuthStore((s) => s.user?.vesselId);
  const key = `${userId}:${vesselId}:${url}`;
  const [saved, setSaved] = useState<{ key: string; image: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    const load = async () => {
      const current = ++revision;
      if (!url || !offlineDocuments.enabled()) return;
      try {
        const image = await offlineDocuments.image(url);
        if (!cancelled && current === revision) setSaved({ key, image });
      } catch {
        if (!cancelled && current === revision) setSaved(null);
      }
    };
    void load();
    const unsubscribe = offlineNotes.subscribe(() => void load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [key, url]);
  return saved?.key === key ? saved.image : null;
}

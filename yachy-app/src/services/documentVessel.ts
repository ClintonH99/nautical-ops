import { offlineDocuments } from '../offline/documentService';
import { OfflineError } from '../offline/access';
import vesselService from './vessel';

/** Export labels use the verified device copy in the offline web build. */
export async function getDocumentVesselName(vesselId: string): Promise<string> {
  if (!offlineDocuments.enabled())
    return (await vesselService.getVessel(vesselId))?.name || 'Vessel';
  const context = await offlineDocuments.context();
  const vessel = context.vessel as { id?: string; name?: string } | undefined;
  if (vessel?.id !== vesselId) throw new OfflineError('SCOPE_CHANGED');
  if (typeof vessel.name !== 'string') throw new OfflineError('NOT_DOWNLOADED');
  return vessel.name;
}

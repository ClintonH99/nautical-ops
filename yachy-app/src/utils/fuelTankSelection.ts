import type { FuelTank, FuelTankBalance } from '../types';

export type FuelTransferTankSelectionMode = 'LEDGER' | 'REPORT_ONLY' | 'LEGACY_EDIT';

/**
 * Keep every currently eligible tank available during a correction while also
 * retaining historical source tanks that may since have been archived.
 */
export function mergeFuelCorrectionTanks(
  eligibleTanks: readonly FuelTank[],
  retainedTanks: readonly (FuelTank | null)[]
): FuelTank[] {
  const merged = [...eligibleTanks];
  const seen = new Set(eligibleTanks.map((tank) => tank.id));

  for (const tank of retainedTanks) {
    if (!tank || seen.has(tank.id)) continue;
    merged.push(tank);
    seen.add(tank.id);
  }

  return merged;
}

/**
 * Ledger transfers require an initialized balance. Report-only transfers made
 * before activation use configured tanks without inventing a zero quantity,
 * while a retained legacy edit also keeps its historical tank choices visible.
 */
export function getSelectableFuelTransferBalances(
  balances: readonly FuelTankBalance[],
  mode: FuelTransferTankSelectionMode
): FuelTankBalance[] {
  return balances.filter((balance) => mode !== 'LEDGER' || balance.isInitialized === true);
}

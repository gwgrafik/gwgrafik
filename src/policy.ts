import type { Position, Quote, Strategy } from './types.js';
import { fraction } from './money.js';
export const policy: Record<Strategy, { staleMs: number; stop: number; trail: number }> = {
  launch: {staleMs: 45_000, stop: .15, trail: .25}, breakout: {staleMs: 120_000, stop: .12, trail: .20},
  momentum: {staleMs: 180_000, stop: .15, trail: .25}, runner: {staleMs: 120_000, stop: .15, trail: .30},
  pullback: {staleMs: 180_000, stop: .12, trail: .25}, scalp: {staleMs: 30_000, stop: .06, trail: .10},
  migration: {staleMs: 90_000, stop: .15, trail: .30},
};
export type Exit = { reason: string; fraction?: number; recoverUsd?: bigint; tier?: number };
export function exitDecision(p: Position, fullExit: Quote, now: number, recoverMultiple = 3, weakFlow = false): Exit | null {
  const net = BigInt(fullExit.outUsd) - BigInt(fullExit.networkFeeUsd);
  const original = BigInt(p.spentUsd) + BigInt(p.entryFeeUsd);
  const current = BigInt(p.atoms);
  if (current <= 0n || original <= 0n) return null;
  // Trigger uses executable gross value of the original token count; recovery amount separately covers all costs.
  const equivalentOriginal = BigInt(fullExit.outUsd) * BigInt(p.originalAtoms) / current;
  const multiple = Number(equivalentOriginal) / Number(BigInt(p.spentUsd));
  const cfg = policy[p.strategy];
  const peak = BigInt(p.peakValueUsd);
  if (net <= BigInt(p.basisRemainingUsd) * BigInt(Math.round((1-cfg.stop)*10000))/10000n)
    return {reason:'executable_stop_loss',fraction:1};
  if (weakFlow && now - p.openedAt > 5000) return {reason:'demand_collapse',fraction:1};
  // Threshold realization is independent of trailing; no mark is set until a confirmed fill.
  if (!p.recovered && multiple >= recoverMultiple)
    return {reason:'recover_capital',recoverUsd: original - BigInt(p.proceedsUsd)};
  for (const tier of [5,10,20])
    if (multiple >= tier && !p.tiers.includes(tier)) return {reason:'profit_ladder',fraction:.20,tier};
  if (peak > 0n && net < peak * BigInt(Math.round((1-cfg.trail)*10000))/10000n)
    return {reason:'trailing',fraction:1};
  if (now - p.lastPeakAt > cfg.staleMs && multiple < 1.1) return {reason:'stagnation',fraction:1};
  return null;
}
// Quote search accounts for nonlinear pool pricing and each partial sell's fee.
export async function recoverySize(balance: bigint, targetNetUsd: bigint, quote: (atoms: bigint) => Promise<Quote>): Promise<{atoms: bigint; quote: Quote}> {
  if (balance <= 0n || targetNetUsd <= 0n) throw new Error('Invalid recovery request');
  let hi = balance, lo = 1n, best = await quote(balance);
  if (BigInt(best.outUsd)-BigInt(best.networkFeeUsd) < targetNetUsd) throw new Error('Recovery not executable');
  // Stop after 16 quotes; hi always retains a quote sufficient to cover the target.
  for (let i=0;i<16 && lo<hi;i++) {
    const mid=(lo+hi)/2n, q=await quote(mid);
    if (BigInt(q.outUsd)-BigInt(q.networkFeeUsd) >= targetNetUsd) {hi=mid;best=q;} else lo=mid+1n;
  }
  return {atoms:hi,quote:best};
}
export function applySale(p: Position, sold: bigint, netUsd: bigint, reason: string, tier?: number) {
  if (sold <= 0n || sold > BigInt(p.atoms)) throw new Error('Oversell');
  const before=BigInt(p.atoms), basis=fraction(BigInt(p.basisRemainingUsd),sold,before);
  p.atoms=(before-sold).toString(); p.proceedsUsd=(BigInt(p.proceedsUsd)+netUsd).toString();
  p.realizedUsd=(BigInt(p.realizedUsd)+netUsd-basis).toString();
  p.basisRemainingUsd=(BigInt(p.basisRemainingUsd)-basis).toString();
  p.recovered=BigInt(p.proceedsUsd)>=BigInt(p.spentUsd)+BigInt(p.entryFeeUsd);
  if (tier && !p.tiers.includes(tier)) p.tiers.push(tier);
  // Scale the peak when quantity changes, avoiding a false trailing trigger after partial realization.
  p.peakValueUsd=fraction(BigInt(p.peakValueUsd),before-sold,before).toString();
  if (p.atoms==='0') p.status='closed';
}

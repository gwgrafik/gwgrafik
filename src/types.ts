export const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const SOL = 'So11111111111111111111111111111111111111112';
export type Strategy = 'launch' | 'breakout' | 'momentum' | 'runner' | 'pullback' | 'scalp' | 'migration';
export type Mode = 'observe' | 'paper' | 'live';
export type Position = {
  id: string; mint: string; strategy: Strategy; openedAt: number;
  originalAtoms: string; atoms: string; spentUsd: string; entryFeeUsd: string;
  proceedsUsd: string; realizedUsd: string; basisRemainingUsd: string;
  recovered: boolean; tiers: number[]; peakValueUsd: string;
  lastPeakAt: number; status: 'open' | 'closed' | 'reconciliation_required';
};
export type Market = {
  mint: string; symbol: string; source: string; receivedAt: number; eventAt?: number;
  priceUsd: number; liquidityUsd: number; buys: number; sells: number;
  volumeUsd: number; change5m: number; createdAt?: number; trending: boolean;
};
export type Flow = { mint: string; at: number; signature: string; wallet: string; side: 'buy' | 'sell'; atoms: string };
export type Quote = {
  adapter: string; inputMint: string; outputMint: string; inAtoms: string;
  outAtoms: string; minOutAtoms: string; networkFeeUsd: string;
  outUsd: string; expectedOutUsd?: string; priceImpactPct: number; at: number; contextSlot?: number;
  raw?: unknown;
};
export type Intent = {
  id: string; mint: string; positionId?: string; side: 'buy' | 'sell';
  strategy: Strategy; reason: string; tier?: number; createdAt: number;
  quote: Quote; state: 'reserved' | 'signed' | 'submitted' | 'unknown' | 'confirmed' | 'failed';
  signature?: string; signedBase64?: string; lastValidBlockHeight?: number;
};
export type Fill = {
  signature: string; inAtoms: string; outAtoms: string;
  inputUsd: string; outputUsd: string; networkFeeUsd: string;
  confirmedAt: number; slot?: number; simulated: boolean;
};
export interface Executor {
  quote(input: string, output: string, amount: bigint): Promise<Quote>;
  prepare(quote: Quote): Promise<{ signature: string; signedBase64: string; lastValidBlockHeight: number }>;
  broadcast(intent: Intent): Promise<void>;
  reconcile(intent: Intent): Promise<{ status: 'confirmed'; fill: Fill } | { status: 'pending' } | { status: 'failed'; feeUsd?: string }>;
  balance(mint: string): Promise<bigint>;
  invalidateReads?():void;
}
export const json = (x: unknown) => JSON.stringify(x, (_, v) => typeof v === 'bigint' ? v.toString() : v);

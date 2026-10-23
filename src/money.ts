import { Decimal } from 'decimal.js';
Decimal.set({ precision: 50, rounding: Decimal.ROUND_DOWN });
export const usd = (n: Decimal.Value) => BigInt(new Decimal(n).mul(1_000_000).floor().toFixed(0));
export const dollars = (n: string | bigint) => new Decimal(n.toString()).div(1_000_000).toNumber();
export const valueUsd = (atoms: bigint, decimals: number, price: number) =>
  usd(new Decimal(atoms.toString()).div(new Decimal(10).pow(decimals)).mul(price));
export const atomsForUsd = (micro: bigint, decimals: number, price: number) => {
  if (!(price > 0)) throw new Error('Missing fresh USD conversion');
  return BigInt(new Decimal(micro.toString()).div(1_000_000).div(price).mul(new Decimal(10).pow(decimals)).floor().toFixed(0));
};
export const fraction = (atoms: bigint, numerator: bigint, denominator: bigint) => atoms * numerator / denominator;
export const min = (a: bigint, b: bigint) => a < b ? a : b;

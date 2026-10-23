import type { Quote } from './types.js';
/** Expected round-trip pricing already includes DEX fees/impact; slippage floors are execution guards. */
export function entryEconomics(inputUsd:bigint,entry:Quote,exit:Quote,maxCostPct:number){
  if(inputUsd<=0n||exit.inputMint!==entry.outputMint||exit.outputMint!==entry.inputMint||exit.inAtoms!==entry.outAtoms)
    throw new Error('entry_economics_quote_mismatch');
  if(exit.expectedOutUsd===undefined)throw new Error('expected_exit_quote_value_missing');
  const expectedReturn=BigInt(exit.expectedOutUsd);
  const fees=BigInt(entry.networkFeeUsd)+BigInt(exit.networkFeeUsd);
  const loss=inputUsd-expectedReturn+fees;
  return {inputUsd:inputUsd.toString(),expectedReturnUsd:expectedReturn.toString(),
    estimatedNetworkAndRentUsd:fees.toString(),expectedLossUsd:loss.toString(),
    maxCostPct,entryMinOutAtoms:entry.minOutAtoms,exitMinOutAtoms:exit.minOutAtoms,
    acceptable:loss*10000n<=inputUsd*BigInt(Math.round(maxCostPct*100))};
}

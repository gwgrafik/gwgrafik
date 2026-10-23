import { getJson } from './http.js';
import { RequestGate } from './request-gate.js';
import { SOL,USDC } from './types.js';
export type ApiInstruction={programId:string;accounts:{pubkey:string;isSigner:boolean;isWritable:boolean}[];data:string};
export type BuildResponse={inputMint:string;outputMint:string;inAmount:string;outAmount:string;otherAmountThreshold:string;
  slippageBps:number;priceImpactPct:string;routePlan:unknown[];computeBudgetInstructions:ApiInstruction[];setupInstructions:ApiInstruction[];
  swapInstruction:ApiInstruction;cleanupInstruction:ApiInstruction|null;otherInstructions:ApiInstruction[];tipInstruction:ApiInstruction|null;
  addressesByLookupTableAddress:Record<string,string[]>|null;blockhashWithMetadata:{blockhash:number[];lastValidBlockHeight:number};transactionVersion:number;contextSlot?:number};
export class JupiterV2 {
  readonly effectiveRps:number;
  private gate:RequestGate;
  constructor(readonly base:string,readonly apiKey:string,readonly rps=.5){
    if(!Number.isFinite(rps)||rps<=0)throw new Error('Invalid Jupiter rate');
    this.effectiveRps=apiKey?rps:Math.min(.5,rps);
    this.gate=new RequestGate(1000/this.effectiveRps);
  }
  async build(input:string,output:string,amount:string,user:string,slippageBps:number):Promise<BuildResponse>{
    const params=new URLSearchParams({inputMint:input,outputMint:output,amount,taker:user,slippageBps:String(slippageBps)});
    const exit=output===SOL||output===USDC;
    const raw=await this.gate.run(()=>getJson<BuildResponse>(`${this.base}/build?${params}`,{headers:this.apiKey?{'x-api-key':this.apiKey}:{}}),exit);
    if(raw.inputMint!==input||raw.outputMint!==output||raw.inAmount!==amount||!raw.routePlan?.length||BigInt(raw.outAmount)<=0n)
      throw new Error('Jupiter V2 response does not match intent');
    if(raw.transactionVersion!==0)throw new Error('transaction_version_not_supported');
    if(raw.slippageBps>slippageBps)throw new Error('unexpected_slippage');
    return raw;
  }
}

import { getJson } from './http.js';
export type ApiInstruction={programId:string;accounts:{pubkey:string;isSigner:boolean;isWritable:boolean}[];data:string};
export type BuildResponse={inputMint:string;outputMint:string;inAmount:string;outAmount:string;otherAmountThreshold:string;
  slippageBps:number;priceImpactPct:string;routePlan:unknown[];computeBudgetInstructions:ApiInstruction[];setupInstructions:ApiInstruction[];
  swapInstruction:ApiInstruction;cleanupInstruction:ApiInstruction|null;otherInstructions:ApiInstruction[];tipInstruction:ApiInstruction|null;
  addressesByLookupTableAddress:Record<string,string[]>|null;blockhashWithMetadata:{blockhash:number[];lastValidBlockHeight:number};transactionVersion:number;contextSlot?:number};
export class JupiterV2 {
  private nextAt=0;
  constructor(readonly base:string,readonly apiKey:string,readonly rps=.5){}
  async build(input:string,output:string,amount:string,user:string,slippageBps:number):Promise<BuildResponse>{
    const wait=Math.max(0,this.nextAt-Date.now());
    if(wait>8000)throw new Error('jupiter_rate_limit_backpressure');
    this.nextAt=Math.max(this.nextAt,Date.now())+1000/this.rps;
    if(wait)await new Promise(r=>setTimeout(r,wait));
    const params=new URLSearchParams({inputMint:input,outputMint:output,amount,taker:user,slippageBps:String(slippageBps)});
    const raw=await getJson<BuildResponse>(`${this.base}/build?${params}`,{headers:this.apiKey?{'x-api-key':this.apiKey}:{}});
    if(raw.inputMint!==input||raw.outputMint!==output||raw.inAmount!==amount||!raw.routePlan?.length||BigInt(raw.outAmount)<=0n)
      throw new Error('Jupiter V2 response does not match intent');
    if(raw.transactionVersion!==0)throw new Error('transaction_version_not_supported');
    if(raw.slippageBps>slippageBps)throw new Error('unexpected_slippage');
    return raw;
  }
}

import { USDC, SOL } from './types.js';
import { getJson } from './http.js';
export type DexPair={chainId:string;dexId:string;pairAddress:string;baseToken:{address:string;symbol:string};quoteToken:{address:string};priceUsd?:string;liquidity?:{usd:number};volume?:{m5:number};txns?:{m5:{buys:number;sells:number}};priceChange?:{m5:number};pairCreatedAt?:number};
export class Prices {
  values=new Map<string,{price:number;at:number}>();
  update(mint:string,price:number,at=Date.now()){if(Number.isFinite(price)&&price>0)this.values.set(mint,{price,at});}
  get(mint:string){const p=this.values.get(mint);if(!p||Date.now()-p.at>45_000)throw new Error(`Missing fresh USD price: ${mint}`);return p.price;}
  async refresh(){
    for(const mint of [SOL,USDC]) {
      const pairs=await getJson<DexPair[]>(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`);
      const pair=pairs.filter(p=>p.baseToken.address===mint&&Number(p.priceUsd)>0).sort((a,b)=>(b.liquidity?.usd??0)-(a.liquidity?.usd??0))[0];
      if(!pair)throw new Error('No fresh quote-currency price');this.update(mint,Number(pair.priceUsd));
    }
  }
}

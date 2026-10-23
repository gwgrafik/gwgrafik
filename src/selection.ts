import type { Flow, Market, Strategy } from './types.js';
export type Evaluation={decision:'BUY'|'WATCH'|'REJECT';strategy?:Strategy;score:number;reasons:string[]};
export function evaluate(m:Market,history:Market[],flows:Flow[],now=Date.now()):Evaluation{
  const reject=(reason:string):Evaluation=>({decision:'REJECT',score:0,reasons:[reason]});
  if(now-m.receivedAt>20_000)return reject('stale_market');
  if(!(m.priceUsd>0)||!(m.liquidityUsd>0))return reject('missing_price_or_liquidity');
  const h=history.filter(x=>x.receivedAt>=now-180_000 && x.receivedAt<=now).sort((a,b)=>a.receivedAt-b.receivedAt);
  if(h.length<3 || now-h[0]!.receivedAt<20_000)return {decision:'WATCH',score:0,reasons:['collecting_chronological_window']};
  const start=h[0]!,prev=h.at(-2)!,peak=Math.max(...h.slice(0,-1).map(x=>x.priceUsd));
  const growth=m.priceUsd/start.priceUsd-1,last=m.priceUsd/prev.priceUsd-1;
  const total=m.buys+m.sells,ratio=total?m.buys/total:0;
  const recent=flows.filter(f=>f.at>now-60_000&&f.at<=now),unique=new Set(recent.filter(f=>f.side==='buy').map(f=>f.wallet)).size;
  const volumeGrowth=start.volumeUsd>0?m.volumeUsd/start.volumeUsd:0;
  const score=Math.max(0,Math.min(100,30*Math.min(growth/.1,1)+25*ratio+15*Math.min(volumeGrowth/2,1)+15*Math.min(unique/5,1)+15*Math.min(m.liquidityUsd/25000,1)));
  if(last<-.08)return reject('active_dump');
  const candidates:Strategy[]=[];
  const fresh=m.createdAt!==undefined && now-m.createdAt<120_000;
  // Wallet counts are on-chain observed participants, not claimed identities; sybil resistance is not guaranteed.
  if(fresh&&unique>=3&&growth>.03&&ratio>.60&&last>0)candidates.push('launch');
  if(growth>.06&&last>0&&m.priceUsd>=peak&&volumeGrowth>1.1&&ratio>.6)candidates.push('breakout');
  if(growth>.04&&last>0&&ratio>.6&&score>=60)candidates.push('momentum');
  if(m.trending&&growth>.03&&last>0&&ratio>.6)candidates.push('runner');
  if(peak>start.priceUsd*1.08&&prev.priceUsd<peak*.97&&m.priceUsd>prev.priceUsd*1.02&&ratio>.6)candidates.push('pullback');
  // Migration and wallet following require explicit confirmed chain events, not an inferred pool age.
  if(!candidates.length)return {decision:'WATCH',score,reasons:['no_confirmed_strategy_setup',`observed_buyers:${unique}`]};
  return {decision:'BUY',strategy:candidates[0],score,reasons:[`growth:${growth.toFixed(4)}`,`buy_ratio:${ratio.toFixed(3)}`,`observed_buyers:${unique}`]};
}

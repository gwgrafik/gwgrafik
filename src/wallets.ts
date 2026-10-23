import type { Flow } from './types.js';
import type { Store } from './store.js';
type Lot={atoms:string;costUsd:string;firstSeen:number;unknownInventory:boolean;realizedUsd?:string};
type Wallet={address:string;realizedUsd:string;wins:number;losses:number;trades:number;firstSeen:number;lots:Record<string,Lot>};
export class WalletWatch {
  wallets:Record<string,Wallet>;
  private savedAt=0;
  constructor(readonly store:Store){this.wallets=store.get('observed_wallets')??{};}
  trade(flow:Flow,quoteUsd:bigint,feeUsd:bigint){
    if(!this.wallets[flow.wallet]&&Object.keys(this.wallets).length>=2000)return;
    const w=this.wallets[flow.wallet]??={address:flow.wallet,realizedUsd:'0',wins:0,losses:0,trades:0,firstSeen:flow.at,lots:{}};
    if(!w.lots[flow.mint]&&Object.keys(w.lots).length>=100)return;
    const lot=w.lots[flow.mint]??={atoms:'0',costUsd:'0',firstSeen:flow.at,unknownInventory:false};
    const atoms=BigInt(flow.atoms);
    if(flow.side==='buy'){
      lot.atoms=(BigInt(lot.atoms)+atoms).toString();lot.costUsd=(BigInt(lot.costUsd)+quoteUsd+feeUsd).toString();
    }else if(atoms>BigInt(lot.atoms)||BigInt(lot.atoms)===0n){
      lot.unknownInventory=true; // Exclude founder allocations/transfers/entries from before observation.
    }else{
      const basis=BigInt(lot.costUsd)*atoms/BigInt(lot.atoms),pnl=quoteUsd-feeUsd-basis;
      lot.costUsd=(BigInt(lot.costUsd)-basis).toString();lot.atoms=(BigInt(lot.atoms)-atoms).toString();
      if(!lot.unknownInventory){w.realizedUsd=(BigInt(w.realizedUsd)+pnl).toString();lot.realizedUsd=(BigInt(lot.realizedUsd??'0')+pnl).toString();w.trades++;if(pnl>0n)w.wins++;else w.losses++;}
    }
    // This is an observation-only leaderboard, not a verified all-history wallet PnL.
    if(Date.now()-this.savedAt>5000){this.flush();}
    if(flow.side==='buy')this.store.event('wallet_entry_candidate',{wallet:w.address,mint:flow.mint,signature:flow.signature,
      observedRealizedUsd:w.realizedUsd,historyVerified:false,liveCopyEligible:false},flow.mint);
  }
  flush(){this.store.set('observed_wallets',this.wallets);this.savedAt=Date.now();}
  leaderForMint(mint:string){return Object.values(this.wallets).filter(w=>!w.lots[mint]?.unknownInventory&&BigInt(w.lots[mint]?.realizedUsd??'0')>0n)
    .sort((a,b)=>Number(BigInt(b.lots[mint]!.realizedUsd!)-BigInt(a.lots[mint]!.realizedUsd!)))[0]?.address;}
  leaders(){return Object.values(this.wallets).filter(w=>w.trades>0).sort((a,b)=>Number(BigInt(b.realizedUsd)-BigInt(a.realizedUsd))).slice(0,20)
    .map(w=>({address:w.address,observedRealizedUsd:w.realizedUsd,wins:w.wins,losses:w.losses,closedSales:w.trades,observedSince:w.firstSeen,
      historyVerified:false,liveCopyEligible:false,note:'Partial stream history; network fees, transfers and related-wallet links not fully audited'}));}
}

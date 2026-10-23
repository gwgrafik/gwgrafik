import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import { Store } from './store.js';
import { ChainExecutor } from './execution.js';
import type { Market,Flow,Intent,Quote,Strategy,Position,Executor,Fill } from './types.js';
import { SOL,USDC } from './types.js';
import { Prices } from './prices.js';
import { evaluate } from './selection.js';
import { exitDecision,recoverySize } from './policy.js';
import { usd,atomsForUsd,valueUsd,min } from './money.js';
import { errorText } from './http.js';
export class Engine {
  history=new Map<string,Market[]>();flows=new Map<string,Flow[]>();
  busy=new Set<string>();readonly owner=randomUUID();
  halted=false;
  constructor(readonly cfg:Config,readonly store:Store,readonly executor:Executor,readonly prices:Prices){
    store.acquireLease(this.owner);
    if(store.get('mode')!==undefined&&store.get('mode')!==cfg.MODE)throw new Error('Use a separate DATA_DIR for each mode');
    store.set('mode',cfg.MODE);
    if(store.get('paper_cash')===undefined)store.set('paper_cash',usd(cfg.PAPER_CASH_USD).toString());
  }
  flow(f:Flow){const list=(this.flows.get(f.mint)??[]).filter(x=>x.at>Date.now()-60000);if(!list.some(x=>x.signature===f.signature&&x.wallet===f.wallet&&x.side===f.side))list.push(f);this.flows.set(f.mint,list);}
  async market(m:Market){
    this.prices.update(m.mint,m.priceUsd,m.receivedAt);this.store.market(m);
    const historyKey=m.mint+':'+m.source;
    const h=(this.history.get(historyKey)??[]).filter(x=>x.receivedAt>Date.now()-180000);h.push(m);this.history.set(historyKey,h.slice(-500));
    const decision=evaluate(m,h,this.flows.get(m.mint)??[]);
    this.store.event('decision',decision,m.mint);
    if(decision.decision!=='BUY'||!decision.strategy||this.cfg.MODE==='observe'||this.busy.has(m.mint)||this.halted)return;
    if(this.store.positions().some(p=>p.mint===m.mint)||this.store.pending().some(i=>i.mint===m.mint))return;
    // Bound concurrent network work without making discovery wait for a position's lifetime.
    if(this.busy.size>=3){this.store.event('reject',{reason:'execution_backpressure'},m.mint);return;}
    this.busy.add(m.mint);
    try{await this.buy(m.mint,decision.strategy);}catch(e){this.store.event('reject',{reason:errorText(e)},m.mint);}finally{this.busy.delete(m.mint);}
  }
  async cashUsd(){
    if(this.cfg.MODE==='paper')return BigInt(this.store.get<string>('paper_cash')!);
    const u=await this.executor.balance(USDC),s=await this.executor.balance(SOL);
    const reserve=BigInt(Math.ceil(this.cfg.MIN_SOL_RESERVE*1e9));
    return valueUsd(u,6,this.prices.get(USDC))+valueUsd(s>reserve?s-reserve:0n,9,this.prices.get(SOL));
  }
  private async buy(mint:string,strategy:Strategy){
    const start=Date.now();
    const realized=this.store.positions(false).reduce((s,p)=>s+BigInt(p.realizedUsd),0n)-this.store.charges();
    if(realized < -usd(this.cfg.MAX_DAILY_LOSS_USD))throw new Error('daily_loss_limit');
    const input=this.cfg.ENABLE_PUMP_CURVE==='true'?SOL:USDC,decimals=input===SOL?9:6;
    const amount=atomsForUsd(usd(this.cfg.POSITION_USD),decimals,this.prices.get(input));
    if(this.cfg.MODE==='live'){
      if(await this.executor.balance(input)<amount)throw new Error('input_balance_insufficient');
      if(await this.executor.balance(SOL)<BigInt(Math.ceil(this.cfg.MIN_SOL_RESERVE*1e9)))throw new Error('sell_fee_reserve');
      // Funding is bounded by exposure and the dedicated wallet, not cumulatively counting recycled proceeds.
      if(this.cfg.MAX_CAPITAL_USD>this.cfg.LIVE_FUNDING_CAP_USD)throw new Error('capital_limit_exceeds_explicit_funding_cap');
    }
    const q=await this.executor.quote(input,mint,amount);
    if(q.priceImpactPct>this.cfg.MAX_PRICE_IMPACT_PCT)throw new Error('price_impact_limit');
    const exit=await this.executor.quote(mint,input,BigInt(q.minOutAtoms));
    const inputCost=usd(this.cfg.POSITION_USD),roundTripLoss=inputCost-BigInt(exit.outUsd)+BigInt(q.networkFeeUsd)+BigInt(exit.networkFeeUsd);
    if(roundTripLoss*10000n>inputCost*BigInt(Math.round(this.cfg.MAX_TRADE_COST_PCT*100)))throw new Error('two_dollar_trade_uneconomic_after_costs');
    const i:Intent={id:randomUUID(),mint,side:'buy',strategy,reason:'entry_signal',createdAt:Date.now(),quote:q,state:'reserved'};
    this.store.assertLease(this.owner);
    this.store.reserve(i,{maxPositions:this.cfg.MAX_POSITIONS,maxCapital:usd(this.cfg.MAX_CAPITAL_USD),cash:await this.cashUsd(),entryCost:inputCost+BigInt(q.networkFeeUsd)});
    this.store.event('signal_to_prepare',{signalAt:start,prepareAt:Date.now()},mint);
    await this.execute(i);
  }
  private async execute(i:Intent){
    this.store.assertLease(this.owner);
    if(this.cfg.MODE==='paper'){
      const raw=i.quote.raw as {inputUsd:string};
      const f:Fill={signature:'paper:'+i.id,inAtoms:i.quote.inAtoms,outAtoms:i.quote.minOutAtoms,inputUsd:raw.inputUsd,
        outputUsd:i.quote.outUsd,networkFeeUsd:i.quote.networkFeeUsd,confirmedAt:Date.now(),simulated:true};
      this.store.commitFill(i,f);
      return;
    }
    try{
      Object.assign(i,await this.executor.prepare(i.quote));i.state='signed';this.store.saveIntent(i);
      this.store.assertLease(this.owner);await this.executor.broadcast(i);i.state='submitted';this.store.saveIntent(i);
      this.store.event('submitted',{signature:i.signature,at:Date.now()},i.mint);
    }catch(e){
      i.state=i.signature?'unknown':'failed';this.store.saveIntent(i);this.store.event('execution_error',{reason:errorText(e),signature:i.signature},i.mint);
    }
  }
  async reconcile(){
    this.store.acquireLease(this.owner);
    for(const i of this.store.pending()){
      if(this.cfg.MODE!=='live')continue;
      try{
        if(i.state==='reserved'&&!i.signature){i.state='failed';this.store.saveIntent(i);continue;}
        const r=await this.executor.reconcile(i);
        this.store.assertLease(this.owner);
        if(r.status==='confirmed')this.store.commitFill(i,r.fill);
        else if(r.status==='failed'){
          this.store.transaction(()=>{if(i.signature&&r.feeUsd)this.store.charge(i.signature,r.feeUsd);i.state='failed';this.store.saveIntent(i);});
          this.store.event('failed_transaction',{signature:i.signature,networkFeeUsd:r.feeUsd??'0'},i.mint);
          // Positions remain active. Exit manager will retry from reconciled quantities, never abandon holdings.
        }else{
          i.state='unknown';this.store.saveIntent(i);
          if(i.signedBase64 && Date.now()-i.createdAt<60000)await this.executor.broadcast(i); // Same bytes/signature only.
          if(Date.now()-i.createdAt>60000)this.store.event('critical',{reason:'unresolved_transaction',signature:i.signature},i.mint);
        }
      }catch(e){this.store.event('critical',{reason:errorText(e),signature:i.signature},i.mint);}
    }
  }
  async manage(p:Position){
    if(this.busy.has(p.mint)||this.store.pending().some(i=>i.mint===p.mint))return;
    this.busy.add(p.mint);
    try{
      if(this.cfg.MODE==='live'){
        const balance=await this.executor.balance(p.mint);
        if(balance!==BigInt(p.atoms)){p.status='reconciliation_required';this.store.savePosition(p);throw new Error('wallet_quantity_mismatch_requires_reconciliation');}
      }
      if(p.status==='reconciliation_required')return;
      const quoteSell=async(n:bigint)=>{
        try{return await this.executor.quote(p.mint,USDC,n);}catch{return this.executor.quote(p.mint,SOL,n);}
      };
      const q=await quoteSell(BigInt(p.atoms)),net=BigInt(q.outUsd)-BigInt(q.networkFeeUsd),now=Date.now();
      const flow=(this.flows.get(p.mint)??[]).filter(f=>f.at>now-20000),sells=flow.filter(f=>f.side==='sell').length;
      const choice=exitDecision(p,q,now,this.cfg.RECOVER_MULTIPLE,flow.length>=5&&sells/flow.length>.8);
      if(net>BigInt(p.peakValueUsd)){p.peakValueUsd=net.toString();p.lastPeakAt=now;}
      this.store.savePosition(p);this.store.set('mark:'+p.id,{netUsd:net.toString(),at:q.at,estimated:true});
      this.store.event('mark',{positionId:p.id,netLiquidationUsd:net.toString(),quoteAt:q.at,estimated:true},p.mint);
      if(!choice)return;
      let sell=q;
      if(choice.recoverUsd!==undefined){
        const result=await recoverySize(BigInt(p.atoms),choice.recoverUsd,quoteSell);sell=result.quote;
        // Binary-search quote may age while routing. Requote the sufficient bound before signing.
        sell=await quoteSell(result.atoms);
        if(BigInt(sell.outUsd)-BigInt(sell.networkFeeUsd)<choice.recoverUsd)throw new Error('recovery_quote_moved_retry_next_tick');
      }else if(choice.fraction!==1){
        const n=BigInt(p.atoms)*BigInt(Math.round((choice.fraction??1)*10000))/10000n;
        if(n===0n)return;sell=await quoteSell(n);
      }
      const i:Intent={id:randomUUID(),mint:p.mint,positionId:p.id,side:'sell',strategy:p.strategy,reason:choice.reason,tier:choice.tier,createdAt:now,quote:sell,state:'reserved'};
      this.store.assertLease(this.owner);
      this.store.reserve(i,{maxPositions:this.cfg.MAX_POSITIONS,maxCapital:usd(this.cfg.MAX_CAPITAL_USD),cash:0n,entryCost:0n});
      await this.execute(i);
    }catch(e){this.store.set('mark:'+p.id,{netUsd:null,at:Date.now(),estimated:true});this.store.event('critical',{positionId:p.id,reason:errorText(e),liquidationValueUsd:null},p.mint);}
    finally{this.busy.delete(p.mint);}
  }
}

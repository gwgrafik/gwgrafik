import { Connection, PublicKey } from '@solana/web3.js';
import { PUMP_PROGRAM_ID,PUMP_AMM_PROGRAM_ID,PUMP_SDK,pumpIdl } from '@pump-fun/pump-sdk';
import { unpackMint } from '@solana/spl-token';
import { EventEmitter } from 'node:events';
import { getJson,errorText } from './http.js';
import { Prices,type DexPair } from './prices.js';
import type { Market,Flow } from './types.js';
import { SOL,USDC } from './types.js';
import { subscribeLogs } from './stream.js';
type Profile={chainId:string;tokenAddress:string};
type Pools={data:{attributes:{base_token_price_usd:string;reserve_in_usd:string};relationships:{base_token:{data:{id:string}}}}[]};
export class Sources extends EventEmitter {
  candidates=new Map<string,{source:string;at:number;trending:boolean}>();
  private flow=new Map<string,Flow[]>();
  private decimals=new Map<string,number>();
  private metadataQueue=new Set<string>();
  private watchedWallets=new Set<string>();
  private created=new Map<string,{at:number;symbol:string}>();
  private tradeValues=new Map<string,{at:number;usd:number}[]>();
  private seen=new Set<string>();
  private timers:NodeJS.Timeout[]=[];
  private subscriptions:number[]=[];
  private wsStops:(()=>void)[]=[];
  private running=new Set<string>();
  private stopFlag=false;
  constructor(readonly rpc:Connection,readonly prices:Prices,readonly wsUrl=rpc.rpcEndpoint.replace(/^http/,'ws')){super();}
  add(mint:string,source:string,trending=false){
    try{new PublicKey(mint);}catch{return;}
    if(mint===SOL||mint===USDC)return;
    const prior=this.candidates.get(mint);
    this.candidates.set(mint,{source:prior?.source??source,at:Date.now(),trending:trending||prior?.trending||false});
    if(this.candidates.size>300) {
      const oldest=[...this.candidates].sort((a,b)=>a[1].at-b[1].at)[0];if(oldest)this.candidates.delete(oldest[0]);
    }
    this.emit('discovery',{mint,source,receivedAt:Date.now()});
  }
  schedule(name:string,ms:number,work:()=>Promise<void>){
    const tick=async()=>{
      if(this.running.has(name)||this.stopFlag)return;this.running.add(name);
      try{await work();this.emit('health',{source:name,ok:true,at:Date.now()});}
      catch(e){this.emit('health',{source:name,ok:false,at:Date.now(),error:errorText(e)});}
      finally{this.running.delete(name);}
    };
    void tick();this.timers.push(setInterval(()=>void tick(),ms));
  }
  async start(){
    this.schedule('mint-metadata',2000,async()=>{
      const batch=[...this.metadataQueue].slice(0,100);if(!batch.length)return;
      const accounts=await this.rpc.getMultipleAccountsInfo(batch.map(k=>new PublicKey(k)),'confirmed');
      for(let i=0;i<batch.length;i++){
        const key=batch[i]!,account=accounts[i];this.metadataQueue.delete(key);
        if(account)try{this.decimals.set(key,unpackMint(new PublicKey(key),account,account.owner).decimals);}catch{}
      }
    });
    this.schedule('dex-profiles',30_000,async()=>{
      for(const path of ['token-profiles/latest/v1','token-boosts/top/v1']){
        const profiles=await getJson<Profile[]>(`https://api.dexscreener.com/${path}`);
        for(const p of profiles)if(p.chainId==='solana')this.add(p.tokenAddress,path,path.includes('boost'));
      }
    });
    for(const kind of ['new_pools','trending_pools'])this.schedule(`gecko-${kind}`,30_000,async()=>{
      const pools=await getJson<Pools>(`https://api.geckoterminal.com/api/v2/networks/solana/${kind}`);
      for(const p of pools.data)this.add(p.relationships.base_token.data.id.replace(/^solana_/,''),`gecko-${kind}`,kind==='trending_pools');
    });
    let cursor=0;
    this.schedule('dex-markets',10_000,async()=>{
      const mints=[...this.candidates.keys()];if(!mints.length)return;
      const batch=mints.slice(cursor,cursor+30);cursor=cursor+30>=mints.length?0:cursor+30;
      if(!batch.length)return;
      const pairs=await getJson<DexPair[]>(`https://api.dexscreener.com/tokens/v1/solana/${batch.join(',')}`);
      for(const mint of batch){
        const p=pairs.filter(p=>p.baseToken.address===mint).sort((a,b)=>(b.liquidity?.usd??0)-(a.liquidity?.usd??0))[0];
        if(!p)continue;
        const m:Market={mint,symbol:p.baseToken.symbol,source:`dex:${p.dexId}`,receivedAt:Date.now(),priceUsd:Number(p.priceUsd??0),
          liquidityUsd:p.liquidity?.usd??0,buys:p.txns?.m5.buys??0,sells:p.txns?.m5.sells??0,volumeUsd:p.volume?.m5??0,
          change5m:p.priceChange?.m5??0,createdAt:p.pairCreatedAt,trending:this.candidates.get(mint)?.trending??false};
        this.emit('market',m);
      }
    });
    const discriminators=new Map(pumpIdl.events.map(e=>[Buffer.from(e.discriminator).toString('hex'),e.name]));
    this.wsStops.push(subscribeLogs(this.wsUrl,PUMP_PROGRAM_ID.toBase58(),(message,context)=>{
      if(message.err)return;
      const stack:string[]=[];
      for(const line of message.logs){
        const invocation=/^Program (\w+) invoke/.exec(line);if(invocation){stack.push(invocation[1]!);continue;}
        if(/^Program \w+ (success|failed)/.test(line)){stack.pop();continue;}
        if(stack.at(-1)!==PUMP_PROGRAM_ID.toBase58()||!line.startsWith('Program data: '))continue;
        const data=Buffer.from(line.slice(14),'base64'),kind=discriminators.get(data.subarray(0,8).toString('hex'));
        if(kind==='CreateEvent'){
          try{const e=PUMP_SDK.decodeCreateEventBc(data.subarray(8));this.created.set(e.mint.toBase58(),{at:Number(e.timestamp.toString())*1000,symbol:e.symbol});this.add(e.mint.toBase58(),'pump-create');}catch{}
        }
        if(kind==='CompleteEvent'){
          try{const e=PUMP_SDK.decodeCompleteEventBc(data.subarray(8));this.emit('migration',{mint:e.mint.toBase58(),signature:message.signature,slot:context.slot,at:Date.now()});}catch{}
        }
        if(kind==='TradeEvent'){
          try{
            const e=PUMP_SDK.decodeTradeEventBc(data.subarray(8)),mint=e.mint.toBase58();
            const key=message.signature+':'+data.toString('base64');if(this.seen.has(key))continue;this.seen.add(key);
            if(this.seen.size>20000)this.seen.delete(this.seen.values().next().value!);
            if(Date.now()-Number(e.timestamp.toString())*1000>20_000)continue;
            const f:Flow={mint,signature:message.signature,at:Number(e.timestamp.toString())*1000,wallet:e.user.toBase58(),side:e.isBuy?'buy':'sell',atoms:e.tokenAmount.toString()};
            const flows=(this.flow.get(mint)??[]).filter(x=>x.at>Date.now()-60_000);flows.push(f);this.flow.set(mint,flows);
            this.emit('flow',{...f,quoteMint:e.quoteMint.toBase58(),quoteAtoms:e.quoteAmount.toString(),feeAtoms:e.fee.add(e.creatorFee).add(e.quoteTransferFee).toString()});
            if(!this.candidates.has(mint))this.add(mint,'pump-trade');
            // Keep callback work bounded. SDK reserve pricing is completed outside the WS callback.
            if(this.running.size>12)continue;
            const task='curve:'+mint;if(this.running.has(task))continue;this.running.add(task);
            void (async()=>{
              try{
                if(!this.decimals.has(mint)){
                  if(this.metadataQueue.size<300)this.metadataQueue.add(mint);return;
                }
                const qm=e.quoteMint.equals(PublicKey.default)?SOL:e.quoteMint.toBase58();
                if(qm!==SOL&&qm!==USDC)return;
                const qp=this.prices.get(qm),qd=qm===SOL?9:6;
                const qr=e.virtualQuoteReserves.isZero()?e.virtualSolReserves:e.virtualQuoteReserves;
                const real=e.realQuoteReserves.isZero()?e.realSolReserves:e.realQuoteReserves;
                const tokenRes=Number(e.virtualTokenReserves.toString())/10**this.decimals.get(mint)!;
                if(tokenRes<=0)return;
                const values=(this.tradeValues.get(mint)??[]).filter(v=>v.at>Date.now()-60000);values.push({at:f.at,usd:Number(e.quoteAmount.toString())/10**qd*qp});this.tradeValues.set(mint,values);
                const m:Market={mint,symbol:this.created.get(mint)?.symbol??mint.slice(0,8),source:'pump-trade',receivedAt:Date.now(),eventAt:f.at,createdAt:this.created.get(mint)?.at,
                  priceUsd:Number(qr.toString())/10**qd*qp/tokenRes,liquidityUsd:Number(real.toString())/10**qd*qp,
                  buys:flows.filter(x=>x.side==='buy').length,sells:flows.filter(x=>x.side==='sell').length,
                  volumeUsd:values.reduce((s,v)=>s+v.usd,0),change5m:0,trending:false};
                this.emit('market',m);
              }catch(e){this.emit('health',{source:'curve-pricing',ok:false,error:errorText(e),at:Date.now()});}
              finally{this.running.delete(task);}
            })();
          }catch{}
        }
      }
      this.emit('health',{source:'pump-ws',ok:true,at:Date.now(),slot:context.slot});
    },h=>this.emit('health',h)));
    // onLogs uses SDK WebSocket reconnect/resubscribe; absence of recent events is reported separately.
  }
  watchWallet(address:string){
    if(this.watchedWallets.has(address)||this.watchedWallets.size>=3)return;
    new PublicKey(address);this.watchedWallets.add(address);
    this.wsStops.push(subscribeLogs(this.wsUrl,address,(logs,context)=>{
      if(logs.err||!logs.logs.some(l=>l.includes('Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 invoke')||l.includes('Program '+PUMP_PROGRAM_ID.toBase58()+' invoke')))return;
      if(this.running.has('wallet-transaction'))return;this.running.add('wallet-transaction');
      void (async()=>{
        try{
          const tx=await this.rpc.getParsedTransaction(logs.signature,{commitment:'confirmed',maxSupportedTransactionVersion:0});
          if(!tx?.meta||tx.meta.err)return;
          const pre=tx.meta.preTokenBalances??[],post=tx.meta.postTokenBalances??[];
          const amounts=(rows:typeof pre,mint:string)=>rows.filter(r=>r.owner===address&&r.mint===mint).reduce((s,r)=>s+BigInt(r.uiTokenAmount.amount),0n);
          const idx=tx.transaction.message.accountKeys.findIndex(k=>k.pubkey.toBase58()===address);
          const solDebit=idx>=0&&tx.meta.preBalances[idx]!>tx.meta.postBalances[idx]!;
          const usdcDebit=amounts(pre,USDC)>amounts(post,USDC);
          if(!solDebit&&!usdcDebit)return;
          for(const mint of new Set(post.filter(r=>r.owner===address).map(r=>r.mint))){
            if(mint===SOL||mint===USDC||amounts(post,mint)<=amounts(pre,mint))continue;
            this.add(mint,'winner-wallet');this.emit('wallet-follow',{mint,wallet:address,signature:logs.signature,receivedAt:Date.now(),slot:context.slot,historyVerified:false});
          }
        }catch(e){this.emit('health',{source:'wallet-follow',ok:false,at:Date.now(),error:errorText(e)});}
        finally{this.running.delete('wallet-transaction');}
      })();
    },h=>this.emit('health',{...(h as object),source:'wallet-follow'})));
  }
  async stop(){this.stopFlag=true;for(const t of this.timers)clearInterval(t);for(const stop of this.wsStops)stop();for(const id of this.subscriptions)await this.rpc.removeOnLogsListener(id);}
}

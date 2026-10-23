import { Connection } from '@solana/web3.js';
import { loadConfig } from './config.js';
import { Store } from './store.js';
import { Prices } from './prices.js';
import { ChainExecutor } from './execution.js';
import { Engine } from './engine.js';
import { Sources } from './sources.js';
import { WalletWatch } from './wallets.js';
import { dashboard } from './dashboard.js';
import { errorText } from './http.js';
import { valueUsd } from './money.js';
import { PublicKey } from '@solana/web3.js';
import { SOL,USDC,type Market,type Flow } from './types.js';
const cfg=loadConfig(),store=new Store(cfg.DATA_DIR),prices=new Prices();
const rpc=new Connection(cfg.RPC_URL,{commitment:'confirmed',wsEndpoint:cfg.RPC_WS_URL,disableRetryOnRateLimit:true});
const executor=new ChainExecutor(rpc,prices,cfg),engine=new Engine(cfg,store,executor,prices),sources=new Sources(rpc,prices,cfg.RPC_WS_URL),wallets=new WalletWatch(store);
const health:Record<string,unknown>={};
const server=dashboard(store,cfg,wallets);
const timers:NodeJS.Timeout[]=[];
const tasks=new Set<string>();let stopped=false;
function schedule(name:string,ms:number,fn:()=>Promise<void>){
  const run=async()=>{if(tasks.has(name)||stopped)return;tasks.add(name);try{await fn();}catch(e){store.event('critical',{task:name,reason:errorText(e)});}finally{tasks.delete(name);}};
  void run();timers.push(setInterval(()=>void run(),ms));
}
sources.on('health',(h:{source:string;ok:boolean;at:number})=>{health[h.source]=h;store.set('source_health',health);});
sources.on('discovery',d=>store.event('discovery',d,d.mint));
sources.on('migration',m=>{store.event('migration',m,m.mint);sources.add(m.mint,'migration');});
sources.on('market',(m:Market)=>{
  store.set('last_market_at',Date.now());
  if(m.trending||m.change5m>=50){const leader=wallets.leaderForMint(m.mint);if(leader)sources.watchWallet(leader);}
  void engine.market(m).catch(e=>store.event('error',{reason:errorText(e)},m.mint));
});
sources.on('wallet-follow',f=>store.event('wallet_follow_candidate',f,f.mint));
sources.on('flow',(f:Flow&{quoteMint:string;quoteAtoms:string;feeAtoms:string})=>{
  if(!store.first('flow:'+f.signature+':'+f.wallet+':'+f.mint+':'+f.side+':'+f.atoms))return;
  engine.flow(f);store.event('flow',f,f.mint);
  const quote=f.quoteMint===PublicKey.default.toBase58()?SOL:f.quoteMint;
  if(quote!==SOL&&quote!==USDC)return;
  try{wallets.trade(f,valueUsd(BigInt(f.quoteAtoms),quote===SOL?9:6,prices.get(quote)),valueUsd(BigInt(f.feeAtoms),quote===SOL?9:6,prices.get(quote)));}catch{}
});
schedule('lease',5000,async()=>store.acquireLease(engine.owner));
schedule('prices',15000,async()=>prices.refresh());
schedule('reconcile',5000,async()=>engine.reconcile());
schedule('positions',3000,async()=>{
  const open=store.positions();for(let i=0;i<open.length;i+=3)await Promise.all(open.slice(i,i+3).map(p=>engine.manage(p)));
});
schedule('readiness',5000,async()=>{
  const at=store.get<number>('last_market_at')??0;
  let fresh=false;try{prices.get(SOL);prices.get(USDC);fresh=true;}catch{}
  store.set('market_ready',fresh&&Date.now()-at<20000);
});
schedule('retention',300000,async()=>{store.retention();engine.pruneCaches();});
schedule('wallet-persistence',5000,async()=>wallets.flush());
await sources.start();
store.event('startup',{mode:cfg.MODE,version:'0.1.0',liveTrading:cfg.MODE==='live'});
console.log(JSON.stringify({event:'started',mode:cfg.MODE,port:cfg.PORT,marketReady:false}));
async function shutdown(){
  if(stopped)return;stopped=true;engine.halted=true;for(const t of timers)clearInterval(t);
  await sources.stop();server.close();
  // In-flight RPC calls have finite deadlines; keep SQLite open until they finish or process exits.
  const deadline=Date.now()+15000;while((tasks.size||engine.busy.size)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,100));
  wallets.flush();store.event('shutdown',{pending:store.pending().length});store.releaseLease(engine.owner);store.close();process.exit(0);
}
process.on('SIGTERM',()=>void shutdown());process.on('SIGINT',()=>void shutdown());
process.on('unhandledRejection',e=>{console.error(errorText(e));engine.halted=true;});

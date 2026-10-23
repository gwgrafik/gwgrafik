import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey, VersionedTransaction, TransactionMessage, ComputeBudgetProgram, TransactionInstruction } from '@solana/web3.js';
import { getMint, getAssociatedTokenAddressSync, getExtensionTypes, ExtensionType, unpackAccount, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { JupiterV2,type BuildResponse } from './jupiter.js';
import { OnlinePumpSdk,PUMP_SDK,getBuyTokenAmountFromSolAmount,getSellSolAmountFromTokenAmount } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import bs58 from 'bs58';
import { SOL,USDC,type Executor,type Intent,type Quote,type Fill } from './types.js';
import { Prices } from './prices.js';
import { valueUsd,usd } from './money.js';
import type { Config } from './config.js';
export class ChainExecutor implements Executor {
  readonly wallet:Keypair|undefined;
  readonly user:PublicKey;
  readonly jupiter:JupiterV2;
  readonly pump:OnlinePumpSdk;
  private mintCache=new Map<string,{decimals:number;program:PublicKey;at:number}>();
  constructor(readonly rpc:Connection,readonly prices:Prices,readonly cfg:Config){
    if(cfg.WALLET_KEYPAIR_PATH){
      const bytes=JSON.parse(readFileSync(cfg.WALLET_KEYPAIR_PATH,'utf8'));
      if(!Array.isArray(bytes)||bytes.length!==64||bytes.some((n:unknown)=>!Number.isInteger(n)||Number(n)<0||Number(n)>255))throw new Error('Invalid wallet file');
      this.wallet=Keypair.fromSecretKey(Uint8Array.from(bytes));
    }
    this.user=this.wallet?.publicKey??PublicKey.default;
    this.jupiter=new JupiterV2(cfg.JUPITER_BASE_URL,cfg.JUPITER_API_KEY,cfg.JUPITER_RPS);
    this.pump=new OnlinePumpSdk(rpc);
  }
  async mint(mint:string){
    if(mint===SOL)return {decimals:9,program:TOKEN_PROGRAM_ID,at:Date.now()};
    // Explicit quote currency: USDC is issuer-controlled and legitimately retains authorities.
    if(mint===USDC)return {decimals:6,program:TOKEN_PROGRAM_ID,at:Date.now()};
    const cached=this.mintCache.get(mint);if(cached&&Date.now()-cached.at<60000)return cached;
    const key=new PublicKey(mint),account=await this.rpc.getAccountInfo(key,'confirmed');
    if(!account||(!account.owner.equals(TOKEN_PROGRAM_ID)&&!account.owner.equals(TOKEN_2022_PROGRAM_ID)))throw new Error('Not a supported SPL mint');
    const m=await getMint(this.rpc,key,'confirmed',account.owner);
    if(m.freezeAuthority)throw new Error('freeze_authority_present');
    if(m.mintAuthority)throw new Error('mint_authority_present');
    const allowed=new Set([ExtensionType.MetadataPointer,ExtensionType.TokenMetadata]);
    if(getExtensionTypes(m.tlvData).some(e=>!allowed.has(e)))throw new Error('unsupported_token2022_extension');
    const result={decimals:m.decimals,program:account.owner,at:Date.now()};this.mintCache.set(mint,result);return result;
  }
  async balance(mint:string):Promise<bigint>{
    if(!this.wallet)throw new Error('Wallet not configured');
    if(mint===SOL)return BigInt(await this.rpc.getBalance(this.user,'confirmed'));
    const accounts=await this.rpc.getParsedTokenAccountsByOwner(this.user,{mint:new PublicKey(mint)},'confirmed');
    return accounts.value.reduce((s,a)=>s+BigInt(a.account.data.parsed.info.tokenAmount.amount),0n);
  }
  async quote(input:string,output:string,amount:bigint):Promise<Quote>{
    if(amount<=0n||amount>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Invalid quote amount');
    const [im,om]=await Promise.all([this.mint(input),this.mint(output)]);
    const inputUsd=valueUsd(amount,im.decimals,this.prices.get(input));
    const ata=output===SOL?null:getAssociatedTokenAddressSync(new PublicKey(output),this.user,false,om.program);
    const missing=ata?!await this.rpc.getAccountInfo(ata,'confirmed'):false;
    const rent=missing?await this.rpc.getMinimumBalanceForRentExemption(165):0;
    const fee=valueUsd(BigInt(5000+this.cfg.MAX_PRIORITY_LAMPORTS+rent),9,this.prices.get(SOL));
    try {
      const raw=await this.jupiter.build(input,output,amount.toString(),this.user.toBase58(),this.cfg.MAX_SLIPPAGE_BPS);
      if(raw.inputMint!==input||raw.outputMint!==output||raw.inAmount!==amount.toString()||BigInt(raw.outAmount)<=0n||!raw.routePlan.length)
        throw new Error('Quote does not match intent');
      return {adapter:'jupiter',inputMint:input,outputMint:output,inAtoms:raw.inAmount,outAtoms:raw.outAmount,minOutAtoms:raw.otherAmountThreshold,
        outUsd:valueUsd(BigInt(raw.otherAmountThreshold),om.decimals,this.prices.get(output)).toString(),networkFeeUsd:fee.toString(),
        priceImpactPct:Number(raw.priceImpactPct)*100,at:Date.now(),contextSlot:raw.contextSlot,raw:{quote:raw,inputUsd:inputUsd.toString()}};
    } catch(e) {
      if(this.cfg.ENABLE_PUMP_CURVE!=='true'||(input!==SOL&&output!==SOL))throw e;
      return this.curveQuote(input,output,amount,inputUsd,fee);
    }
  }
  private async curveQuote(input:string,output:string,amount:bigint,inputUsd:bigint,fee:bigint):Promise<Quote>{
    const buy=input===SOL,mint=new PublicKey(buy?output:input),info=await this.mint(mint.toBase58());
    const [state,global,feeConfig,m]=await Promise.all([
      buy?this.pump.fetchBuyState(mint,this.user,info.program):this.pump.fetchSellState(mint,this.user,info.program),
      this.pump.fetchGlobal(),this.pump.fetchFeeConfig(),getMint(this.rpc,mint,'confirmed',info.program)]);
    if(!state.quoteMint.equals(new PublicKey(SOL)))throw new Error('Direct curve adapter currently supports SOL quote only');
    if(state.bondingCurve.complete)throw new Error('Curve migrated: requires DEX route');
    const params={global,feeConfig,mintSupply:new BN(m.supply.toString()),bondingCurve:state.bondingCurve,amount:new BN(amount.toString()),quoteMint:state.quoteMint,quoteTransferFee:state.quoteTransferFee};
    const out=buy?getBuyTokenAmountFromSolAmount(params):getSellSolAmountFromTokenAmount(params);
    const floor=BigInt(out.toString())*BigInt(10000-this.cfg.MAX_SLIPPAGE_BPS)/10000n;
    const outputInfo=await this.mint(output);
    const markedOutput=valueUsd(BigInt(out.toString()),outputInfo.decimals,this.prices.get(output));
    const effectiveLossPct=Math.max(0,1-Number(markedOutput)/Number(inputUsd))*100;
    return {adapter:'pump-curve',inputMint:input,outputMint:output,inAtoms:amount.toString(),outAtoms:out.toString(),minOutAtoms:floor.toString(),
      outUsd:valueUsd(floor,outputInfo.decimals,this.prices.get(output)).toString(),networkFeeUsd:fee.toString(),priceImpactPct:effectiveLossPct,
      at:Date.now(),raw:{inputUsd:inputUsd.toString()}};
  }
  async prepare(q:Quote){
    if(!this.wallet||this.cfg.MODE!=='live')throw new Error('Signing is only enabled in configured LIVE');
    if(Date.now()-q.at>10_000)throw new Error('Quote expired before signing');
    if(q.priceImpactPct>this.cfg.MAX_PRICE_IMPACT_PCT)throw new Error('price_impact_limit');
    let tx:VersionedTransaction,lastValidBlockHeight:number;
    if(q.adapter==='jupiter'){
      const built=(q.raw as {quote:BuildResponse}).quote;
      if(built.swapInstruction.programId!=='JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')throw new Error('Unexpected Jupiter router program');
      const allowed=new Set(['11111111111111111111111111111111',TOKEN_PROGRAM_ID.toBase58(),TOKEN_2022_PROGRAM_ID.toBase58(),
        'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL','JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4']);
      const raw=[...built.setupInstructions,...built.otherInstructions,built.swapInstruction,...(built.cleanupInstruction?[built.cleanupInstruction]:[])];
      if(built.tipInstruction)throw new Error('Unexpected tip instruction');
      const wrapped=getAssociatedTokenAddressSync(new PublicKey(SOL),this.user).toBase58();
      const ix=raw.map(i=>{
        if(!allowed.has(i.programId))throw new Error('Unexpected top-level program');
        const data=Buffer.from(i.data,'base64');
        if(i.programId==='11111111111111111111111111111111'){
          if(data.length!==12||data.readUInt32LE(0)!==2||q.inputMint!==SOL||i.accounts[0]?.pubkey!==this.user.toBase58()||i.accounts[1]?.pubkey!==wrapped)
            throw new Error('Unexpected native transfer');
        }
        if(i.programId===TOKEN_PROGRAM_ID.toBase58()||i.programId===TOKEN_2022_PROGRAM_ID.toBase58()){
          if(![1,9,16,17,18].includes(data[0]??-1)||i.accounts[0]?.pubkey!==wrapped)throw new Error('Unexpected token authority or transfer instruction');
          if(data[0]===9&&(i.accounts[1]?.pubkey!==this.user.toBase58()||i.accounts[2]?.pubkey!==this.user.toBase58()))throw new Error('Unexpected close recipient');
        }
        return new TransactionInstruction({programId:new PublicKey(i.programId),keys:i.accounts.map(a=>({pubkey:new PublicKey(a.pubkey),isSigner:a.isSigner,isWritable:a.isWritable})),data});
      });
      const lookup=await Promise.all(Object.keys(built.addressesByLookupTableAddress??{}).map(async key=>{
        const r=await this.rpc.getAddressLookupTable(new PublicKey(key));if(!r.value)throw new Error('Missing lookup table');return r.value;
      }));
      const limit=1_400_000;
      const block=await this.rpc.getLatestBlockhash('confirmed');lastValidBlockHeight=block.lastValidBlockHeight;
      tx=new VersionedTransaction(new TransactionMessage({payerKey:this.user,recentBlockhash:block.blockhash,instructions:[
        ComputeBudgetProgram.setComputeUnitLimit({units:limit}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:Math.floor(this.cfg.MAX_PRIORITY_LAMPORTS*1e6/limit)}),...ix]}).compileToV0Message(lookup));
    }else{
      const buy=q.inputMint===SOL,mint=new PublicKey(buy?q.outputMint:q.inputMint),mi=await this.mint(mint.toBase58());
      const global=await this.pump.fetchGlobal();
      let instructions:TransactionInstruction[];
      if(buy){
        const state=await this.pump.fetchBuyState(mint,this.user,mi.program);
        instructions=await PUMP_SDK.buyInstructions({...state,global,mint,user:this.user,tokenProgram:mi.program,
          amount:new BN(q.minOutAtoms),solAmount:new BN(q.inAtoms),slippage:0});
      }else{
        const state=await this.pump.fetchSellState(mint,this.user,mi.program);
        instructions=await PUMP_SDK.sellInstructions({...state,global,mint,user:this.user,tokenProgram:mi.program,
          amount:new BN(q.inAtoms),solAmount:new BN(q.minOutAtoms),slippage:0,mayhemMode:state.bondingCurve.isMayhemMode});
      }
      const block=await this.rpc.getLatestBlockhash('confirmed');lastValidBlockHeight=block.lastValidBlockHeight;
      tx=new VersionedTransaction(new TransactionMessage({payerKey:this.user,recentBlockhash:block.blockhash,
        instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:300000}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:Math.floor(this.cfg.MAX_PRIORITY_LAMPORTS*1e6/300000)}),...instructions]}).compileToV0Message());
    }
    if(tx.message.header.numRequiredSignatures!==1||!tx.message.staticAccountKeys[0]?.equals(this.user))throw new Error('Unexpected signer or fee payer');
    const output=await this.mint(q.outputMint),input=await this.mint(q.inputMint);
    const outputAccount=q.outputMint===SOL?this.user:getAssociatedTokenAddressSync(new PublicKey(q.outputMint),this.user,false,output.program);
    const inputAccount=q.inputMint===SOL?this.user:getAssociatedTokenAddressSync(new PublicKey(q.inputMint),this.user,false,input.program);
    const addresses=[this.user,inputAccount,outputAccount];
    const before=await this.rpc.getMultipleAccountsInfo(addresses,'confirmed');
    const sim=await this.rpc.simulateTransaction(tx,{sigVerify:false,replaceRecentBlockhash:true,accounts:{encoding:'base64',addresses:addresses.map(p=>p.toBase58())}});
    if(sim.value.err||!sim.value.accounts)throw new Error('Transaction simulation failed');
    const tokenAmount=(a:typeof before[number],address:PublicKey)=>a?unpackAccount(address,a,a.owner):undefined;
    for(const idx of [1,2]){
      if(addresses[idx]!.equals(this.user))continue;
      const a=sim.value.accounts[idx];if(!a)throw new Error('Simulation lacks token account');
      const after={...a,data:Buffer.from(a.data[0]!,'base64'),owner:new PublicKey(a.owner)};
      const decoded=tokenAmount(after,addresses[idx]!);
      if(!decoded?.owner.equals(this.user)||decoded.delegate||decoded.closeAuthority)throw new Error('Unsafe token account after simulation');
    }
    const nativeBefore=BigInt(before[0]?.lamports??0),nativeAfter=BigInt(sim.value.accounts[0]?.lamports??0);
    const allowedNative=(q.inputMint===SOL?BigInt(q.inAtoms):0n)+BigInt(Math.ceil(Number(q.networkFeeUsd)/1e6/this.prices.get(SOL)*1e9));
    if(nativeBefore-nativeAfter>allowedNative)throw new Error('Simulated native debit exceeds budget');
    const getAfter=(idx:number,mint:string,program:PublicKey)=>{
      const a=sim.value.accounts![idx];if(!a)return 0n;
      return mint===SOL?BigInt(a.lamports):unpackAccount(addresses[idx]!,{...a,data:Buffer.from(a.data[0]!,'base64'),owner:new PublicKey(a.owner)},program).amount;
    };
    const preInput=q.inputMint===SOL?nativeBefore:tokenAmount(before[1]??null,inputAccount)?.amount??0n;
    const preOutput=q.outputMint===SOL?nativeBefore:tokenAmount(before[2]??null,outputAccount)?.amount??0n;
    if(q.inputMint!==SOL&&preInput-getAfter(1,q.inputMint,input.program)>BigInt(q.inAtoms))throw new Error('Simulated input debit exceeds quote');
    const received=getAfter(2,q.outputMint,output.program)-preOutput+(q.outputMint===SOL?BigInt(5000+this.cfg.MAX_PRIORITY_LAMPORTS):0n);
    if(received<BigInt(q.minOutAtoms))throw new Error('Simulated output below minimum');
    tx.sign([this.wallet]);
    return {signature:bs58.encode(tx.signatures[0]!),signedBase64:Buffer.from(tx.serialize()).toString('base64'),lastValidBlockHeight};
  }
  async broadcast(i:Intent){
    if(!i.signedBase64||!i.signature)throw new Error('Missing durable signed transaction');
    const sig=await this.rpc.sendRawTransaction(Buffer.from(i.signedBase64,'base64'),{skipPreflight:false,maxRetries:0});
    if(sig!==i.signature)throw new Error('Signature mismatch');
  }
  async reconcile(i:Intent):Promise<{status:'confirmed';fill:Fill}|{status:'pending'}|{status:'failed';feeUsd?:string}>{
    if(!i.signature)return {status:'failed'};
    const statuses=await this.rpc.getSignatureStatuses([i.signature],{searchTransactionHistory:true}),status=statuses.value[0];
    if(!status){
      const height=await this.rpc.getBlockHeight('finalized');
      return {status:i.lastValidBlockHeight!==undefined&&height>i.lastValidBlockHeight?'failed':'pending'};
    }
    if(status.confirmationStatus!=='finalized')return {status:'pending'};
    const tx=await this.rpc.getTransaction(i.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
    if(!tx?.meta)return {status:'pending'};
    if(tx.meta.err)return {status:'failed',feeUsd:valueUsd(BigInt(tx.meta.fee),9,this.prices.get(SOL)).toString()};
    const owner=this.user.toBase58();
    const tokenDelta=(mint:string)=>{
      const pre=(tx.meta!.preTokenBalances??[]).filter(x=>x.owner===owner&&x.mint===mint).reduce((a,x)=>a+BigInt(x.uiTokenAmount.amount),0n);
      const post=(tx.meta!.postTokenBalances??[]).filter(x=>x.owner===owner&&x.mint===mint).reduce((a,x)=>a+BigInt(x.uiTokenAmount.amount),0n);
      return post-pre;
    };
    const walletIndex=tx.transaction.message.staticAccountKeys.findIndex(k=>k.equals(this.user));
    if(walletIndex<0)throw new Error('Wallet missing in finalized transaction');
    const native=BigInt(tx.meta.postBalances[walletIndex]!)-BigInt(tx.meta.preBalances[walletIndex]!);
    const fee=BigInt(tx.meta.fee),nativeTransfer=native+fee;
    const ownIndices=new Set([...(tx.meta.preTokenBalances??[]),...(tx.meta.postTokenBalances??[])].filter(x=>x.owner===owner).map(x=>x.accountIndex));
    const rentDelta=[...ownIndices].reduce((s,index)=>{
      const pre=BigInt(tx.meta!.preBalances[index]??0),post=BigInt(tx.meta!.postBalances[index]??0);
      return s+(pre===0n||post===0n?post-pre:0n);
    },0n);
    const inAmount=i.quote.inputMint===SOL?-nativeTransfer-rentDelta:-tokenDelta(i.quote.inputMint);
    const outAmount=i.quote.outputMint===SOL?nativeTransfer+rentDelta:tokenDelta(i.quote.outputMint);
    if(inAmount<=0n||outAmount<=0n)throw new Error('Finalized transaction deltas require manual reconciliation');
    const im=await this.mint(i.quote.inputMint),om=await this.mint(i.quote.outputMint);
    // Non-SOL swaps additionally pay ATA rent (or receive refunds) through the native account.
    const overhead=i.quote.inputMint!==SOL&&i.quote.outputMint!==SOL?-native:fee+rentDelta;
    return {status:'confirmed',fill:{signature:i.signature,inAtoms:inAmount.toString(),outAtoms:outAmount.toString(),
      inputUsd:valueUsd(inAmount,im.decimals,this.prices.get(i.quote.inputMint)).toString(),
      outputUsd:valueUsd(outAmount,om.decimals,this.prices.get(i.quote.outputMint)).toString(),
      networkFeeUsd:valueUsd(overhead,9,this.prices.get(SOL)).toString(),confirmedAt:Date.now(),slot:tx.slot,simulated:false}};
  }
}

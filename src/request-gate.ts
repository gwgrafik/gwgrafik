import { retryDelay } from './http.js';
type Job<T>={run:()=>Promise<T>;priority:number;expires:number;resolve:(value:T)=>void;reject:(e:unknown)=>void};
/** One outbound request at a time. Exits take the next slot; queued entries expire. */
export class RequestGate {
  private jobs:Job<unknown>[]=[];
  private draining=false;
  private nextAt=0;
  constructor(readonly intervalMs:number,readonly now=Date.now,readonly sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms))){}
  run<T>(run:()=>Promise<T>,exit=false):Promise<T>{
    if(this.jobs.length>=(exit?8:2))return Promise.reject(new Error('jupiter_rate_limit_backpressure'));
    return new Promise<T>((resolve,reject)=>{
      this.jobs.push({run,priority:exit?0:1,expires:this.now()+(exit?45000:8000),resolve:resolve as (x:unknown)=>void,reject});
      void this.drain();
    });
  }
  private async drain(){
    if(this.draining)return;this.draining=true;
    try{
      while(this.jobs.length){
        const wait=this.nextAt-this.now();if(wait>0)await this.sleep(wait);
        this.jobs.sort((a,b)=>a.priority-b.priority);
        const job=this.jobs.shift()!;
        if(job.expires<this.now()){job.reject(new Error('jupiter_queued_request_expired'));continue;}
        this.nextAt=this.now()+this.intervalMs;
        try{job.resolve(await job.run());}
        catch(e){this.nextAt=Math.max(this.nextAt,this.now()+retryDelay(e));job.reject(e);}
      }
    }finally{this.draining=false;}
  }
}

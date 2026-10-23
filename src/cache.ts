/** Short-lived, single-flight reads. Failed reads are never reused. */
export class ReadCache<K,V> {
  private values=new Map<K,{value:V;expires:number}>();
  private flights=new Map<K,Promise<V>>();
  private epoch=0;
  constructor(readonly ttlMs:number,readonly now=Date.now,readonly maxKeys=256){}
  get(key:K,load:()=>Promise<V>):Promise<V>{
    const hit=this.values.get(key);
    if(hit&&hit.expires>this.now())return Promise.resolve(hit.value);
    const flight=this.flights.get(key);if(flight)return flight;
    const epoch=this.epoch;
    const task=Promise.resolve().then(load).then(value=>{
      if(this.epoch===epoch){
        this.values.delete(key);this.values.set(key,{value,expires:this.now()+this.ttlMs});
        if(this.values.size>this.maxKeys)this.values.delete(this.values.keys().next().value!);
      }
      return value;
    }).finally(()=>{if(this.flights.get(key)===task)this.flights.delete(key);});
    this.flights.set(key,task);return task;
  }
  invalidate(){this.epoch++;this.values.clear();this.flights.clear();}
}

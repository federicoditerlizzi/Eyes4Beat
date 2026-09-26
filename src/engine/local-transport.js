import { command } from './protocol.js';
export class LocalTransport{
 #engine;
 constructor(createEngine,options={}){this.closed=false;this.sequence=0;this.listeners=new Set();this.version=0;this.#engine=createEngine({...options,emit:event=>{
  if(this.closed)return;const copy=structuredClone(event);if(copy.type==='state'){if(copy.version<=this.version)return;this.version=copy.version}
  for(const listener of this.listeners)listener(structuredClone(copy));
 }});}
 send(type,payload={}){if(this.closed)return Promise.reject(new Error('Engine disposed'));const message=structuredClone(command(this.sequence+1,type,payload));this.sequence++;return this.#engine.receive(message)}
 async dispose(){if(this.closed)return;this.closed=true;this.listeners.clear();await this.#engine.dispose?.()}
 subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener)}
}

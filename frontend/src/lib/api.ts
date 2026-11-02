import { mockFeatures,mockObservations } from '../data/mock';
import type {Feature,Observation} from './types';
async function get<T>(path:string,fallback:T):Promise<T>{try{const r=await fetch('/api'+path,{signal:AbortSignal.timeout(1500)});if(!r.ok)throw new Error(String(r.status));return await r.json() as T}catch{return fallback}}
export const dataApi={features:()=>get<Feature[]>('/features',mockFeatures),observations:(plantId:string)=>get<Observation[]>(`/observations/${encodeURIComponent(plantId)}`,mockObservations.filter(o=>o.plantId===plantId))};

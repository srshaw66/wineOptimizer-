import { mockObservations } from '../data/mock';
import type {Feature,Observation} from './types';
export type Vineyard={id:string;name:string;location:string};
export type LayoutPlant={x:number;y:number};
export type LayoutRow={x1:number;y1:number;x2:number;y2:number;plants?:LayoutPlant[]};
export type LayoutBlock={name:string;rows:number;plants_per_row:number;bounds?:{x:number;y:number;width:number;height:number};rows_layout?:LayoutRow[]};
export type ImageSettings={opacity?:number;rotation?:number;scale?:number;positionX?:number;positionY?:number;brightness?:number;contrast?:number;saturation?:number;crop?:number;flipX?:number;flipY?:number;columns?:number;columnGap?:number;rowGap?:number;padding?:number;blockOpacity?:number};
export type VineyardLayout={blocks:LayoutBlock[];image_settings:ImageSettings;image_url:string|null};
async function get<T>(path:string,fallback:T):Promise<T>{try{const r=await fetch('/api'+path,{signal:AbortSignal.timeout(1500)});if(!r.ok)throw new Error(String(r.status));return await r.json() as T}catch{return fallback}}
export const dataApi={features:(vineyardId:string)=>get<Feature[]>(`/features?vineyard_id=${encodeURIComponent(vineyardId)}`,[]),observations:(plantId:string)=>get<Observation[]>(`/observations/${encodeURIComponent(plantId)}`,mockObservations.filter(o=>o.plantId===plantId)),vineyards:()=>get<Vineyard[]>('/vineyards',[]),layout:(vineyardId:string)=>get<VineyardLayout>(`/vineyards/${encodeURIComponent(vineyardId)}/layout`,{blocks:[],image_settings:{},image_url:null})};

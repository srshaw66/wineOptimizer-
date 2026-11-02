import {useEffect} from 'react';
import {MapContainer,ImageOverlay,Rectangle,Polyline,CircleMarker,Tooltip,useMap} from 'react-leaflet';
import L from 'leaflet';
import type {Feature,LayerKey} from '../lib/types';
const backgroundBounds:L.LatLngBoundsExpression=[[0,0],[700,1000]];
function Camera({target}:{target:Feature|null}){
 const map=useMap();
 useEffect(()=>{if(!target)return;const zoomByKind={vineyard:-0.45,block:0.3,row:0.85,plant:1.6};map.flyTo(target.center,zoomByKind[target.kind],{animate:true,duration:.6})},[map,target]);
 return null;
}
function Resize(){const map=useMap();useEffect(()=>{const r=new ResizeObserver(()=>map.invalidateSize({pan:false}));r.observe(map.getContainer());return()=>r.disconnect()},[map]);return null}
interface Props{features:Feature[];selected:string;hovered:string|null;layers:Record<LayerKey,boolean>;focusTarget:Feature|null;onSelect:(id:string)=>void;onHover:(id:string|null)=>void}
export default function VineyardMap({features,selected,hovered,layers,focusTarget,onSelect,onHover}:Props){
 const blocks=features.filter(f=>f.kind==='block');const rows=features.filter(f=>f.kind==='row');const plants=features.filter(f=>f.kind==='plant');
 const active=hovered||selected;
 const belongs=(f:Feature)=>active==='vineyard'||active===f.id||active.startsWith(f.id+':')||(f.kind==='block'&&(active.startsWith('row:'+f.blockId+':')||active.startsWith('plant:'+f.blockId+':')));
 return <MapContainer crs={L.CRS.Simple} center={[350,500]} zoom={-0.45} minZoom={-1.4} maxZoom={4} zoomSnap={0.1} zoomDelta={0.5} zoomControl={false} attributionControl={false} className="leaflet-map" preferCanvas={false}>
  <ImageOverlay url="/vineyard-ground.svg" bounds={backgroundBounds}/>
  <Camera target={focusTarget}/><Resize/>
  {layers.blocks&&blocks.map(b=><Rectangle key={b.id} bounds={b.bounds!} pathOptions={{color:belongs(b)?'#3278c6':'#588a5a',weight:belongs(b)?4:2,fillColor:belongs(b)?'#3278c6':'#77a073',fillOpacity:belongs(b)?.16:.08}} eventHandlers={{click:()=>onSelect(b.id),mouseover:()=>onHover(b.id),mouseout:()=>onHover(null)}}><Tooltip sticky direction="top">{b.name}</Tooltip></Rectangle>)}
  {layers.imagery&&blocks.map(b=><Rectangle key={'image'+b.id} bounds={b.bounds!} interactive={false} pathOptions={{color:'#56a2ca',dashArray:'6 6',fillColor:'#56a2ca',fillOpacity:.14,weight:2}}/>)}
  {layers.rows&&rows.map(r=>{const block=blocks.find(b=>b.id==='block:'+r.blockId)!;const activeRow=active===r.id||(active.startsWith(r.id.replace('row:','plant:')+':'));return <Polyline key={r.id} positions={[[r.center[0],block.bounds![0][1]+36],[r.center[0],block.bounds![1][1]-36]]} pathOptions={{color:activeRow?'#e4a039':'#75a072',weight:activeRow?11:6,opacity:.9}} eventHandlers={{click:()=>onSelect(r.id),mouseover:()=>onHover(r.id),mouseout:()=>onHover(null)}}><Tooltip sticky>{block.name} / {r.name}</Tooltip></Polyline>})}
  {layers.plants&&plants.map(p=>{const isHover=hovered===p.id,isSelected=selected===p.id;return <CircleMarker key={p.id} center={p.center} radius={isHover?11:isSelected?9:6} pathOptions={{color:isHover?'#196b50':isSelected?'#3278c6':'white',weight:isHover||isSelected?3:2,fillColor:p.status==='flagged'?'#dfa03d':'#4e9b68',fillOpacity:1}} eventHandlers={{click:()=>onSelect(p.id),mouseover:()=>onHover(p.id),mouseout:()=>onHover(null)}}><Tooltip sticky direction="top">{p.name} · {p.parentId?.replace('row:','Block ').replace(':',' / Row ')}</Tooltip></CircleMarker>})}
 </MapContainer>
}

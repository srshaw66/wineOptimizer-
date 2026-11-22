import {useEffect,useMemo,useRef} from 'react';
import type {CSSProperties} from 'react';
import {CircleMarker,ImageOverlay,MapContainer,Polygon,Polyline,Tooltip,useMap,ZoomControl} from 'react-leaflet';
import L from 'leaflet';
import type {Feature,LayerKey} from '../lib/types';
import type {ImageSettings} from '../lib/api';

const MAP_EXTENT: L.LatLngBoundsLiteral = [[0,0],[700,1000]];
const WORLD = L.latLngBounds(MAP_EXTENT);

const KIND_ZOOM = {vineyard:0.05,block:0.45,row:1.05,plant:1.9} as const;
let cameraLockUntil=0;
function lockCamera(ms=520){cameraLockUntil=performance.now()+ms}

function featureBounds(feature:Feature,blocks:Feature[]){
  if(feature.bounds) return L.latLngBounds(feature.bounds);
  if(feature.kind==='row'){
    const block=blocks.find(b=>b.id===`block:${feature.blockId}`);
    if(block?.bounds){
      const west=block.bounds[0][1];
      const east=block.bounds[1][1];
      const y=feature.center[0];
      return L.latLngBounds([[y-36,west+24],[y+36,east-24]]);
    }
  }
  const [y,x]=feature.center;
  return L.latLngBounds([[y-30,x-38],[y+30,x+38]]);
}

function Panes(){
  const map=useMap();
  useEffect(()=>{
    const panes:Array<[string,string]> = [['blocks','410'],['rows','450'],['plants','520']];
    for(const [name,z] of panes){
      const pane=map.getPane(name)??map.createPane(name);
      pane.style.zIndex=z;
    }
  },[map]);
  return null;
}

function ViewportSync({fitSerial}:{fitSerial:number}){
  const map=useMap();
  const lastFit=useRef(0);
  useEffect(()=>{
    const el=map.getContainer();
    let frame=0;
    const preserveCenter=()=>{
      if(performance.now()<cameraLockUntil) return;
      const center=map.getCenter();
      const zoom=map.getZoom();
      cancelAnimationFrame(frame);
      frame=requestAnimationFrame(()=>{
        if(performance.now()<cameraLockUntil) return;
        map.invalidateSize({animate:false,pan:false});
        map.setView(center,zoom,{animate:false});
      });
    };
    const observer=new ResizeObserver(preserveCenter);
    lockCamera(400);
    map.fitBounds(WORLD,{padding:[36,36],animate:false,maxZoom:0.2});
    observer.observe(el);
    lastFit.current=fitSerial;
    return ()=>{cancelAnimationFrame(frame);observer.disconnect()};
  },[map]);
  useEffect(()=>{
    if(fitSerial===lastFit.current) return;
    lastFit.current=fitSerial;
    lockCamera(500);
    map.flyToBounds(WORLD,{padding:[36,36],duration:0.4,maxZoom:0.2});
  },[fitSerial,map]);
  return null;
}

function Camera({target,serial,blocks}:{target:Feature|null;serial:number;blocks:Feature[]}){
  const map=useMap();
  const lastSerial=useRef(0);
  useEffect(()=>{
    if(!target||serial===0||serial===lastSerial.current) return;
    lastSerial.current=serial;
    lockCamera(520);
    const padding:{paddingTopLeft:[number,number];paddingBottomRight:[number,number]}={
      paddingTopLeft:[32,48],
      paddingBottomRight:[32,48]
    };
    if(target.kind==='plant'){
      map.flyTo(target.center,KIND_ZOOM.plant,{animate:true,duration:0.42,easeLinearity:0.35});
      return;
    }
    map.flyToBounds(featureBounds(target,blocks),{...padding,maxZoom:KIND_ZOOM[target.kind]+0.35,duration:0.42,easeLinearity:0.35});
  },[blocks,map,serial,target]);
  return null;
}

interface Props{
  features:Feature[];
  selected:string;
  hovered:string|null;
  layers:Record<LayerKey,boolean>;
  focusTarget:Feature|null;
  focusSerial:number;
  fitSerial:number;
  onSelect:(id:string)=>void;
  onHover:(id:string|null)=>void;
  backgroundUrl?:string|null;
  imageSettings?:ImageSettings;
}

export default function VineyardMap({features,selected,hovered,layers,focusTarget,focusSerial,fitSerial,onSelect,onHover,backgroundUrl,imageSettings={}}:Props){
  const transformPoint=(point:[number,number]):[number,number]=>{
    const scale=Number(imageSettings.scale??100)/100;
    const cx=500+Number(imageSettings.positionX??0); const cy=350+Number(imageSettings.positionY??0);
    let x=cx+(point[1]-500)*scale; let y=cy+(point[0]-350)*scale;
    if(imageSettings.flipX)x=2*cx-x;
    if(imageSettings.flipY)y=2*cy-y;
    const radians=Number(imageSettings.rotation??0)*Math.PI/180;
    const dx=x-cx; const dy=y-cy;
    return [cy+dx*Math.sin(radians)+dy*Math.cos(radians),cx+dx*Math.cos(radians)-dy*Math.sin(radians)];
  };
  const renderedFeatures=useMemo(()=>features.map(feature=>{
    const rendered={...feature,center:transformPoint(feature.center)} as Feature;
    if(feature.bounds){const [[y0,x0],[y1,x1]]=feature.bounds;const corners=[transformPoint([y0,x0]),transformPoint([y0,x1]),transformPoint([y1,x1]),transformPoint([y1,x0])];rendered.polygon=corners;rendered.bounds=[[Math.min(...corners.map(point=>point[0])),Math.min(...corners.map(point=>point[1]))],[Math.max(...corners.map(point=>point[0])),Math.max(...corners.map(point=>point[1]))]]}
    if(feature.line)rendered.line=[transformPoint(feature.line[0]),transformPoint(feature.line[1])];
    return rendered;
  }),[features,imageSettings]);
  const blocks=useMemo(()=>renderedFeatures.filter(f=>f.kind==='block'),[renderedFeatures]);
  const rows=useMemo(()=>renderedFeatures.filter(f=>f.kind==='row'),[renderedFeatures]);
  const plants=useMemo(()=>renderedFeatures.filter(f=>f.kind==='plant'),[renderedFeatures]);
  const renderedFocus=focusTarget?renderedFeatures.find(feature=>feature.id===focusTarget.id)||null:null;
  const active=hovered||selected;

  const belongs=(f:Feature)=>{
    if(active===f.id) return true;
    if(f.kind==='block') return active.startsWith(`row:${f.blockId}:`)||active.startsWith(`plant:${f.blockId}:`);
    if(f.kind==='row') return active.startsWith(f.id.replace('row:','plant:')+':');
    return false;
  };

  const stopSelect=(id:string)=> (event:L.LeafletMouseEvent)=>{
    L.DomEvent.stopPropagation(event);
    onSelect(id);
  };
  const stopHover=(id:string)=> (event:L.LeafletMouseEvent)=>{
    L.DomEvent.stopPropagation(event);
    onHover(id);
  };

  const limit=useMemo(()=>WORLD.pad(0.6),[ ]);
  const imageBounds=useMemo(()=>{
    const scale=(Number(imageSettings.scale??100)/100);
    const width=1000*scale;
    const height=700*scale;
    const x=500+Number(imageSettings.positionX??0);
    const y=350+Number(imageSettings.positionY??0);
    return [[y-height/2,x-width/2],[y+height/2,x+width/2]] as L.LatLngBoundsLiteral;
  },[imageSettings.positionX,imageSettings.positionY,imageSettings.scale]);
  const imageStyle={
    filter:`brightness(${Number(imageSettings.brightness??100)}%) contrast(${Number(imageSettings.contrast??100)}%) saturate(${Number(imageSettings.saturation??100)}%)`,
    transform:`rotate(${Number(imageSettings.rotation??0)}deg) scaleX(${imageSettings.flipX?-1:1}) scaleY(${imageSettings.flipY?-1:1})`,
    transformOrigin:'center center'
    ,clipPath:`inset(${Number(imageSettings.crop??0)}% ${Number(imageSettings.crop??0)}% ${Number(imageSettings.crop??0)}% ${Number(imageSettings.crop??0)}%)`
  } as CSSProperties;
  useEffect(()=>{
    const image=document.querySelector('.leaflet-image-layer.map-background-image') as HTMLImageElement|null;
    if(image) Object.assign(image.style,imageStyle);
  },[backgroundUrl,imageStyle]);

  return (
    <MapContainer
      crs={L.CRS.Simple}
      center={[350,500]}
      zoom={-0.2}
      minZoom={-1.5}
      maxZoom={3.25}
      maxBounds={limit}
      maxBoundsViscosity={0.55}
      zoomSnap={0.25}
      zoomDelta={0.5}
      wheelPxPerZoomLevel={140}
      inertia={false}
      bounceAtZoomLimits
      zoomControl={false}
      attributionControl={false}
      doubleClickZoom
      scrollWheelZoom
      className="leaflet-map"
    >
      {backgroundUrl && <ImageOverlay url={backgroundUrl} bounds={imageBounds} opacity={Number(imageSettings.opacity??70)/100} className="map-background-image" />}
      <Panes />
      <ViewportSync fitSerial={fitSerial} />
      <Camera target={renderedFocus} serial={focusSerial} blocks={blocks} />
      <ZoomControl position="bottomright" />

      {layers.blocks && blocks.map(block=>{
        const on=belongs(block);
        return (
          <Polygon
            key={block.id}
            pane="blocks"
            positions={block.polygon||block.bounds!}
            bubblingMouseEvents={false}
            pathOptions={{color:on?'#3278c6':'#5c8a5e',weight:on?2.5:2,fillColor:on?'#3278c6':'#77a073',fillOpacity:on?Number(imageSettings.blockOpacity??14)/100:Number(imageSettings.blockOpacity??7)/100,lineJoin:'round'}}
            eventHandlers={{click:stopSelect(block.id),mouseover:stopHover(block.id),mouseout:()=>onHover(null)}}
          >
            <Tooltip sticky direction="top">{block.name}</Tooltip>
          </Polygon>
        );
      })}

      {layers.imagery && blocks.map(block=>(
        <Polygon
          key={`image-${block.id}`}
          pane="blocks"
          positions={block.polygon||block.bounds!}
          interactive={false}
          pathOptions={{color:'#56a2ca',dashArray:'6 6',fillColor:'#56a2ca',fillOpacity:0.12,weight:2}}
        />
      ))}

      {layers.rows && rows.map(row=>{
        const block=blocks.find(b=>b.id===`block:${row.blockId}`);
        if(!block?.bounds) return null;
        const on=belongs(row);
        return (
          <Polyline
            key={row.id}
            pane="rows"
            positions={row.line||[[row.center[0],block.bounds[0][1]+36],[row.center[0],block.bounds[1][1]-36]]}
            bubblingMouseEvents={false}
            pathOptions={{color:on?'#e4a039':'#75a072',weight:on?7:5,opacity:0.95,lineCap:'round'}}
            eventHandlers={{click:stopSelect(row.id),mouseover:stopHover(row.id),mouseout:()=>onHover(null)}}
          >
            <Tooltip sticky>{block.name} / {row.name}</Tooltip>
          </Polyline>
        );
      })}

      {layers.plants && plants.map(plant=>{
        const isHover=hovered===plant.id;
        const isSelected=selected===plant.id;
        return (
          <CircleMarker
            key={plant.id}
            pane="plants"
            center={plant.center}
            radius={isHover||isSelected?8:6.5}
            bubblingMouseEvents={false}
            pathOptions={{color:isHover?'#196b50':isSelected?'#3278c6':'#f4f8f4',weight:isHover||isSelected?2.5:1.5,fillColor:plant.status==='flagged'?'#dfa03d':'#4e9b68',fillOpacity:1}}
            eventHandlers={{click:stopSelect(plant.id),mouseover:stopHover(plant.id),mouseout:()=>onHover(null)}}
          >
            <Tooltip sticky direction="top">{plant.name} · {plant.parentId?.replace('row:','Block ').replace(':',' / Row ')}</Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}

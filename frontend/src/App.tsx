import {useEffect,useMemo,useState} from 'react';
import VineyardMap from './components/VineyardMap';
import {mockFeatures,mockObservations} from './data/mock';
import {dataApi} from './lib/api';
import type {Feature,LayerKey,Observation,PanelTab} from './lib/types';
import './styles/app.css';
const nav=['Overview','Map','Data','Analytics'] as const;
type Page=typeof nav[number];
export default function App(){
 const [features,setFeatures]=useState<Feature[]>(mockFeatures),[observations,setObservations]=useState<Observation[]>(mockObservations);
 const [page,setPage]=useState<Page>('Map'),[left,setLeft]=useState(true),[right,setRight]=useState(true),[prior,setPrior]=useState<[boolean,boolean]>([true,true]);
 const [selected,setSelected]=useState('plant:A:1:3'),[hovered,setHovered]=useState<string|null>(null),[tab,setTab]=useState<PanelTab>('Details');
 const [expanded,setExpanded]=useState<Set<string>>(new Set(['vineyard','block:A','row:A:1']));
 const [layers,setLayers]=useState<Record<LayerKey,boolean>>({blocks:true,rows:true,plants:true,imagery:false});
 const [focusId,setFocusId]=useState<string|null>(null),[focusSerial,setFocusSerial]=useState(0),[profileOpen,setProfileOpen]=useState(false);
 useEffect(()=>{dataApi.features().then(setFeatures)},[]);
 const byId=useMemo(()=>new Map(features.map(f=>[f.id,f])),[features]);
 const current=byId.get(selected),hover=hovered?byId.get(hovered):null;
 const children=(id:string)=>features.filter(f=>f.parentId===id);
 useEffect(()=>{if(current?.kind==='plant'){dataApi.observations(current.id).then(setObservations)}},[selected,features]);
 const selectedObs=current?.kind==='plant'?observations.filter(o=>o.plantId===current.id).sort((a,b)=>b.date.localeCompare(a.date)):[];
 const pick=(id:string,fromMap:boolean)=>{setSelected(id);setTab('Details');if(fromMap)setRight(true);else{setFocusId(id);setFocusSerial(v=>v+1)};
  const f=byId.get(id);if(f){setExpanded(old=>{const s=new Set(old);let parent=f.parentId;while(parent){s.add(parent);parent=byId.get(parent)?.parentId||null}return s})}};
 const expand=(id:string)=>setExpanded(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next});
 const featureTree=(f:Feature,depth=0):React.ReactNode=><div key={f.id}>
  <div className={'tree-row '+(selected===f.id?'selected '+f.kind:'')+(hovered===f.id?' hovered':'')} style={{paddingLeft:6+depth*16}} onMouseEnter={()=>setHovered(f.id)} onMouseLeave={()=>setHovered(null)}>
    {children(f.id).length>0?<button className="expander" onClick={()=>expand(f.id)} aria-label={`${expanded.has(f.id)?'Collapse':'Expand'} ${f.name}`}>{expanded.has(f.id)?'▾':'▸'}</button>:<span className="expander-spacer"/>}
    <button className="tree-label" onClick={()=>pick(f.id,false)}>{f.kind==='plant'?<span className={'circle '+(f.status==='flagged'?'flagged':'')}/>:<span className="tree-icon">{f.kind==='vineyard'?'◆':f.kind==='block'?'▣':'≡'}</span>}{f.name}</button>
  </div>
  {expanded.has(f.id)&&children(f.id).map(child=>featureTree(child,depth+1))}
 </div>;
 const onlyMap=()=>{if(left||right){setPrior([left,right]);setLeft(false);setRight(false)}else{setLeft(prior[0]);setRight(prior[1])}};
 const breadcrumb=(f:Feature)=>{const parts=[];let p=f.parentId;while(p){const parent=byId.get(p);if(!parent)break;parts.unshift(parent.name);p=parent.parentId}return parts.join(' / ')};
 const obs=selectedObs[0];
 return <div className="app-shell">
  <header className="topbar"><div className="branding"><span className="brand-icon">♧</span>VineyardOS <small>LOCAL</small></div><nav>{nav.map(n=><button key={n} className={page===n?'nav-active':''} onClick={()=>setPage(n)}>{n}</button>)}</nav><div className="account-zone"><button className="account-icon" onClick={()=>setProfileOpen(!profileOpen)} aria-label="Account menu">U</button>{profileOpen&&<div className="account-popover"><strong>Demo Profile</strong><p>Local prototype — no authentication or online account.</p><button onClick={()=>setProfileOpen(false)}>Close</button></div>}</div></header>
  <div className="workspace">
   <aside className={'sidebar left'+(!left?' closed':'')}><div className="sidebar-content"><div className="sidebar-title"><button className="panel-toggle" onClick={()=>setLeft(false)} title="Collapse vineyards">⇤</button><strong>Vineyards</strong></div><div className="tree">{byId.has('vineyard')&&featureTree(byId.get('vineyard')!)}</div><div className="layer-section"><h3>Map Layers</h3>{([['blocks','Block boundaries'],['rows','Rows'],['plants','Plant circles'],['imagery','Drone coverage']] as [LayerKey,string][]).map(([k,label])=><label key={k}><input type="checkbox" checked={layers[k]} onChange={e=>setLayers(old=>({...old,[k]:e.target.checked}))}/>{label}</label>)}</div></div></aside>
   <main className="main-map">
    <VineyardMap features={features} selected={selected} hovered={hovered||''} layers={layers} focusTarget={focusId?({...byId.get(focusId),_version:focusSerial} as Feature):null} onSelect={id=>pick(id,true)} onHover={setHovered}/>
    <div className="floating-controls"><button className={'float-toggle '+(left?'invisible':'')} onClick={()=>setLeft(true)} title="Open vineyards">⇥</button><button className="map-only" onClick={onlyMap}>{left||right?'⛶ Map Only':'⊞ Restore Panels'}</button><button className={'float-toggle '+(right?'invisible':'')} onClick={()=>setRight(true)} title="Open inspector">⇤</button></div>
    <div className="map-legend"><strong>Sonoma Vineyard</strong><div><span className="legend-swatch blue"/> Block <span className="legend-swatch amber"/> Row <span className="legend-swatch green"/> Plant</div></div>
    {hover&&<div className="hover-status">Hovering: {hover.name}</div>}
    {page!=='Map'&&<div className="page-overlay"><h1>{page}</h1><p>Local prototype workspace. Mapping functions are available under Map.</p><div className="page-cards">{(page==='Overview'?['Vineyards','Recent Surveys','Flagged Plants']:page==='Data'?['Import CSV','Data Sources','Drone Photos']:['Block Comparison','Canopy Trends','Reports']).map(x=><div className="page-card" key={x}><strong>{x}</strong><p>Placeholder for later development</p></div>)}</div><button className="back-button" onClick={()=>setPage('Map')}>← Return to Map</button></div>}
   </main>
   <aside className={'sidebar right'+(!right?' closed':'')}><div className="sidebar-content"><div className="sidebar-title"><strong>Inspector</strong><button className="panel-toggle" onClick={()=>setRight(false)} title="Collapse inspector">⇥</button></div>{current&&<><h2>{current.name}</h2><p className="muted small">{breadcrumb(current)||'Vineyard overview'}</p><div className="tab-group">{(['Details','Data','History'] as PanelTab[]).map(t=><button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t}</button>)}</div>
    {tab==='Details'&&<>{current.kind==='plant'?<><div className="photo-holder"><img src={obs?.photoUrl||'/plant-placeholder.svg'} alt={`Illustration placeholder for ${current.name}`}/><span>Illustration · real plant photo not yet connected</span></div><div className="info-line"><span>Plant ID</span><b>{current.id.replaceAll(':','-')}</b></div><div className="info-line"><span>Status</span><b>{current.status==='flagged'?'Flagged':'Normal'}</b></div><div className="info-line"><span>Latest survey</span><b>{obs?.date||'—'}</b></div></>:<><div className="summary-placeholder">{current.name}<small>Selected geographic feature</small></div><div className="info-line"><span>Feature type</span><b>{current.kind}</b></div><div className="info-line"><span>Child features</span><b>{children(current.id).length}</b></div></>}</>}
    {tab==='Data'&&<div className="summary-placeholder"><span className="metric">{obs?`${obs.coverage}%`:'—'}</span><span>Example canopy coverage</span><small>Synthetic measurements; not a crop-health diagnosis</small></div>}
    {tab==='History'&&<div className="history">{selectedObs.length?selectedObs.map(o=><div className="history-item" key={o.id}><b>{o.date}</b><p>{o.note}</p></div>):<div className="summary-placeholder">Historical records will appear here when imported.</div>}</div>}
   </>}</div></aside>
  </div><footer><span>Sonoma Vineyard · Local development</span><span>Mock data / No account required</span></footer>
 </div>;
}

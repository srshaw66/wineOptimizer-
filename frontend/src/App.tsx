import {useEffect,useMemo,useRef,useState} from 'react';
import VineyardMap from './components/VineyardMap';
import ImportPanel from './components/ImportPanel';
import VineyardSelection from './components/VineyardSelection';
import VineyardDesigner from './components/VineyardDesigner';
import VineyardOverview from './components/VineyardOverview';
import {mockObservations} from './data/mock';
import {dataApi,type Vineyard} from './lib/api';
import type {Feature,LayerKey,Observation,PanelTab} from './lib/types';
import './styles/app.css';
import './styles/import.css';
import './styles/selection.css';

export default function App(){
  const [features,setFeatures]=useState<Feature[]>([]);
  const [observations,setObservations]=useState<Observation[]>(mockObservations);
  const [vineyard,setVineyard]=useState<Vineyard|null>(null);
  const [importOpen,setImportOpen]=useState(false);
  const [overviewOpen,setOverviewOpen]=useState(false);
  const [darkMode,setDarkMode]=useState(false);
  const [backgroundUrl,setBackgroundUrl]=useState<string|null>(null);
  const [imageSettings,setImageSettings]=useState<Record<string,number>>({});
  const [left,setLeft]=useState(true);
  const [right,setRight]=useState(true);
  const [prior,setPrior]=useState<[boolean,boolean]>([true,true]);
  const [selected,setSelected]=useState('plant:A:1:3');
  const [hovered,setHovered]=useState<string|null>(null);
  const [tab,setTab]=useState<PanelTab>('Details');
  const [expanded,setExpanded]=useState<Set<string>>(new Set(['vineyard','block:A','row:A:1']));
  const [layers,setLayers]=useState<Record<LayerKey,boolean>>({blocks:true,rows:true,plants:true,imagery:false});
  const [focusId,setFocusId]=useState<string|null>(null);
  const [focusSerial,setFocusSerial]=useState(0);
  const [fitSerial,setFitSerial]=useState(0);
  const [profileOpen,setProfileOpen]=useState(false);
  const hoverClear=useRef<number>(0);
  const treeRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{if(vineyard){dataApi.features(vineyard.id).then(setFeatures);dataApi.layout(vineyard.id).then(layout=>{setBackgroundUrl(layout.image_url);setImageSettings(layout.image_settings||{})})}},[vineyard]);

  const byId=useMemo(()=>new Map(features.map(f=>[f.id,f])),[features]);
  const current=byId.get(selected);
  const hover=hovered?byId.get(hovered):null;
  const childrenOf=(id:string)=>features.filter(f=>f.parentId===id);

  useEffect(()=>{
    if(current?.kind==='plant') dataApi.observations(current.id).then(setObservations);
  },[current]);

  const selectedObs=current?.kind==='plant'
    ?observations.filter(o=>o.plantId===current.id).sort((a,b)=>b.date.localeCompare(a.date))
    :[];

  const reveal=(id:string)=>{
    const feature=byId.get(id);
    if(!feature) return;
    setExpanded(old=>{
      const next=new Set(old);
      let parent=feature.parentId;
      while(parent){
        next.add(parent);
        parent=byId.get(parent)?.parentId||null;
      }
      return next;
    });
  };

  const pick=(id:string,fromMap:boolean)=>{
    setSelected(id);
    setTab('Details');
    setRight(true);
    setImportOpen(false);
    reveal(id);
    if(!fromMap){
      setFocusId(id);
      setFocusSerial(n=>n+1);
    }
  };

  const setHover=(id:string|null)=>{
    window.clearTimeout(hoverClear.current);
    if(id){
      setHovered(id);
      return;
    }
    hoverClear.current=window.setTimeout(()=>setHovered(null),50);
  };

  useEffect(()=>{
    const row=treeRef.current?.querySelector('.tree-row.selected');
    row?.scrollIntoView({block:'nearest',behavior:'smooth'});
  },[selected,left]);

  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(event.key!=='Escape') return;
      if(profileOpen){setProfileOpen(false);return;}
      if(importOpen){setImportOpen(false);return;}
    };
    window.addEventListener('keydown',onKey);
    return ()=>window.removeEventListener('keydown',onKey);
  },[importOpen,profileOpen]);

  const expand=(id:string)=>{
    setExpanded(prev=>{
      const next=new Set(prev);
      if(next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const featureTree=(feature:Feature,depth=0):React.ReactNode=>{
    const kids=childrenOf(feature.id);
    const isOpen=expanded.has(feature.id);
    return (
      <div key={feature.id}>
        <div
          className={`tree-row ${selected===feature.id?`selected ${feature.kind}`:''}${hovered===feature.id?' hovered':''}`}
          style={{paddingLeft:6+depth*16}}
          onMouseEnter={()=>setHover(feature.id)}
          onMouseLeave={()=>setHover(null)}
        >
          {kids.length>0
            ?<button className="expander" onClick={()=>expand(feature.id)} aria-label={`${isOpen?'Collapse':'Expand'} ${feature.name}`}>{isOpen?'▾':'▸'}</button>
            :<span className="expander-spacer"/>}
          <button className="tree-label" onClick={()=>pick(feature.id,false)}>
            {feature.kind==='plant'
              ?<span className={`circle ${feature.status==='flagged'?'flagged':''}`}/>
              :<span className="tree-icon">{feature.kind==='vineyard'?'◆':feature.kind==='block'?'▣':'≡'}</span>}
            {feature.name}
          </button>
        </div>
        {isOpen && kids.map(child=>featureTree(child,depth+1))}
      </div>
    );
  };

  const onlyMap=()=>{
    if(left||right){
      setPrior([left,right]);
      setLeft(false);
      setRight(false);
    }else{
      setLeft(prior[0]);
      setRight(prior[1]);
    }
  };

  const breadcrumb=(feature:Feature)=>{
    const parts:string[]=[];
    let parentId=feature.parentId;
    while(parentId){
      const parent=byId.get(parentId);
      if(!parent) break;
      parts.unshift(parent.name);
      parentId=parent.parentId;
    }
    return parts.join(' / ');
  };

  const obs=selectedObs[0];
  if(!vineyard) return <VineyardSelection onSelect={item=>{setFeatures([]);setSelected('vineyard');setVineyard(item)}}/>;
  return (
    <div className={`app-shell${darkMode?' dark-mode':''}`}>
      <header className="topbar">
        <div className="branding"><span className="brand-icon">♧</span>VineyardOS <small>LOCAL</small></div>
        <div className="current-vineyard"><button className="vineyard-name-button" onClick={()=>setOverviewOpen(true)}>{vineyard.name}</button><button onClick={()=>setVineyard(null)}>Switch vineyard</button><button onClick={()=>setImportOpen(true)}>Import data</button></div>
        <div className="account-zone">
          <button className="account-icon" onClick={()=>setProfileOpen(open=>!open)} aria-label="Account menu">U</button>
          {profileOpen && (
            <div className="account-popover">
              <strong>Demo Profile</strong>
              <p>Local prototype — no authentication or online account.</p>
              <button onClick={()=>setProfileOpen(false)}>Close</button>
            </div>
          )}
        </div>
      </header>
      <div className="workspace">
        <aside className={`sidebar left${left?'':' closed'}`}>
          <div className="sidebar-content">
            <div className="sidebar-title">
              <button className="panel-toggle" onClick={()=>setLeft(false)} title="Collapse vineyards">⇤</button>
              <strong>Vineyards</strong>
            </div>
            <div className="tree" ref={treeRef}>{byId.has('vineyard') && featureTree(byId.get('vineyard')!)}</div>
            <div className="layer-section">
              <h3>Map Layers</h3>
              {([['blocks','Block boundaries'],['rows','Rows'],['plants','Plant circles'],['imagery','Drone coverage']] as [LayerKey,string][]).map(([key,label])=>(
                <label key={key}>
                  <input type="checkbox" checked={layers[key]} onChange={e=>setLayers(old=>({...old,[key]:e.target.checked}))}/>
                  {label}
                </label>
              ))}
            </div>
          </div>
        </aside>
        <main className="main-map">
          <VineyardMap
            features={features}
            selected={selected}
            hovered={hovered}
            layers={layers}
            focusTarget={focusId?byId.get(focusId)||null:null}
            focusSerial={focusSerial}
            fitSerial={fitSerial}
            backgroundUrl={vineyard.id==='sonoma-demo'?'/vineyard-ground.svg':backgroundUrl}
            imageSettings={imageSettings}
            onSelect={id=>pick(id,true)}
            onHover={setHover}
          />
          <div className="floating-controls">
            <button className={`float-toggle ${left?'invisible':''}`} onClick={()=>setLeft(true)} title="Open vineyards">⇥</button>
            <div className="float-cluster">
              <button className="map-only" onClick={onlyMap}>{left||right?'Map only':'Restore panels'}</button>
              <button className="map-only" onClick={()=>setFitSerial(n=>n+1)} title="Fit vineyard in view">Fit vineyard</button>
            </div>
            <button className={`float-toggle ${right?'invisible':''}`} onClick={()=>setRight(true)} title="Open inspector">⇤</button>
          </div>
          <div className="map-legend">
            <strong>{vineyard.name}</strong>
            <div><span className="legend-swatch blue"/> Block <span className="legend-swatch amber"/> Row <span className="legend-swatch green"/> Plant</div>
          </div>
          {hover && <div className="hover-status">Hovering: {breadcrumb(hover) ? `${breadcrumb(hover)} / ${hover.name}` : hover.name}</div>}
          {importOpen && (
            <div className="page-overlay">
              <ImportPanel vineyardId={vineyard.id}/>
              <button className="back-button" onClick={()=>setImportOpen(false)}>Return to map</button>
            </div>
          )}
          {!importOpen && !overviewOpen && features.length===0 && <div className="page-overlay"><VineyardDesigner vineyardId={vineyard.id} onSaved={()=>{dataApi.features(vineyard.id).then(setFeatures);dataApi.layout(vineyard.id).then(layout=>setBackgroundUrl(layout.image_url))}}/></div>}
          {overviewOpen && <div className="page-overlay"><VineyardOverview vineyard={vineyard} darkMode={darkMode} onDarkMode={setDarkMode} onBack={()=>setOverviewOpen(false)} onUpdated={updated=>{setVineyard(updated);setOverviewOpen(false)}} onMapUpdated={url=>setBackgroundUrl(url)} onLayoutUpdated={settings=>{setImageSettings(settings);dataApi.features(vineyard.id).then(setFeatures)}}/></div>}
        </main>
        <aside className={`sidebar right${right?'':' closed'}`}>
          <div className="sidebar-content">
            <div className="sidebar-title">
              <strong>Inspector</strong>
              <button className="panel-toggle" onClick={()=>setRight(false)} title="Collapse inspector">⇥</button>
            </div>
            {current && (
              <>
                <h2>{current.name}</h2>
                <p className="muted small">{breadcrumb(current)||'Vineyard overview'}</p>
                <div className="tab-group">
                  {(['Details','Data','History'] as PanelTab[]).map(item=>(
                    <button key={item} className={tab===item?'active':''} onClick={()=>setTab(item)}>{item}</button>
                  ))}
                </div>
                {tab==='Details' && (
                  current.kind==='plant' ? (
                    <>
                      <div className="photo-holder">
                        <img src={obs?.photoUrl||'/plant-placeholder.svg'} alt={`Illustration placeholder for ${current.name}`}/>
                        <span>Illustration · real plant photo not yet connected</span>
                      </div>
                      <div className="info-line"><span>Plant ID</span><b>{current.id.split(':').join('-')}</b></div>
                      <div className="info-line"><span>Status</span><b>{current.status==='flagged'?'Flagged':'Normal'}</b></div>
                      <div className="info-line"><span>Latest survey</span><b>{obs?.date||'—'}</b></div>
                    </>
                  ) : (
                    <>
                      <div className="summary-placeholder">{current.name}<small>Selected geographic feature</small></div>
                      <div className="info-line"><span>Feature type</span><b>{current.kind}</b></div>
                      <div className="info-line"><span>Child features</span><b>{childrenOf(current.id).length}</b></div>
                    </>
                  )
                )}
                {tab==='Data' && (
                  <div className="summary-placeholder">
                    <span className="metric">{obs?`${obs.coverage}%`:'—'}</span>
                    <span>Example canopy coverage</span>
                    <small>Synthetic measurements; not a crop-health diagnosis</small>
                  </div>
                )}
                {tab==='History' && (
                  <div className="history">
                    {selectedObs.length
                      ? selectedObs.map(item=>(
                          <div className="history-item" key={item.id}><b>{item.date}</b><p>{item.note}</p></div>
                        ))
                      : <div className="summary-placeholder">Historical records will appear here when imported.</div>}
                  </div>
                )}
              </>
            )}
          </div>
        </aside>
      </div>
      <footer>
        <span>{vineyard.name} · Local development</span>
        <span>Mock data / No account required</span>
      </footer>
    </div>
  );
}

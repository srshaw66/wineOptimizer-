import {useEffect,useRef,useState} from 'react';
import type {ImageSettings,LayoutBlock,LayoutRow,VineyardLayout} from '../lib/api';

type Mode='blocks'|'rows'|'plants';
type Drag={kind:'block'|'row'|'plant';block:number;row?:number;plant?:number;dx:number;dy:number};
type Props={layout:VineyardLayout;imageSettings:ImageSettings;onClose:()=>void;onSave:(blocks:LayoutBlock[])=>Promise<void>};

function defaultBounds(index:number,columns:number):NonNullable<LayoutBlock['bounds']>{
  const width=(1000-160-(columns-1)*110)/columns;
  return {x:80+(index%columns)*(width+110),y:75+Math.floor(index/columns)*330,width,height:250};
}
function defaultRows(bounds:NonNullable<LayoutBlock['bounds']>,count:number,plants:number):LayoutRow[]{
  return Array.from({length:count},(_,index)=>{
    const y=bounds.y+35+(index+0.5)*Math.max(20,(bounds.height-70)/Math.max(count,1));
    const x1=bounds.x+30; const x2=bounds.x+bounds.width-30;
    return {x1,y1:y,x2,y2:y,plants:Array.from({length:plants},(_,p)=>({x:x1+p*(x2-x1)/Math.max(plants-1,1),y}))};
  });
}
function hydrate(blocks:LayoutBlock[],settings:ImageSettings){
  const columns=Math.max(1,Number(settings.columns??2));
  return blocks.map((block,index)=>{const bounds=block.bounds||defaultBounds(index,columns);return {...block,bounds,rows_layout:block.rows_layout?.length?block.rows_layout:defaultRows(bounds,block.rows,block.plants_per_row)}})
}

export default function LayoutEditor({layout,imageSettings,onClose,onSave}:Props){
  const [blocks,setBlocks]=useState<LayoutBlock[]>(()=>hydrate(layout.blocks,imageSettings));
  const [mode,setMode]=useState<Mode>('blocks');
  const [selectedBlock,setSelectedBlock]=useState(0);
  const [selectedRow,setSelectedRow]=useState(0);
  const [drawing,setDrawing]=useState<{x:number;y:number}|null>(null);
  const [drag,setDrag]=useState<Drag|null>(null);
  const [saving,setSaving]=useState(false);
  const stageRef=useRef<HTMLDivElement>(null);
  const selected=blocks[selectedBlock]; const rows=selected?.rows_layout||[];

  useEffect(()=>{const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous}},[]);
  useEffect(()=>setBlocks(hydrate(layout.blocks,imageSettings)),[layout,imageSettings]);
  const point=(event:React.PointerEvent)=>{const rect=stageRef.current!.getBoundingClientRect();return {x:Math.max(0,Math.min(1000,(event.clientX-rect.left)*1000/rect.width)),y:Math.max(0,Math.min(700,(event.clientY-rect.top)*700/rect.height))}};
  const patchBlock=(index:number,patch:Partial<LayoutBlock>)=>setBlocks(old=>old.map((block,i)=>i===index?{...block,...patch}:block));

  const begin=(event:React.PointerEvent)=>{
    const p=point(event);
    if(mode==='blocks'){setDrawing(p);return}
    if(selected)setDrawing(p);
  };
  const move=(event:React.PointerEvent)=>{
    if(!drag)return;
    const p=point(event);
    setBlocks(old=>old.map((block,bi)=>{
      if(bi!==drag.block)return block;
      if(drag.kind==='block'){
        const bounds=block.bounds!; const nextX=p.x-drag.dx; const nextY=p.y-drag.dy;
        const deltaX=nextX-bounds.x; const deltaY=nextY-bounds.y;
        const rows=(block.rows_layout||[]).map(row=>({...row,x1:row.x1+deltaX,y1:row.y1+deltaY,x2:row.x2+deltaX,y2:row.y2+deltaY,plants:(row.plants||[]).map(plant=>({...plant,x:plant.x+deltaX,y:plant.y+deltaY}))}));
        return {...block,bounds:{...bounds,x:nextX,y:nextY},rows_layout:rows};
      }
      const nextRows=[...(block.rows_layout||[])]; const row=nextRows[drag.row!];
      if(drag.kind==='row')nextRows[drag.row!]={...row,y1:p.y-drag.dy,y2:p.y-drag.dy,plants:(row.plants||[]).map(plant=>({...plant,y:p.y-drag.dy}))};
      else {const plants=[...(row.plants||[])];plants[drag.plant!]={...plants[drag.plant!],x:p.x-drag.dx,y:p.y-drag.dy};nextRows[drag.row!]={...row,plants}}
      return {...block,rows_layout:nextRows};
    }));
  };
  const finish=(event:React.PointerEvent)=>{
    const p=point(event);
    if(drag){setDrag(null);return}
    if(!drawing)return;
    const start=drawing;setDrawing(null);
    if(mode==='blocks'){
      const bounds={x:Math.min(start.x,p.x),y:Math.min(start.y,p.y),width:Math.abs(p.x-start.x),height:Math.abs(p.y-start.y)};
      if(bounds.width<25||bounds.height<25)return;
      setBlocks(old=>[...old,{name:`Block ${old.length+1}`,rows:1,plants_per_row:0,bounds,rows_layout:defaultRows(bounds,1,0)}]);
      setSelectedBlock(blocks.length);setSelectedRow(0);return;
    }
    if(!selected)return;
    if(mode==='rows'){
      if(Math.abs(p.x-start.x)<20)return;
      const next=[...rows,{x1:start.x,y1:start.y,x2:p.x,y2:p.y,plants:[]}];
      patchBlock(selectedBlock,{rows_layout:next,rows:next.length});setSelectedRow(next.length-1);return;
    }
    const row=rows[selectedRow];if(!row)return;
    const next=rows.map((item,index)=>index===selectedRow?{...item,plants:[...(item.plants||[]),{x:p.x,y:p.y}]}:item);
    patchBlock(selectedBlock,{rows_layout:next,plants_per_row:Math.max(...next.map(item=>item.plants?.length||0),0)});
  };
  const startDrag=(event:React.PointerEvent,kind:Drag['kind'],block:number,row?:number,plant?:number)=>{
    event.stopPropagation();const p=point(event);setSelectedBlock(block);
    if(kind==='block'){const b=blocks[block].bounds!;setDrag({kind,block,dx:p.x-b.x,dy:p.y-b.y})}
    else if(kind==='row'){const item=blocks[block].rows_layout![row!];setSelectedRow(row!);setDrag({kind,block,row,dx:0,dy:p.y-item.y1})}
    else {const item=blocks[block].rows_layout![row!].plants![plant!];setSelectedRow(row!);setDrag({kind,block,row,plant,dx:p.x-item.x,dy:p.y-item.y})}
  };
  const save=async()=>{setSaving(true);try{await onSave(blocks)}finally{setSaving(false)}};
  const imageStyle={opacity:Number(imageSettings.opacity??70)/100,filter:`brightness(${Number(imageSettings.brightness??100)}%) contrast(${Number(imageSettings.contrast??100)}%) saturate(${Number(imageSettings.saturation??100)}%)`,transform:`rotate(${Number(imageSettings.rotation??0)}deg) scale(${Number(imageSettings.scale??100)/100}) scaleX(${imageSettings.flipX?-1:1}) scaleY(${imageSettings.flipY?-1:1})`,clipPath:`inset(${Number(imageSettings.crop??0)}%)`};

  return <div className="layout-modal-backdrop"><section className="layout-modal"><header><div><h2>Map your vineyard</h2><p>{mode==='blocks'?'Draw and drag block outlines.':mode==='rows'?'Draw rows inside the selected block.':'Click to add plants along the selected row.'}</p></div><button className="back-button" onClick={onClose}>Close</button></header><div className="layout-workspace"><aside className="layout-sidebar"><div className="layout-steps"><button className={mode==='blocks'?'active':''} onClick={()=>setMode('blocks')}><b>1</b> Blocks <small>{blocks.length} mapped</small></button><button className={mode==='rows'?'active':''} disabled={!blocks.length} onClick={()=>setMode('rows')}><b>2</b> Rows <small>{blocks.reduce((n,b)=>n+(b.rows_layout?.length||0),0)} mapped</small></button><button className={mode==='plants'?'active':''} disabled={!blocks.length||!rows.length} onClick={()=>setMode('plants')}><b>3</b> Plants <small>{blocks.reduce((n,b)=>n+(b.rows_layout||[]).reduce((m,r)=>m+(r.plants?.length||0),0),0)} placed</small></button></div><label className="layout-select">Block<select value={selectedBlock} onChange={event=>{setSelectedBlock(Number(event.target.value));setSelectedRow(0)}}>{blocks.map((block,index)=><option key={index} value={index}>{block.name}</option>)}</select></label>{mode!=='blocks'&&selected&&<label className="layout-select">Row<select value={selectedRow} onChange={event=>setSelectedRow(Number(event.target.value))}>{rows.map((_,index)=><option key={index} value={index}>Row {index+1}</option>)}</select></label>}<div className="layout-help"><strong>{blocks.length?'Continue mapping':'First, outline your blocks'}</strong><span>{blocks.length?'Choose a step to inspect or edit your existing layout.':'Click and drag on the image to draw your first block.'}</span></div><button className="confirm-button" disabled={saving} onClick={()=>void save()}>{saving?'Saving…':'Save layout'}</button></aside><div className="layout-stage-wrap"><div className={`layout-stage mode-${mode}`} ref={stageRef} onPointerDown={begin} onPointerMove={move} onPointerUp={finish}><img className="layout-stage-image" src={layout.image_url||'/vineyard-ground.svg'} style={imageStyle} alt="Current vineyard map"/><svg viewBox="0 0 1000 700" preserveAspectRatio="none"><rect width="1000" height="700" fill="transparent"/>{blocks.map((block,bi)=>{const b=block.bounds!;return <g key={bi}><rect x={b.x} y={b.y} width={b.width} height={b.height} className={`editor-block ${selectedBlock===bi?'selected':''}`} onPointerDown={event=>startDrag(event,'block',bi)}/>{selectedBlock===bi&&mode!=='blocks'&&(block.rows_layout||[]).map((row,ri)=><g key={ri}><line x1={row.x1} y1={row.y1} x2={row.x2} y2={row.y2} className={`editor-row ${mode==='rows'&&selectedRow===ri?'selected':''}`} onPointerDown={event=>startDrag(event,'row',bi,ri)}/>{mode==='plants'&&(row.plants||[]).map((plant,pi)=><circle key={pi} cx={plant.x} cy={plant.y} r="7" className={`editor-plant ${selectedRow===ri?'selected':''}`} onPointerDown={event=>startDrag(event,'plant',bi,ri,pi)}/>)}</g>)}</g>})}</svg><div className="layout-stage-hint">{mode==='blocks'?'Drag to outline a block':mode==='rows'?'Drag across the block to add a row':'Click on a row to add a plant'}</div></div></div></div></section></div>;
}

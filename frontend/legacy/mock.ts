import type { Feature, Observation } from '../lib/types';
export const blocksData = [
  {id:'A',left:80,right:440,bottom:405,top:645,rows:3},
  {id:'B',left:550,right:920,bottom:405,top:645,rows:3},
  {id:'C',left:80,right:920,bottom:75,top:325,rows:4},
];
export const mockFeatures:Feature[] = [{id:'vineyard',kind:'vineyard',name:'Sonoma Vineyard',parentId:null,center:[350,500],bounds:[[55,60],[665,940]]}];
export const mockObservations:Observation[]=[];
for(const b of blocksData){
  const bid=`block:${b.id}`;
  mockFeatures.push({id:bid,kind:'block',name:`Block ${b.id}`,parentId:'vineyard',blockId:b.id,center:[(b.bottom+b.top)/2,(b.left+b.right)/2],bounds:[[b.bottom,b.left],[b.top,b.right]]});
  for(let r=1;r<=b.rows;r++){
    const y=b.top-43-(r-1)*(b.top-b.bottom-88)/(b.rows-1),rid=`row:${b.id}:${r}`;
    mockFeatures.push({id:rid,kind:'row',name:`Row ${r}`,parentId:bid,blockId:b.id,rowId:rid,center:[y,(b.left+b.right)/2]});
    for(let p=1;p<=5;p++){
      const x=b.left+37+(p-1)*(b.right-b.left-74)/4,id=`plant:${b.id}:${r}:${p}`;
      const flagged=(b.id==='A'&&r===1&&p===3)||(b.id==='B'&&r===2&&p===4);
      mockFeatures.push({id,kind:'plant',name:`Plant ${p}`,parentId:rid,blockId:b.id,rowId:rid,plantNo:p,center:[y,x],status:flagged?'flagged':'normal'});
      for(const [i,date] of ['2026-10-09','2026-09-20','2026-08-28'].entries())mockObservations.push({id:`${id}-${i}`,plantId:id,date,coverage:60+(p*7+r*3+i*4)%35,status:flagged?'Flagged for inspection':'Normal',note:flagged?'Visual follow-up suggested (example only)':'Synthetic survey record',photoUrl:'/plant-placeholder.svg'});
    }
  }
}

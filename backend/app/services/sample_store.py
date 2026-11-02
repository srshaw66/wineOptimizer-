"""Local mock repository. Replace with a Supabase/PostGIS implementation later."""
from datetime import date, timedelta

BLOCKS = [dict(id='A',left=80,right=440,bottom=405,top=645,rows=3),dict(id='B',left=550,right=920,bottom=405,top=645,rows=3),dict(id='C',left=80,right=920,bottom=75,top=325,rows=4)]

def features():
    result=[dict(id='vineyard',kind='vineyard',name='Sonoma Vineyard',parentId=None,center=[350,500],bounds=[[55,60],[665,940]])]
    for block in BLOCKS:
        b=block
        bid=f"block:{b['id']}"
        result.append(dict(id=bid,kind='block',name=f"Block {b['id']}",parentId='vineyard',blockId=b['id'],center=[(b['bottom']+b['top'])/2,(b['left']+b['right'])/2],bounds=[[b['bottom'],b['left']],[b['top'],b['right']]]))
        for row in range(1,b['rows']+1):
            y=b['top']-43-(row-1)*(b['top']-b['bottom']-88)/(b['rows']-1)
            rid=f"row:{b['id']}:{row}"
            result.append(dict(id=rid,kind='row',name=f'Row {row}',parentId=bid,blockId=b['id'],rowId=rid,center=[y,(b['left']+b['right'])/2]))
            for plant in range(1,6):
                x=b['left']+37+(plant-1)*(b['right']-b['left']-74)/4
                flagged=(b['id']=='A' and row==1 and plant==3) or (b['id']=='B' and row==2 and plant==4)
                result.append(dict(id=f"plant:{b['id']}:{row}:{plant}",kind='plant',name=f'Plant {plant}',parentId=rid,blockId=b['id'],rowId=rid,plantNo=plant,center=[y,x],status='flagged' if flagged else 'normal'))
    return result

def observations(plant_id):
    f=next((a for a in features() if a['id']==plant_id and a['kind']=='plant'),None)
    if not f:return []
    b,r,p=plant_id.split(':')[1:]
    flagged=f['status']=='flagged'
    return [dict(id=f'{plant_id}-{i}',plantId=plant_id,date=d,coverage=60+(int(p)*7+int(r)*3+i*4)%35,status='Flagged for inspection' if flagged else 'Normal',note='Visual follow-up suggested (example only)' if flagged else 'Synthetic survey record',photoUrl='/plant-placeholder.svg') for i,d in enumerate(['2026-10-09','2026-09-20','2026-08-28'])]

def geojson():
    fs=[]
    for b in BLOCKS:
        x0,x1,y0,y1=b['left'],b['right'],b['bottom'],b['top']
        fs.append(dict(type='Feature',properties=dict(blockId=b['id'],name=f"Block {b['id']}"),geometry=dict(type='Polygon',coordinates=[[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]])))
    return dict(type='FeatureCollection',features=fs)

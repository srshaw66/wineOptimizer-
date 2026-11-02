from fastapi import FastAPI,HTTPException,Query
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional
from app.services import sample_store
from app.routes.imports import router as import_router, layout_features

app=FastAPI(title='VineyardOS Local API',version='0.1.0',description='Demo-only, no accounts or persistent edits')
app.add_middleware(CORSMiddleware,allow_origins=['http://127.0.0.1:5173','http://localhost:5173'],allow_credentials=False,allow_methods=['GET','POST'],allow_headers=['*'])
app.include_router(import_router)

@app.get('/api/health')
def health(): return {'status':'ok','mode':'local-demo'}
@app.get('/api/features')
def features(vineyard_id: Optional[str] = Query(default=None)):
    if vineyard_id and vineyard_id != 'sonoma-demo':
        return layout_features(vineyard_id)
    return sample_store.features(vineyard_id)
@app.get('/api/observations/{plant_id:path}')
def observations(plant_id:str): return sample_store.observations(plant_id)
@app.get('/api/blocks.geojson')
def blocks_geojson(): return sample_store.geojson()
@app.get('/api/geo/status')
def geo_status():
    from importlib.util import find_spec
    return {name:bool(find_spec(name)) for name in ['geopandas','folium','mapclassify','matplotlib']}

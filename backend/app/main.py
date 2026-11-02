from fastapi import FastAPI,HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.services import sample_store

app=FastAPI(title='VineyardOS Local API',version='0.1.0',description='Demo-only, no accounts or persistent edits')
app.add_middleware(CORSMiddleware,allow_origins=['http://127.0.0.1:5173','http://localhost:5173'],allow_credentials=False,allow_methods=['GET'],allow_headers=['*'])

@app.get('/api/health')
def health(): return {'status':'ok','mode':'local-demo'}
@app.get('/api/features')
def features(): return sample_store.features()
@app.get('/api/observations/{plant_id:path}')
def observations(plant_id:str): return sample_store.observations(plant_id)
@app.get('/api/blocks.geojson')
def blocks_geojson(): return sample_store.geojson()
@app.get('/api/geo/status')
def geo_status():
    from importlib.util import find_spec
    return {name:bool(find_spec(name)) for name in ['geopandas','folium','mapclassify','matplotlib']}

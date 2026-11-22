from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.imports import router as import_router
from app.routes.sites import router as sites_router
from app.sensors.registry import get_provider

app = FastAPI(title='VineyardOS Local API', version='0.2.0', description='SSU campus vineyard presentation example. Example data only; no accounts.')
app.add_middleware(CORSMiddleware, allow_origins=['http://127.0.0.1:5173', 'http://localhost:5173'], allow_credentials=False, allow_methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allow_headers=['*'])
app.include_router(sites_router)
app.include_router(import_router)


@app.get('/api/health')
def health():
    info = get_provider().info()
    return {'status': 'ok', 'mode': 'example' if info.kind == 'example' else 'provider', 'sensor_provider': info.id}


@app.get('/api/geo/status')
def geo_status():
    from importlib.util import find_spec
    return {name: bool(find_spec(name)) for name in ['geopandas', 'folium', 'mapclassify', 'matplotlib']}

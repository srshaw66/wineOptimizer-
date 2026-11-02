"""Optional GeoPandas operations. Requires requirements-geo.txt."""
from app.services.sample_store import geojson

def vineyard_geodataframe():
    import geopandas as gpd
    from shapely.geometry import shape
    data=geojson()['features']
    # Demo map coordinates are abstract, NOT geographic GPS coordinates.
    return gpd.GeoDataFrame([{'block':x['properties']['blockId'],'geometry':shape(x['geometry'])} for x in data])

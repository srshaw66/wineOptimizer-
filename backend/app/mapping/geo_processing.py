"""Optional GeoPandas operations. Requires requirements-geo.txt."""
from app.sensors.sites import DEFAULT_SITE_ID, site_geometry


def site_geodataframe(site_id: str = DEFAULT_SITE_ID):
    import geopandas as gpd
    # GeoJSON is WGS84 lon/lat; reproject (e.g. to EPSG:32610) before measuring areas or distances.
    return gpd.GeoDataFrame.from_features(site_geometry(site_id)['features'], crs='EPSG:4326')

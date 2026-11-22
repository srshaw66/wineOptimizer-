"""Optional standalone Folium export of the example site geometry (WGS84). Requires requirements-geo.txt."""
from app.sensors.sites import DEFAULT_SITE_ID, site_geometry


def build_html(site_id: str = DEFAULT_SITE_ID):
    import folium
    data = site_geometry(site_id)
    m = folium.Map(tiles='OpenStreetMap')
    layer = folium.GeoJson(data, name='Example site geometry (approximate)').add_to(m)
    m.fit_bounds(layer.get_bounds())
    return m.get_root().render()

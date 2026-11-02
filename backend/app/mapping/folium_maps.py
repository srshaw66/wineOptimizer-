"""Optional standalone Folium export. Demo coordinates only."""
def build_html():
    import folium
    from app.services.sample_store import geojson
    m=folium.Map(location=[0,0],zoom_start=2,tiles=None)
    folium.GeoJson(geojson(),name='Synthetic vineyard blocks').add_to(m)
    m.fit_bounds([[0,0],[700,1000]])
    return m.get_root().render()

"""Optional Mapclassify helper for real per-block measurements."""
def quantile_classes(values,k=3):
    import mapclassify
    return mapclassify.Quantiles(values,k=k).yb.tolist()

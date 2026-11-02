"""Optional static figure export, not used by initial UI."""
from io import BytesIO

def example_chart_png():
    import matplotlib
    matplotlib.use('Agg')
    from matplotlib import pyplot as plt
    fig,ax=plt.subplots()
    ax.plot(['Aug','Sep','Oct'],[68,74,82])
    ax.set(title='Example canopy coverage',ylabel='Coverage (%)')
    buf=BytesIO();fig.savefig(buf,format='png');plt.close(fig)
    return buf.getvalue()

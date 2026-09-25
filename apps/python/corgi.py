"""Helpers for charts people read on a phone, in Brazilian formats.

    import corgi
    ax.yaxis.set_major_formatter(corgi.brl_axis())   # R$ 2,1 mi
    corgi.brl(1234567.8)                              # 'R$ 1,23 mi'
    corgi.bar_labels(ax)                              # values on top of bars
    corgi.legend_below(ax)                            # legend under the chart
"""
from matplotlib.ticker import FuncFormatter


def _num(value, decimals):
    text = f"{value:,.{decimals}f}"
    return text.replace(",", "_").replace(".", ",").replace("_", ".")


def brl(value, decimals=None):
    """R$ 950 · R$ 12,5 mil · R$ 1,23 mi · R$ 2,1 bi"""
    sign = "-" if value < 0 else ""
    value = abs(value)
    for size, suffix in ((1e9, " bi"), (1e6, " mi"), (1e3, " mil")):
        if value >= size:
            shown = value / size
            places = decimals if decimals is not None else (1 if shown >= 10 else 2)
            return f"{sign}R$ {_num(shown, places).rstrip('0').rstrip(',')}{suffix}"
    return f"{sign}R$ {_num(value, decimals if decimals is not None else 0)}"


def number(value, decimals=None):
    """950 · 12,5 mil · 1,23 mi"""
    return brl(value, decimals).replace("R$ ", "")


def percent(value, decimals=1):
    """0.298 -> '29,8%'"""
    return f"{_num(value * 100, decimals)}%"


def brl_axis():
    return FuncFormatter(lambda value, _: brl(value))


def number_axis():
    return FuncFormatter(lambda value, _: number(value))


def percent_axis(decimals=0):
    return FuncFormatter(lambda value, _: percent(value, decimals))


def bar_labels(ax, fmt=None, fontsize=11):
    fmt = fmt or number
    for container in ax.containers:
        ax.bar_label(container, labels=[fmt(v) for v in container.datavalues], padding=3, fontsize=fontsize)


def legend_below(ax, ncol=3):
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.12), ncol=ncol, frameon=False)

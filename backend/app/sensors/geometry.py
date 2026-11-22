"""Plot-scale planar geometry helpers for WGS84 [lng, lat] lines (fine over tens of metres)."""
from __future__ import annotations

import math

M_PER_DEG_LAT = 110_950.0


def _xy(points):
    lat0 = points[0][1]
    k = 111_320.0 * math.cos(math.radians(lat0))
    return [(p[0] * k, p[1] * M_PER_DEG_LAT) for p in points], k


def slice_line(line: list, start: float, end: float) -> list[list[float]]:
    """Portion of `line` between fractions `start` and `end` of its length."""
    xy, k = _xy(line)
    lengths = [0.0]
    for (x1, y1), (x2, y2) in zip(xy, xy[1:]):
        lengths.append(lengths[-1] + math.hypot(x2 - x1, y2 - y1))
    total = lengths[-1] or 1.0

    def at(d: float) -> list[float]:
        for i in range(1, len(lengths)):
            if d <= lengths[i] or i == len(lengths) - 1:
                seg = (lengths[i] - lengths[i - 1]) or 1.0
                t = max(0.0, min(1.0, (d - lengths[i - 1]) / seg))
                return [round(line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, 8), round(line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t, 8)]
        return list(line[-1])

    a, b = start * total, end * total
    inner = [list(line[i]) for i in range(1, len(line) - 1) if a < lengths[i] < b]
    return [at(a), *inner, at(b)]

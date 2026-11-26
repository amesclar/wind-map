#!/usr/bin/env python3
"""Build backend/app/data/land_mask_1km.bin.z from the GLOBE 1 km land/sea grid (SCRUM-263).

The app reads the committed asset with the standard library (`backend/app/services/land_mask.py`);
this script is the only place that needs the upstream package and numpy, so neither becomes a
runtime or test dependency:

    python -m venv /tmp/mask
    /tmp/mask/bin/pip install global-land-mask
    /tmp/mask/bin/python scripts/build-land-mask.py

GLOBE (Global Land One-km Base Elevation) is NOAA/NCEI's 1 km land/sea grid, v1.0, 21,600 x 43,200
cells, not subject to U.S. copyright (citation asked for: doi:10.7289/V52R3PMS). The mask is taken
from `global-land-mask` (MIT), whose `_mask` array is True where the cell is ocean.

Output: one bit per cell, 1 = land, row-major from 90 N / 180 W, low bit of each byte first
(`np.packbits(..., bitorder="little")`), zlib level 9. Keep the layout in step with the loader.
"""

import zlib
from pathlib import Path

import numpy as np
from global_land_mask import globe

TARGET = Path(__file__).resolve().parents[1] / "backend" / "app" / "data" / "land_mask_1km.bin.z"


def main() -> None:
    land = np.logical_not(globe._mask)  # noqa: SLF001 - the package exposes no array accessor
    rows, cols = land.shape
    packed = np.packbits(land.reshape(-1), bitorder="little").tobytes()
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_bytes(zlib.compress(packed, 9))
    print(f"{TARGET}: {TARGET.stat().st_size:,} bytes ({rows} x {cols} cells)")


if __name__ == "__main__":
    main()

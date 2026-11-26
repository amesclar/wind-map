"""1 km land mask for wave model cells (SCRUM-263).

The Marine wave models answer a request near the coast with their nearest sea cell, and that cell
can sit on a narrow island: the Whidbey Island spike returned 29 of 56 nodes on land, including
cells the models call "sea" because their own mask is about 8 km wide. Distance cannot separate the
two cases — a cell borrowed from across an island and a cell that legitimately covers a coastal
node are both a few kilometres away — so the cell itself is tested for land.

The mask is GLOBE, the NOAA/NCEI Global Land One-km Base Elevation land/sea grid (v1.0): 21,600 x
43,200 cells of 0.008333°, about 1 km at the equator. It ships as the derived asset
`backend/app/data/land_mask_1km.bin.z`:

- one bit per cell, 1 = land, row-major from 90 N / 180 W, bits filled from the low bit of each
  byte (numpy's `packbits(..., bitorder="little")`), compressed with zlib level 9;
- `scripts/build-land-mask.py` rebuilds it from the `global-land-mask` package, which is a build
  dependency only: at runtime this module needs the standard library alone;
- 1,282,678 bytes on disk, 116,640,000 bytes decompressed: the process that inflates it peaks at
  123.4 MB RSS (measured 2026-11-26), against roughly 935 MB for loading the package's
  21600 x 43200 boolean array at runtime. `preload()` inflates it once at startup, off the event loop
  (SCRUM-273), so no request pays for it.

GLOBE is not subject to U.S. copyright and NOAA/NCEI asks for the citation
doi:10.7289/V52R3PMS; `global-land-mask` is MIT. If the asset is missing or unreadable the mask
fails open — no cell is called land — and logs once, so the wave layer keeps working.
"""

import asyncio
import logging
import math
import zlib
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

MASK_PATH = Path(__file__).resolve().parents[1] / "data" / "land_mask_1km.bin.z"
MASK_ROWS = 21_600
MASK_COLS = 43_200
MASK_LAT_TOP = 90.0
MASK_LON_LEFT = -180.0
MASK_CELL_DEG = 180.0 / MASK_ROWS  # 0.008333°
MASK_BYTES = MASK_ROWS * MASK_COLS // 8  # 116,640,000


@lru_cache(maxsize=1)
def _bits() -> bytes | None:
    """The unpacked mask, or None when it cannot be read (the mask then fails open)."""
    try:
        raw = zlib.decompress(MASK_PATH.read_bytes())
    except (OSError, zlib.error) as exc:
        logger.warning("Land mask %s unavailable (%s); wave cells will not be checked for land", MASK_PATH, exc)
        return None
    if len(raw) != MASK_BYTES:
        logger.warning(
            "Land mask %s holds %d bytes, expected %d; wave cells will not be checked for land",
            MASK_PATH,
            len(raw),
            MASK_BYTES,
        )
        return None
    return raw


async def preload() -> None:
    """Inflate the mask at startup, off the event loop (SCRUM-273).

    `is_land` used to inflate 116 MB synchronously on the first wave request, inside an `async def`
    that calls it per cell, so the first grid after a start blocked every other request while the
    asset decompressed. Warming it in `lifespan` means no request ever pays that cost, and a
    missing or corrupt asset is logged once at startup instead of on a user's request.
    """
    await asyncio.to_thread(_bits)


def is_land(latitude: float, longitude: float) -> bool:
    """True when the 1 km cell containing the point is land; False when the mask is unavailable."""
    bits = _bits()
    if bits is None:
        return False
    row = min(MASK_ROWS - 1, max(0, math.floor((MASK_LAT_TOP - latitude) / MASK_CELL_DEG)))
    col = min(MASK_COLS - 1, max(0, math.floor((longitude - MASK_LON_LEFT) / MASK_CELL_DEG)))
    index = row * MASK_COLS + col
    return bool((bits[index >> 3] >> (index & 7)) & 1)


def reset_cache() -> None:
    """Drop the unpacked mask; the tests use it to load another asset, production never needs it."""
    _bits.cache_clear()

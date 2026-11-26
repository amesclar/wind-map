"""Tests for the shipped 1 km GLOBE land mask (SCRUM-263)."""

import zlib

import pytest

from backend.app.services import land_mask


@pytest.fixture(autouse=True)
def _fresh_mask():
    """Every test starts from the asset on disk, whatever another test pointed the loader at."""
    land_mask.reset_cache()
    yield
    land_mask.reset_cache()


def test_the_asset_is_a_full_globe_bitmask():
    """A truncated or recompressed asset would shift every cell; the size is the contract."""
    raw = zlib.decompress(land_mask.MASK_PATH.read_bytes())

    assert len(raw) == land_mask.MASK_BYTES == 116_640_000


@pytest.mark.parametrize(
    ("latitude", "longitude"),
    [
        # The Whidbey Island cells the wave model answers with and calls sea (the SCRUM-263 bug).
        (48.2083, -122.625),
        (48.2917, -122.625),
        (48.3750, -122.625),
        (48.4583, -122.5417),
        (39.0, -95.0),  # Kansas
        (51.5, -0.12),  # London
    ],
)
def test_land_cells(latitude: float, longitude: float):
    assert land_mask.is_land(latitude, longitude) is True


@pytest.mark.parametrize(
    ("latitude", "longitude"),
    [
        (47.9, -125.5),  # open Pacific, west of the Washington coast
        (47.0, -124.6),
        (48.15, -122.75),  # Admiralty Inlet
        (48.208, -122.542),  # the coastal cell the wave tests use
        (0.0, -160.0),  # central Pacific
    ],
)
def test_sea_cells(latitude: float, longitude: float):
    assert land_mask.is_land(latitude, longitude) is False


def test_coordinates_at_the_edges_clamp_instead_of_raising():
    for latitude, longitude in ((90.0, -180.0), (-90.0, 180.0), (90.0, 180.0), (-90.0, -180.0)):
        assert isinstance(land_mask.is_land(latitude, longitude), bool)


def test_a_missing_asset_fails_open(monkeypatch, tmp_path):
    """Waves keep working without the asset; the layer must not fail closed on every cell."""
    monkeypatch.setattr(land_mask, "MASK_PATH", tmp_path / "missing.bin.z")
    land_mask.reset_cache()

    assert land_mask.is_land(48.2083, -122.625) is False


def test_a_corrupt_asset_fails_open(monkeypatch, tmp_path):
    broken = tmp_path / "land_mask_1km.bin.z"
    broken.write_bytes(b"not zlib")
    monkeypatch.setattr(land_mask, "MASK_PATH", broken)
    land_mask.reset_cache()

    assert land_mask.is_land(48.2083, -122.625) is False


def test_a_truncated_asset_fails_open(monkeypatch, tmp_path):
    short = tmp_path / "land_mask_1km.bin.z"
    short.write_bytes(zlib.compress(b"\x00" * 1_000))
    monkeypatch.setattr(land_mask, "MASK_PATH", short)
    land_mask.reset_cache()

    assert land_mask.is_land(48.2083, -122.625) is False

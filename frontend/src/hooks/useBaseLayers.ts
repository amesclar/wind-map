/**
 * Base-map and chart layers for the map (SCRUM-275).
 *
 * These effects are imperative Leaflet that has nothing to do with markers, pop-ups or the wind
 * layers: the tile layer per base map, the paper chart's keyless substrate and its clipped layer,
 * the Seamap style, the seamark overlay and the CHS NONNA depth shading. They lived inside
 * `MapView`, where reading the marker logic meant scrolling past all of it; the panes, z-indexes
 * and cleanup order are unchanged.
 */

import { useCallback, useEffect, useState } from 'react';
import L from 'leaflet';
import type { MapTileLayer } from '../types';
import {
  CHART_BOUNDS,
  CHART_COVERAGE_MAX_LAT,
  CHART_EDGE_PANE,
  CHART_MIN_ZOOM,
  CHART_PANE,
  CHART_TILE_FAILURE_THRESHOLD,
  CHART_TILE_FAILURE_WINDOW_MS,
  fetchGoogleSession,
  nonnaLayerConfig,
  NONNA_PANE,
  seamarkLayerConfig,
  SEAMARK_PANE,
  tileLayerConfig,
} from '../components/mapTiles';
import { createSeamapLayer, mountSeamapLayer, type SeamapLayer } from '../components/seamapLayer';

export interface BaseLayerOptions {
  tileLayerType: MapTileLayer;
  cartoApiKey: string;
  /** The seamark overlay, already resolved for the base map (SCRUM-214). */
  seamarksShown: boolean;
  bcDepthVisible: boolean;
}

export interface BaseLayers {
  /** The NOAA paper chart is the selected base. */
  chartBase: boolean;
  /** Top of the chart's clip is out of view, or the zoom is below its floor. */
  chartOutsideCoverage: boolean;
  /** The view crosses the chart's northern clip edge. */
  chartStraddlesEdge: boolean;
  /** Enough chart tiles failed in one window to call the service down (SCRUM-217). */
  chartTilesFailed: boolean;
  /** Remounts the chart layers and clears the failure notice. */
  retryChart: () => void;
}

export function useBaseLayers(
  mapInstance: L.Map | null,
  { tileLayerType, cartoApiKey, seamarksShown, bcDepthVisible }: BaseLayerOptions,
): BaseLayers {
  const chartBase = tileLayerType === 'paper_chart';
  const [chartOutsideCoverage, setChartOutsideCoverage] = useState(false);
  const [chartStraddlesEdge, setChartStraddlesEdge] = useState(false);
  const [chartTilesFailed, setChartTilesFailed] = useState(false);
  const [chartRetryCount, setChartRetryCount] = useState(0);

  const retryChart = useCallback(() => {
    setChartTilesFailed(false);
    setChartRetryCount((count) => count + 1);
  }, []);

  // Swap the base tile layer when the layer or CARTO key changes. The paper chart is a pair
  // (SCRUM-203): a keyless dark substrate plus the opaque chart in its own pane, clipped to the
  // service's coverage, so the clip edge reveals a working map instead of a blank canvas.
  // SCRUM-217: the chart layer's tile failures are counted here, and Retry remounts this effect.
  useEffect(() => {
    if (!mapInstance) return;
    const layers: L.Layer[] = [];
    // Counted per tile batch, not per tile: one stray tile from a pan is not an outage.
    let failures = 0;
    let windowStartedAt = 0;
    const noteTileError = () => {
      const now = Date.now();
      if (now - windowStartedAt > CHART_TILE_FAILURE_WINDOW_MS) {
        failures = 0;
        windowStartedAt = now;
      }
      failures += 1;
      if (failures >= CHART_TILE_FAILURE_THRESHOLD) setChartTilesFailed(true);
    };
    const noteBatchLoaded = () => {
      // Only a batch with no failures clears the notice: the load that follows an outage's failed
      // tiles must not hide it again immediately, but a recovered service clears it with no click.
      if (failures === 0) setChartTilesFailed(false);
      failures = 0;
      windowStartedAt = 0;
    };
    const ensureChartPane = () => {
      if (!mapInstance.getPane(CHART_PANE)) {
        const pane = mapInstance.createPane(CHART_PANE);
        pane.style.zIndex = '205';
        // Tiles only paint here: clicks must still reach the map and the barbs.
        pane.style.pointerEvents = 'none';
      }
    };

    if (tileLayerType === 'paper_chart') {
      const substrate = tileLayerConfig('osm_dark');
      if (substrate.kind === 'xyz') {
        layers.push(L.tileLayer(substrate.url, substrate.options).addTo(mapInstance));
      }
      ensureChartPane();
      const chart = tileLayerConfig('paper_chart');
      if (chart.kind === 'wms') {
        const chartLayer = L.tileLayer.wms(chart.url, {
          ...chart.options,
          pane: CHART_PANE,
          minZoom: CHART_MIN_ZOOM,
          bounds: L.latLngBounds(
            [CHART_BOUNDS.south, CHART_BOUNDS.west],
            [CHART_BOUNDS.north, CHART_BOUNDS.east],
          ),
        });
        chartLayer.on('tileerror', noteTileError);
        chartLayer.on('load', noteBatchLoaded);
        layers.push(chartLayer.addTo(mapInstance));
      }
    } else if (tileLayerType === 'seamap') {
      // SCRUM-206: a keyless dark substrate under a lazily loaded MapLibre style. The pane is the
      // chart's (205): above the base tiles, below the depth shading and the seamarks.
      const substrate = tileLayerConfig('osm_dark');
      if (substrate.kind === 'xyz') {
        layers.push(L.tileLayer(substrate.url, substrate.options).addTo(mapInstance));
      }
      ensureChartPane();
      // The first selection downloads MapLibre; switching away, or a map React StrictMode already
      // replaced, while it loads must leave no layer behind, so the layer is only mounted on a
      // map that is still this effect's own.
      let disposed = false;
      let seamapLayer: SeamapLayer | null = null;
      let unregisterVector = () => {};
      void createSeamapLayer()
        .then((created) => {
          if (disposed) return;
          unregisterVector = mountSeamapLayer(mapInstance, created);
          seamapLayer = created;
        })
        .catch((err) => {
          // The substrate still shows, so the map stays usable; the console names the cause.
          console.error('The Seamap base style could not be loaded:', err);
        });
      return () => {
        disposed = true;
        unregisterVector();
        seamapLayer?.remove();
        layers.forEach((layer) => layer.remove());
      };
    } else if (tileLayerType === 'google_satellite') {
      const substrate = tileLayerConfig('osm_dark');
      if (substrate.kind === 'xyz') {
        layers.push(L.tileLayer(substrate.url, substrate.options).addTo(mapInstance));
      }
      let disposed = false;
      let googleLayer: L.TileLayer | null = null;
      void fetchGoogleSession()
        .then((session) => {
          if (disposed) return;
          const conf = tileLayerConfig('google_satellite', '', session.tile_url);
          if (conf.kind === 'xyz' && conf.url) {
            googleLayer = L.tileLayer(conf.url, conf.options).addTo(mapInstance);
            layers.push(googleLayer);
          }
        })
        .catch((err) => {
          console.error('The Google Satellite base layer could not be loaded:', err);
        });
      return () => {
        disposed = true;
        googleLayer?.remove();
        layers.forEach((layer) => layer.remove());
      };
    } else {
      const base = tileLayerConfig(tileLayerType, cartoApiKey);
      if (base.kind === 'xyz') layers.push(L.tileLayer(base.url, base.options).addTo(mapInstance));
    }

    return () => {
      layers.forEach((layer) => layer.remove());
    };
  }, [mapInstance, tileLayerType, cartoApiKey, chartRetryCount]);

  // The chart draws only inside the clip; outside it the substrate shows, which is accurate but
  // needs saying, because the service has no "no chart here" tile to speak for itself.
  useEffect(() => {
    if (!mapInstance || !chartBase) {
      setChartOutsideCoverage(false);
      setChartStraddlesEdge(false);
      setChartTilesFailed(false);
      return;
    }
    // The app opens below the chart's zoom floor, so selecting the mode would otherwise show a
    // notice and no chart at all; zoom to the floor once, which the user can undo.
    if (mapInstance.getZoom() < CHART_MIN_ZOOM) mapInstance.setZoom(CHART_MIN_ZOOM);
    const update = () => {
      const bounds = mapInstance.getBounds();
      const belowFloor = mapInstance.getZoom() < CHART_MIN_ZOOM;
      setChartOutsideCoverage(bounds.getSouth() > CHART_BOUNDS.north || belowFloor);
      setChartStraddlesEdge(
        !belowFloor && bounds.getSouth() <= CHART_BOUNDS.north && bounds.getNorth() > CHART_BOUNDS.north,
      );
    };
    update();
    mapInstance.on('moveend', update);
    mapInstance.on('zoomend', update);
    return () => {
      mapInstance.off('moveend', update);
      mapInstance.off('zoomend', update);
    };
  }, [chartBase, mapInstance]);

  // SCRUM-215: draw the 49.6 N clip as a rule, so the chart does not simply stop in the middle of
  // the water. It spans the chart's own coverage box and only paints while the chart base is on.
  useEffect(() => {
    if (!mapInstance || !chartBase) return;
    if (!mapInstance.getPane(CHART_EDGE_PANE)) {
      const pane = mapInstance.createPane(CHART_EDGE_PANE);
      pane.style.zIndex = '206';
      pane.style.pointerEvents = 'none';
    }
    const boundary = L.polyline(
      [
        [CHART_COVERAGE_MAX_LAT, CHART_BOUNDS.west],
        [CHART_COVERAGE_MAX_LAT, CHART_BOUNDS.east],
      ],
      {
        pane: CHART_EDGE_PANE,
        color: '#161b22',
        weight: 1.2,
        opacity: 0.5,
        dashArray: '6 6',
        interactive: false,
      },
    ).addTo(mapInstance);
    return () => {
      boundary.remove();
    };
  }, [chartBase, mapInstance, chartRetryCount]);

  // Nautical seamark overlay (SCRUM-175): its own pane, so the base map, the seamarks and the
  // wind layers stack in a fixed order however they are toggled.
  useEffect(() => {
    if (!mapInstance || !seamarksShown) return;
    if (!mapInstance.getPane(SEAMARK_PANE)) {
      const pane = mapInstance.createPane(SEAMARK_PANE);
      pane.style.zIndex = '210';
      // Tiles only paint here: clicks must still reach the map and the barbs.
      pane.style.pointerEvents = 'none';
    }
    const { url, options } = seamarkLayerConfig();
    const layer = L.tileLayer(url, options).addTo(mapInstance);
    return () => {
      layer.remove();
    };
  }, [mapInstance, seamarksShown]);

  // CHS NONNA bathymetry (SCRUM-205): its own pane above the chart and under the seamarks, so the
  // depth shading never covers the aids it gives context to, whichever toggle ran last.
  useEffect(() => {
    if (!mapInstance || !bcDepthVisible) return;
    if (!mapInstance.getPane(NONNA_PANE)) {
      const pane = mapInstance.createPane(NONNA_PANE);
      pane.style.zIndex = '208';
      // Tiles only paint here: clicks must still reach the map and the barbs.
      pane.style.pointerEvents = 'none';
    }
    const config = nonnaLayerConfig();
    if (config.kind !== 'wms') return;
    const layer = L.tileLayer.wms(config.url, config.options).addTo(mapInstance);
    return () => {
      layer.remove();
    };
  }, [mapInstance, bcDepthVisible]);

  return {
    chartBase,
    chartOutsideCoverage,
    chartStraddlesEdge,
    chartTilesFailed,
    retryChart,
  };
}

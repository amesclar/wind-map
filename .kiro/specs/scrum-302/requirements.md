# SCRUM-302 — Base-map failure notice

## Problem

When OpenStreetMap began refusing the app's tiles (SCRUM-288) the map showed a handful of tiles and
an empty background: no notice, no barbs, no explanation. A user cannot tell "the provider refused
us" from "the app is broken". The chart already says so (SCRUM-217), the base map did not — and the
restore of the OpenStreetMap bases (SCRUM-333) makes a silent refusal more likely, not less.

## Requirements

- R1 The selected base layer's `tileerror` events are counted per tile batch: three failures inside
  ten seconds raise the notice, one stray tile from a pan does not.
- R2 The notice names the base map ("The CARTO base map is not loading — try another base map."),
  uses the chart notice's placement and styling, and offers Retry, Map settings and Dismiss.
- R3 Retry remounts the layer and clears the state; a load batch with no failures clears it too, so a
  recovered provider needs no click.
- R4 A base change clears the state, and a dismissal covers that failure only.
- R5 The chart's failures never raise the base notice; they keep their own (SCRUM-217).
- R6 Normal use shows nothing: the notice appears only after a failing batch.

## Acceptance

One clear notice naming the base map when it cannot load, a working retry, no notice in normal use.

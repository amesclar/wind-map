import { describe, expect, it } from 'vitest';
import {
  POPUP_EDGE_PADDING,
  POPUP_OPTIONS,
  POPUP_TOP_PADDING,
  POPUP_TIP_TOLERANCE_PX,
  popupNudge,
  tipVisible,
} from './popupPlacement';

const container = { left: 0, top: 0, right: 800, bottom: 600 };

describe('popupNudge (SCRUM-252)', () => {
  it('leaves a pop-up that already fits alone', () => {
    expect(popupNudge({ left: 100, top: 200, right: 400, bottom: 420 }, container)).toEqual({ x: 0, y: 0 });
  });

  it('pulls a pop-up back inside the left and right edges', () => {
    expect(popupNudge({ left: -20, top: 200, right: 280, bottom: 420 }, container)).toEqual({ x: 32, y: 0 });
    expect(popupNudge({ left: 650, top: 200, right: 850, bottom: 420 }, container)).toEqual({ x: -62, y: 0 });
  });

  it('moves a pop-up below the reserved top strip and above the bottom edge', () => {
    expect(popupNudge({ left: 100, top: 40, right: 400, bottom: 260 }, container)).toEqual({ x: 0, y: 48 });
    expect(popupNudge({ left: 100, top: 500, right: 400, bottom: 640 }, container)).toEqual({ x: 0, y: -52 });
  });

  it('moves on both axes in a corner', () => {
    expect(popupNudge({ left: 750, top: 30, right: 950, bottom: 250 }, container)).toEqual({ x: -162, y: 58 });
  });
});

describe('popup placement options (SCRUM-252)', () => {
  it('reserves the edges and the top strip for every pop-up', () => {
    expect(POPUP_OPTIONS).toMatchObject({ autoPan: true, keepInView: true });
    expect(POPUP_OPTIONS.autoPanPaddingTopLeft).toEqual([POPUP_EDGE_PADDING, POPUP_TOP_PADDING]);
    expect(POPUP_OPTIONS.autoPanPaddingBottomRight).toEqual([POPUP_EDGE_PADDING, POPUP_EDGE_PADDING]);
  });

  it('keeps the tip for small nudges and hides it past the tolerance', () => {
    expect(tipVisible({ x: 0, y: 0 })).toBe(true);
    expect(tipVisible({ x: POPUP_TIP_TOLERANCE_PX, y: 0 })).toBe(true);
    expect(tipVisible({ x: 12, y: 12 })).toBe(false);
  });
});

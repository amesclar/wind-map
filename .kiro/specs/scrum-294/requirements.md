# SCRUM-294 Map key: explain glyph orientation

## User stories

1. As a sailor reading the map key, I want to know which way each glyph points, so I can tell the
   direction the wind comes from, the water flows and the waves travel without opening a pop-up.
2. As a screen-reader user, I want the same explanation in the key's label, so the key is not
   visual-only.

## Acceptance criteria (EARS)

**1.1** WHEN the map key is shown THEN it shall explain the wind barb's orientation with the line
`staff points where the wind comes from`, under the wind examples.

**1.2** WHEN the currents row is on THEN the key shall add `chevron points where the water flows`
under that row.

**1.3** WHEN the waves row is on THEN the key shall add `heads point where the waves travel` under
that row.

**1.4** WHEN the currents or waves layer is off THEN its explanation shall be absent with its row.

**1.5** WHEN a screen reader reads the key THEN its label shall carry the same three explanations,
in the same order as the rows, with each layer's unit.

**1.6** WHEN the key renders THEN the existing glyph examples, ranges, the `colour = temperature`
note and the `pointer-events-none` behaviour shall be unchanged.

**1.7** WHEN the key is drawn at 248 px wide and 9 px type THEN each explanation shall fit on one
line.

## Out of scope

- The glyphs themselves, their tier tables, pop-ups, the export footer and the wind colour legend.

# TODO Filter P2 Icon Toggle Fix Specification

Goal: Fix the issue where clicking the P2 filter doesn't switch the SVG icon to the brighter one.

## 1. Why

`p2_filter_active.svg` is used as the bright version of P2 filter but this is asymmetric with P0 (`p0.svg`) and P1 (`p1.svg`).
Also, `p2.svg` is currently filled with `#388E3C` (dark green), whereas `p2_dim.svg` uses `#2ECC71` with 0.35 opacity. This makes the inactive dim version look different from the active version, and the active version fails to show correctly if VS Code cannot resolve or cache `p2_filter_active.svg`.
We should unify P2 to use `p2.svg` for active and `p2_dim.svg` for inactive, with `p2.svg` containing the correct bright green `#2ECC71` fill.

## 2. Changes Made

- Update `package.json` line 288-290 to use `resources/p2.svg` instead of `resources/p2_filter_active.svg`.
- Update `resources/p2.svg` content to change the rect fill to `#2ECC71`.
- Delete `resources/p2_filter_active.svg`.

## 3. Verification

- Run test suite successfully.
- Re-compile the extension.

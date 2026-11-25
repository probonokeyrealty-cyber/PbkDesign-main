# Van Nuys Market Map pilot

House vs. ZIP shows the read-only map only for saved ZIP 91411. The map is available in the private PBK Command Center production build, its release-candidate Deploy Preview, and the original staging-indicators build. The separate staging charts and fictional trend panels remain preview-only. The Preview #111 QA fixture is not part of the staff release.

- Rent and home-value colors use fixed dollar bands and the bundled ACS 2020-2024 estimates. Hover reveals the estimate and 90% range. Gray means missing, not zero. These are area estimates, not asking prices or an appraisal.
- Tap a neighboring ZCTA or use its comparison button. The saved and selected ZCTAs remain visible, and **View comparison** takes focus to the results without changing the saved listing. Manual ZIP entry still works. The solid outline marks the saved ZCTA, not an exact house location.
- The county view shows Los Angeles County FIPS 06037 and the saved December 2025 BLS LAUS observation. It does not change the selected ZCTA or assign a county unemployment rate to each ZIP.
- Boundary polygons and label points are from Census TIGERweb's 2020 ZCTA and county layers. Display simplification is applied during import; the map is not a postal or parcel boundary reference.

The fixed-area pilot uses static SVG paths in a local Mercator projection rather than the Dialer's authenticated street map. No map tiles, secrets, or provider APIs are needed at runtime. Refresh the public boundary snapshot explicitly by running `node scripts/import-van-nuys-market-boundaries.mjs`; the script calls only Census TIGERweb. Do not run it as part of the app or a deployment.

For hosted release verification, open an existing saved 91411 lead in signed-in Chrome at 390 px. In **Market Comparison**, tap 91406 on the map and confirm the comparison opens, **View comparison** goes to the results, and the saved listing stays the same. Do not refresh property evidence or use a fixture for this sign-off.

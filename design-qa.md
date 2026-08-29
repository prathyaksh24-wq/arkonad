# Native TUI design QA

## Result

final result: passed

This result covers the terminal-native screens and keyboard interactions in this
change. It is not acceptance of a published cross-platform release, every Store
installation recipe, or the unported multi-agent/worktree screens.

## Visual evidence

- Source: `D:\CodexHome\generated_images\01a00353-650a-7f71-bfed-4872d7bc3a4c\exec-e393bd7d-1c10-43d1-9f5c-f60a77247ea8.png`.
- Selected design: original option 2, amber Store. The later tools/pets design is not the target.
- Implementation: `D:\CodexHome\visualizations\2026\08\15\01a00353-650a-7f71-bfed-4872d7bc3a4c\native-tui\store-120.png`.
- Combined comparison: the same directory's `source-and-native.png`.
- Additional captures: `home-80.png` and `store-50.png`.
- Refined native captures: `D:\CodexHome\visualizations\2026\08\15\01a00353-650a-7f71-bfed-4872d7bc3a4c\native-tui-refined\home-80.png`,
  `onboard-80.png`, `pets-80.png`, and `store-120.png`.
- Viewports: Store 120 columns x 40 rows; welcome 80 x 24; narrow Store 50 x 18.
- Source pixels: 1487 x 1058. Store buffer raster: 1440 x 960, using 12 x 24 pixel cells. No CSS viewport or browser density applies.
- Comparison normalization: source scaled proportionally to the implementation's height, without stretching; final combined image 2789 x 960. Pixel-perfect font matching is not claimed: the host terminal owns font size and cell metrics.
- State: amber Store, empty query, third row (OpenCode) selected. Mock installed counts and catalog names differ intentionally. The renderer capture has not run host detection and says so; it must not fabricate installed apps. Live terminal testing separately detected three installed tools.

The full comparison was opened together and all labels, key hints, row selection,
and detail text were readable. Separate focused crops were unnecessary at this
resolution. These PNGs come from the actual Ratatui TestBackend cell buffer,
not a browser or generated design. The QA rasterizer joins box glyphs at their
cell boundaries; the executable itself uses terminal box-drawing characters.

## Findings and comparison history

1. P2, fixed: short welcome/settings screens could hide the selected row. They
   now use a stateful table, with a regression test at 50 x 16. Smaller unsupported
   viewports show a resize message rather than inaccessible controls.
2. P2, fixed: compact welcome/settings keybars showed catalog-only hints. Their
   hints now describe the active screen; the welcome capture was regenerated.
3. Capture issue, fixed: GDI glyph bearings made the first QA raster show dashed
   borders although the native buffer contained continuous box glyphs. The
   rasterizer now connects cell edges, and the comparison preserves source aspect
   ratio. The revised full comparison was inspected.
4. Accepted: native rows are denser than the mock at this chosen terminal size.
   Users control the terminal's font/size. The 65/35 table/detail split, square
   frames, black background, amber text, reversed selected row, and bottom keybar
   are retained. Below 86 columns, the detail pane gives space to the list;
   publisher and installation details remain accessible through v and i.

No remaining P0/P1/P2 visual findings in the scoped native screens.

## Refined preview pass

The separate `C:\Users\User\arkonad-preview` build was used as an interaction
reference, not copied as a runtime. The landing command prompt, animated logo,
guided setup, six palettes, and half-block pets were brought into the existing
native modules. The following preview defects were corrected in this pass:

1. The 80 x 24 onboarding screen clips neither paths nor later setup steps.
   Detection comes from the shared catalog rather than a second hardcoded probe list.
2. Store install, update, adoption, and removal still use the existing review
   and explicit-Y approval flow; the preview's immediate package commands were not used.
3. `/term` uses full terminal handoff instead of a fixed 120 x 24 embedded PTY,
   so the user's shell owns the current terminal size and input until exit.
4. Session status does not claim network health. It reports only OS, terminal,
   shell, theme, pet, directory, and catalog detections available locally.
5. The landing screen avoids a sidebar, permanent tabs, web cards, gradients,
   rounded controls, and decorative panels. The original dense Store remains intact.

The four refined captures were opened at original resolution. Text, borders,
reverse selection, the onboarding progress row, status hints, and Gengar's
half-block sprite were readable at 80 x 24; the Store remained readable at
120 x 40. No remaining P0/P1/P2 visual findings were found in this pass.

## Fidelity surfaces

- Typography: monospace cells; Consolas in the QA raster, host font in use.
  Header/selection emphasis and column alignment are present. No web-font fetch.
- Layout: title, query/directory row, table, details, status, keybar. No sidebar,
  browser controls, rounded cards, permanent decorative panels, or pets pane.
- Colors: named theme tokens; amber is RGB 255/191/0 on black, with cyan notices.
  NO_COLOR is honored. Reverse video conveys selection without depending on hue.
- Assets: the selected Store has no raster illustrations to reproduce. Native
  borders and text are the UI, as the user requested; CRT glow is not simulated.
- Copy: actual catalog and executable detection, no fake versions, installation
  counts, progress, or success claims. Source-only entries say so. Install,
  update, adoption, and uninstall require review and a separate Y confirmation.

## Validation

- 53 native Rust tests passed: 49 library tests, two CLI tests, two settings tests.
- 104 tests passed with the retained desktop feature enabled.
- Native Clippy passed with warnings denied; Rust formatting checked.
- Release executable built and reported its version. Its PE subsystem is Windows
  console (3), not GUI. With NO_COLOR unset, the live terminal output used the
  configured 24-bit amber palette. Sending Ctrl+C to the waiting local child
  returned to Arkonad without terminating the parent.
- Retained TypeScript/Vite build passed, with the existing large-bundle warning.
- Source checks passed: native UI (7), bootstrap (9), release (11), legacy accessibility (9).
- PowerShell bootstrap failure tests passed for missing native assets, wrong
  checksum, unsigned download, and a conflicting existing version. Existing
  launcher/version files remained unchanged. Test-created scratch folders only
  were removed; no installed app was changed.
- PowerShell parser and POSIX shell syntax checks passed.
- Live Windows terminal: /opencode filtered the Store; opening PowerShell and
  running a marker command worked; exit restored the same filtered selection.
  The sandbox denied PowerShell history-file writes, not terminal input.
- Live isolated catalog child: a local codex.cmd fixture received stdin in the
  repository directory; exiting with code 23 restored Arkonad and showed that
  code. No provider request was involved in this fixture test.
- An initial provider launch encountered Codex's TERM=dumb warning; it was
  declined and returned to Arkonad. This is not evidence of a successful full
  coding-agent session. No prompts/tasks were sent to the provider.
- Renderer tests cover seven screens, dialogs, empty results, narrow/tiny
  terminals, selection visibility, search, and confirmation/cancellation.

## Remaining validation and scope

- Linux/macOS execution and Windows ARM64 need their native runners. The workflow
  defines those builds; it has not run or published a release in this task.
- Real publisher downloads, signing/notarization, and host installation were not
  performed. Most catalog entries remain publisher-instruction-only; only
  manifests with reviewed executable recipes can be installed by Arkonad.
- One foreground child at a time. Task/worktree management, concurrent agent
  supervision, integration previews, and workspace recovery remain available
  only in the retained desktop code, not these native screens.
- Screen-reader behavior and unusual emulator/font combinations need human QA.

## Implementation checklist

- [x] Native Rust default entry point; desktop is opt-in.
- [x] Original amber Store direction applied across native screens.
- [x] Shell/tool handoff, stdin, exit restoration, search, and review flows.
- [x] Existing catalog, installer, receipts, and settings reused.
- [x] Native build/bootstrap/release paths and local validation.
- [ ] Platform-runner, signed-release, publisher-install, and accessibility QA before publication.

Follow-up polish: terminal-host font tuning and optional richer welcome artwork
can be considered separately; neither should change the selected Store layout.

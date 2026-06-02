# Codex Instructions for Nightingale Trainer Fork

This is a fork of rzru/nightingale. Treat it as an existing Rust/Tauri/React/Python-ML app, not a greenfield project.

Primary objective:
Transform Nightingale into a serious singing-practice trainer while preserving existing karaoke functionality.

User-facing goals:
1. Add a large, readable Practice Mode / Training Mode.
2. Show expected pitch as large horizontal note bars.
3. Show live sung pitch as a thick visible trace.
4. Make pitch/rhythm feedback useful for improvement, not just scoring.
5. Add phrase looping and retry.
6. Add calibration and offset controls if missing or insufficient.
7. Improve UltraStar compatibility where practical.
8. Keep all processing local and avoid accounts/cloud/telemetry.

Constraints:
- Do not rewrite large parts of the app unless necessary.
- First locate the existing playback, pitch scoring, transcript, lyrics, and USDX code paths.
- Prefer incremental commits.
- Preserve existing party karaoke mode.
- Add a separate practice/training overlay or route before modifying default playback.
- Add tests for pure logic where possible.
- Do not add new paid services, signup flows, telemetry, or cloud processing.
- Keep GPL license compatibility.

Important technical areas to inspect:
- client/src for React playback UI, lyrics display, state management, scoring display.
- client/src-tauri for Tauri commands and microphone/pitch detection.
- app-core/src for library DB, analyzer orchestration, config, caching, USDX parsing, media provider logic.
- app-core/analyzer for Python ML analysis pipeline.
- xtask for build/dev command behavior.

Preferred first milestone:
Add a read-only Practice Overlay using existing song/playback/scoring data:
- toggleable from playback screen
- full-width/full-height pitch lane
- expected notes/lyrics visible
- live pitch trace visible
- phrase score prominent
- no analyzer changes unless existing data is insufficient

Before coding:
1. Map the current code flow.
2. Identify exact files/components/functions involved.
3. Write a short implementation plan.
4. Then modify the smallest set of files needed.

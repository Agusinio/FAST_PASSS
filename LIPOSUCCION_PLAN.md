# Plan of Attack: Extension Liposuction (Refactoring)

The goal is to move all business logic to JavaScript (JS) and leave ExtendScript (JSX) as a layer of "atomic" executors.

## General Principles
1. **Business Logic in JS**: Calculations, loops over complex data, path construction, and orchestration of multiple steps stay in JS.
2. **Strict Bridges**: All calls from JS *must* go through a `jsx_` bridge in `main.jsx`. No direct calls to `FASTPASS.Module.Method` from JS.
3. **Atomic JSX**: Each JSX function should do ONE thing (e.g., "import this file", "set this clip's start time").
4. **JSON exchange**: Pass data as JSON strings between environments.

## Phase 0: Standardization & JS Audit (CRITICAL)
- [ ] **Audit all `callJSX`**: Redirect direct module calls (e.g., `FASTPASS.Project.saveAs`) to bridges (e.g., `jsx_saveProjectAs`).
- [ ] **Fix `jsx_checkContextState`**: This bridge is currently commented out in `main.jsx`, breaking the UI status (NOU/OBRIR).
- [ ] **Unify naming**: Ensure JS calls `jsx_importFiles` (plural) as defined in the mapping, and that JSX accepts the JSON payload.
- [ ] **Path Normalization**: Move path cleaning (slashes, UNC) from `2_IO.jsx` to `js/logic/scanner.js` (`preparePathsForImport`).

## Phase 2: Project Management (`3_Project.jsx`)
- **Current State**: `activateProject` contains complex sequence searching and "surgical cleaning" of tabs.
- **Goal**: Move the sequence searching and decision-making to JS. JSX should just have `openSequence(id)` and `closeSequence(id)`.
- **Candidates**: `saveAs`, `cloneSequence`, `activateProject`.

## Phase 3: Timeline & Tracks (`4_Sequences.jsx`, `4_Tracks.jsx`, `4_Timeline.jsx`)
- **Current State**: Logic for track isolation and CTI safety is in JSX.
- **Goal**: Move "Isolate track X" logic (which involves looping through all tracks and muting them) to JS.
- **Candidates**: `isolateTrack_Strict`, `cleanTrack`.

## Phase 4: Clips & Keyframes (`4_Clips.jsx`, `4_KF.jsx`)
- **Current State**: `rippleTrimStart` and `setClipXPosition` calculate offsets and keyframe values.
- **Goal**: JS calculates the exact seconds/values. JSX just sets `clip.start`, `clip.inPoint`, or `v.setValueAtKey()`.
- **Candidates**: `rippleTrimStart`, `moveClipToTime`, `setXPosition`.

## Phase 5: Subtitles & Render (`6_Subtitles.jsx`, `5_Render.jsx`)
- **Current State**: `cleanIn` handles sorting and offsetting clips in a loop.
- **Goal**: JS gets the list of selected clips, calculates the new positions, and tells JSX to `moveClip(id, newTime)` for each one.
- **Candidates**: `cleanIn`, `cleanOut`, `exportSnapshot`.

## Task List for current session:
1. [x] Research and Plan.
2. [ ] Rename `importFiles` in `2_IO.jsx`.
3. [ ] Fix `main.jsx` and `4_Clips.jsx` calls.
4. [ ] Add `preparePathsForImport` to `scanner.js`.
5. [ ] Create `js/logic/project_manager.js` to handle Phase 2 logic.

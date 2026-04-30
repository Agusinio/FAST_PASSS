# Graph Report - .  (2026-04-30)

## Corpus Check
- 110 files · ~224,714 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 305 nodes · 337 edges · 19 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_jQuery Library|jQuery Library]]
- [[_COMMUNITY_Premiere Pro Typings|Premiere Pro Typings]]
- [[_COMMUNITY_CSInterface Typings|CSInterface Typings]]
- [[_COMMUNITY_Assembly Workflow|Assembly Workflow]]
- [[_COMMUNITY_Panel Extension Base|Panel Extension Base]]
- [[_COMMUNITY_Escaleta Cleaning|Escaleta Cleaning]]
- [[_COMMUNITY_Context Rendering|Context Rendering]]
- [[_COMMUNITY_Vulcan Library|Vulcan Library]]
- [[_COMMUNITY_Main Entry Point|Main Entry Point]]
- [[_COMMUNITY_Render Workflow|Render Workflow]]
- [[_COMMUNITY_SRT Logic|SRT Logic]]
- [[_COMMUNITY_Scene Detection|Scene Detection]]
- [[_COMMUNITY_Cut Workflow|Cut Workflow]]
- [[_COMMUNITY_Retols Workflow|Retols Workflow]]
- [[_COMMUNITY_KF Workflow|KF Workflow]]
- [[_COMMUNITY_Main Button Workflow|Main Button Workflow]]
- [[_COMMUNITY_System Typings|System Typings]]
- [[_COMMUNITY_CEP Engine Lib|CEP Engine Lib]]
- [[_COMMUNITY_Community 25|Community 25]]

## God Nodes (most connected - your core abstractions)
1. `Animation()` - 6 edges
2. `checkContext()` - 6 edges
3. `updateThemeWithAppSkinInfo()` - 5 edges
4. `evalScript()` - 5 edges
5. `Sizzle()` - 5 edges
6. `setMatcher()` - 5 edges
7. `matcherFromTokens()` - 5 edges
8. `done()` - 5 edges
9. `onLoaded()` - 4 edges
10. `toHex()` - 4 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities

### Community 0 - "jQuery Library"
Cohesion: 0.05
Nodes (33): actualDisplay(), addCombinator(), ajaxConvert(), ajaxHandleResponses(), Animation(), augmentWidthOrHeight(), condense(), createFxNow() (+25 more)

### Community 1 - "Premiere Pro Typings"
Cohesion: 0.06
Nodes (32): Anywhere, Application, AudioChannelMapping, colorSpace, Csxs, CsxsResourceCentral, Document, Encoder (+24 more)

### Community 2 - "CSInterface Typings"
Cohesion: 0.17
Nodes (21): ApiVersion(), AppSkinInfo(), ColorType(), ContextMenuItemStatus(), CSEvent(), CSInterface(), CSXSWindowType(), Direction() (+13 more)

### Community 3 - "Assembly Workflow"
Cohesion: 0.15
Nodes (8): callJSX(), clasificarItem(), findParentStructural(), getEffectiveDuradaSec(), getRawDuradaSec(), getUtils(), log(), parseDurada()

### Community 4 - "Panel Extension Base"
Cohesion: 0.2
Nodes (11): addRule(), computeValue(), evalScript(), loadJSX(), mySetProxyFunction(), onAppThemeColorChanged(), onClickButton(), onLoaded() (+3 more)

### Community 5 - "Escaleta Cleaning"
Cohesion: 0.29
Nodes (6): BuildJsonOutput(), FindAnchorBackward(), FindAnchorForward(), IsTemporalAnchor(), SerializeItem(), SerializeValue()

### Community 6 - "Context Rendering"
Cohesion: 0.36
Nodes (7): checkContext(), getUtils(), init(), log(), syncConductorUI(), updateButton(), updateLights()

### Community 7 - "Vulcan Library"
Cohesion: 0.4
Nodes (2): requiredParamsValid(), VulcanMessage()

### Community 8 - "Main Entry Point"
Cohesion: 0.53
Nodes (4): callContextAudit(), callWorkflow(), handleSelectionChange(), initPanel()

### Community 9 - "Render Workflow"
Cohesion: 0.47
Nodes (3): callJSX(), getUtils(), log()

### Community 10 - "SRT Logic"
Cohesion: 0.47
Nodes (3): callJSX(), getUtils(), log()

### Community 11 - "Scene Detection"
Cohesion: 0.7
Nodes (4): main(), readRGBFile(), splitScene(), writeToRGBFile()

### Community 13 - "Cut Workflow"
Cohesion: 0.6
Nodes (3): callJSX(), getUtils(), log()

### Community 14 - "Retols Workflow"
Cohesion: 0.6
Nodes (3): callJSX(), getUtils(), log()

### Community 18 - "KF Workflow"
Cohesion: 0.83
Nodes (3): callJSX(), getUtils(), log()

### Community 19 - "Main Button Workflow"
Cohesion: 0.83
Nodes (3): callJSX(), getUtils(), log()

### Community 20 - "System Typings"
Cohesion: 0.67
Nodes (2): quote(), str()

### Community 22 - "CEP Engine Lib"
Cohesion: 1.0
Nodes (2): getErrorResult(), getLastError()

### Community 25 - "Community 25"
Cohesion: 1.0
Nodes (1): CSXSEvent

## Knowledge Gaps
- **33 isolated node(s):** `CSXSEvent`, `ProjectItemType`, `SequenceSettings`, `AudioChannelMapping`, `colorSpace` (+28 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Vulcan Library`** (6 nodes): `Vulcan.js`, `GetValueByKey()`, `requiredParamsValid()`, `strStartsWith()`, `Vulcan()`, `VulcanMessage()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `System Typings`** (4 nodes): `1_System.jsx`, `f()`, `quote()`, `str()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `CEP Engine Lib`** (3 nodes): `CEPEngine_extensions.js`, `getErrorResult()`, `getLastError()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 25`** (2 nodes): `PlugPlugExternalObject.d.ts`, `CSXSEvent`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What connects `CSXSEvent`, `ProjectItemType`, `SequenceSettings` to the rest of the system?**
  _33 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `jQuery Library` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Premiere Pro Typings` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
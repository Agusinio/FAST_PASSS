/**
 * ============================================================================
 * WORKFLOW: ASSEMBLY (Alias retrocompatibles — v2.9.5 "LIPO-PRO")
 * ============================================================================
 * Aquest mòdul ha estat modularitzat en 4 dominis independents:
 *   - MP4     → js/workflows/flow_mp4.js      (segmentació, densitat)
 *   - Markers → js/workflows/flow_markers.js  (F1→F6: OnAir, Gràfics)
 *   - Chyrons → js/workflows/flow_chyrons.js  (conductor, ensamblatge)
 *   - Graphics → js/workflows/flow_graphics.js (CTI, debug, captura)
 *
 * Mantingut com a aliases per a compatibilitat amb codi existent
 * que referencia FASTPASS_UI.Workflows.Assembly.* directament.
 * ============================================================================
 */

(function () {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Workflows = FASTPASS_UI.Workflows || {};

    FASTPASS_UI.Workflows.Assembly = {

        // ── MP4 / Segmentació ──
        _calcDensityFootprint: function (clips) {
            return FASTPASS_UI.Workflows.MP4._calcDensityFootprint(clips);
        },
        debugBlockItems: async function (blockId) {
            return FASTPASS_UI.Workflows.MP4.debugBlockItems(blockId);
        },
        runInOutCrudo: async function () {
            return FASTPASS_UI.Workflows.MP4.runInOutCrudo();
        },
        placeRawMarkers: async function () {
            return FASTPASS_UI.Workflows.MP4.placeRawMarkers();
        },

        // ── Markers (F1→F6) ──
        _safePlaceByPrefixes: async function (placements, label) {
            return FASTPASS_UI.Workflows.Markers._safePlaceByPrefixes(placements, label);
        },
        placeOnAirMarkers: async function () {
            return FASTPASS_UI.Workflows.Markers.placeOnAirMarkers();
        },
        placeUngroupedMarkers: async function () {
            return FASTPASS_UI.Workflows.Markers.placeUngroupedMarkers();
        },
        placeDeducedOnAirMarkers: async function () {
            return FASTPASS_UI.Workflows.Markers.placeDeducedOnAirMarkers();
        },
        placeScheduledMarkers: async function () {
            return FASTPASS_UI.Workflows.Markers.placeScheduledMarkers();
        },
        correlationSnapMarkers: async function () {
            return FASTPASS_UI.Workflows.Markers.correlationSnapMarkers();
        },
        snapFaroMarkers: async function () {
            return FASTPASS_UI.Workflows.Markers.snapFaroMarkers();
        },
        snapOrphanMarkers: async function () {
            return FASTPASS_UI.Workflows.Markers.snapOrphanMarkers();
        },
        placeGraphicMarkers: async function () {
            return FASTPASS_UI.Workflows.Markers.placeGraphicMarkers();
        },
        placeInferredItems: async function () {
            return FASTPASS_UI.Workflows.Markers.placeInferredItems();
        },
        enforceMarkerOrder: async function () {
            return FASTPASS_UI.Workflows.Markers.enforceMarkerOrder();
        },
        _setupEstructural: async function () {
            return FASTPASS_UI.Workflows.Markers._setupEstructural();
        },
        _classifyItems: function (lines) {
            return FASTPASS_UI.Workflows.Markers._classifyItems(lines);
        },
        _calcTemporalAnchors: function (manifest, reader, structuralItems, clips) {
            return FASTPASS_UI.Workflows.Markers._calcTemporalAnchors(manifest, reader, structuralItems, clips);
        },
        _correlationSnap: function (markers, clips, densityData, manifestItems, reader) {
            return FASTPASS_UI.Workflows.Markers._correlationSnap(markers, clips, densityData, manifestItems, reader);
        },

        // ── Chyrons ──
        runAutoPlacement: async function (mainTrack) {
            return FASTPASS_UI.Workflows.Chyrons.runAutoPlacement(mainTrack);
        },
        runGuidedAssembly: async function () {
            return FASTPASS_UI.Workflows.Chyrons.runGuidedAssembly();
        },
        _getStructureFromMarkers: async function () {
            return FASTPASS_UI.Workflows.Chyrons._getStructureFromMarkers();
        },
        _logLearning: async function (ctx, aiIn, humanIn, aiOut, humanOut) {
            return FASTPASS_UI.Workflows.Chyrons._logLearning(ctx, aiIn, humanIn, aiOut, humanOut);
        },
        verifyTcRefFootprint: async function (refTime, tolerance) {
            return FASTPASS_UI.Workflows.Chyrons.verifyTcRefFootprint(refTime, tolerance);
        },

        // ── Graphics (CTI, Debug, Captura) ──
        updateBlocInFromCTI: async function () {
            return FASTPASS_UI.Workflows.Graphics.updateBlocInFromCTI();
        },
        updateBlocOutFromCTI: async function () {
            return FASTPASS_UI.Workflows.Graphics.updateBlocOutFromCTI();
        },
        runInOutCocinado: async function () {
            return FASTPASS_UI.Workflows.Graphics.runInOutCocinado();
        },
        placeCookedMarkers: async function () {
            return FASTPASS_UI.Workflows.Graphics.placeCookedMarkers();
        },
        capturaUsuarioInOut: async function () {
            return FASTPASS_UI.Workflows.Graphics.capturaUsuarioInOut();
        },
        capturaUsuarioMarks: async function () {
            return FASTPASS_UI.Workflows.Graphics.capturaUsuarioMarks();
        },
        _snapSimple: function (pos, clipCuts) {
            return FASTPASS_UI.Workflows.Graphics._snapSimple(pos, clipCuts);
        }
    };

    window.FASTPASS_UI.Workflows.Assembly = FASTPASS_UI.Workflows.Assembly;
})();
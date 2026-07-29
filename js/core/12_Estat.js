/**
 * ============================================================================
 * 12_Estat.js (Gestor d'Estat Global de la UI)
 * ============================================================================
 */
var FASTPASS_UI = FASTPASS_UI || {};

FASTPASS_UI.State = {
    themeClipName: "PENDENT",
    projectFolderPath: "",
    structure: [],
    pieceIndex: 0,
    srtWorkMode: false,
    isKeyframeMode: false,
    isWorking: false,
    activeSequenceName: null, 
    
    masterTheme: null, 
    srt: null,

    reset: function() {
        this.themeClipName = "PENDENT";
        this.structure = [];
        this.pieceIndex = 0;
        this.masterTheme = null;
        this.srt = null;
    }
};

window.FASTPASS_UI = FASTPASS_UI;
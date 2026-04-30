var FASTPASS_UI = FASTPASS_UI || {};

FASTPASS_UI.State = {
    themeClipName: "PENDENT",
    projectFolderPath: "",
    structure: [],
    pieceIndex: 0,
    srtWorkMode: false,
    isKeyframeMode: false,
    activeSequenceName: "",
    lastOpenedProjectName: "",
    
    masterTheme: null,
    srt: null,
    hierarchy: {}, // Mapa de lineID -> data (Fase 4 Mejora Eficiencia)

    reset: function() {
        this.themeClipName = "PENDENT";
        this.structure = [];
        this.pieceIndex = 0;
        this.masterTheme = null;
        this.srt = null;
        this.hierarchy = {};
        this.lastOpenedProjectName = "";
    }
};

window.FASTPASS_UI = FASTPASS_UI;
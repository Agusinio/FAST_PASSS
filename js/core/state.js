var FASTPASS_UI = FASTPASS_UI || {};

FASTPASS_UI.State = {
    themeClipName: "PENDENT",
    projectFolderPath: "",
    structure: [],
    pieceIndex: 0,
    srtWorkMode: false,
    isKeyframeMode: false,
    
    // Almacenamiento de clips activos (MasterTheme / SRT)
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
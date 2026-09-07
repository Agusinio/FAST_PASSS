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
    // MECÀNICA D'INICI (2026-09-04): data de treball explícita.
    //   'today' (defecte) | 'yesterday' (mode correcció amb Ctrl+clic a MAIN)
    workTarget: "today",
    
    masterTheme: null,
    srt: null,
    hierarchy: {}, // Mapa de lineID -> data (Fase 4 Mejora Eficiencia)

    // Fix 24: Cache del JSON d'escaleta parsejat per evitar múltiples parsejos
    // de fitxers de 7000+ línies (es parsejava fins a 5 cops per workflow).
    // Clau: { path, data, timestamp }
    _escaletaCache: null,

    // D11: Fase actual de colocació de marcadors (1-5).
    // Cada clic a MARCADORS avança una fase, permetent debug visual.
    //   F1: TC RAW    → faros a posició ideal exacta (sense snap)
    //   F2: SNAP      → F1 + snapToCutFaro (±10s)
    //   F3: COINC     → F2 + D3-COINC + FARO-START/END
    //   F4: APROX     → F3 + greedySnapshot bidireccional
    //   F5: COMPLET   → F4 + gràfics (Ronda 3) + validació D10/BIDIR
    markerPhase: 1,

    reset: function() {
        this.themeClipName = "PENDENT";
        this.structure = [];
        this.pieceIndex = 0;
        this.masterTheme = null;
        this.srt = null;
        this.hierarchy = {};
        this.lastOpenedProjectName = "";
        this.workTarget = "today";
        this.dateDir = null;
        this._escaletaCache = null;
        this.markerPhase = 1;
    }
};

window.FASTPASS_UI = FASTPASS_UI;
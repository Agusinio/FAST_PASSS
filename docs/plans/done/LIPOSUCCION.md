


// --- BOOTSTRAP ---

jsx_BOOTSTRAP               replace, load, evalfile


// --- IO & SYSTEM ---

jsx_scanDirectory           *scanDirectory                       getFiles, push, getTime
jsx_getProjectFolder        getProjectFolder
jsx_focusProject            activateProjectscandirectory
jsx_openProject             openProject
jsx_importFile              *importSingleFile                    parse, decode, replace, push, createBin, importFiles
jsx_prepFlowData            getConfig, getFormattedDate         getDate, getMonth, getFullYear
jsx_updateConfig            updateConfig
jsx_createFolder            create

                            validateNetworkPaths                fileExists, push
                            verifyItems                         parse, findItemInProject
                            deleteFile                          remove


// --- PROJECT ---

jsx_anchorWorkProject       ...
jsx_getSequenceList         getSequenceList                     push
jsx_renameSequence          renameSequence
jsx_openTemplate            openTemplate                        openDocument
jsx_cloneSequence           cloneSequence
jsx_openSequence            openSequence                        openSequence
jsx_findOrCreateBin         createBin *                         createBin
jsx_renameActiveSequence    ...
jsx_checkFileExists         ...
jsx_saveProject             save
jsx_saveProjectAs           saveAs                              create, saveAs, 
jsx_checkItemExists         checkItemExists
jsx_focusProjectPanel       focusProjectPanel                   select
jsx_setWorkProjectByPath    ...

                            findRootBin
                            getTargetProject
                            saveSigned                          getConfig, getFormattedDate, create, saveAs
                            openProject                         openDocument, decode
                            activateProject                     select, replace, enableQE, openSequence, getActiveSequence, close, openSequence
                            createInitialClone                  getTargetProject, clone
                            renameAndMoveClone                  getTargetProject, moveBin
                            cleanupStrays                       deleteBin
                            _findBin 
                            findItemInProject                   search
                            getItemFromBin                      findRootBin
                            importFileAtomic                    importFiles
                            findLargeChyron                     getMediaPath
                            findLargeChyronVerbose              findLargeChyron !!!!
                            getProjectDir
                            nuclearRefresh
jsx_ensureProjectFocus                                          openDocument


// --- SEQUENCE --

jsx_nuclearRefresh          nuclearRefresh                      getPlayerPosition, setPlayerPosition
jsx_getCTI                  getCTI                              getPlayerPosition
jsx_setCTI_Safe             setCTI                              Time, setPlayerPosition
jsx_setSequenceInOut        setInOut                            Time, setInPoint, setOutPoint
jsx_setPlayerPosition_QE    setCTI_QE                           enableQE, getActiveSequence, setSeconds


// --- TIMELINE ---

                            _getClipAtTime
                            getClipInfoUnderCTI                 getPlayerPosition


// --- TRACKS ---

jsx_setTargetedTrack        setTarget                           setTargeted
jsx_cleanTrack              cleanAfterTime
jsx_unlockAllVideoTracks    unlockAll                           setLocked
jsx_unmuteAllVideoTracks    unmuteAll                           setMute
jsx_isolateTrack_Strict     isolate
jsx_setTrackMuteState       setMute                             setMute


// --- CLIPS --

jsx_syncSelection           syncSelection                       getAtTime, getPlayerPosition, setSelected
jsx_placeMp4OnV1            placeMp4                            importSingleFile, findItemInProject, overwriteClip
jsx_overwriteClip           overwriteByName                     findItemInProject, Time, overwriteClip
jsx_rippleTrimClipStart     rippleTrimStart                     Time
jsx_moveClipToTime          moveToTime                          Time, parseFloat
jsx_rippleTrimClipEnd       rippleTrimEnd                       Time, getAtTime
                            getAtTime
                            detectScenes                        setSelected, performSceneEditDetectionOnSelection


// --- CHYRONS ---

jsx_getChyronCreationDates  getMetadataDates
jsx_findThemeTitleClipName  findThemeTitleClipName


// --- MOTION & KF ---

jsx_setClipXPosition        setXPosition                        _getTargetPositionProp, getPlayerPosition, isTimeVarying, addKey, setValueAtKey, setValue
jsx_getClipXPosition        getPositionX, OJO! getXPosition     _getTargetPositionProp, getValueAtTime, getPlayerPosition
jsx_getKFData               getKFData                           _getTargetPositionProp, isTimeVarying, getKeyTime, getValueAtTime, push
jsx_addKeyframe             addKeyframeAtCurrentTime            _getTargetPositionProp, getPlayerPosition, isTimeVarying, setTimeVarying, addKey
jsx_applyExtremeKF          applyExtremeCurvesAtTime            _getTargetPositionProp, addKey, setValueAtKey, getValueAtTime, setKFInterp, deleteKFAtTime
jsx_applyIntermediateKF     applyIntermediateCurvesAtTime       _getTargetPositionProp, setKFInterp
                            getMotion
                            deleteKFAtTime                      getKeys, removeKey
                            setKFInterp                         getKeys, setInterpolationTypeAtKey
                            _getTargetPositionProp              getAtTime, getPlayerPosition


// --- GRAPH ---

jsx_applyGraph16_9_Preset   apply169
jsx_findAndPlaceChyron      placeChyron
jsx_getClipNameAtTime       getClipNameAtTime                   getAtTime
jsx_exportSnapshot_CurrentTime  exportSnapshot


// --- SRT ---
 
jsx_srtCleanIn              cleanIn                             _getSubtTrack, remove, push
jsx_srtCleanOut             cleanOut                            _getSubtTrack, remove
jsx_getSelectedSubtitleClips    getSelectedClips                push
jsx_applySubtitleChanges    applyChanges                        _getSubtTrack
jsx_renderActiveSequence    addToAME
                            getClipNameAt                       _getSubtTrack
                            findNextClipStart                   _getSubtTrack


// --- DEBUGG ---

jsx_debugPosition           getClipPositionDebug
jsx_getTargetingDebug       getTargetingDebug
jsx_reflectTrack            reflectTrackProperties
jsx_getKFDiagnostic         runFullReport                       getPlayerPosition, getKeys, isTimeVarying

// --- ESTABILITZACIÓ WORKFLOWS (31/03/2026) ---
// S'ha completat la fase de "Liposucció" dels workflows principals (MainButton).
// Tota la lògica pesada d'infraestructura s'ha mogut a Project_Logic.js.

Project_Logic.create         Orquestra plantilla, bins, ingesta i sequences.
Project_Logic.ingestAssets   Unifica ingesta de Wotts, Media (MP4/SRT) i Portada (PNG).
Project_Logic.lock           Centralitza la creació de fitxers .lock.

// Millores Atòmiques en JSX (3_Project.jsx, 5_Tracks.jsx, 6_Clips.jsx):
// - Robustesa en l'escapat de caràcters (decodeURIComponent).
// - Track Targeting unificat (V1/A1).
// - Inserció condicionada de MP4 si el track està buit.

---
© 2026 FAST >>> PASS | Lògica Depurada i Estabilitzada.
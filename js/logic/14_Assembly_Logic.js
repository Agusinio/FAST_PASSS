/**
 * ============================================================================
 * LOGIC: ASSEMBLY (Orquestació de muntatge i acabats) - v2.6.1 literal
 * ============================================================================
 */

(function() {
    var FASTPASS_UI = window.FASTPASS_UI || {};
    FASTPASS_UI.Logic = FASTPASS_UI.Logic || {};

    const utils = {
        callJSX: (s) => window.FASTPASS_UI.Utils.callJSX(s),
        log: (m) => window.FASTPASS_UI.Utils.log(m, "DEBUG"),
        delay: (ms) => window.FASTPASS_UI.Utils.delay(ms),
        escape: (s) => window.FASTPASS_UI.Utils.escape(s),
        timeToSeconds: (tc) => window.FASTPASS_UI.Utils.timeToSeconds(tc)
    };

    FASTPASS_UI.Logic.Assembly = {
        
        /**
         * setup: Orquestra el muntatge decoratiu base (Temes, SRTs, Chyrons).
         */
        setup: async function(state) {
            utils.log("🏗️ Assembly: Orquestrant muntatge decoratiu...");
            const cfg = window.FASTPASS_UI.Config.get();
            
            // 1. TEMA-TITOL (V4)
            if (state.masterTheme) {
                await window.Clips.insert(state.masterTheme.name, cfg.tracks.video.tematitol, 0.0);
            }

            // 2. SRT (V5)
            if (state.srt) {
                await window.Clips.insert(state.srt.name, cfg.tracks.subtitle.s1, 0.0);
            }
            
            // 3. CHYRON MASTER (V6)
            const masterChyronRaw = await utils.callJSX("Project.biggestIn('CHYRONS')");
            const masterChyron = JSON.parse(masterChyronRaw || "null");
            
            if (masterChyron) {
                utils.log(`🎯 Chyron principal detectat: ${masterChyron.name}`);
                await window.Clips.insert(masterChyron.name, cfg.tracks.video.chyrons, 0.4, 6.6);
            }

            return "OK_SETUP";
        },

        /**
         * freeze: Genera el freeze frame final automatitzat.
         */
        freeze: async function(targetTime = 6.6) {
            utils.log(`📸 Assembly: Generant Freeze Frame a ${targetTime}s...`);
            const cfg = window.FASTPASS_UI.Config.get();
            const T_THEME = cfg.tracks.video.tematitol;

            // 1. Aïllament visual de la pista de Temes
            await window.Tracks.isolate(T_THEME, "video");
            await window.Timeline.set(targetTime);
            await utils.delay(1000);

            // 2. Captura orquestrada (Literal: Context.folder)
            const folder = await utils.callJSX("Context.folder()");
            const snapPath = `${folder}\\Snapshots\\freeze_${Date.now()}.png`.replace(/\\/g, "\\\\");
            const res = await window.Render.capture(snapPath, targetTime);
            
            // 3. Restauració de visibilitat
            await window.Tracks.all("video", "mute", false);

            // 4. Importació i "Smart Insert"
            if (res.success) {
                const fileName = snapPath.split("\\\\").pop();
                const payload = JSON.stringify([snapPath]);
                // Literal: IO.importFiles
                await utils.callJSX(`IO.importFiles('${payload}', 'root')`);
                
                // Literal: Timeline.duration()
                const dur = await utils.callJSX("Timeline.duration()");
                await window.Clips.insert(fileName, T_THEME, targetTime, dur);
                return "OK_FREEZE";
            }
            return "ERR_FREEZE";
        },

        /**
         * conductor: Insereix el grafisme del conductor.
         */
        conductor: async function(conductorFile, targetTime = 7.6) {
            if (!conductorFile) return "NO_CONDUCTOR";
            const cfg = window.FASTPASS_UI.Config.get();
            const pathRaw = `${cfg.rutas.conductors}${conductorFile}`;
            
            utils.log(`👤 Assembly: Inserint conductor ${conductorFile}`);
            const payload = JSON.stringify([pathRaw.replace(/\\/g, "\\\\\\\\")]);  // corregit doble escape
            // Literal: IO.importFiles
            await utils.callJSX(`IO.importFiles('${payload}', 'root')`);
            await window.Clips.insert(conductorFile, cfg.tracks.video.chyrons, targetTime);
            
            return "OK_CONDUCTOR";
        },

        /**
         * calcFootprintDelta: Calcula el decalatge mig entre posició ideal i posició real
         * dels NomCarrec d'un bloc. Retorna 0 si no hi ha ancoratges disponibles.
         *
         * @param {Object} block  - Bloc amb array block.chyrons
         * @param {Array}  clips  - Array de clips del bloc (blockClips)
         * @returns {number} Desplaçament mig en segons
         */
        calcFootprintDelta: function(block, clips) {
            const anchors = [];
            for (const c of block.chyrons) {
                if ((c.rol || '').toUpperCase() !== "NOMCARREC") continue;
                const idealPos = clips[0].start + utils.timeToSeconds(c.tc);
                const candidate = clips.find(clip =>
                    clip.start <= (idealPos + 2) &&
                    clip.start >= (idealPos - 2) &&
                    (clip.end - clip.start) > 2.5
                );
                if (candidate) {
                    anchors.push({ delta: candidate.start - idealPos });
                }
            }
            return anchors.length > 0
                ? anchors.reduce((s, a) => s + a.delta, 0) / anchors.length
                : 0;
        },

        /**
         * findCandidateClip: Busca el clip més adient per col·locar un chyron a idealPos.
         * Optimitat amb cerca binària (Fase 2).
         *
         * @param {Array}  clips    - Array de clips del bloc
         * @param {number} idealPos - Temps ideal en segons
         * @param {Object} [opts]   - { minMarginBefore, minMarginAfter }
         * @returns {Object} Clip candidat
         */
        findCandidateClip: function(clips, idealPos, opts) {
            const minMarginBefore = (opts && opts.minMarginBefore !== undefined) ? opts.minMarginBefore : 0.5;
            const minMarginAfter  = (opts && opts.minMarginAfter  !== undefined) ? opts.minMarginAfter  : 3.0;

            // 1. Cerca binària per trobar el clip que comença just abans o a idealPos
            const idx = window.FASTPASS_UI.Utils.binarySearchForTime(clips, idealPos, 'start');
            const candidate = clips[idx];

            // 2. Validació de marges del candidat trobat
            if (candidate && 
                candidate.start <= idealPos + 0.1 && 
                candidate.end >= idealPos - 0.1 &&
                (candidate.end - candidate.start) > 2.5 &&
                (idealPos - candidate.start) >= minMarginBefore &&
                (candidate.end - idealPos) >= minMarginAfter) {
                return candidate;
            }

            // 3. Fallback: Si el candidat binari no és perfecte, fem un escaneig proper (±2 clips)
            // en lloc de filtrar tot l'array de clips.
            for (let i = Math.max(0, idx - 1); i <= Math.min(clips.length - 1, idx + 1); i++) {
                const c = clips[i];
                if (c.start <= idealPos + 0.1 && c.end >= idealPos - 0.1 && (c.end - c.start) > 2.5) {
                    return c;
                }
            }

            // 4. Darrer recurs: primer clip del bloc
            return clips[0];
        },

        /**
         * classifyChyrons: Classifica els chyrons d'un bloc per tipus:
         * temaTitols, traduccions, otros. També detecta si hi ha NomCarrec i Firma.
         *
         * Centralitza els 5+ llocs on s'usava c.name.includes("Tema-Titol").
         *
         * @param {Array} chyrons - Array de chyrons del bloc
         * @returns {{ temaTitols, traduccions, otros, hasNom, hasFirma }}
         */
        classifyChyrons: function(chyrons) {
            const temaTitols = [];
            const traduccions = [];
            const otros = [];
            let hasNom = false;
            let hasFirma = false;

            for (const c of chyrons) {
                if (c.name.includes("Tema-Titol") || c.name.includes("TITOL")) {
                    temaTitols.push(c);
                } else if (
                    (c.rol || '').toUpperCase().includes("TRADUCCIO") ||
                    c.name.toUpperCase().includes("TRADUCCIO")
                ) {
                    traduccions.push(c);
                } else {
                    otros.push(c);
                }
                if ((c.rol || '').toUpperCase() === "NOMCARREC") hasNom = true;
                if (c.name.includes("Firma")) hasFirma = true;
            }

            return { temaTitols, traduccions, otros, hasNom, hasFirma };
        },

        /**
         * calcDensityFootprint: Analitza la freqüència de talls de V1 per zones
         * temporals i detecta les "ruptures de patró" (HIGH→LOW o LOW→HIGH)
         * que solen indicar l'inici d'un nou ítem d'escaleta.
         *
         * Algoritme:
         *   1. Divideix el clip en finestres temporals de `windowSec` segons.
         *   2. Compta els talls (inicis de clip) dins de cada finestra → talls/min.
         *   3. Classifica cada finestra com HIGH (ràpid, VTR/pieza editada)
         *      o LOW (lent, directe/plató) usant `thresholdCutsPerMin`.
         *   4. Identifica els punts on el tipus canvia (HIGH↔LOW) → rupturas de patró.
         *      Cada ruptura es el tall real del V1 més proper al límit de finestra.
         *
         * @param {Array}  clips              - Array de clips de V1 {start, end}
         * @param {number} [windowSec=30]     - Mida de la finestra deslizant en segons
         * @param {number} [thresholdCutsPerMin=4] - Umbral per classificar HIGH vs LOW
         * @returns {{ zones: Array, breaks: Array, totalDuration: number }}
         *   zones:  [{start, end, cutsPerMin, type:'HIGH'|'LOW'}]
         *   breaks: [{time, fromType, toType, clipIdx}]  ← candidats a inici d'ítem
         */
        calcDensityFootprint: function(clips, windowSec, thresholdCutsPerMin) {
            windowSec = windowSec !== undefined ? windowSec : 30;
            thresholdCutsPerMin = thresholdCutsPerMin !== undefined ? thresholdCutsPerMin : 4;

            if (!clips || clips.length === 0) {
                return { zones: [], breaks: [], totalDuration: 0 };
            }

            const totalDuration = clips[clips.length - 1].end - clips[0].start;
            const timelineStart = clips[0].start;

            // 1. Construir finestres
            const zones = [];
            let windowStart = timelineStart;
            while (windowStart < timelineStart + totalDuration) {
                const windowEnd = windowStart + windowSec;

                // Comptar inicis de clip dins d'aquesta finestra
                // (el primer inici de clip és simplement el primer tall visible)
                let cutsInWindow = 0;
                for (const clip of clips) {
                    // Un tall és l'inici d'un clip (excepte el primer clip de la finestra)
                    if (clip.start > windowStart && clip.start < windowEnd) {
                        cutsInWindow++;
                    }
                }

                const cutsPerMin = (cutsInWindow / windowSec) * 60;
                const type = cutsPerMin >= thresholdCutsPerMin ? 'HIGH' : 'LOW';

                zones.push({
                    start: windowStart,
                    end: Math.min(windowEnd, timelineStart + totalDuration),
                    cutsPerMin: parseFloat(cutsPerMin.toFixed(2)),
                    type
                });

                windowStart = windowEnd;
            }

            // 2. Detectar rupturas de patró (canvis HIGH↔LOW entre finestres consecutives)
            const breaks = [];
            for (let i = 1; i < zones.length; i++) {
                const prev = zones[i - 1];
                const curr = zones[i];
                if (prev.type !== curr.type) {
                    // Trobar el tall real de V1 més proper al límit de finestra
                    const boundary = prev.end;
                    let closestCut = boundary;
                    let closestIdx = -1;
                    let minDist = Infinity;

                    for (let j = 0; j < clips.length; j++) {
                        const dist = Math.abs(clips[j].start - boundary);
                        if (dist < minDist && dist <= windowSec * 0.5) {
                            minDist = dist;
                            closestCut = clips[j].start;
                            closestIdx = j;
                        }
                    }

                    breaks.push({
                        time: closestCut,
                        fromType: prev.type,
                        toType: curr.type,
                        clipIdx: closestIdx
                    });
                }
            }

            utils.log(`📊 [DensityFootprint] ${zones.length} zones (window=${windowSec}s, llindar=${thresholdCutsPerMin} talls/min), ${breaks.length} ruptures detectades`);
            breaks.forEach(b => {
                utils.log(`   🔀 Ruptura ${b.fromType}→${b.toType} a ${b.time.toFixed(2)}s (clip #${b.clipIdx})`);
            });

            return { zones, breaks, totalDuration };
        },

        /**
         * _resolveTrackForWott: Determina la pista de video destí segons el rol del wott.
         *
         * Regles de routing (valors reals del Profile.json):
         *   - Tema-Titol / TITOL       → tematitol (V5 al Profile.json actiu)
         *   - SENYAL / ENVIAT / EN DIRECTO → llocdata (V7 al Profile.json actiu)
         *   - Altres (Nomcarrec, Conductor, Firma, Directe presencial, ...) → chyrons (V6 al Profile.json actiu)
         *
         * NOTA: No es fa servir "DIRECTE" sol perquè apareix en descripcions
         *       de convidats presencials (ex: "Donapas directe") que NO són
         *       senyals remotes. Només es considera "senyal remota" quan el
         *       token específic SENYAL, ENVIAT o EN DIRECTO és present.
         *
         * @param {string} name - Nom complet del fitxer wott
         * @param {Object} cfg  - Configuració activa (FASTPASS_UI.Config.get())
         * @returns {number} Índex de pista de video (1-based)
         */
        _resolveTrackForWott: function(name, cfg) {
            const upper = name.toUpperCase();
            // Tema-Titol / _TITOL → tematitol
            if (upper.includes("TEMA-TITOL") || upper.includes("_TITOL")) {
                return cfg.tracks.video.tematitol;
            }
            // Senyal remota / enviada / en directo → llocdata
            // NO s'usa "DIRECTE" sol per evitar falsos positius (ex: "Donapas directe")
            if (upper.includes("_SENYAL_") || upper.includes("_ENVIAT_") || upper.includes("EN DIRECTO")) {
                return cfg.tracks.video.llocdata;
            }
            // Default: Nomcarrec, Conductor, Firma, Directe presencial, etc. → chyrons
            return cfg.tracks.video.chyrons;
        },

        /**
         * _findMarkerForLineID: Troba el marcador del timeline que correspon a un lineID de wott.
         *
         * Regles (per ordre de prioritat):
         *   1. EXCEPCIÓ DP+Enviat/PRESENCIAL: Si el lineID conté "DP" (Donapas)
         *      I el nom del wott conté "ENVIAT" o "PRESENCIAL", busca el marker de
         *      CONNEXIÓ (comments conté "CONEXIÓ" o "CONNEXIO") més proper DESPRÉS
         *      del marker de secció del DP. Això situa els wotts de senyal enviada/
         *      presencial al punt de connexió en lloc del seu marker de secció.
         *   2. Per defecte, busca un marker de SECCIÓ el label del qual comenci
         *      exactament pel lineID complet (ex: "01lead - LEAD..." per a "01LEAD").
         *   3. Fallback: marker el label del qual comenci amb el prefix numèric del bloc
         *      (per a lineIDs curts com "02" sense sufix de secció).
         *
         * NOTA: Tots els markers del sistema tenen labels que comencen amb dígit
         *       (ex: "01 - CONEXIÓ", "01c - CONNEXIO", "01dp - Donapas...").
         *       Per tant NO es pot usar "label no comença per dígit" per identificar
         *       markers estructurals. En lloc d'això, es busca per contingut "CONEXIÓ"
         *       al comments del marker.
        /**
         * resolveHierarchy: Construeix el mapa de jerarquia (Fase 4).
         * Analitza les línies d'escaleta i els marcadors per crear relacions
         * instantànies entre lineIDs, seccions i connexions.
         *
         * @param {Array} escaletaItems - Llista d'items d'escaleta (des del Manifest)
         * @returns {Object} El mapa de jerarquia
         */
        resolveHierarchy: function(escaletaItems) {
            const hierarchy = {};
            if (!escaletaItems) return hierarchy;

            for (const item of escaletaItems) {
                if (!item.num) continue;
                const lineID = item.num.toUpperCase();
                
                // Determinar bloc (els primers 2 dígits)
                const blockNum = lineID.substring(0, 2);
                
                hierarchy[lineID] = {
                    id: lineID,
                    block: blockNum,
                    title: item.titol,
                    isSection: !!item.teVideo,
                    isConnexion: (item.font === 'CONN' || item.font === 'OFT')
                };
            }
            
            window.FASTPASS_UI.State.hierarchy = hierarchy;
            utils.log(`🏗️ Jerarquia resolta: ${Object.keys(hierarchy).length} ítems mapejats.`);
            return hierarchy;
        },

        /**
         * _findMarkerForLineID: Troba el marcador del timeline que correspon a un lineID de wott.
         * Optimitat amb consulta a Jerarquia (Fase 4).
         */
        _findMarkerForLineID: function(lineID, markers, wottName) {
            const upperLine = lineID.toUpperCase();
            const hierarchy = window.FASTPASS_UI.State.hierarchy || {};
            const hData = hierarchy[upperLine];

            // --- CAS ESPECIAL: DP (Donapas) + ENVIAT/PRESENCIAL ---
            const upperName = (wottName || "").toUpperCase();
            const isDpEnviatPresencial = /DP/i.test(upperLine) && (upperName.includes("ENVIAT") || upperName.includes("PRESENCIAL"));
            
            if (isDpEnviatPresencial) {
                const dpMarker = markers.find(m => (m.comments || m.name || "").toUpperCase().startsWith(upperLine));
                if (dpMarker) {
                    const dpTime = dpMarker.time;
                    const conexioMarkers = markers
                        .filter(m => {
                            const label = (m.comments || m.name || "").toUpperCase();
                            return label.includes("CONEXIÓ") || label.includes("CONNEXIO");
                        })
                        .sort((a, b) => Math.abs(a.time - dpTime) - Math.abs(b.time - dpTime));

                    if (conexioMarkers.length > 0) return conexioMarkers[0];
                    return dpMarker;
                }
            }

            // --- CAS GENERAL: Consulta directa ---
            const sectionMarker = markers.find(m => {
                const label = (m.comments || m.name || "").toUpperCase().trim();
                return label === upperLine || label.startsWith(upperLine + " ") || label.startsWith(upperLine + "\t");
            });

            if (sectionMarker) return sectionMarker;

            // Fallback numèric
            const numMatch = upperLine.match(/(\d+)/);
            if (numMatch) {
                const numericLabel = markers.find(m => {
                    const label = (m.comments || m.name || "").toUpperCase().trim();
                    const numPrefix = numMatch[1];
                    return label === numPrefix || label.startsWith(numPrefix + " ") || label.startsWith(numPrefix + "\t");
                });
                if (numericLabel) return numericLabel;
            }

            return null;
        },

        /**
         * runGuidedAssembly: Automatitza el muntatge de rètols basat en marcadors i noms de fitxer.
         *
         * Lògica de matching:
         *   - Cada wott s'ancora al seu marker de SECCIÓ pel lineID complet
         *     (ex: "01LEAD" → marker "01lead - LEAD BONIQUISME...").
         *   - EXCEPCIÓ: wotts amb "DP" (Donapas) que continguin "ENVIAT" o "PRESENCIAL"
         *     al nom s'ancoren al marker de CONNEXIÓ més proper després del seu
         *     marker de secció. La resta de wotts de Donapas es queden al seu marker.
         *   - Filtra Tema-Titol amb durada < 1s (són descartables, ~25 frames).
         *
         * Suporta 2 formats de nom de fitxer:
         *   - Antic: `..._ID_HH-MM-SS_...`  (guions, 3 parells → hores-minuts-segons)
         *   - Actual: `..._ID_MM.SS_...`     (punt, 2 parells → minuts.segons)
         *   Ex: `Wott_TNV_v1_01lead_00.15_LEAD BONIQUISME...` → lineID=01LEAD, offset=15s
         */
        runGuidedAssembly: async function() {
            utils.log("🤖 Iniciant Assembly Guiat per Marcadors (Optimitzat)...");
            const cfg = window.FASTPASS_UI.Config.get();

            // 1. Recollir Marcadors del Timeline
            const markersRaw = await utils.callJSX("Markers.get()");
            let markers = [];
            try { markers = JSON.parse(markersRaw || "[]"); } catch(e) { }
            
            if (markers.length === 0) {
                utils.log("⚠️ No s'han trobat marcadors a la seqüència activa.", "WARN");
                return "ERR_NO_MARKERS";
            }

            // 2. Recollir Wotts del Bin CHY
            const wottsRaw = await utils.callJSX("FASTPASS.Project.items('CHY')");
            let wotts = [];
            try { wotts = JSON.parse(wottsRaw || "[]"); } catch(e) { }

            if (wotts.length === 0) {
                utils.log("⚠️ El bin CHY està buit.", "WARN");
                return "ERR_NO_WOTTS";
            }

            utils.log(`📊 Processant ${wotts.length} rètols contra ${markers.length} marcadors...`);

            // --- FASE 3: Pre-compilació de RegExp ---
            const reFormat = /_([A-Z0-9]+)_(\d{2})[.-](\d{2})(?:[.-](\d{2}))?/i;
            const reTema = /TEMA-TITOL|_TITOL/i;
            const reDp = /DP/i;
            const reEnviat = /ENVIAT|PRESENCIAL/i;

            let count = 0;
            let skippedCount = 0;

            // --- FASE 1: Batching de Comandos ---
            window.FASTPASS_UI.Utils.Batch.begin();

            for (const wott of wotts) {
                const name = wott.name;
                
                // Regex flexible: lineID alfanumèric + TC amb separador . o -
                const match = name.match(reFormat);
                
                if (!match) {
                    continue;
                }

                const lineID = match[1].toUpperCase();
                let offset;

                if (match[4] !== undefined) {
                    // 3 parells: HH-MM-SS o HH.MM.SS (format antic)
                    offset = (parseInt(match[2], 10) * 3600) + (parseInt(match[3], 10) * 60) + parseInt(match[4], 10);
                } else {
                    // 2 parells: MM.SS o MM-SS (format actual amb punts)
                    offset = (parseInt(match[2], 10) * 60) + parseInt(match[3], 10);
                }

                // === FILTRE: Tema-Titol de curta durada (< 1s) ===
                if (reTema.test(name)) {
                    const duration = (typeof wott.duration === 'number') ? wott.duration : 0;
                    if (duration > 0 && duration < 1.0) {
                        skippedCount++;
                        continue;
                    }
                }

                // === TROBAR MARCADOR PER AL WOTT ===
                const marker = FASTPASS_UI.Logic.Assembly._findMarkerForLineID(lineID, markers, name);
                
                if (!marker) {
                    continue;
                }

                const targetTrack = FASTPASS_UI.Logic.Assembly._resolveTrackForWott(name, cfg);
                const targetTime = marker.time + offset;
                
                // Aquest 'insert' s'encolarà automàticament al batch
                await window.Clips.insert(name, targetTrack, targetTime);
                count++;
            }

            // Executar tots els inserts de cop
            await window.FASTPASS_UI.Utils.Batch.flush();

            const skipMsg = skippedCount > 0 ? ` (${skippedCount} Tema-Titol curts descartats)` : '';
            utils.log(`✅ Assembly Guiat finalitzat. S'han col·locat ${count} rètols${skipMsg}.`);
            return "OK_GUIDED_" + count;
        }
    };

    // Alias global literal
    window.Assembly = FASTPASS_UI.Logic.Assembly;

    window.FASTPASS_UI = FASTPASS_UI;
})();

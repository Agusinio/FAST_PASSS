/** 
 * =================================================================================
 * Utils.js - VERSIÓ ULTRA-ATÒMICA (Pla LIPO)
 * =================================================================================
 */
(function() {
    var csInterface = new CSInterface();
    window.FASTPASS_UI = window.FASTPASS_UI || {};
    
    window.FASTPASS_UI.Utils = {
        isJsxReady: false,
        csInterface: csInterface,

        _logBuffer: [],
        _debugLogPath: null,
        // Auditoria de crides JSX: registra cada script enviat a Premiere per poder
        // comparar les accions REALS amb les que el codi pretén executar.
        _auditBuffer: [],
        _auditPath: null,
        // ── 📊 PERF (FASE 0 · TEMPORAL 2026-09-16) ─────────────────────────
        // Instrumentació per mesurar el coll d'ampolla del slider de reencuadre.
        // NO altera cap comportament: només compta temps, bytes i crides.
        // Retirar (o posar _perfOn = false) quan ja no calgui.
        _perfOn: true,
        _ioStats: { n: 0, ms: 0, maxMs: 0, bytes: 0, logN: 0, auditN: 0, syncN: 0, asyncN: 0, blockMs: 0 },
        _jsxStats: { n: 0, byPrefix: {}, other: 0 },
        // ── 🚀 FASE 2 (2026-09-16): I/O fora del camí calent ───────────────
        // Mesura Fase 0: 206 escriptures / 2411 ms / 35 MB reescrits en un barrido
        // de 4,5 s (54% del temps) — writeFile de CEP és SÍNCRON i va a un share
        // de xarxa. Ara s'acumulen línies i s'escriuen amb Node fs.appendFile
        // ASÍNCRON com a molt 1 cop cada _ioFlushMs; ERROR/forceLog forcen flush.
        _ioFlushMs: 400,
        _logPending: [],
        _auditPending: [],
        _ioTimer: 0,
        _fsMod: undefined,
        _fsKind: '',
        // Filtre de logs per tema: string amb keywords separades per coma o null (desactivat).
        // Quan està actiu, log() NOMÉS escriu els missatges que continguin alguna keyword.
        // ⚠️ TEMPORAL (2026-09-04): DESACTIVAT per poder veure els logs del botó Main
        // (diagnòstic deriva IN del MP4). Per reactivar el filtre: setLogFilter('DoblePantalla')
        // o setLogFilter('Main, ProgramStart, sweet') des de la consola del panell.
        _logFilter: null,

        /**
         * Activa el filtre de logs per tema. Ex: setLogFilter('DoblePantalla') o
         * setLogFilter('Chyrons, PAS') o setLogFilter('') per desactivar.
         */
        setLogFilter: function(keywords) {
            this._logFilter = (keywords && String(keywords).trim()) ? String(keywords).split(',').map(function(k) { return k.trim().toLowerCase(); }).filter(Boolean) : null;
            this.log("🎛️ Filtre de logs: " + (this._logFilter ? this._logFilter.join(', ') : 'DESACTIVAT'), "DEBUG");
        },

        clearLogFilter: function() {
            this.setLogFilter("");
        },

        /**
         * Inicialitza (o reinicia) el fitxer de log per al projecte actiu.
         * Es crida des de _runNew() i _runLoad() per tenir un log per projecte.
         * @param {string} folderPath - Ruta absoluta a la carpeta del projecte (ex: \\...\\09_06_2026\)
         * @param {string} projectName - Nom del fitxer .prproj (ex: Pruebas_TNV_V1_TEMA.prproj)
         */
        _setLogPath: function(folderPath, projectName) {
            // 🚀 FASE 2: abans de canviar de fitxer, buida el que quedi pendent.
            this._ioFlushNow();
            var normalized = folderPath.replace(/\\/g, '\\').replace(/\/$/, '');
            // Log comú a la carpeta PROVES (per seguir qualsevol projecte des d'un únic fitxer obert a l'editor)
            var provIdx = normalized.toUpperCase().indexOf('\\PROVES\\');
            if (provIdx > 0) {
                normalized = normalized.substring(0, provIdx) + '\\PROVES';
            }
            this._debugLogPath = normalized + '\\FASTPASS.log';
            this._logBuffer = [];
            this._logPending = [];          // 🚀 FASE 2
            try {
                window.cep.fs.writeFile(this._debugLogPath, '');
            } catch(e) {}
            // Fitxer d'auditoria de crides JSX (sense filtre de tema)
            this._auditPath = normalized + '\\FASTPASS_audit.log';
            this._auditBuffer = [];
            this._auditPending = [];        // 🚀 FASE 2
            try {
                window.cep.fs.writeFile(this._auditPath, '');
            } catch(e) {}
            this.log("📄 Log iniciat per a: " + projectName, "DEBUG");
        },

        /**
         * Retorna timestamp ISO local: [YYYY-MM-DD HH:MM:SS]
         */
        _timestamp: function() {
            var d = new Date();
            var pad = function(n) { return (n < 10 ? '0' : '') + n; };
            return '[' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
                   ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ']';
        },

        // ── 📊 PERF (FASE 0 · TEMPORAL 2026-09-16) ─────────────────────────
        /** Reinicia els comptadors de mesura (I/O i crides JSX). */
        _perfReset: function() {
            this._ioStats = { n: 0, ms: 0, maxMs: 0, bytes: 0, logN: 0, auditN: 0, syncN: 0, asyncN: 0, blockMs: 0 };
            this._jsxStats = { n: 0, byPrefix: {}, other: 0 };
        },

        /**
         * _timedWrite: window.cep.fs.writeFile mesurant quant triga i quants bytes
         * reescriu. El writeFile de CEP és SÍNCRON i les rutes de log viuen en un
         * share de xarxa (UNC) → aquesta mesura és la que ha de dir si l'I/O és el
         * coll d'ampolla del slider.
         * @param {string} path
         * @param {string} data
         * @param {string} kind - 'log' | 'audit' (per al desglossament)
         */
        _timedWrite: function(path, data, kind) {
            var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            var res = null;
            try { res = window.cep.fs.writeFile(path, data); } catch(eIO) { res = null; }
            if (this._perfOn) {
                var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                var s = this._ioStats;
                var d = t1 - t0;
                s.n++; s.ms += d; if (d > s.maxMs) s.maxMs = d;
                s.syncN++; s.blockMs += d;      // escriptura SÍNCRONA: temps bloquejant la UI
                s.bytes += (data ? data.length : 0);
                if (kind === 'audit') { s.auditN++; } else { s.logN++; }
            }
            return res;
        },

        // ── 🚀 FASE 2: escriptura diferida i asíncrona ─────────────────────
        /**
         * _nodeFs: objecte `fs` de Node si està disponible.
         * Ordre de detecció (cascada, per cobrir totes les configuracions de CEP):
         *  1. window.cep_node.require  → API oficial CEP 10+ (NO cal --mixed-context)
         *  2. require (global)         → context mixt / CEP 9
         *  3. window.cep.node.require  → variants antigues
         * Es guarda també _fsKind per poder diagnosticar-ho des del informe PERF.
         */
        _nodeFs: function() {
            if (this._fsMod !== undefined) return this._fsMod;
            var fs = null, kind = 'cep.fs(sync)';
            try { if (window.cep_node && window.cep_node.require) { fs = window.cep_node.require('fs'); if (fs) kind = 'cep_node'; } } catch(e1) { fs = null; }
            if (!fs) { try { if (typeof require === 'function') { fs = require('fs'); if (fs) kind = 'require'; } } catch(e2) { fs = null; } }
            if (!fs) { try { if (window.cep && window.cep.node && window.cep.node.require) { fs = window.cep.node.require('fs'); if (fs) kind = 'cep.node'; } } catch(e3) { fs = null; } }
            if (!fs) { fs = null; }
            this._fsMod = fs;
            this._fsKind = kind;
            return fs;
        },

        /**
         * _writeNow: escriu les línies acumulades a disc.
         * - Amb Node fs  → appendFile ASÍNCRON (no bloqueja el fil de la UI).
         * - Sense Node   → writeFile de CEP (síncron), però només 1 cop per flush.
         * @param {string} path
         * @param {string[]} pending - línies noves (es buiden aquí)
         * @param {string} kind - 'log' | 'audit'
         */
        _writeNow: function(path, pending, kind) {
            if (!path || !pending || pending.length === 0) return;
            var lines = pending.splice(0, pending.length);
            var data = lines.join('\n') + '\n';
            var fs = this._nodeFs();
            if (fs && fs.appendFile) {
                var self = this;
                var t0 = this._perfOn ? ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) : 0;
                var bytes = data.length;
                try {
                    fs.appendFile(path, data, function (err) {
                        if (!self._perfOn) return;
                        var t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                        var s = self._ioStats;
                        s.n++; s.asyncN++; s.ms += (t1 - t0); s.bytes += bytes;
                        if (kind === 'audit') { s.auditN++; } else { s.logN++; }
                    });
                    return;
                } catch(eAp) { /* cau al fallback síncron */ }
            }
            // Sense Node fs: reescriure el buffer SENCER (comportament clàssic de CEP),
            // però ara només 1 cop per flush en comptes de 1 cop per missatge.
            var full = (kind === 'audit') ? this._auditBuffer : this._logBuffer;
            this._timedWrite(path, full.join('\n') + '\n', kind);
        },

        /**
         * _ensureExtLogPath: Ruta del fitxer de log local de l'extensió. S'usa com a
         * fallback quan encara no hi ha projecte (fase prèvia a CREAR: FOTO,
         * checkContext, semàfors) o quan forceLog no té fitxer de projecte.
         * La primera vegada el fitxer es deixa NET (log de sessió, sense barrejar
         * amb execucions anteriors).
         */
        _ensureExtLogPath: function() {
            if (this._extLogPath) return this._extLogPath;
            // (2026-09-22) ABANS només es provava window.location.href: durant l'ARRENCADA del
            // panell (les línies ⏱️ [BOOT]) encara no està resolta → la ruta era null i
            // utils.log DESCARTAVA aquells missatges (no es veien enlloc). Ara es prova primer
            // la ruta nativa de l'extensió (el mateix mètode que fa servir main.js).
            var candidates = [];
            try {
                if (this.csInterface && typeof SystemPath !== 'undefined' && SystemPath.EXTENSION) {
                    var ext = this.csInterface.getSystemPath(SystemPath.EXTENSION);
                    if (ext) candidates.push(String(ext).replace(/[\\/]+$/, ''));
                }
            } catch (eExt) { }
            try {
                var href = window.location.href;
                var qi = href.indexOf('/index.html');
                if (qi > 0) {
                    var p = decodeURIComponent(href.substring(0, qi));
                    if (p.indexOf('file:///') === 0) p = p.substring(8);
                    candidates.push(p.replace(/\//g, '\\'));
                }
            } catch (eHref) { }
            for (var i = 0; i < candidates.length; i++) {
                var full = candidates[i] + '\\_keyframe_trace.log';
                try {
                    window.cep.fs.writeFile(full, '');
                    this._logBuffer = [];
                    this._extLogPath = full;
                    return full;
                } catch (eW) { }
            }
            return this._extLogPath;
        },

        /** Buida immediatament els pendents de log i auditoria. */
        _ioFlushNow: function() {
            if (this._ioTimer) { clearTimeout(this._ioTimer); this._ioTimer = 0; }
            // FIX (2026-09-16): sense projecte assignat, el log va al fitxer local de l'extensió.
            var logPath = this._debugLogPath || this._ensureExtLogPath();
            if (logPath && this._logPending.length) { this._writeNow(logPath, this._logPending, 'log'); }
            if (this._auditPath && this._auditPending.length) { this._writeNow(this._auditPath, this._auditPending, 'audit'); }
        },

        /** Agenda un flush diferit (com a molt 1 cada _ioFlushMs). */
        _ioSchedule: function() {
            if (this._ioTimer) return;
            var self = this;
            // Sense Node el writeFile de CEP és SÍNCRON i reescriu el fitxer SENCER:
            // el cost per escriptura creix amb la mida del log → s'allarga l'interval
            // perquè el temps bloquejant per segon es mantingui petit i constant.
            var ms = this._ioFlushMs;
            if (!this._nodeFs()) {
                ms = 400 + Math.min(3000, this._logBuffer.length * 2);
            }
            this._ioTimer = setTimeout(function () {
                self._ioTimer = 0;
                self._ioFlushNow();
            }, ms);
        },

        /**
         * _jsxLabel: etiqueta curta d'un script JSX per al desglossament del
         * comptador (ex: "Anim.sliderApply", "Registry.poll").
         */
        _jsxLabel: function(script) {
            try {
                var m = /([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(script);
                return m ? m[1] : 'altres';
            } catch(e) { return 'altres'; }
        },

        /** Compta una crida JSX realment enviada a Premiere (desglossada per etiqueta). */
        _jsxCount: function(script) {
            if (!this._perfOn) return;
            var s = this._jsxStats;
            s.n++;
            var k = this._jsxLabel(script);
            if (s.byPrefix[k] === undefined) {
                if (Object.keys(s.byPrefix).length >= 30) { s.other++; return; }
                s.byPrefix[k] = 0;
            }
            s.byPrefix[k]++;
        },

        // ── DEDUPLICACIÓ DE MISSATGES REPETITS ─────────────────────────────
        // Un error dins d'un poll es repeteix molts cops per segon (cas real:
        // 2.029 línies idèntiques → 1,1 MB de log en una sessió). Aquí, si el
        // mateix missatge es repeteix dins de LOG_DEDUPE_MS, no s'escriu; només
        // se n'imprimeix 1 de cada LOG_DEDUPE_EVERY repeticions (amb comptador).
        LOG_DEDUPE_MS: 5000,
        LOG_DEDUPE_EVERY: 100,
        _logDedupe: {},
        _logDedupeCount: 0,

        log: function(msg, level) { 
            // Filtre de logs per tema (estalvia tokens/ruido al chat).
            // Els missatges de nivell ERROR sempre es mostren.
            if (this._logFilter && level !== "ERROR") {
                var filter = this._logFilter;
                if (typeof filter === "string") filter = [String(filter).toLowerCase()];
                var _m = String(msg).toLowerCase();
                var _match = false;
                for (var _i = 0; _i < filter.length; _i++) {
                    if (_m.indexOf(String(filter[_i]).toLowerCase()) !== -1) { _match = true; break; }
                }
                if (!_match) return;
            }

            // Deduplicació: només suprimeix repeticions EXACTES seguides.
            // Un missatge únic s'escriu sempre; les repeticions ràpides s'agrupen.
            var _key = String(msg);
            var _now = Date.now();
            var _d = this._logDedupe[_key];
            if (_d && (_now - _d.last) < this.LOG_DEDUPE_MS) {
                _d.n++;
                _d.last = _now;
                if ((_d.n % this.LOG_DEDUPE_EVERY) !== 0) return;
                msg = _key + '  [repetit x' + _d.n + ']';
            } else {
                this._logDedupe[_key] = { last: _now, n: 1 };
                // Poda periòdica: primer treure les entrades caducades; si tot i això
                // n'hi ha massa (molts missatges únics seguits), reiniciar el mapa.
                if (++this._logDedupeCount > 500) {
                    var _cut = _now - this.LOG_DEDUPE_MS;
                    var _live = 0;
                    for (var _k in this._logDedupe) {
                        if (this._logDedupe[_k].last < _cut) { delete this._logDedupe[_k]; }
                        else { _live++; }
                    }
                    if (_live > 400) { this._logDedupe = {}; }
                    this._logDedupeCount = 0;
                }
            }

            const colors = { "INFO": "🔵", "DEBUG": "🟢", "ERROR": "🔴", "WARN": "🟡" };
            var ts = this._timestamp();
            var formatted = ts + ' ' + (colors[level || "INFO"] || '🔵') + ' [FASTPASS]: ' + msg;
            console.log(formatted);
            // Escriure al fitxer de debug del projecte perquè el Cline pugui llegir-lo.
            // FIX (2026-09-16): en la fase PRÈVIA al projecte (FOTO, checkContext,
            // semàfors, ESCALETA...) no hi ha cap fitxer assignat i aquests missatges
            // només anaven a la consola del panell → impossibles de diagnosticar.
            // Ara, si no hi ha fitxer de projecte, s'escriuen al fitxer local de
            // l'extensió (_ensureExtLogPath), amb el mateix flush diferit.
            var _logPath = this._debugLogPath || this._ensureExtLogPath();
            if (_logPath) {
                this._logBuffer.push(formatted);
                this._logPending.push(formatted);     // 🚀 FASE 2: acumula
                // Els ERRORs s'escriuen sempre de seguida (no es poden perdre).
                if (level === "ERROR") { this._ioFlushNow(); } else { this._ioSchedule(); }
            }
        },

        clearLogFile: function() {
            this._logBuffer = [];
            this._logPending = [];          // 🚀 FASE 2
            this._auditPending = [];        // 🚀 FASE 2
            if (this._ioTimer) { clearTimeout(this._ioTimer); this._ioTimer = 0; }
            if (this._debugLogPath) {
                try {
                    window.cep.fs.writeFile(this._debugLogPath, '');
                    this.log("🧹 Log file reiniciat", "DEBUG");
                } catch(e) {}
            }
        },

        /**
         * forceLog: Escriu SEMPRE al console i al fitxer FASTPASS.log, saltant-se
         * el filtre de tema (_logFilter). Útil per a traçes de diagnòstic.
         */
        forceLog: function(msg) {
            try {
                var ts = this._timestamp();
                var formatted = ts + ' 🟢 [FASTPASS]: ' + msg;
                console.log(formatted);
                // Mateix camí per als dos casos (FIX 2026-09-16): amb projecte escriu al
                // log del projecte; sense projecte, _ioFlushNow resol el fitxer local de
                // l'extensió (_ensureExtLogPath) → els missatges de diagnòstic previs a
                // CREAR ja no es perden a la consola.
                this._logBuffer.push(formatted);
                this._logPending.push(formatted);   // 🚀 FASE 2
                this._ioFlushNow();                 // diagnòstic: escriptura immediata
            } catch(e) {}
        },

        /**
         * Pont asíncron cap al motor ExtendScript (JSX).
         */
        callJSX: function(script, opts) {
            // opts.rawError: si true, un ERR de JSX es retorna TAL QUAL (per poder
            // distingir "error de transport" de "resposta buida"). Per defecte es
            // manté el comportament clàssic (ERR → "[]") per no alterar els llamants.
            var rawError = !!(opts && opts.rawError);
            // Auditoria: registra cada script enviat a Premiere (per poder comparar
            // les accions reals amb el que el codi pretén executar)
            if (this._auditPath) {
                try {
                    var _auditLine = this._timestamp() + " JSX> " + script;
                    this._auditBuffer.push(_auditLine);
                    this._auditPending.push(_auditLine);   // 🚀 FASE 2: acumula
                    this._ioSchedule();                    // 🚀 FASE 2: flush diferit
                } catch(e) {}
            }
            // Si estem en mode batching i NO és una crida de consulta crítica (com Anim.x), encolar
            if (this.Batch._isBatching && !script.includes("Anim.x") && !script.includes(".get") && !script.includes(".active")) {
                this.Batch._queue.push(script);
                return Promise.resolve("QUEUED");
            }

            this._jsxCount(script);   // 📊 FASE 0: compta la crida real a Premiere

            return new Promise(function(resolve) {
                var isAnimX = script.indexOf("Anim.x") !== -1;
                var safeScript = "try{" + script + "}catch(e){'ERR:'+e.message}";
                csInterface.evalScript(safeScript, function(res) {
                    if (!res || res === "undefined") {
                        resolve("");
                    } else if (res.indexOf("ERR:") === 0) {
                        window.FASTPASS_UI.Utils.log("💥 [JSX ERROR]: " + res, "ERROR");
                        resolve(rawError ? res : "[]");
                    } else {
                        resolve(res);
                    }
                });
            });
        },

        /**
         * Sistema de Batching per a comandes JSX (Fase 1 Mejora Eficiencia)
         */
        Batch: {
            _queue: [],
            _isBatching: false,
            begin: function() { 
                this._isBatching = true; 
                this._queue = [];
                window.FASTPASS_UI.Utils.log("📥 Batching JSX iniciat...", "DEBUG");
            },
            flush: async function() {
                if (this._queue.length === 0) {
                    this._isBatching = false;
                    return "EMPTY";
                }
                const fullScript = this._queue.join(";\n");
                const count = this._queue.length;
                this._queue = [];
                this._isBatching = false;
                
                window.FASTPASS_UI.Utils.log(`📤 Enviant batch de ${count} comandes...`, "DEBUG");
                return await window.FASTPASS_UI.Utils.callJSX(fullScript);
            }
        },

        /**
         * Algoritme de cerca binària per a llistes ordenades per temps (Fase 2)
         */
        binarySearchForTime: function(list, time, timeKey = 'start') {
            let low = 0;
            let high = list.length - 1;
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                const midTime = list[mid][timeKey];
                if (midTime === time) return mid;
                if (midTime < time) low = mid + 1;
                else high = mid - 1;
            }
            return high; // Retorna l'índex immediatament anterior o coincident
        },

        /**
         * _decodeName: Desfà l'URL-encoding que ExtendScript pot aplicar a
         * File.name en rutes UNC (ex: 'Pruebas_TNC_V1_CAP%20POLICIA.prproj').
         * Sense això els noms no coincideixen amb els del projecte obert
         * (Project.path() dóna el nom real) i el context conclou LOAD en
         * comptes d'UPDATE → els semàfors no es calculen i queden apagats.
         * @param {string} name
         * @returns {string}
         */
        _decodeName: function(name) {
            var n = String(name === null || name === undefined ? '' : name);
            if (n.indexOf('%') === -1) return n;
            try { return decodeURIComponent(n); } catch (e) { return n; }
        },

        readFolder: async function(path) {
            // ── FILTRAT PER DATA DE CREACIÓ (2026-09-07) ───────────────────────
            // Els fitxers del NAS (wotts .mov, portades .png, SRT...) poden tenir el
            // mtime DESPLAÇAT per processos nocturns (ex: 02:31 del dia següent).
            // La data FIABLE és la de CREACIÓ (creationTime / File.created), que cap
            // procés modifica. Per això en rutes UNC es llegeix SEMPRE via JSX
            // (scanDirectory → File.created) i mai s'usa mtime com a created.
            //
            // ⚠️ (2026-09-22) INTENT DESCARTAT d'optimitzar-ho amb cep.fs.readdir +
            // cep.fs.stat també en UNC: en aquesta màquina el stat sobre UNC NO dóna
            // creationTime → created quedava buit → filterByWorkDate descartava TOTS
            // els wotts/portades ("69 -> 0, NO datables") i no es col·locava res.
            // Revertit al JSX. Si es vol tornar a intentar, cal PRIMER verificar que
            // cep.fs.stat('./ruta UNC') retorna creationTime.
            // ── CONTRACTE (F1, 2026-10-01) ──────────────────────────────────────
            //   Array (fins i tot []) = lectura OK ([ ] = carpeta buida DE DEBÒ)
            //   null                  = la lectura ha FALLAT (pont/motor/permisos)
            // Els cridaners han de comprovar `!result` per distingir-ho: un null
            // MAI s'ha de tractar com "no hi ha res" sense avisar l'usuari.
            var isUnc = (path || '').indexOf('\\\\') === 0 || (path || '').indexOf('//') === 0;
            if (isUnc) {
                return await this._readFolderViaJsx(path);   // pot ser null (F1)
            }

            // Rutes locals: CEP (més ràpid). creationTime directe; mai mtime com a created.
            var result = window.cep.fs.readdir(path);
            if (result.err === 0) {
                var filenames = result.data;
                var filesWithStats = [];
                var folderPath = path.replace(/[\\/]*$/, "\\");
                var needCreated = [];

                for (var i = 0; i < filenames.length; i++) {
                    var name = filenames[i];
                    var fullPath = folderPath + name;
                    var stat = window.cep.fs.stat(fullPath);
                    var created = (stat.err === 0) ? stat.data.creationTime : null;
                    filesWithStats.push({
                        name: this._decodeName(name),
                        mtime: (stat.err === 0) ? stat.data.mtime : 0,
                        created: created
                    });
                    if (!created || isNaN(created) || created === 0) needCreated.push(name);
                }

                // Si CEP no exposa creationTime (comú), completar amb File.created via JSX.
                if (needCreated.length > 0) {
                    var jsxMap = await this._scanDirectoryMap(path);
                    if (jsxMap) {
                        for (var j = 0; j < filesWithStats.length; j++) {
                            var it2 = jsxMap[filesWithStats[j].name];
                            if (!it2) continue;
                            if (!filesWithStats[j].created || isNaN(filesWithStats[j].created) || filesWithStats[j].created === 0) {
                                filesWithStats[j].created = it2.created || 0;
                            }
                        }
                    }
                }
                return filesWithStats;
            } else {
                this.log(`CEP error ${result.err} leyendo carpeta, intentando via JSX: ${path}`, "DEBUG");
                return await this._readFolderViaJsx(path);
            }
        },

        /**
         * _scanDirectoryMap: Llista la carpeta via JSX (File.created) i la retorna
         * com a mapa name → { modified, created, size }.
         *
         * ── F1 (2026-10-01) · LECTURA FALLIDA ≠ CARPETA BUIDA ─────────────────
         * Retorna `null` NOMÉS quan la lectura ha FALLAT:
         *   · el pont no ha retornat res ('' / undefined),
         *   · error del motor ('ERR…'),
         *   · la crida ha quedat encuada pel Batching ('QUEUED'),
         *   · el motor diu 0 fitxers MENTRE CEP n'hi veu (readdir) → llistat perdut.
         * Un mapa buit (`{}`) vol dir carpeta buida de debò.
         * ABANS, qualsevol d'aquests errors es convertia en una llista buida
         * silenciosa → el panell creia "no hi ha rètols del bloc" i els botons de
         * chyrons quedaven morts sense cap pista (cas real 2026-10-01: 0 wotts
         * importats tot i haver-hi 24 .mov del bloc V1 al NAS).
         * @param {string} path
         * @returns {Promise<Object|null>} mapa (pot ser {}) o null si ha FALLAT
         */
        _scanDirectoryMap: async function(path) {
            // Testimoni independent del motor: cep.fs.readdir (barat, sense stats
            // per fitxer) diu quants fitxers hi hauria d'haver.
            var expected = null;
            try {
                var rd = window.cep.fs.readdir(path);
                if (rd && rd.err === 0 && rd.data) expected = rd.data.length;
            } catch (eRd) { expected = null; }

            var items = null;
            try {
                // rawError:true → els ERR del motor arriben TAL QUAL (no es
                // converteixen en "[]", que és el que amagava la fallada).
                var raw = await this.callJSX(`IO.scanDirectory('${this.escape(path)}')`, { rawError: true });
                if (raw === 'QUEUED') {
                    this.log('❌ [FS] Lectura FALLIDA: la crida ha quedat encuada pel Batching: ' + path, 'ERROR');
                    return null;
                }
                if (raw === undefined || raw === null || raw === '') {
                    this.log('❌ [FS] Lectura FALLIDA (el pont no ha retornat res): ' + path +
                        ' · CEP hi veu ' + (expected === null ? '?' : expected) + ' fitxers', 'ERROR');
                    return null;
                }
                if (String(raw).indexOf('ERR') === 0) {
                    this.log('❌ [FS] Error del motor llistant ' + path + ': ' + String(raw).substring(0, 80), 'ERROR');
                    return null;
                }
                items = JSON.parse(raw);
            } catch (e) {
                this.log(`💥 Error en scanDirectory JSX (${path}): ${e.message}`, "ERROR");
                return null;
            }

            if (!items || items.length === 0) {
                // El motor diu buit. Si CEP hi veu fitxers, la lectura s'ha perdut.
                if (expected && expected > 0) {
                    this.log('❌ [FS] Lectura INCOMPLETA de ' + path + ': el motor diu 0 fitxers i CEP n\'hi veu ' +
                        expected + ' → es descarta (NO es tracta com a carpeta buida)', 'ERROR');
                    return null;
                }
                return {};   // carpeta buida de debò
            }
            if (expected !== null && items.length !== expected) {
                this.log('⚠️ [FS] Llistat parcial de ' + path + ': motor=' + items.length + ' · CEP=' + expected, 'WARN');
            }

            var map = {};
            for (var k = 0; k < items.length; k++) {
                map[items[k].name] = {
                    modified: items[k].modified || 0,
                    created: items[k].created || 0,
                    size: items[k].size || 0
                };
            }
            return map;
        },

        /**
         * _readFolderViaJsx: Llegeix la carpeta completament via JSX (rutas UNC).
         * created prové de File.created (data de creació real, fiable).
         * @returns {Promise<Array|null>} [] = carpeta buida · null = lectura FALLIDA
         */
        _readFolderViaJsx: async function(path) {
            var jsxMap = await this._scanDirectoryMap(path);
            if (!jsxMap) return null;   // F1: fallada (null) ≠ carpeta buida ([])
            var out = [];
            for (var name in jsxMap) {
                if (!jsxMap.hasOwnProperty(name)) continue;
                var it = jsxMap[name];
                out.push({ name: this._decodeName(name), mtime: it.modified, created: it.created, size: it.size });
            }
            return out;
        },

        /**
         * Crea directoris de forma recursiva al NAS/Local des de JS
         */
        ensureFolders: function(path) {
            const fs = window.cep.fs;
            let normalizedPath = path.replace(/\//g, '\\');
            let parts = normalizedPath.split('\\');
            let currentPath = "";
        
            // Gestió de ruta UNC (\\DSMEDIA07...)
            let isUNC = normalizedPath.indexOf('\\\\') === 0;
            this.log(`🔍 [JS-FS] Analitzant ruta: ${normalizedPath} (UNC: ${isUNC})`, "DEBUG");
            
            // Si és UNC, el començament és \\SERVIDOR\RECURS
            if (isUNC) {
                currentPath = '\\\\' + parts[2] + '\\' + parts[3];
                var startIndex = 4;
            } else {
                currentPath = parts[0]; // Unitat C: o similar
                var startIndex = 1;
            }
        
            for (let i = startIndex; i < parts.length; i++) {
                if (!parts[i]) continue;
                currentPath += '\\' + parts[i];
                
                let stat = fs.stat(currentPath);
                
                // 📍 Si no existe (err 2) O si hay un error de acceso (err 3, etc.)
                // intentamos crearla de todos modos por si es un subdirectorio nuevo.
                if (stat.err !== 0) { 
                    let result = fs.makedir(currentPath);
                    
                    if (result.err === 0) {
                        this.log(`✅ [JS-FS] Carpeta creada: ${currentPath}`, "DEBUG");
                    } else if (result.err === 82) { // 82 = Ya existe (pero el stat falló por red)
                        this.log(`ℹ️ [JS-FS] La carpeta ya existía: ${currentPath}`, "DEBUG");
                    } else {
                        // Solo logueamos como error si realmente no podemos crearla
                        this.log(`⚠️ [JS-FS] Intentant crear ${currentPath}: Codi ${result.err}`, "DEBUG");
                    }
                }
            }
            return true;
        },


        /**
         * Ingesta de fitxers a Premiere Pro.
         * @param {Array} pathList - Llista de rutes (UNC o locals).
         * @param {string} binName - Nom del Bin de destí (o "root").
         */
        importList: async function(pathList, binName) {
            if (!pathList || !pathList.length) return;
        
            // Extraemos solo el path si es un objeto
            const rawPaths = pathList.map(item => item.path || item);
        
            try {
                // 📍 BLINDAJE: (2026-09-23) El payload viatja dins d'un LITERAL ExtendScript
                // ('...'), així que cal una DOBLE escapada: JSON.stringify converteix cada \
                // en \\ i utils.escape les torna a duplicar, de manera que el literal les
                // retorni senceres (i de pas escapa les cometes simples).
                // ABANS només s'escapaven les cometes simples → les barres invertides es
                // perdien en arribar al JSX (\P, \Z, \S… → P, Z, S) i la ruta quedava
                // trencada: la ingesta fallava amb ERR:MOVE_FAILED i després l'ítem no
                // existia (ERR_ITEM_NOT_FOUND en col·locar-lo).
                // No es notava al flux de Project perquè allà les rutes es passen amb "/"
                // (f.path.replace(/\\/g, "/")) i escape() no toca les barres normals.
                // Mateixa tècnica que _freezeTemaTitol (flow_chyrons.js).
                const payload = this.escape(JSON.stringify(rawPaths));
                
                const res = await this.callJSX(`FASTPASS.IO.importFiles('${payload}', '${binName}')`);
                
                if (res !== "OK") throw new Error(res);
                //this.log(`✅ Ingesta OK a ${binName}`, "INFO");
            } catch (e) {
                this.log(`🔴 Error Ingesta: ${e.message}`, "ERROR");
            }
        },

        sanitizeName: function(str) {
            if (!str) return "Unnamed_Item";
            // (2026-09-23) NOMS SEMPRE EN ASCII I IDÈNTICS entre bloc, projecte i seqüència.
            // 1. NFD + treure diacrítics: Ç→C, à→a, è→e, í→i, ·→(res), ’→'…
            var normalized = String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            // 2. QUALSEVOL resta de caràcter no-ASCII s'ELIMINA: així cap nom pot arrossegar
            //    mojibake ("COMENA‡A", "Ã‡", "Â€") ni símbols estranys.
            normalized = normalized.replace(/[^\x20-\x7E]/g, "");
            // 3. Caràcters prohibits a Windows + espais col·lapsats + límit de 60 caràcters.
            var pattern = new RegExp('[<>:"/\\\\|?*#]', 'g');
            return normalized.replace(pattern, "").replace(/\s+/g, " ").trim().substring(0, 60);
        },

        /**
         * workFolder(ctx): RUTA DE TREBALL ÚNICA de l'extensió (2026-09-24).
         * Estructura: <destinoBase><prog>_PROJECTES/<YYYY_MM_DD>/<V*>
         * TOTS els artefactes del bloc viuen aquí dins (projecte, escaleta local,
         * MP4 del bloc, manifest, snapshots, anàlisi, SRT, renders) → cap bloc
         * barreja fitxers amb un altre.
         * @param {Object} ctx - {config, progData, dateDir, bloque} (State també val)
         * @returns {string} Ruta sense barra final (separador "/" entre els segments nous)
         */
        workFolder: function(ctx) {
            if (!ctx) return "";
            var rutas = (ctx.config && ctx.config.rutas) ? ctx.config.rutas : {};
            var progDir = (ctx.progData && ctx.progData.directorio) ? ctx.progData.directorio : "";
            var date = ctx.dateDir ? String(ctx.dateDir) : "";
            // El bloc ("V1", "V2"…) entra com a subdirectori de la carpeta de data.
            var bloc = ctx.bloque ? this.sanitizeName(ctx.bloque).replace(/\s+/g, "") : "";
            var out = String(rutas.destinoBase || "") + progDir + "/" + date;
            if (bloc) out += "/" + bloc;
            return out;
        },

        escape: function(str) {
            if (!str) return "";
            // Escapem caràcters perillosos per a injecció en literals ExtendScript (ES3).
            // Els caràcters de control (\n \r \t) es converteixen a seqüències d'escapada
            // per evitar que trenquin el literal de string dins d'evalScript().
            // Les barres invertides i comilles simples també s'escapen.
            // (2026-09-23) NOMÉS ASCII: qualsevol caràcter no-ASCII (à, è, ç, ·, ’ …) s'envia
            // com a \uXXXX perquè ExtendScript no el corrompi en creuar el pont evalScript
            // (era la causa que el nom del projecte/seqüència perdés els caràcters catalans).
            return str
                .replace(/\\/g, "\\\\")
                .replace(/'/g, "\\'")
                .replace(/\n/g, "\\n")
                .replace(/\r/g, "\\r")
                .replace(/\t/g, "\\t")
                .replace(/[\u0080-\uFFFF]/g, function (ch) {
                    var h = ch.charCodeAt(0).toString(16);
                    while (h.length < 4) { h = "0" + h; }
                    return "\\u" + h;
                });
        },

        delay: function(ms) { 
            return new Promise(resolve => setTimeout(resolve, ms)); 
        },

        getFormattedDate: function() {
            var d = new Date();
            var day = ("0" + d.getDate()).slice(-2);
            var month = ("0" + (d.getMonth() + 1)).slice(-2);
            var year = d.getFullYear();
            return year + "_" + month + "_" + day;
        },

        /**
         * getYesterdayDateDir: Retorna la data del dia natural anterior (YYYY_MM_DD).
         * MECÀNICA D'INICI (2026-09-04): usada pel Ctrl+clic (mode correcció) i Ctrl+FOTO.
         * @returns {string} Ex: "2026_09_06"
         */
        getYesterdayDateDir: function() {
            var d = new Date();
            d.setDate(d.getDate() - 1);
            var dd = ("0" + d.getDate()).slice(-2);
            var mm = ("0" + (d.getMonth() + 1)).slice(-2);
            return "" + d.getFullYear() + "_" + mm + "_" + dd;
        },

        /**
         * Valida que un dateDir (DD_MM_YYYY) estigui dins de la finestra
         * temporal permesa per a la cerca de projectes en directoris germans.
         *
         * Regles:
         *   - Sempre s'accepta el dia d'avui.
         *   - Sempre s'accepta ahir (l'editor pot necessitar obrir el projecte
         *     del dia anterior fins al dia següent).
         *   - Qualsevol data anterior (fa 2+ dies) es rebutja.
         *   - NO s'usa mtime del directori perquè no és fiable (s'actualitza
         *     amb auto-save, .lock, etc.).
         *
         * @param {string} dateDirStr - Data en format DD_MM_YYYY, ex: "26_05_2026"
         * @returns {boolean} true si la data està dins de la finestra permesa
         */
        isDateDirInTemporalWindow: function(dateDirStr) {
            if (!dateDirStr) return false;

            // Nomes s'accepten directoris d'avui o ahir (finestra de 22h implicita:
            // cada projecte viu al seu directori de data, i l'editor pot necessitar
            // obrir-lo fins al dia seguent). Qualsevol data anterior es rebutja.
            // NO usem dirMtime perque no es fiable (s'actualitza amb auto-save, locks...).
            // Format esperat: YYYY_MM_DD
            var parts = dateDirStr.split('_');
            if (parts.length !== 3) return false;
            var y = parseInt(parts[0], 10);
            var m = parseInt(parts[1], 10);
            var d = parseInt(parts[2], 10);
            if (isNaN(d) || isNaN(m) || isNaN(y)) return false;

            var dirDate = new Date(y, m - 1, d);
            var now = new Date();
            var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            var yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);

            var dirTime = dirDate.getTime();
            var accepted = (dirTime === today.getTime() || dirTime === yesterday.getTime());
            if (window.FASTPASS_UI && window.FASTPASS_UI.Utils) {
                window.FASTPASS_UI.Utils.log('🔒 [TemporalWindow] dir=' + dateDirStr + ' accepted=' + accepted, 'DEBUG');
            }
            return accepted;
        },

        /**
         * D7.5: Extreu la data d'emissió en format DD_MM_YYYY des del nom
         * d'un fitxer d'escaleta. És la FONT ÚNICA de dateDir.
         *
         * Format esperat del filename: TN_VESPRE_20260517_215504.json
         * Extrau el penúltim segment (YYYYMMDD) i el converteix a DD_MM_YYYY.
         *
         * @param {string} filename - Nom del fitxer (sense ruta), ex: "TN_VESPRE_20260517_215504.json"
         * @returns {string|null} Data en format DD_MM_YYYY, o null si no es pot extreure
         */
        extractDateFromEscaletaFilename: function(filename) {
            if (!filename) return null;
            var noExt = filename.replace(/\.json$/i, '');
            var parts = noExt.split('_');
            if (parts.length < 2) return null;
            var yyyymmdd = null;
            // Nou format: YYYYMMDD al segment [0]
            if (/^\d{8}$/.test(parts[0])) {
                yyyymmdd = parts[0];
            } else {
                // Fallback: format antic (data al penultim segment)
                var old = parts[parts.length - 2];
                if (old && old.length === 8 && /^\d{8}$/.test(old)) {
                    yyyymmdd = old;
                }
            }
            if (!yyyymmdd) return null;
            var dd = yyyymmdd.substring(6, 8);
            var mm = yyyymmdd.substring(4, 6);
            var yyyy = yyyymmdd.substring(0, 4);
            return yyyy + '_' + mm + '_' + dd;
        },

        /**
         * Extreu la data d'emissió en format YYYYMMDD (prefix) des del nom
         * d'un fitxer d'escaleta. S'usa per filtrar JSONs per data exacta.
         * @param {string} filename
         * @returns {string|null} "20260618" o null
         */
        extractDatePrefixFromFilename: function(filename) {
            if (!filename) return null;
            var noExt = filename.replace(/\.json$/i, '');
            var parts = noExt.split('_');
            if (parts.length >= 1 && /^\d{8}$/.test(parts[0])) {
                return parts[0];
            }
            return null;
        },

        /**
         * Converteix format "00.46" o "01.00" a segons (float).
         */
        timeToSeconds: function(tcStr) {
            if (!tcStr) return 0;
            const parts = tcStr.split('.');
            if (parts.length === 1) return parseFloat(parts[0]);
            const m = parseFloat(parts[0]) || 0;
            const s = parseFloat(parts[1]) || 0;
            return (m * 60) + s;
        },

        handleError: function(e, context) {
            this.log(`💥 [${context}] Error: ${e.message}`, "ERROR");
            this.status(`Error en ${context}`, "error");
        },

        status: function(msg, type) {
            const el = document.getElementById('estado');
            if (!el) return;
            el.innerText = msg;
            el.className = "status-" + (type || "debug");
        },

        updateUIState: function(state) {
            const main = document.getElementById('main-content');
            if (main) main.classList.toggle('busy', state === 'BUSY');
        },

        /**
         * 🛡️ SEGURETAT: Verifica si la seqüència activa en Premiere coincideix 
         * amb el context triat al panell.
         */
        validateActiveSequence: async function() {
            const state = window.FASTPASS_UI.State;
            const config = window.FASTPASS_UI.Config.get();
            const elProg = document.getElementById('programa');
            const elBloc = document.getElementById('bloc');
            
            if (!elProg || !elBloc) return true; // Fail-safe si no hi ha UI
            
            // Actualizar la secuencia activa desde Premiere
            const activeSeq = await this.refreshActiveSequence();
            
            const progKey = elProg.value;
            const blocVal = elBloc.value;
            
            // Si estem en una seqüència buida o NO n'hi ha cap de activa
            if (!activeSeq) {
                this.status("⚠️ Cap seqüència activa!", "error");
                return false;
            }

            // Validació per paraules clau (Tokens)
            // Busquem si el nom de la seqüència inclou el codi del programa i el bloc
            const progData = config.mapeoProgramas[progKey];
            const progFileName = progData ? progData.archivo : "";
            const progWott = progData ? progData.wott : "";
            
            const hasProg = activeSeq.indexOf(progFileName) !== -1 || activeSeq.indexOf(progWott) !== -1;
            const hasBloc = activeSeq.indexOf(blocVal) !== -1;

            if (!hasProg) {
                const msg = `⚠️ Sincronia Perduda! Estàs a '${activeSeq.substring(0,15)}...' però el panell diu ${progKey}`;
                this.status(msg, "error");
                this.log(msg, "WARN");
                return false;
            }
            // Opcional: advertir si el bloque no coincide pero no bloquear
            if (!hasBloc) {
                this.log(`⚠️ El bloque ${blocVal} no aparece en la secuencia activa. Continuando...`, "DEBUG");
            }

            return true;
        },

        /**
         * Obtiene el nombre de la secuencia activa desde Premiere y actualiza el estado.
         * @returns {Promise<string>} Nombre de la secuencia activa (vacío si no hay).
         */
        refreshActiveSequence: async function() {
            const state = window.FASTPASS_UI.State;
            try {
                const seqName = await this.callJSX("Context.activeSeq()");
                state.activeSequenceName = seqName && seqName.indexOf("ERROR") === -1 ? seqName : "";
                this.log(`🔍 Secuencia activa actualizada: ${state.activeSequenceName || "(ninguna)"}`, "DEBUG");
                return state.activeSequenceName;
            } catch (e) {
                this.log(`⚠️ Error al refrescar secuencia activa: ${e.message}`, "WARN");
                state.activeSequenceName = "";
                return "";
            }
        },

        /**
         * 🎯 focusV1: Torna el "clip objectiu" del panell a V1 (auto-selecció a V1).
         * Per què cal: `Anim.setMotionValues` (i els inserts/overwrites) acaben amb un toggle
         * de selecció intern; si l'últim clip SELECCIONAT és de V2/V3/V6/V7, el clip objectiu
         * del panell (Anim.sliderApply / Anim.modeInfo → _sliderTarget → Clips.getSelectedVideo,
         * que recorre les pistes d'abaix cap amunt) deixa de ser V1.
         * Tècnica (sense JSX nou): re-aplicar al clip de V1 els SEUS MATEIXOS valors de Motion
         * (getMotionValues → setMotionValues) → mateix estat visual, però V1 torna a quedar
         * seleccionat. Patró validat a DoblePantalla (2026-09-21).
         * @param {string} [tag]    - Etiqueta pel log (ex: "DoblePantalla", "Repartir").
         * @param {number} [refSec] - Segon de referència (p. ex. l'inici del clip tractat).
         *                            Si no es passa, s'usa el clip de V1 sota el CTI.
         * @returns {Promise<boolean>} true si el focus s'ha pogut restaurar a V1.
         */
        focusV1: async function(tag, refSec) {
            const t = tag || "FOCUS";
            try {
                let raw = null;
                if (typeof refSec === 'number' && isFinite(refSec)) {
                    raw = await this.callJSX(`Clips.at(1, ${(refSec + 0.1).toFixed(2)}, 'video')`);
                }
                if (!raw || raw === 'null') {
                    const cti = parseFloat(await this.callJSX('Timeline.get()') || '0');
                    raw = await this.callJSX(`Clips.at(1, ${cti.toFixed(2)}, 'video')`);
                }
                if (!raw || raw === 'null') {
                    this.log(`🎯 [${t}] focus V1: cap clip de V1 per seleccionar.`, "WARN");
                    return false;
                }
                const c1 = JSON.parse(raw);
                const mvRaw = await this.callJSX(`Anim.getMotionValues(1, ${c1.index})`);
                if (!mvRaw || String(mvRaw).indexOf('ERR') === 0) {
                    this.log(`🎯 [${t}] focus V1: sense valors de Motion a V1[${c1.index}] (${mvRaw}).`, "WARN");
                    return false;
                }
                const selAbans = await this.callJSX('Clips.getSelectedVideo()');
                const res = await this.callJSX(`Anim.setMotionValues(1, ${c1.index}, '${String(mvRaw).replace(/'/g, "\\'")}')`);
                await this.delay(150);
                const selDespres = await this.callJSX('Clips.getSelectedVideo()');
                this.log(`🎯 [${t}] focus → V1[${c1.index}] "${c1.name}" | toggle ${res} | clip objectiu: ${selAbans} → ${selDespres}`, "INFO");
                return true;
            } catch (eF) {
                this.log(`🎯 [${t}] focus V1: ${eF.message}`, "WARN");
                return false;
            }
        },

        /**
         * 🎯 targetOnlyV1: Deixa el TARGETING (autoselecció de pista) NOMÉS a V1 i A1.
         * Per què cal: `Tracks.target(1, true)` (que fan alguns fluxos) no desactiva les
         * altres pistes; si alguna operació (inserts amb ripple, `_limitarTargets`, etc.) les
         * ha deixat totes activades, Premiere queda amb "totes les pistes enfocades" i un
         * insert cauria a qualsevol pista. Aquí ho deixem determinista: V1 i A1 actius.
         * @param {string} [tag] - Etiqueta pel log (ex: "Col·locar").
         * @returns {Promise<boolean>}
         */
        targetOnlyV1: async function(tag) {
            const t = tag || "FOCUS";
            try {
                const nV = parseInt(await this.callJSX("Tracks.count('video')") || '0', 10) || 0;
                for (let i = 1; i <= nV; i++) {
                    await this.callJSX(`Tracks.target(${i}, ${i === 1}, 'video')`);
                }
                const nA = parseInt(await this.callJSX("Tracks.count('audio')") || '0', 10) || 0;
                for (let i = 1; i <= nA; i++) {
                    await this.callJSX(`Tracks.target(${i}, ${i === 1}, 'audio')`);
                }
                this.log(`🎯 [${t}] targeting → només V1 (de ${nV} pistes de vídeo) i A1 (de ${nA} d'àudio)`, "INFO");
                return true;
            } catch (eT) {
                this.log(`🎯 [${t}] targeting: ${eT.message}`, "WARN");
                return false;
            }
        },

        /**
         * applyGlobalOffsetSec: Aplica el desplaçament global de TC (tcOffset) a un valor en segons.
         * La deriva sistemàtica d'ingesta (ex: 12 frames ~0.48s) es corregeix centralitzadament
         * des de Profile.json > general.tcOffset.
         * @param {number} seconds - Valor en segons a corregir
         * @returns {number} - Valor corregit amb l'offset configurat
         */
        applyGlobalOffsetSec: function(seconds) {
            const cfg = window.FASTPASS_UI.Config.get();
            const offset = cfg.tcOffset || 0;
            if (offset !== 0) {
                this.log(`📐 [GLOBAL_OFFSET] Aplicant offset de ${offset}s a ${seconds.toFixed(3)}s → ${(seconds + offset).toFixed(3)}s`, "DEBUG");
            }
            return seconds + offset;
        },

        deleteFile: function(path) {
            try {
                const fs = window.cep.fs;
                // Normalizamos barras para Node/CEP
                const normalizedPath = path.replace(/\//g, '\\');
                const result = fs.unlink(normalizedPath);
                
                if (result.err === 0) {
                    this.log(`✅ Arxiu eliminat del NAS: ${normalizedPath}`, "DEBUG");
                    return true;
                } else {
                    this.log(`⚠️ No s'ha pogut esborrar (Error ${result.err}): ${normalizedPath}`, "DEBUG");
                    return false;
                }
            } catch(e) { 
                return false; 
            }
        }

    };
})();

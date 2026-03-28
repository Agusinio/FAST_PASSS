/**
 * =================================================================================
 * 3_Project.jsx
 * Gestió de projectes, Bins i seqüències (v12 - SUPER-LITERAL DRY)
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.Project = (function() {

    // --- HELPERS PRIVATS (LITERALS) ---

    function _focus() {
        if ($.global.FASTPASS_WorkProject instanceof Project) {
            return $.global.FASTPASS_WorkProject;
        }
        return app.project;
    }

    function _item(collection, name) {
        if (!collection) return null;
        for (var i = 0; i < collection.numItems; i++) {
            if (collection[i].name === name) return collection[i];
        }
        if (collection.numSequences) {
            for (var j = 0; j < collection.numSequences; j++) {
                if (collection[j].name === name) return collection[j];
            }
        }
        return null;
    }

    function _search(folder, name) {
        for (var i = 0; i < folder.children.numItems; i++) {
            var child = folder.children[i];
            if (child.name === name) return child;
            if (child.type === 2) { 
                var found = _search(child, name);
                if (found) return found;
            }
        }
        return null;
    }

    return {
        
        // --- 1. GESTIÓ DE PROJECTE ---
        
        save: function() {
            try {
                var p = _focus();
                if (p) { p.save(); return "OK"; }
                return "ERR:NO_PROJ";
            } catch(e) { return "ERR:" + e.message; }
        },

        saveAs: function(pathString) {
            try {
                var cleanPath = pathString.replace(/\\/g, "/");
                if (pathString.indexOf("\\\\") === 0) cleanPath = "//" + cleanPath.substring(2).replace(/\/+/g, "/");
                var myFile = new File(cleanPath);
                if (!myFile.parent.exists) myFile.parent.create();
        
                var p = _focus();
                var ok = p.saveAs(myFile.fsName);
                if (ok) { $.global.FASTPASS_WorkProject = p; return "OK"; }
                return "ERR:REJECTED";
            } catch(e) { return "ERR:" + e.message; }
        },

        open: function(path) {
            try {
                var f = new File(path);
                if (!f.exists) return "ERR:NOT_EXISTS";
                var ok = app.openDocument(f.fsName);
                if (ok) $.global.FASTPASS_WorkProject = app.project;
                return ok ? "OK" : "ERR:OPEN_FAILED";
            } catch(e) { return "ERR:" + e.message; }
        },

        // --- 2. ITEMS & BINS ---

        items: function(binName) {
            try {
                var p = _focus();
                var container = binName ? _item(p.rootItem.children, binName) : p.rootItem;
                if (!container || !container.children) return "[]";

                var results = [];
                for (var i = 0; i < container.children.numItems; i++) {
                    var it = container.children[i];
                    results.push({
                        name: it.name,
                        type: it.type,
                        mediaPath: (it.type === 1) ? it.getMediaPath() : ""
                    });
                }
                return JSON.stringify(results);
            } catch(e) { return "[]"; }
        },

        find: function(name) {
            return _search(_focus().rootItem, name);
        },

        rename: function(name, newName) {
            var it = this.find(name);
            if (it) { it.name = newName; return "OK"; }
            return "ERR:NOT_FOUND";
        },

        move: function(itemName, binName) {
            var p = _focus();
            var it = this.find(itemName);
            var bin = _item(p.rootItem.children, binName) || p.rootItem;
            if (it && bin) { it.moveBin(bin); return "OK"; }
            return "ERR:MOVE_FAILED";
        },

        bin: function(name) {
            var p = _focus();
            var existing = _item(p.rootItem.children, name);
            if (existing) return existing.name;
            var newBin = p.rootItem.createBin(name);
            return newBin ? newBin.name : "root";
        },

        // --- 3. SEQCÜÈNCIES ---

        list: function() {
            try {
                var p = _focus();
                var results = [];
                for (var i = 0; i < p.sequences.numSequences; i++) {
                    results.push({
                        name: p.sequences[i].name,
                        id: p.sequences[i].sequenceID
                    });
                }
                return JSON.stringify(results);
            } catch(e) { return "[]"; }
        },

        clone: function(sourceName) {
            try {
                var p = _focus();
                var seq = _item(p.sequences, sourceName);
                if (seq) {
                    seq.clone();
                    return p.activeSequence.name; 
                }
                return "ERR:NOT_FOUND";
            } catch (e) { return "ERR:" + e.message; }
        },

        openSeq: function(name) {
            var p = _focus();
            var seq = _item(p.sequences, name);
            if (seq) { p.openSequence(seq.sequenceID); return "OK"; }
            return "ERR:NOT_FOUND";
        },

        byName: function(name) {
            var p = _focus();
            var seq = _item(p.sequences, name);
            return seq || p.activeSequence;
        },

        byTokens: function(tokenProg, tokenBloc) {
            try {
                var p = _focus();
                for (var i = 0; i < p.sequences.numSequences; i++) {
                    var s = p.sequences[i];
                    if (s && s.name.indexOf(tokenProg) !== -1 && s.name.indexOf(tokenBloc) !== -1) {
                        return String(s.name);
                    }
                }
                return "ERR:NOT_FOUND";
            } catch(e) { return "ERR:" + e.message; }
        }
    };
})();
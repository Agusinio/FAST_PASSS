/**
 * =================================================================================
 * 20_Projecte.jsx
 * Gestió de projectes, Bins i seqüències (v12 - SUPER-LITERAL DRY)
 * =================================================================================
 */

if (typeof $.global.FASTPASS === "undefined") { $.global.FASTPASS = {}; }
var FASTPASS = $.global.FASTPASS;

FASTPASS.Projecte = (function() {

    function _focus() {
        if ($.global.FASTPASS_WorkProject instanceof Projecte) {
            return $.global.FASTPASS_WorkProject;
        }
        return app.project;
    }

    function _normWin(s) {
        return s.replace(/[\uFEFF\u200B]/g, '').replace(/^\s+|\s+$/g, '').toLowerCase();
    }

    function _item(collection, name) {
        if (!collection) return null;
        var nameLow = _normWin(name);
        for (var i = 0; i < collection.numItems; i++) {
            if (_normWin(collection[i].name) === nameLow) return collection[i];
        }
        if (collection.numSequences) {
            for (var j = 0; j < collection.numSequences; j++) {
                if (_normWin(collection[j].name) === nameLow) return collection[j];
            }
        }
        return null;
    }

    function _search(folder, name) {
        var nameLow = _normWin(name);
        for (var i = 0; i < folder.children.numItems; i++) {
            var child = folder.children[i];
            if (_normWin(child.name) === nameLow) return child;
            if (child.type === 2) { 
                var found = _search(child, name);
                if (found) return found;
            }
        }
        return null;
    }

    return {
        save: function() {
            try {
                var p = _focus();
                if (p) { p.save(); return "OK"; }
                return "ERR:NO_PROJ";
            } catch(e) { return "ERR:" + e.message; }
        },

        path: function() {
            try {
                var p = _focus();
                return p ? p.path : "";
            } catch(e) { return ""; }
        },

        saveAs: function(pathString) {
            try {
                if (!pathString) return "ERR: Camí buit";
                var cleanPath = pathString.replace(/\\/g, "/");
                var myFile = new File(cleanPath);
                if (!myFile.parent.exists) { myFile.parent.create(); }
                var p = app.project; 
                if (!p) return "ERR: No hi ha projecte actiu";
                var success = p.saveAs(myFile.fsName);
                if (success || myFile.exists) {
                    $.global.FASTPASS_WorkProject = p;
                    return "OK";
                }
                return "ERR: Guardat rebutjat per Premiere";
            } catch(e) { return "ERR:" + e.message; }
        },
        
        open: function(pathString) {
            try {
                var cleanPath = pathString.replace(/\\/g, "/");
                var f = new File(cleanPath);
                if (!f.exists) return "ERR:NOT_EXISTS";
                var ok = app.openDocument(f.fsName);
                if (ok) {
                    $.global.FASTPASS_WorkProject = app.project;
                    return "OK";
                }
                return "ERR:OPEN_FAILED";
            } catch(e) { return "ERR:" + e.message; }
        },

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

        find: function(nameEncoded) {
            var name = decodeURIComponent(nameEncoded).replace(/^\s+|\s+$/g, '');
            return _search(_focus().rootItem, name);
        },

        rename: function(nameEncoded, newNameEncoded) {
            var it = this.find(nameEncoded);
            if (it) { 
                it.name = decodeURIComponent(newNameEncoded).replace(/^\s+|\s+$/g, ''); 
                return "OK"; 
            }
            return "ERR:NOT_FOUND";
        },

        move: function(itemNameEncoded, binNameEncoded) {
            var p = _focus();
            var it = this.find(itemNameEncoded);
            var binName = decodeURIComponent(binNameEncoded).replace(/^\s+|\s+$/g, '');
            var bin = _item(p.rootItem.children, binName) || p.rootItem;
            if (it && bin) { it.moveBin(bin); return "OK"; }
            return "ERR:MOVE_FAILED";
        },

        moveByPath: function(filePathEncoded, binNameEncoded) {
            try {
                var p = _focus();
                var filePath = decodeURIComponent(filePathEncoded).replace(/\\/g, '/');
                var binName = decodeURIComponent(binNameEncoded).replace(/^\s+|\s+$/g, '');
                var targetBin = _item(p.rootItem.children, binName) || p.rootItem;

                for (var i = 0; i < p.rootItem.children.numItems; i++) {
                    var item = p.rootItem.children[i];
                    if (item.type === 1) {
                        var mediaPath = item.getMediaPath();
                        if (mediaPath) {
                            var normalizedMedia = mediaPath.replace(/\\/g, '/');
                            if (normalizedMedia === filePath || normalizedMedia.slice(-filePath.length) === filePath) {
                                item.moveBin(targetBin);
                                return "OK";
                            }
                        }
                    }
                }
                return "ERR:NOT_FOUND";
            } catch(e) { return "ERR:" + e.message; }
        },

        bin: function(nameEncoded) {
            var p = _focus();
            var name = decodeURIComponent(nameEncoded).replace(/^\s+|\s+$/g, '');
            var existing = _item(p.rootItem.children, name);
            if (existing) return existing.name;
            var newBin = p.rootItem.createBin(name);
            return newBin ? newBin.name : "root";
        },

        cloneSeq: function(sourceNameEncoded) {
            try {
                var p = _focus();
                var sourceName = decodeURIComponent(sourceNameEncoded).replace(/^\s+|\s+$/g, '');
                var foundSeq = null;
                for (var i = 0; i < p.sequences.numSequences; i++) {
                    var s = p.sequences[i];
                    if (s && s.name.replace(/^\s+|\s+$/g, '') === sourceName) {
                        foundSeq = s;
                        break;
                    }
                }
                if (foundSeq) {
                    foundSeq.clone(); 
                    return app.project.activeSequence.name;
                }
                return "ERR:NOT_FOUND";
            } catch (e) { return "ERR:" + e.message; }
        }
    };
})();

var Projecte = FASTPASS.Projecte;
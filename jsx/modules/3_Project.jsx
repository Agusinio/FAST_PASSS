/*
 * =================================================================================
 * MODULE: PROJECT (v10 - DRY VERSION)
 * ARXIU: modules/3_Project.jsx
 * =================================================================================
 */

var FASTPASS = $.global.FASTPASS || {};
FASTPASS.Project = (function() {

    // --- GENERIC HELPERS (PRIVATE) ---

    function getTargetProject(path) {
        if (!path) return FASTPASS_WorkProject || app.project;
        var f = new File(path);
        for (var i = 0; i < app.projects.numProjects; i++) {
            if (app.projects[i].path === f.fsName) return app.projects[i];
        }
        return app.project;
    }

    // Un iterator genèric per a qualsevol col·lecció de Premiere
    function findInCollection(collection, name) {
        if (!collection) return null;
        for (var i = 0; i < collection.numItems; i++) {
            if (collection[i].name === name) return collection[i];
        }
        // Cas especial per a Sequences collection (que no usa numItems sino .numSequences)
        if (collection.numSequences) {
            for (var j = 0; j < collection.numSequences; j++) {
                if (collection[j].name === name) return collection[j];
            }
        }
        return null;
    }

    function searchRecursive(folder, name) {
        for (var i = 0; i < folder.children.numItems; i++) {
            var child = folder.children[i];
            if (child.name === name) return child;
            if (child.type === 2) { // 2 = Bin
                var found = searchRecursive(child, name);
                if (found) return found;
            }
        }
        return null;
    }

    return {
        
        // --- 1. GESTIÓN DE PROYECTO ---

        saveAs: function(pathString, projectPath) {
            try {
                var f = new File(pathString);
                if (!f.parent.exists) f.parent.create();
                return getTargetProject(projectPath).saveAs(f.fsName);
            } catch(e) { return false; }
        },

        openProject: function(path) {
            try {
                var f = new File(path);
                return f.exists ? app.openDocument(f.fsName) : false;
            } catch(e) { return false; }
        },

        // --- 2. ACCIONES SOBRE ITEMS (ATOMISMO) ---

        listItems: function(binName, projectPath) {
            try {
                var proj = getTargetProject(projectPath);
                var container = binName ? findInCollection(proj.rootItem.children, binName) : proj.rootItem;
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

        findItem: function(name, projectPath) {
            return searchRecursive(getTargetProject(projectPath).rootItem, name);
        },

        renameItem: function(name, newName, projectPath) {
            var it = this.findItem(name, projectPath);
            if (it) { it.name = newName; return true; }
            return false;
        },

        moveItem: function(itemName, binName, projectPath) {
            var proj = getTargetProject(projectPath);
            var it = this.findItem(itemName, projectPath);
            var bin = findInCollection(proj.rootItem.children, binName) || proj.rootItem;
            if (it && bin) { it.moveBin(bin); return true; }
            return false;
        },

        // --- 3. SECUENCIAS ---

        cloneSequence: function(sourceName, newName, projectPath) {
            var proj = getTargetProject(projectPath);
            var seq = findInCollection(proj.sequences, sourceName);
            if (!seq) return "ERR_SOURCE_NOT_FOUND";
            seq.clone();
            return sourceName + " Copy";
        },

        openSequence: function(name, projectPath) {
            var proj = getTargetProject(projectPath);
            var seq = findInCollection(proj.sequences, name);
            if (seq) { proj.openSequence(seq.sequenceID); return true; }
            return false;
        },

        createBin: function(name, projectPath) {
            var proj = getTargetProject(projectPath);
            var existing = findInCollection(proj.rootItem.children, name);
            return existing || proj.rootItem.createBin(name);
        }
    };
})();
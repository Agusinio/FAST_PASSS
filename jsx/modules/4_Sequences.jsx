// 4_Sequences.jsx

var FASTPASS = FASTPASS || {};
FASTPASS.Sequences = {
    getCTI: function () {
        return app.project.activeSequence ? app.project.activeSequence.getPlayerPosition().seconds : 0;
    },

    setCTI: function (s) {
        var t = new Time(); t.seconds = parseFloat(s);
        app.project.activeSequence.setPlayerPosition(t.ticks);
    },

    nuclearRefresh: function () {
        var s = app.project.activeSequence; if (!s) return;
        var p = s.getPlayerPosition();
        var n = new Time(); n.seconds = p.seconds + 0.001;
        s.setPlayerPosition(n.ticks); s.setPlayerPosition(p.ticks);
        return "REFRESH_OK";
    },

    // El "Atajo de Ingeniería" (QE) recuperado
    setCTI_QE: function (tc) {
        app.enableQE();
        qe.project.getActiveSequence().CTI.setSeconds(parseFloat(tc));
        return "QE_OK";
    },

    setInOut: function (i, o) {
        var s = app.project.activeSequence;
        var tIn = new Time(); tIn.seconds = parseFloat(i);
        var tOut = new Time(); tOut.seconds = parseFloat(o);
        s.setInPoint(tIn.ticks); s.setOutPoint(tOut.ticks);
    }
};
var FASTPASS = FASTPASS || {};
FASTPASS.Sequences = {
    getCTI: function () {
        var seq = FASTPASS.Context.getWorkSequence();
        return seq ? seq.getPlayerPosition().seconds : 0;
    },

    setCTI: function (s) {
        var seq = FASTPASS.Context.getWorkSequence();
        if (!seq) return "ERR:NO_SEQ";
        var t = new Time(); t.seconds = parseFloat(s);
        seq.setPlayerPosition(t.ticks);
        return "OK";
    },

    nuclearRefresh: function () {
        var seq = FASTPASS.Context.getWorkSequence();
        if (!seq) return "ERR:NO_SEQ";
        var p = seq.getPlayerPosition();
        var n = new Time(); n.seconds = p.seconds + 0.001;
        seq.setPlayerPosition(n.ticks); seq.setPlayerPosition(p.ticks);
        return "REFRESH_OK";
    },

    setCTI_QE: function (tc) {
        app.enableQE();
        qe.project.getActiveSequence().CTI.setSeconds(parseFloat(tc));
        return "QE_OK";
    },

    setInOut: function (i, o) {
        var seq = FASTPASS.Context.getWorkSequence();
        if (!seq) return "ERR:NO_SEQ";
        var tIn = new Time(); tIn.seconds = parseFloat(i);
        var tOut = new Time(); tOut.seconds = parseFloat(o);
        seq.setInPoint(tIn.ticks); seq.setOutPoint(tOut.ticks);
        return "OK";
    }
};
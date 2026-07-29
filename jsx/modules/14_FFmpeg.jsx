/**
 * ============================================================================
 * JSX Module: FFmpeg - extractClip (crea .bat, executa, retorna immediatament)
 * ============================================================================
 * NO fa polling amb $.sleep (bloqueja File.execute). Retorna "LAUNCHED" i
 * JS espera un temps fix + verifica amb IO.exists.
 * ============================================================================
 */

(function() {
    if ($.global.FASTPASS && $.global.FASTPASS.FFmpeg) {
        $.writeln("[FFmpeg] Ja carregat. Es salta.");
        return;
    }

    var FASTPASS = $.global.FASTPASS;

    FASTPASS.FFmpeg = {

        extractClip: function(ffmpegPath, sourcePath, startSec, duration, outputPath) {
            $.writeln("[FFmpeg.extractClip] INICI");
            $.writeln("[FFmpeg.extractClip] ffmpeg=" + ffmpegPath);
            $.writeln("[FFmpeg.extractClip] output=" + outputPath);

            // Validar que ffmpeg existeix
            var ffmpegFile = new File(ffmpegPath);
            if (!ffmpegFile.exists) {
                return "ERR:ffmpeg no trobat a: " + ffmpegPath;
            }

            // Crear .bat que fa: ffmpeg a temp + copy + del
            var timestamp = new Date().getTime();
            var tempClip = "C:\\temp\\" + outputPath.split(/[\\\/]/).pop();
            var batFile = new File("C:/temp/extract_" + timestamp + ".bat");
            
            var batContent = '@echo off\r\n';
            batContent += '"' + ffmpegPath + '" -ss ' + startSec + ' -t ' + duration + ' -i "' + sourcePath + '" -c copy -avoid_negative_ts make_zero -y "' + tempClip + '"\r\n';
            batContent += 'if exist "' + tempClip + '" (\r\n';
            batContent += '  copy /y "' + tempClip + '" "' + outputPath + '"\r\n';
            batContent += '  del /f /q "' + tempClip + '"\r\n';
            batContent += ')\r\n';
            
            batFile.open("w");
            batFile.write(batContent);
            batFile.close();
            
            if (!batFile.exists) {
                $.writeln("[FFmpeg.extractClip] ERR: No s'ha pogut crear el .bat");
                return "ERR:No s'ha pogut crear el .bat";
            }
            $.writeln("[FFmpeg.extractClip] .bat creat: " + batFile.fsName);

            // Executar i RETORNAR IMMEDIATAMENT (sense $.sleep)
            $.writeln("[FFmpeg.extractClip] Executant .bat...");
            batFile.execute();
            $.writeln("[FFmpeg.extractClip] .bat llançat. Retornant LAUNCHED");
            return "LAUNCHED";
        }
    };

    $.writeln("[FFmpeg] Mòdul carregat correctament.");
})();
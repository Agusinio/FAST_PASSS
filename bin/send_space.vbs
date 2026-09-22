' ============================================================================
' FAST >>> PASS - send_space.vbs
' Envia la BARRA ESPACIADORA (Play/Pausa) a la finestra de Premiere.
'
' (2026-09-22) Per quin cal aquest script:
'   - El panell CEP, quan te el focus del teclat, no deixa arribar l'ESPAI a Premiere.
'   - En aquesta versio de Premiere NO existeixen les APIs per tornar el focus
'     (app.setAppFocus i app.bringToFront donen "is not a function") ni el QE
'     te play() (qe.project.getActiveSequence().play tambe dona "is not a function").
'   - L'unica via que queda es enviar la propia tecla des del sistema.
'
' S'executa amb File.execute() des d'ExtendScript -> s'obre amb wscript.exe
' (SENSE consola ni parpadeig de finestra).
' NOMES ASCII a proposit: wscript llegeix els .vbs com ANSI.
' ============================================================================
Option Explicit

Dim shell, wmi, procs, proc, pid
pid = 0

Set shell = CreateObject("WScript.Shell")
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set procs = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name='Adobe Premiere Pro.exe'")

For Each proc In procs
    pid = proc.ProcessId
Next

If pid = 0 Then WScript.Quit 1        ' Premiere no trobat
If shell.AppActivate(pid) = False Then WScript.Quit 2

WScript.Sleep 120                     ' marge perque el canvi de finestra es completi
shell.SendKeys " "
WScript.Quit 0

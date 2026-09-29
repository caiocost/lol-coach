' Abre a bandeja do LoL Coach (bandeja.ps1) sem janela de PowerShell.
'
' Duplo clique abre a bandeja e a tela; "/semabrir" (usado no logon, pelo
' atalho de "Iniciar com o Windows") sobe calado, sem abrir o navegador.
Option Explicit
Dim fso, shell, aqui, extra
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
aqui = fso.GetParentFolderName(WScript.ScriptFullName)

extra = ""
If WScript.Arguments.Count > 0 Then
  If LCase(WScript.Arguments(0)) = "/semabrir" Then extra = " -SemAbrir"
End If

' 0 = janela oculta; False = nao espera terminar
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & _
          Chr(34) & aqui & "\bandeja.ps1" & Chr(34) & extra, 0, False

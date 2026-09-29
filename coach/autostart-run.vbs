' Inicia o coach sem janela de console.
'
' Existe só por isso: rodar o node direto pelo Agendador de Tarefas abre um
' console preto no logon toda vez. O wscript com WindowStyle 0 evita.
'
' Chamado pela tarefa criada em autostart.ps1 — não é para rodar na mão.
Option Explicit
Dim fso, shell, projeto, log, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

' o .vbs mora em <projeto>\coach\
projeto = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
log = projeto & "\coach\autostart.log"

shell.CurrentDirectory = projeto

' Redireciona saída e erro pro log: sem isso uma falha no boot fica invisível.
Dim node
node = "node"
If fso.FileExists(projeto & "\runtime\node.exe") Then node = Chr(34) & projeto & "\runtime\node.exe" & Chr(34)
cmd = "cmd /c " & node & " " & Chr(34) & projeto & "\coach\start.mjs" & Chr(34) & _
      " >> " & Chr(34) & log & Chr(34) & " 2>&1"

' 0 = janela oculta; False = não espera terminar
shell.Run cmd, 0, False

# Áudios dos alertas

Cada alerta toca o arquivo com o **nome-base** abaixo. Os que vêm no repositório
são exemplos — regrave com a sua voz pela própria tela.

**A extensão não importa.** O servidor resolve pelo nome-base e aceita mp3, m4a,
wav, ogg, aac, mp4, webm, opus e flac. O painel detecta arquivos novos a cada
10s, sem reiniciar.

| Arquivo | Quando toca | Sugestão de fala |
|---|---|---|
| `objetivo-60` | 60s antes de dragão/vastilarvas/arauto/barão | "Dragão chegando, comece a andar" |
| `objetivo-30` | 30s antes | "Objetivo agora, rio com visão" |
| `objetivo-livre` | objetivo de pé há 45s e ninguém pegou | "Objetivo de graça, ninguém pegou" |
| `objetivo-expira` | arauto/vastilarvas prestes a sumir | "Vai sumir, pega agora" |
| `janela-objetivo` | 2+ inimigos mortos e objetivo perto (pós-15) | "Inimigos mortos, pega o objetivo" |
| `nivel-6-inimigo` | um inimigo chegou ao nível 6 | "Cuidado, ele tem ult" |
| `nivel-6-seu` | você chegou ao nível 6 | "Ult na mão" |

Os alertas que você cria em **Criar alerta** entram nesta lista sozinhos.

## Gravar pela tela

Abra `http://localhost:7778`, painel **Áudios dos alertas**, clique em **●**,
fale e clique em **■**. Salva com o nome certo e converte para WAV (precisa do
ffmpeg). O navegador pede permissão de microfone na primeira vez; a gravação
para sozinha em 10s.

Dicas: curto (1 a 2 segundos) e com a sua voz — é mais fácil de reconhecer no
meio do som do jogo.

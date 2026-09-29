"""Daemon das luzes do coach: HTTP em 127.0.0.1:7779 -> OpenRGB (6742).

Mantém UMA conexão com o servidor OpenRGB e desenha a 40 fps só enquanto há
algo para animar; ocioso, não escreve nada — assim o "Beber Água" agendado pode
usar o teclado fora da partida sem dois clientes brigando.

Uso:
    python scripts/rgb/rgb_daemon.py                 # servidor (o `npm run coach` sobe sozinho)
    python scripts/rgb/rgb_daemon.py --demo penta    # roda um efeito direto e sai
    python scripts/rgb/rgb_daemon.py --demo dragao --tipo Water

Rotas: POST /efeito {efeito, params} | {lote: [...]}, POST /estado {morto, respawnEm, teste?},
POST /partida {ativa}, POST /carregando {ativo, teste?}, POST /reset, GET /status.
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from layout import BRANCO, Dispositivos, Layout, achar, connect  # noqa: E402
from mixer import Mixer  # noqa: E402

FPS = 40
PORTA = 7779
RECONECTA_S = 5.0


def log(msg: str) -> None:
    print(msg, flush=True)


class Hardware:
    """Conexão com o OpenRGB que se refaz sozinha quando cai."""

    def __init__(self, mixer: Mixer, lock: threading.Lock):
        self.mixer, self.lock = mixer, lock
        self.dev: Dispositivos | None = None
        self.client = None

    @property
    def conectado(self) -> bool:
        return self.dev is not None

    def laco_de_conexao(self) -> None:
        avisou = False
        while True:
            if self.dev is None:
                try:
                    from openrgb import OpenRGBClient
                    client = OpenRGBClient("127.0.0.1", 6742, "coach-luzes")
                    if achar(client, "KEYBOARD", "RGB_TECLADO"):
                        dev = Dispositivos.do_cliente(client)
                        with self.lock:
                            self.client, self.dev = client, dev
                            self.mixer.definir_layout(dev.layout())
                        log("OpenRGB conectado: " + ", ".join(d.name for d in dev.todos()))
                        avisou = False
                    else:
                        client.disconnect()
                except Exception as e:  # servidor fora, detecção em andamento, etc.
                    if not avisou:
                        log(f"OpenRGB indisponível ({type(e).__name__}); tentando a cada {RECONECTA_S:.0f}s")
                        avisou = True
            time.sleep(RECONECTA_S)

    def enviar(self, quadro: tuple) -> None:
        if self.dev is None:
            return
        try:
            self.dev.enviar(*quadro)
        except Exception as e:
            log(f"OpenRGB caiu ({type(e).__name__}); reconectando")
            with self.lock:
                self.dev = None
                self.client = None
                self.mixer.definir_layout(Layout.sintetico())

    def status(self) -> dict:
        d = self.dev
        nome = lambda x: x.name if x is not None else None  # noqa: E731
        return {
            "openrgb": d is not None,
            "dispositivos": {
                "teclado": nome(d.kb) if d else None,
                "ram": nome(d.ram) if d else None,
                "placa": nome(d.placa) if d else None,
            },
        }


def criar_handler(mixer: Mixer, hw: Hardware, lock: threading.Lock):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # silencia o log por requisição
            pass

        def _json(self, code: int, corpo: dict) -> None:
            dados = json.dumps(corpo).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(dados)))
            self.end_headers()
            self.wfile.write(dados)

        def _corpo(self) -> dict:
            n = int(self.headers.get("Content-Length") or 0)
            if not n:
                return {}
            try:
                v = json.loads(self.rfile.read(n))
                return v if isinstance(v, dict) else {}
            except json.JSONDecodeError:
                return {}

        def do_GET(self):
            if self.path == "/status":
                with lock:
                    self._json(200, {**hw.status(), **mixer.status()})
            else:
                self._json(404, {"erro": "rota desconhecida"})

        def do_POST(self):
            c = self._corpo()
            with lock:
                if self.path == "/efeito":
                    if isinstance(c.get("lote"), list):
                        ok = mixer.disparar_lote(c["lote"])
                    else:
                        ok = mixer.disparar(str(c.get("efeito", "")), c.get("params"))
                elif self.path == "/estado":
                    mixer.estado(bool(c.get("morto")), float(c.get("respawnEm") or 0), bool(c.get("teste")))
                    ok = True
                elif self.path == "/carregando":
                    mixer.carregar(bool(c.get("ativo")), bool(c.get("teste")), c.get("estimativa"))
                    ok = True
                elif self.path == "/partida":
                    mixer.partida(bool(c.get("ativa")))
                    ok = True
                elif self.path == "/reset":
                    mixer.reset()
                    ok = True
                else:
                    self._json(404, {"erro": "rota desconhecida"})
                    return
                self._json(200, {"ok": ok, **mixer.status()})

    return Handler


def servir(porta: int) -> None:
    lock = threading.Lock()
    mixer = Mixer(Layout.sintetico())
    hw = Hardware(mixer, lock)
    threading.Thread(target=hw.laco_de_conexao, daemon=True).start()

    srv = ThreadingHTTPServer(("127.0.0.1", porta), criar_handler(mixer, hw, lock))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    log(f"luzes em http://127.0.0.1:{porta}")

    try:
        while True:
            inicio = time.perf_counter()
            quadro = None
            with lock:
                if mixer.precisa_desenhar():
                    quadro = mixer.quadro()
            if quadro is not None:
                hw.enviar(quadro)
            time.sleep(max(0.0, 1 / FPS - (time.perf_counter() - inicio)))
    except KeyboardInterrupt:
        pass
    finally:
        with lock:
            mixer.partida(False)   # não deixa o flag travando o Beber Água


def demo(nome: str, params: dict) -> None:
    client = connect(30, "coach-luzes-demo")
    dev = Dispositivos.do_cliente(client)
    mixer = Mixer(dev.layout())
    if not mixer.disparar(nome, params):
        raise SystemExit(f"efeito desconhecido: {nome}")
    frames, t0 = 0, time.perf_counter()
    while mixer.status()["efeitoAtual"] is not None:
        dev.enviar(*mixer.quadro())
        frames += 1
        time.sleep(max(0.0, frames / FPS - (time.perf_counter() - t0)))
    dev.pintar(BRANCO)
    dt = time.perf_counter() - t0
    log(f"{nome}: {frames} quadros em {dt:.1f}s ({frames / dt:.0f} fps) | {', '.join(d.name for d in dev.todos())}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--porta", type=int, default=PORTA)
    ap.add_argument("--demo", help="kill, double, triple, quadra, penta, assist, firstblood, shutdown, "
                                   "ace, dragao, barao, arauto, vastilarvas, vitoria, derrota, agua")
    ap.add_argument("--tipo", default="Fire", help="tipo do dragão no --demo")
    a = ap.parse_args()
    if a.demo:
        atalhos = {"double": 2, "triple": 3, "quadra": 4, "penta": 5}
        if a.demo in atalhos:
            demo("multikill", {"n": atalhos[a.demo]})
        else:
            demo(a.demo, {"tipo": a.tipo})
    else:
        servir(a.porta)


if __name__ == "__main__":
    main()

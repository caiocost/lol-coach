// Gera docs/dispositivos.md a partir da lista oficial do OpenRGB.
//
// O coach anima três coisas: teclado (obrigatório para os letreiros), RAM e
// placa-mãe. E anima pelo modo "Direct" do OpenRGB (cor por LED, quadro a
// quadro), então um controlador sem Direct é reconhecido pelo OpenRGB mas não
// acende no coach. A conexão diz o que ele precisa: USB funciona direto;
// SMBus/I2C (quase toda RAM e parte das placas) precisa do driver PawnIO e do
// OpenRGB rodando como administrador.
//
// Uso: node scripts/gerar-dispositivos.mjs   (baixa o CSV da versão embarcada)
import { writeFileSync } from "node:fs";

const VERSAO = "1.0";   // a mesma do OpenRGB que o empacotar.ps1 embarca
const URL_CSV = `https://openrgb.org/data/supported_devices_${VERSAO}.csv`;

/** CSV com aspas e quebra de linha dentro do campo. */
function lerCsv(txt) {
  const linhas = []; let campo = "", linha = [], aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (aspas) {
      if (c === '"' && txt[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ",") { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && txt[i + 1] === "\n") i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = "";
    } else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  const [cab, ...resto] = linhas;
  return resto.filter((l) => l.length > 1).map((l) => Object.fromEntries(cab.map((h, i) => [h, l[i] ?? ""])));
}

const txt = await (await fetch(URL_CSV)).text();
const todos = lerCsv(txt);

const GRUPOS = [
  ["keyboard", "Teclados", "Obrigatório para os letreiros (nome do campeão, KILL, pixel art). Precisa ser RGB **por tecla**."],
  ["ram", "Memória RAM", "Extra: ondas e flashes acompanham o teclado."],
  ["motherboard", "Placas-mãe", "Extra: pulsa junto com os efeitos."],
];

const categorias = (d) => d.Category.split("\n").map((c) => c.trim().toLowerCase());
const precisaAdmin = (t) => /smbus|i2c/i.test(t);
const limpo = (s) => s.replace(/\s+/g, " ").trim().replace(/\|/g, "/");

let md = `# Dispositivos compatíveis com as luzes

Gerado de [openrgb.org/devices_${VERSAO}](https://openrgb.org/devices_${VERSAO}.html) (OpenRGB ${VERSAO}, a versão que vem no pacote) por \`scripts/gerar-dispositivos.mjs\`.

A lista é por **família de controlador** (o chip que o OpenRGB conversa), não por produto. Se o seu teclado não aparece pelo nome, procure pela marca: vários modelos usam o mesmo controlador. O jeito mais rápido de saber é abrir o coach: o menu **Luzes** da bandeja mostra o que foi detectado.

- ✅ **anima no coach**: o OpenRGB controla LED por LED (modo Direct).
- ⚠️ **problemático**: o OpenRGB suporta com ressalvas; veja a página do dispositivo no site deles.
- 🔒 **precisa de PawnIO + admin**: conexão SMBus/I2C. Instale o [PawnIO](https://pawnio.eu) e rode o OpenRGB como administrador. Sem isso, só os dispositivos USB acendem.
- Famílias sem o modo Direct ficam de fora: o OpenRGB reconhece, mas o coach não consegue animar.

Testado de verdade: **HyperX Alloy Origins** (teclado), **Kingston Fury DDR5** (RAM), **ASUS TUF GAMING X670E-PLUS** (placa).
`;

const resumo = [];
for (const [cat, titulo, nota] of GRUPOS) {
  const vistos = new Set();
  const linhas = todos
    .filter((d) => categorias(d).includes(cat))
    .filter((d) => d.Direct.includes("✔") || d.Direct.includes("🚨"))
    .map((d) => ({
      nome: limpo(d.RGBController),
      tipo: limpo(d.Type),
      ok: d.Direct.includes("✔") ? "✅" : "⚠️",
      obs: precisaAdmin(d.Type) ? "🔒" : "",
    }))
    .filter((l) => { const k = `${l.nome}|${l.tipo}`; if (vistos.has(k)) return false; vistos.add(k); return true; })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt"));
  resumo.push(`${titulo}: ${linhas.length}`);
  md += `\n## ${titulo} (${linhas.length})\n\n${nota}\n\n| Controlador | Conexão | Coach | Precisa |\n|---|---|---|---|\n`;
  for (const l of linhas) md += `| ${l.nome} | ${l.tipo} | ${l.ok} | ${l.obs} |\n`;
}

writeFileSync(new URL("../docs/dispositivos.md", import.meta.url), md);
console.log(`  docs/dispositivos.md — ${resumo.join(", ")}`);

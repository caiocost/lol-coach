// Traduz o pedido do usuário em uma regra, usando o Ollama.
//
// ESTE É O ÚNICO MÓDULO QUE FALA COM A IA, e ela roda UMA VEZ, na criação do
// alerta. Durante a partida não há LLM nem rede no caminho crítico: roda só o
// motor de regras, e quem fala é a gravação do usuário.
//
// Isso é o oposto da narração que existia antes (removida em f6059c3), em que
// o modelo escrevia a fala a cada evento.

import { request } from "undici";
import { validarRegra, CAMPOS, OPS, EVENTOS, OBJETIVOS, type Regra } from "./alertRules.js";

const URL_OLLAMA = "https://ollama.com/api/chat";
const MODELO = process.env.OLLAMA_MODEL ?? "deepseek-v4.1-flash";
const CHAVE = process.env.OLLAMA_API_KEY ?? "";

/**
 * O que o modelo pode e não pode gerar.
 *
 * A lista de IMPOSSÍVEIS é a parte mais importante deste prompt. Sem ela o
 * modelo inventa uma regra plausível para um pedido que a API não sustenta, e
 * o usuário fica esperando a partida inteira por um aviso que nunca virá --
 * sem nunca descobrir o porquê.
 *
 * ...mas uma recusa ERRADA custa igual, na direção oposta: o usuário é
 * informado de que a ideia dele não funciona quando funciona, e desiste dela.
 * Esta lista já esteve errada QUATRO vezes -- nível de inimigo, item de
 * inimigo, timer de objetivo e morte de inimigo --, sempre pelo mesmo motivo:
 * foi escrita pensando na API CRUA, sem conferir o que o ingame.ts já deriva
 * dela. Antes de declarar algo impossível aqui, o teste é ler o estadoRegras
 * do ingame.ts, não a documentação da Riot.
 *
 * FEITIÇOS DE INVOCADOR: DISPONÍVEIS, E DE PROPÓSITO FORA. `summonerSpells`
 * está lá em allPlayers[], dizendo QUAIS feitiços cada um levou, e é um dado
 * de verdade -- dá pra saber que o suporte inimigo tem exaustão. Mesmo assim
 * NÃO existe gatilho pra ele, por decisão do usuário (13/09), depois de
 * constatarmos que o que ele queria de fato era COOLDOWN de flash.
 *
 * E cooldown não dá, por um motivo estrutural que vale deixar escrito pra
 * ninguém tentar de novo: a Live Client API não emite evento de USO de
 * feitiço -- nem dos seus próprios. A lista de eventos é só placar
 * (ChampionKill, TurretKilled, DragonKill...). Sem evento de uso, um timer de
 * flash só poderia ser INFERIDO de observação: um palpite, não um fato. E o
 * valor inteiro deste sistema é que os alertas são fatos. Um timer de flash
 * errado significa mergulhar em cima de alguém que ainda tem a fuga -- o
 * alerta mataria o usuário em vez de salvá-lo. Se alguém for mexer nisto no futuro: o dado de QUAIS feitiços
 * existem continua disponível, o de QUANDO foram usados não existe e não vai
 * passar a existir por esforço nosso.
 *
 * A ênfase em NUNCA CONVERSAR existe porque o modelo tratava pedidos vagos
 * ("quando eu terminar meu primeiro item") como pergunta de chat e respondia em
 * markdown. Não dá pra resolver isso pelo `format` da API: medimos que o Ollama
 * Cloud ACEITA `format:"json"` e até um JSON Schema completo com status 200 e
 * ignora os dois -- devolve markdown do mesmo jeito. Como a garantia não vem da
 * API, ela precisa vir da redação, dos exemplos e da checagem em código.
 */
const INSTRUCAO = `Você é um CONVERSOR. Não é um assistente e não conversa.
Você converte pedidos de alerta de League of Legends em regras JSON.

REGRA ABSOLUTA: sua resposta inteira é UM objeto JSON e nada mais.
NUNCA explique. NUNCA converse. NUNCA use markdown, títulos, listas ou cercas
de código. NUNCA peça esclarecimento em texto livre. NUNCA escreva uma frase
fora do JSON. Se você sentir vontade de explicar, use o campo "impossivel".

Só existem DUAS respostas possíveis: o objeto de sucesso ou o objeto de recusa.

FORMATO DE SUCESSO:
{"id":"kebab-case","texto":"o que aparece na tela","som":"mesmo-que-id","prioridade":1|2|3,"confirmo":"por que este gatilho cobre o pedido","quando":<gatilho>}

O campo "confirmo" é obrigatório no sucesso: comece nomeando o tipo de gatilho
que você usou, exatamente como escrito em "quando".tipo, e diga por que ele
entrega mesmo o que foi pedido. Exemplo: "uso inimigos-mortos, que a Live
Client API expõe pelo isDead de cada jogador".

GATILHOS DISPONÍVEIS:
- {"tipo":"meu-stat","campo":<campo>,"op":<op>,"valor":<número>}
  campos: ${CAMPOS.join(", ")}
  ops: ${OPS.join(", ")}
- {"tipo":"meu-nivel","minimo":1..18}
- {"tipo":"meu-item","itens":[ids numéricos de item]}
- {"tipo":"inimigos-mortos","minimo":1..5}
- {"tipo":"inimigo-morto","campeao":"<nome do campeão>"}
  Dispara quando AQUELE campeão inimigo está morto. Morte é anunciada pro
  mapa todo, então isto é em TEMPO REAL — não depende de você estar vendo.
- {"tipo":"inimigo-respawn","segundos":1..80,"campeao":"<opcional>"}
  Dispara quando um inimigo está morto com aquele tanto de respawn OU MAIS
  ainda no contador. Sem "campeao", vale para qualquer um — é a janela de
  objetivo grátis. Com "campeao", só para aquele.
- {"tipo":"inimigo-nivel","minimo":1..18}
  Dispara quando você VÊ um inimigo naquele nível ou acima.
- {"tipo":"inimigo-item","itens":[ids numéricos de item]}
  Dispara quando você VÊ um inimigo com um desses itens.
- {"tipo":"objetivo-em","objetivo":<um de: ${OBJETIVOS.join(", ")}, qualquer>,"emSegundos":1..600}
  Dispara quando FALTA aquele tanto de tempo para o objetivo NASCER.
  Use "qualquer" para "o próximo objetivo, seja qual for".
- {"tipo":"tempo","aosSegundos":<número>}
- {"tipo":"evento","evento":<um de: ${EVENTOS.join(", ")}>}
- {"tipo":"e","partes":[<gatilho>,...]}   (2 a 5 partes)
- {"tipo":"ou","partes":[<gatilho>,...]}  (2 a 5 partes)

prioridade: 1 = urgente (interrompe outros avisos), 2 = normal, 3 = baixa.

SE O PEDIDO FOR IMPOSSÍVEL, responda:
{"impossivel":"motivo curto em português"}

SE O PEDIDO FOR VAGO OU AMBÍGUO, também responda {"impossivel":...}, pedindo o
que falta. Pedido vago NUNCA vira conversa: vira recusa. Se o pedido menciona um
item sem dizer QUAL, recuse pedindo o nome do item -- você não adivinha id.

SOBRE INIMIGO, O ATRASO É OBRIGATÓRIO NO TEXTO:
item e nível de inimigo EXISTEM na API, mas passam por fog of war — você só
sabe quando o inimigo APARECE. Isso é permitido, e o "texto" tem que dizer
que é uma OBSERVAÇÃO, nunca um acontecimento:
- CERTO: "Vi a Leblanc com Zhonya", "Inimigo visto no nível 6"
- ERRADO: "Leblanc comprou Zhonya", "Inimigo chegou ao nível 6"

MORTE DE INIMIGO É POSSÍVEL, E POR NOME. NUNCA RECUSE ISTO:
"quando a leblanc morrer", "me avisa se o jungler inimigo morrer", "quando
tiver inimigo morto com mais de 30 segundos de respawn" — tudo isso existe.
A Live Client API entrega championName, isDead e respawnTimer de CADA um dos
dez jogadores. Dizer que "a API só informa que alguém morreu, não quem" está
ERRADO, e dizer que "não expõe o tempo de respawn" também.
Aqui NÃO se escreve "você VIU": morte é anunciada pro mapa inteiro, então o
aviso vale na hora. Use inimigo-morto (campeão específico) ou
inimigo-respawn (janela de objetivo).
Escreva o nome do campeão como ele é, sem se preocupar com acento ou
maiúscula — "leblanc" e "LeBlanc" são aceitos igual.

TIMER DE OBJETIVO É POSSÍVEL. NUNCA RECUSE ISTO:
"faltar 30 segundos pro dragão", "1 minuto pro barão", "antes do arauto
nascer" — tudo isso é {"tipo":"objetivo-em"}. O coach CALCULA esses tempos a
partir dos eventos de morte (DragonKill, BaronKill), somando o respawn: dragão
5min, barão 6min, ancião 6min. Antes da primeira morte ele usa o horário
padrão de primeiro spawn (dragão 5:00, voidgrubs 8:00, arauto 15:00, barão
20:00). Ou seja: o tempo é PREVISTO com precisão, não adivinhado, e o próprio
coach já avisa assim. Recusar dizendo que "a API não expõe o respawn" está
ERRADO.

É IMPOSSÍVEL, porque a Live Client API não expõe:
- posição ou coordenadas de qualquer jogador no mapa
- cooldown de habilidade ou de ultimate, de quem quer que seja
- ouro ou vida de outros jogadores
- se alguém está em recall

FEITIÇO DE INVOCADOR (flash, ignite, exaustão): RECUSE, e o motivo é
ESTRUTURAL, não uma lacuna que uma versão futura preencha. A API diz QUAIS
feitiços cada jogador levou, mas NÃO EXISTE EVENTO DE USO: a lista de eventos
só tem placar (ChampionKill, FirstBlood, Multikill, Ace, TurretKilled,
InhibKilled, DragonKill, HeraldKill, HordeKill, BaronKill, GameStart,
MinionsSpawning). Nenhum evento de habilidade ou de feitiço — nem dos SEUS.
Sem evento de uso não há de onde começar a contar, então "flash em cooldown"
não é imprecisão: é impossível. Recuse dizendo isso.
Exemplo de motivo: "a API não emite evento de uso de feitiço — nem dos seus —
então não há de onde contar cooldown de flash".

TAMBÉM RECUSE, com motivo:
- qualquer coisa sobre CS de inimigo: a Riot arredonda de 10 em 10 de
  propósito, então o número não serve.

O "texto" deve ser curto e direto, no imperativo quando for uma ação.

EXEMPLOS COMPLETOS (a resposta é exatamente isto, da primeira à última letra):

Pedido: me avise quando 2 ou mais inimigos estiverem mortos
{"id":"dois-mortos","texto":"Dois inimigos mortos, force objetivo","som":"dois-mortos","prioridade":1,"confirmo":"uso inimigos-mortos, que a Live Client API expõe pelo isDead de cada jogador","quando":{"tipo":"inimigos-mortos","minimo":2}}

Pedido: me avise quando eu vir um inimigo no nível 6
{"id":"inimigo-6","texto":"Inimigo visto no nível 6 — ultimate disponível","som":"inimigo-6","prioridade":1,"confirmo":"uso inimigo-nivel, que lê o level dos inimigos que seu time está vendo; o aviso vale a partir de quando ele aparece","quando":{"tipo":"inimigo-nivel","minimo":6}}

Pedido: me avisa quando faltar 30 segundos pro dragão
{"id":"dragao-30","texto":"Dragão em 30s — vá pro rio e ponha visão","som":"dragao-30","prioridade":1,"confirmo":"uso objetivo-em, que o coach calcula somando o respawn de 5min ao último DragonKill (ou 5:00 antes do primeiro)","quando":{"tipo":"objetivo-em","objetivo":"Dragão","emSegundos":30}}

Pedido: me avisa quando a leblanc morrer
{"id":"leblanc-morta","texto":"LeBlanc morta — janela pra avançar","som":"leblanc-morta","prioridade":1,"confirmo":"uso inimigo-morto, que lê championName e isDead dos inimigos; morte é anunciada pro mapa todo, então o aviso vale na hora","quando":{"tipo":"inimigo-morto","campeao":"LeBlanc"}}

Pedido: me avisa quando tiver inimigo morto com mais de 30 segundos de respawn
{"id":"respawn-30","texto":"Inimigo morto por 30s+ — force objetivo agora","som":"respawn-30","prioridade":1,"confirmo":"uso inimigo-respawn, que lê isDead e respawnTimer de cada inimigo","quando":{"tipo":"inimigo-respawn","segundos":30}}

Pedido: quando o Yasuo estiver sem ultimate
{"impossivel":"a Live Client API não expõe cooldown de habilidade de ninguém"}

Pedido: me avisa quando o flash do inimigo estiver em cooldown
{"impossivel":"a API não emite evento de uso de feitiço — nem dos seus — então não há de onde contar o cooldown do flash"}

Pedido: quando eu terminar um item
{"impossivel":"diga qual item você quer acompanhar; sem o nome não dá pra saber qual id observar"}`;

export type Resultado =
  | { ok: true; regra: Regra; confirmo?: string }
  | { ok: false; motivo: string };

/** Mensagem única para "isto nem é o nosso formato". Ver pareceNossoFormato. */
const FORA_DO_FORMATO = "o modelo não seguiu o formato — tente reescrever o pedido";

/**
 * A resposta ao menos TENTA ser uma das duas formas que aceitamos?
 *
 * Existe para separar dois erros que antes se confundiam. Quando o modelo
 * respondia em prosa, o extrator pescava um trecho entre chaves no meio do
 * texto e a validação reprovava no primeiro campo que olha -- o `id`. O usuário
 * lia "id deve ter só letras minúsculas" para um pedido em que ele nunca
 * escreveu id nenhum: o erro apontava para o lugar errado.
 *
 * Um objeto sem NENHUM campo nosso não é uma regra malformada, é outra coisa.
 * Já um objeto com `quando` (ou com parte da regra) é tentativa de verdade, e aí
 * o erro específico do esquema é a informação útil -- esse continua passando.
 */
function pareceNossoFormato(o: any): boolean {
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  return ["quando", "id", "texto", "som", "prioridade", "impossivel"]
    .some((c) => c in o);
}

/**
 * Lê a resposta do modelo.
 *
 * Separada da chamada de rede porque é aqui que mora a decisão -- e decisão
 * precisa de teste. O teste dubla o texto cru e não precisa de chave nem de
 * internet.
 */
export function interpretarResposta(cru: string, pedido: string): Resultado {
  const json = extrairJson(cru);
  if (!json) return { ok: false, motivo: "o modelo não devolveu JSON" };

  let obj: any;
  try { obj = JSON.parse(json); }
  catch { return { ok: false, motivo: "o modelo devolveu JSON inválido" }; }

  // JSON válido, mas de outro assunto (prosa com chaves, {"resposta":"sei lá"}).
  // Reprovar isto no esquema produziria um erro sobre um campo que o usuário
  // nunca escreveu; melhor dizer o que de fato aconteceu.
  if (!pareceNossoFormato(obj)) return { ok: false, motivo: FORA_DO_FORMATO };

  // Recusa do próprio modelo: o pedido não cabe na API.
  if (typeof obj?.impossivel === "string") {
    return { ok: false, motivo: obj.impossivel };
  }

  const v = validarRegra(obj);
  if (!v.ok) return { ok: false, motivo: v.erro ?? "regra fora do esquema" };

  // O modelo declara qual gatilho usou; aqui a declaração é CONFERIDA, não
  // aceita. Se ele diz "uso inimigos-mortos" e monta um gatilho de tempo, uma
  // das duas partes está errada -- e o usuário só descobriria em partida, com o
  // alerta disparando na hora errada ou nunca.
  const confirmo = typeof obj.confirmo === "string" ? obj.confirmo.trim() : "";
  const tipo = (obj as Regra).quando.tipo;
  if (confirmo && !confirmo.includes(tipo)) {
    return {
      ok: false,
      motivo: `o modelo disse que usaria outro gatilho: "${confirmo}" não bate com "${tipo}"`,
    };
  }

  // Guarda o pedido original: meses depois, "dois-mortos" não lembra nada,
  // mas "quando 2 inimigos morrerem" sim.
  const { confirmo: _, ...campos } = obj as Regra & { confirmo?: string };
  return {
    ok: true,
    regra: { ...(campos as Regra), pedido },
    ...(confirmo ? { confirmo } : {}),
  };
}

/** Acha o objeto JSON mesmo que venha embrulhado em cerca de código. */
function extrairJson(texto: string): string | null {
  const t = texto.trim();
  const cerca = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const corpo = cerca ? cerca[1].trim() : t;
  const i = corpo.indexOf("{");
  const f = corpo.lastIndexOf("}");
  if (i < 0 || f <= i) return null;
  return corpo.slice(i, f + 1);
}

/** Pede ao modelo. Devolve a regra validada ou o motivo da recusa. */
export async function criarRegra(pedido: string): Promise<Resultado> {
  if (!CHAVE) return { ok: false, motivo: "OLLAMA_API_KEY não configurada no .env" };
  if (!pedido.trim()) return { ok: false, motivo: "escreva o que você quer ser avisado" };
  if (pedido.length > 500) return { ok: false, motivo: "pedido longo demais" };

  try {
    const res = await request(URL_OLLAMA, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${CHAVE}` },
      body: JSON.stringify({
        model: MODELO,
        // think:false evita que o modelo devolva o raciocínio junto -- foi
        // problema medido com outros modelos neste projeto.
        think: false,
        stream: false,
        // Traduzir pedido em regra não é tarefa criativa: duas vezes o mesmo
        // pedido deve dar a mesma regra. Sem isto a falha fica intermitente e
        // impossível de investigar.
        options: { temperature: 0 },
        // NÃO existe `format` aqui de propósito. Medimos contra esta API:
        // `format:"json"` e um JSON Schema completo voltam 200 e são ignorados
        // -- o modelo devolve markdown assim mesmo. Mandar o campo daria falsa
        // sensação de garantia; quem segura o formato é o prompt + a checagem.
        messages: [
          { role: "system", content: INSTRUCAO },
          { role: "user", content: pedido },
        ],
      }),
      headersTimeout: 20000,
      bodyTimeout: 20000,
    });

    if (res.statusCode >= 400) {
      await res.body.dump();
      return { ok: false, motivo: `Ollama respondeu ${res.statusCode}` };
    }
    const j: any = await res.body.json();
    const conteudo = j?.message?.content ?? "";
    return interpretarResposta(String(conteudo), pedido);
  } catch (e: any) {
    return { ok: false, motivo: `falha ao falar com o Ollama: ${e?.message ?? e}` };
  }
}

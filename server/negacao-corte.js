// Porte literal do MCP do TJRO (verificar.js, 1.41.x; regra calibrada no TRT14 e remedida nos recibos do TJRO em 22/10/2026).
// v1.11.0 do TRF1 (07/11/2026): sem medição própria neste corpus — o aviso é conservador (NÃO citar sem ler a frase inteira).
// Entrada: texto em norm1 (minúsculas, sem acento, pontuação preservada).

// NEGAÇÃO OMITIDA NO CORTE (Leva A, red team 22/10/2026): "a cobrança da tarifa [...] é devida" sobre "a cobrança da tarifa NÃO é
// devida" saía ✅ LITERAL sem alerta — negacaoAntes só olha antes do 1º fragmento e o vão entre fragmentos não era lido. Porte da regra
// já calibrada no MCP do TRT14 (rodadas 2, 3 e final de 22/10/2026, sobre recibos reais: negação em QUALQUER ponto da lacuna alarmava
// 31% das elipses aleatórias curtas e 83% das longas). Só conta a negação que REGE o fragmento seguinte: na mesma oração dele (depois
// do último . ; : da lacuna), sem quebra de oração entre ela e o fragmento e a até NEG_CORTE_DIST palavras; ou presa ao fragmento
// ANTERIOR, seguida só de aposto(s) ("não é, conforme o laudo, devido"). Negação dentro de inciso entre vírgulas ou parênteses, inteiro
// na lacuna (", e não tributária,"), não rege o seguinte. Remedido nos recibos do TJRO (harness/medir-negacao-corte.mjs).
const RE_NEG_LACUNA = new RegExp(String.raw`(?<![a-z0-9])(?:nao|nem|nunca|jamais|inexist[a-z]*|indevid[a-z]*|improced[a-z]*|` +
  String.raw`improvid[a-z]*|afast[a-z]*|descab[a-z]*|incabive[a-z]*|rejeit[a-z]*|indefer[a-z]*|nego|negou|negar|negad[oa]s?|sem razao|` +
  String.raw`exclu(?:i|ir|o|iu|indo|id[oa]s?|sao|soes|a|am|e|em|ira|iram)|descaracteriz[a-z]*|absolv[a-z]*|extirp[a-z]*|decot[a-z]*|` +
  String.raw`retir(?:ar|o|a|ou|ada|ado|adas|ados|ando|e|em)(?= (?:d[aeo]s?|na|no) (?:condenacao|sentenca|comando|titulo|calculo))|` +
  String.raw`exim(?:ir|o|e|em|iu|ida|ido|idas|idos|indo)|isent(?:ar|o|a|os|as|ou|ando|e|em)|inviav[a-z]*|impossib[a-z]*|impossive[a-z]*|` +
  String.raw`sem(?! (?:prejuizo|embargo|duvida|razao)(?![a-z0-9]))|deix(?:o|a|ou|ar|ando|ei|amos|aram|e|em) de)(?![a-z0-9])`, "g");
// TJRO (medido nos recibos, 22/10/2026): "não é demais ressaltar" afirma; "declaratória de inexistência de débito/relação" é o NOME da ação
const RE_NOME_DA_ACAO = /declaratoria (?:de )?$/;
const RE_NEG_LACUNA_FALSA = /^nao (?:e demais|obstante|so|apenas|somente|(?:havendo|ha|houve|resta|restam|restando|pairam?) (?:qualquer |mais )?duvidas?|(?:se )?pode (?:deixar|olvidar|ignorar|negar)|se (?:desconhece|ignora|olvida|nega)|ha como negar|(?:se )?deix[a-z]* de)(?![a-z0-9])/;
const RE_NEG_ANTES_DE_DEIXAR = /(?<![a-z0-9])(?:nao|nem|nunca|jamais)(?: (?:se|lhe|lhes|o|a|os|as|me|nos))?\s*$/;
const RE_FIM_ORACAO_LACUNA = /[.;:!?](?!\d)/g;
const RE_QUEBRA_PONTE = /[.;:!?](?!\d)|,\s*(?:mas|e|ou|que|o que|porque|pois|porquanto|embora|ainda|conforme|sendo)(?![a-z0-9])|\smas\s/;
const RE_QUEBRA_ANTES_NEG = /[,]|(?<![a-z0-9])(?:e|mas|ou|que|pois|porque|porquanto|embora|quando|onde|se|enquanto|conquanto)(?![a-z0-9])/;
const RE_INCISO_COORDENADO = /^\s*(?:e|mas|ou|porem|todavia|contudo|entretanto|logo|portanto)(?![a-z0-9])/;
const RE_VIRGULA_LACUNA = /(?<!\d),|,(?!\d)|\s-\s/g;
export const NEG_CORTE_DIST = 6, NEG_CORTE_APOSTO_MAX = 24;
const nPalavras = (x) => (x.match(/[a-z0-9]+/g) || []).length;
export function negacaoNoCorte(lac, seguinte = "", anterior = "") {
  let corte = 0;
  for (const m of lac.matchAll(RE_FIM_ORACAO_LACUNA)) corte = m.index + 1;
  const cauda = lac.slice(corte);
  const sep = [...cauda.matchAll(RE_VIRGULA_LACUNA)];
  const virg = sep.map((m) => m.index), virgFim = sep.map((m) => m.index + m[0].length);
  const nSeg = virg.length;
  const comSeguinte = cauda + " " + seguinte;
  const parens = [];
  { const pilha = [];
    for (let k = 0; k < cauda.length; k++) {
      if (cauda[k] === "(") pilha.push(k);
      else if (cauda[k] === ")" && pilha.length) { const ab = pilha.pop(); if (!pilha.length) parens.push([ab, k]); }
    } }
  const dentroDeParenteses = (idx) => parens.some(([ab, fe]) => idx > ab && idx < fe);
  const cands = [];
  for (const m of comSeguinte.matchAll(RE_NEG_LACUNA)) {
    if (m.index >= cauda.length) break;
    if (RE_NEG_LACUNA_FALSA.test(comSeguinte.slice(m.index).replace(/[^a-z0-9]+/g, " "))) continue;
    if (m[0].startsWith("deix") && RE_NEG_ANTES_DE_DEIXAR.test(cauda.slice(0, m.index).replace(/[^a-z0-9]+/g, " "))) continue;
    if (dentroDeParenteses(m.index)) continue;
    if (m[0].startsWith("inexist") && RE_NOME_DA_ACAO.test(((corte ? "" : anterior) + cauda.slice(0, m.index)).slice(-24).replace(/[^a-z0-9]+/g, " "))) continue;
    cands.push(m);
  }
  for (const op of cands.reverse()) {
    const fimOp = op.index + op[0].length;
    const i = virg.filter((v) => v < op.index).length;
    if (i === nSeg) {
      const ponte = cauda.slice(fimOp);
      if (RE_QUEBRA_PONTE.test(ponte) || nPalavras(ponte) > NEG_CORTE_DIST) continue;
      return [corte + op.index, corte + fimOp];
    }
    if (i === 0) {
      if (RE_QUEBRA_ANTES_NEG.test(cauda.slice(0, op.index))) continue;
      const ponte0 = cauda.slice(fimOp, virg[0]);
      if (RE_QUEBRA_PONTE.test(ponte0) || nPalavras(ponte0) > NEG_CORTE_DIST) continue;
      if (cauda.slice(virgFim[nSeg - 1]).trim()) continue;
      const incisos = [];
      for (let k = 0; k + 1 < nSeg; k++) incisos.push(cauda.slice(virgFim[k], virg[k + 1]));
      if (!incisos.length || incisos.some((x) => RE_INCISO_COORDENADO.test(x))) continue;
      if (incisos.reduce((n, x) => n + nPalavras(x), 0) > NEG_CORTE_APOSTO_MAX) continue;
      return [corte + op.index, corte + fimOp];
    }
  }
  return null;
}


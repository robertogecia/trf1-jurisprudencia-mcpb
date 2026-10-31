// v1.10.0 — auditoria das citações de uma peça e lista de leitura, SEM REDE, sobre os recibos locais.
// Ideia e comparador de relator do MCP do TJRO (auditoria.js/cadeia.js v1.39–1.41), reescritos para o que o TRF1 expõe: na base trf1 o
// portal entrega índice (relator, turma, data), ementa e dispositivo, nunca o fecho do voto; na TNU, o fecho vem do inteiro teor.
// Por isso, aqui: só 🔴 para dígito verificador inválido; divergência de relator, turma ou data é 🟠 "confira" com os dois valores; ✅ só quando
// algo foi de fato comparado e bateu, dizendo que a base é o índice do portal; nunca ✅ por "não achei problema". NADA aqui diz que o julgado
// sustenta a tese: isso é a leitura, verificar_citacao_trf1 para a frase entre aspas e o revisor-adversarial.
import { listarRecibos, soDigitos, fold, regexTermo } from "./lib.js";

export const AUDITORIA_MAX_CHARS = 400_000;

export function dvCnjValido(d20) {
  if (!/^\d{20}$/.test(d20)) return false;
  return 98n - (BigInt(d20.slice(0, 7) + d20.slice(9) + "00") % 97n) === BigInt(d20.slice(7, 9));
}
const mascara = (d) => `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16)}`;

// ------------------------------------------------------------------ relator (comparador do TJRO, sem a semente de nomes)
const TITULOS = new Set(["desembargador", "desembargadora", "juiz", "juiza", "convocado", "convocada", "ministro", "ministra", "relator", "relatora",
  "substituto", "substituta", "direito", "presidente", "redator", "redatora", "federal", "federais", "fed", "des", "desa", "turma", "regional", "conv"]);
const AGNOMES = new Set(["filho", "filha", "junior", "neto", "neta", "sobrinho", "sobrinha", "segundo", "terceiro"]);
export const nomesDoRelator = (nome) => fold(nome).split(/[^a-z]+/).filter((w) => w.length >= 4 && !TITULOS.has(w) && !AGNOMES.has(w));
const SOBRENOMES_COMUNS = new Set("silva santos oliveira souza sousa pereira costa rodrigues almeida lima ferreira gomes ribeiro martins carvalho alves neves araujo barbosa cardoso".split(" "));
/** "confere" | "ambiguo" | "diverge" | null. Nome único só confere se for o ÚLTIMO sobrenome de UM relator entre os `conhecidos` (os já lidos
 *  nesta máquina, como listas de nomes) e não for comum; sem `conhecidos`, nunca confere. Vários nomes conferem se o último coincide (red team 31/10:
 *  "João Batista" não pode conferir com "João Batista Moreira"). */
export function compararRelator(informado, doRecibo, conhecidos = []) {
  if (!informado || !doRecibo) return null;
  const al = nomesDoRelator(informado), bl = nomesDoRelator(doRecibo);
  if (!al.length || !bl.length) return null;
  const A = new Set(al), B = new Set(bl);
  const aEmB = [...A].every((w) => B.has(w)), bEmA = [...B].every((w) => A.has(w));
  if (aEmB && bEmA) return "confere";
  if (aEmB) {
    const unico = (palavras) => { const comW = conhecidos.filter((k) => palavras.every((w) => k.includes(w))); return comW.length === 1 && comW[0].length === B.size && comW[0].every((x) => B.has(x)); };
    if (A.size >= 2) return al[al.length - 1] === bl[bl.length - 1] || unico([...A]) ? "confere" : "ambiguo";
    const [w] = A;
    if (w.length < 5 || SOBRENOMES_COMUNS.has(w)) return "ambiguo";
    // nome único: só vale se não for o PRENOME do relator do recibo e for de um só relator entre os já lidos
    return bl.indexOf(w) > 0 && unico([w]) ? "confere" : "ambiguo";
  }
  if (bEmA) return al[al.length - 1] === bl[bl.length - 1] ? "confere" : "ambiguo";
  return "diverge";
}

// ------------------------------------------------------------------ turma/órgão
const ORD = { primeira: 1, segunda: 2, terceira: 3, quarta: 4, quinta: 5, sexta: 6, setima: 7, oitava: 8, nona: 9, decima: 10 };
const UNID = { primeira: 1, segunda: 2, terceira: 3, quarta: 4, quinta: 5, sexta: 6, setima: 7, oitava: 8, nona: 9 };
function numeroOrdinal(txt) {
  const t = fold(txt).replace(/[^a-z0-9ªº°\s-]/g, " ").replace(/-/g, " ").trim();
  const m = /^(\d{1,2})\s*[ªº°a]?$/.exec(t);
  if (m) return Number(m[1]);
  const ws = t.split(/\s+/);
  if (ws.length === 2 && ws[0] === "decima" && UNID[ws[1]]) return 10 + UNID[ws[1]];
  if (ws.length === 1 && ORD[ws[0]]) return ORD[ws[0]];
  return null;
}
const ROTULO_TIPO = { turma: "Turma", recursal: "Turma Recursal", secao: "Seção", corte: "Corte Especial", tnu: "Turma Nacional de Uniformização" };
const rotuloUnidade = (u) => { const [n, tipo] = u.split("|"); return /^\d+$/.test(n) ? `${n}ª ${ROTULO_TIPO[tipo] || tipo}` : (ROTULO_TIPO[tipo] || tipo); };
const RE_UNIDADE = /(?<![\p{L}\d])((?:d[ée]cim[ao][\s-]+)?(?:primeir|segund|terceir|quart|quint|sext|s[ée]tim|oitav|non)[ao]|\d{1,2})\s*(?:\.?[ªº°]|a\b)?\s*(turma recursal|turma|se[çc][ãa]o|corte especial|t(?![\p{L}])\.?)/giu;
/** Chaves "N|tipo" (ex.: "9|turma"; "tnu|tnu" e "corte|corte" sem número) encontradas num texto; vazio se nada legível. */
export function unidadesDoTexto(txt) {
  const out = new Set();
  const t = String(txt || "");
  for (const m of t.matchAll(RE_UNIDADE)) {
    const n = numeroOrdinal(m[1]);
    if (!n) continue;
    const tipo = /recursal/i.test(m[2]) ? "recursal" : /se[çc]/i.test(m[2]) ? "secao" : /corte/i.test(m[2]) ? "corte" : "turma";
    out.add(`${n}|${tipo}`);
  }
  if (/(?<![\p{L}])TNU(?![\p{L}])|turma\s+nacional/iu.test(t)) out.add("tnu|tnu");
  if (/corte\s+especial/iu.test(t)) out.add("corte|corte");
  return [...out];
}
const NOME = String.raw`(?:\p{Lu}[\p{L}'’-]*|\b(?:de|da|do|dos|das|e)\b)(?:\s+(?:\p{Lu}[\p{L}'’-]*|(?:de|da|do|dos|das|e))){0,6}`;
// nome com título (Des. Fed., Desa., Juiz Federal, Min.) sem "Rel.": "Presidência da TNU, Min. Raul Araújo", "Des. Fed. Fulano" — vale como relator candidato
const RE_TITULADO = new RegExp(String.raw`(?<![\p{L}])(?:Des[\p{L}.]*\s*(?:Fed[\p{L}.]*\s*)?|DES[\p{L}.]*\s*(?:FED[\p{L}.]*\s*)?|Ju[ií]z[a]?\s*(?:Federal\s*)?|JU[IÍ]Z[A]?\s*(?:FEDERAL\s*)?|Min[\p{L}.]*\s*|MIN[\p{L}.]*\s*)(?:Convocad[oa]\s*)?(${NOME})`, "gu");
const RE_MENCIONA_ORGAO = /(?<![\p{L}])(?:Turma|Se[çc][ãa]o|Corte)(?![\p{L}])/u;

// ------------------------------------------------------------------ o que a peça diz ao lado do número
const PREFIXO_REL = String.raw`(?:[Rr]el(?:ator(?:a)?|atoria(?:\s+d[oa])?|\.|a\.)?|REL(?:ATOR(?:A)?|\.)?|[Rr]elatad[oa]\s+pel[oa]|[Vv]oto\s+condutor\s+d[oa]|(?:[Dd]a\s+)?[Ll]avra\s+d[oa]|[Dd]e\s+autoria\s+d[oa])`;
const RE_REL = new RegExp(String.raw`(?<![\p{L}])${PREFIXO_REL}[ªº]?\.?(?![\p{L}])\s*(?:p\/\s*(?:o\s*)?ac[óo]rd[ãa]o\s*)?(?:\(a\))?\s*:?\s*(?:(?:Des|DES|Juiz|JUIZ|Juíza|JUÍZA|Min|MIN)[\p{L}.]*\s*(?:(?:Fed|FED)[\p{L}.]*)?\s*(?:(?:Convocad|CONVOCAD)[oOaA])?\s*(?:\(a\))?\s*)?(${NOME})`, "gu");
const RE_MENCIONA_REL = /(?<![\p{L}])(?:[Rr]el(?:ator(?:a)?|atoria(?=\s+d[oa](?![\p{L}]))|\.|a\.)?|REL(?:ATOR(?:A)?|\.)?|[Rr]elatad[oa]|[Vv]oto\s+condutor|[Ll]avra\s+d[oa]|[Dd]e\s+autoria\s+d[oa])[ªº]?(?![\p{L}])/u;   // "a relatoria divergente" não é menção a relator
const ANCORA_JULG = String.raw`(?:\bj(?:ulgad[oa])?\.?|julgamento\s*(?:em|:)|data\s+(?:do|de)\s+julgamento\s*:?|sess[ãa]o\s+(?:de|em|do\s+dia))\s*(?:em\s*)?`;
const RE_DATA = new RegExp(ANCORA_JULG + String.raw`(\d{1,2})[./](\d{1,2})[./](\d{2,4})`, "giu");
const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const RE_DATA_EXT = new RegExp(ANCORA_JULG + String.raw`(\d{1,2})\s*º?\s+de\s+(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})`, "giu");
const RE_DATA_EM_EXT = /(?<![\p{L}])em\s+(\d{1,2})\s*º?\s+de\s+(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})/giu;
const RE_ANCORA_SEM_DATA = new RegExp(ANCORA_JULG + String.raw`\d`, "iu");
const RE_PUB = /(?:\bDJ[eE]?N?\b|publicad[oa]|publica[çc][ãa]o)[^\d\n]{0,25}(\d{1,2})[./](\d{1,2})[./](\d{2,4})/giu;
const FRONTEIRA = /\n|;\s|(?<![A-Za-z])(?:STJ|STF|TST|TJ-?[A-Z]{2})\b|\b(?:REsp|AREsp|EREsp|EAREsp|AgInt|AgRg|EDcl)\b/;
const diaDe = (dd, mm, aa) => Date.UTC(aa.length === 2 ? 2000 + Number(aa) : Number(aa), Number(mm) - 1, Number(dd));
const dataBr = (ms) => { const d = new Date(ms); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`; };
// número com espaço junto aos separadores ("0001001-39 .2020…") também é lido (red team 31/10)
const RE_NUM = /(?<![0-9])(\d{7})\s?-?\s?(\d{2})\s?\.?\s?(\d{4})\s?\.?\s?(\d)\s?\.?\s?(\d{2})\s?\.?\s?(\d{4})(?![0-9])/g;

/** Cada dado da peça (relator, turma, data) é atribuído ao número de processo MAIS PRÓXIMO dentro do mesmo trecho (limitado por quebra de linha,
 *  "; " e começo de citação a STJ/STF): janelas fixas faziam o relator de uma citação cair na vizinha (red team e corpus cego, 31/10). */
// O rótulo de classe ("AC nº", "Apelação nº", "CC nº", "PUIL", "AI") abre uma NOVA citação: o que vem antes dele não é dela. "processo nº" não corta
// (pode ser "Relatado pelo Des. X no processo nº N", com o relator antes do número).
const ROTULO_CLASSE = String.raw`\b(?:(?:AC|AI|AG|AMS|REOMS|ACR|ApCiv|RemNec|ReeNec|HC|MS|CC|PUIL|PEDILEF|RCL)|(?:Apela[çc][ãa]o(?:\s+(?:C[íi]vel|Criminal))?|Agravo(?:\s+de\s+Instrumento)?|Pedido\s+de\s+Uniformiza[çc][ãa]o|Remessa\s+Necess[áa]ria|Conflito\s+de\s+Compet[êe]ncia|Mandado\s+de\s+Seguran[çc]a|Embargos\s+de\s+Declara[çc][ãa]o))\b\s*(?:n[º°o.]*\s*)?(?=\d{7})`;
const RE_ROTULO = new RegExp(ROTULO_CLASSE, "giu");
const RE_CORTE_DURO = new RegExp(FRONTEIRA.source, "g");
// o rótulo só abre citação nova depois de conjunção ("e também em AC…", "ao passo que se vê Apelação…") ou de uma data que fecha a anterior;
// em "Rel. X, 9ª Turma, Apelação Cível nº N" os dados vêm ANTES do rótulo e são desta citação (corpus cego 2, 31/10)
const ANTES_DE_CITACAO_NOVA = /(?:\b(?:e|ou|bem\s+como|ainda|também|além\s+d[oa]|tampouco|ao\s+passo\s+que|se\s+v[eê]|no\s+mesmo\s+sentido|em\s+sentido\s+(?:contr[áa]rio|diverso))\b[\s,]*(?:(?:de|em|do|da|no|na|o|a)\s+){0,2}|\d{4}[²³¹⁰-⁹]*\s*[,;.]?\s*(?:\[\^\d+\])?\s*)$/iu;
// fim de frase: nota de rodapé "[^1]" ou data/parêntese seguidos de ponto e maiúscula ("Des. Fed." e "Rel. Des." não cortam)
const RE_FIM_DE_FRASE = /\.\s*\[\^\d+\]\s*|(?<=\d{4})\.\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])|(?<=\))\.\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/gu;
// marcadores de discurso que abrem uma NOVA citação, mesmo sem rótulo de classe ("…, ao passo que a Segunda Turma…", "no mesmo sentido, Terceira Seção…",
// ", e Rel. Des. Fed. …"): o que vem depois é da citação seguinte (corpus cego 4, 31/10)
const RE_MARCADOR_NOVA = /\b(?:ao\s+passo\s+que|no\s+mesmo\s+sentido|em\s+sentido\s+(?:contr[áa]rio|diverso)|em\s+igual\s+rumo|bem\s+como|tamb[ée]m\s+(?:de|em|por)\b|j[áa]\s+(?=(?:a\s+)?(?:\d{1,2}\s*[ªº]|(?:primeir|segund|terceir|quart|quint|sext|non|d[ée]cim)[ao]\b))|e\s+(?=(?:Rel\b|Relat|Des[\p{L}.]*\s|Ju[ií]z|Min\.|\d{1,2}\s*[ªº]|(?:Primeira|Segunda|Terceira|Quarta|Quinta|Sexta|Nona|D[ée]cima)\b)))/giu;
function posicoesDeCorte(t) {
  const out = [...t.matchAll(RE_CORTE_DURO)].map((m) => m.index);
  for (const m of t.matchAll(RE_MARCADOR_NOVA)) out.push(m.index);
  for (const m of t.matchAll(RE_FIM_DE_FRASE)) out.push(m.index);
  for (const m of t.matchAll(RE_ROTULO)) if (ANTES_DE_CITACAO_NOVA.test(t.slice(Math.max(0, m.index - 70), m.index))) out.push(m.index);
  return out.sort((a, b) => a - b);
}
function ocorrencias(t) {
  const marcas = [...t.matchAll(RE_NUM)].map((m) => ({ d: m.slice(1, 7).join(""), ini: m.index, fim: m.index + m[0].length,
    relatores: new Set(), datas: new Set(), pubs: new Set(), unidades: new Set(), relatorNaoLido: false, orgaoNaoLido: false, dataNaoLida: false }));
  if (!marcas.length) return [];
  const cortes = posicoesDeCorte(t);
  const trecho = (pos) => { let k = 0; while (k < cortes.length && cortes[k] < pos) k++; return k; };
  marcas.forEach((m) => { m.seg = trecho(m.ini); });
  const MAX_DEPOIS = 260, MAX_ANTES = 120;
  const dono = (pos, fim) => {
    const seg = trecho(pos);
    let melhor = null, dmin = Infinity;
    for (const m of marcas) {
      if (m.seg !== seg) continue;
      const dist = pos >= m.fim ? pos - m.fim : m.ini - fim;   // depois do número | antes do número
      if (dist < 0 || dist > (pos >= m.fim ? MAX_DEPOIS : MAX_ANTES)) continue;
      if (dist < dmin) { dmin = dist; melhor = m; }
    }
    return melhor;
  };
  const dentroDeNumero = (pos) => marcas.some((m) => pos >= m.ini && pos < m.fim);
  const parsedDatas = [];
  for (const m of t.matchAll(RE_REL)) { const n = m[1].trim(); if (!nomesDoRelator(n).length) continue; const o = dono(m.index, m.index + m[0].length); if (o) o.relatores.add(n); }
  for (const m of t.matchAll(RE_TITULADO)) { const n = m[1].trim(); if (!nomesDoRelator(n).length) continue; const o = dono(m.index, m.index + m[0].length); if (o) o.relatores.add(n); }
  for (const m of t.matchAll(RE_DATA_EM_EXT)) {
    if (/(?:publicad[oa]|disponibiliz\w*|\bDJ[eE]?N?\b|juntad[oa]|protocolad[oa]|lid[oa]|acessad[oa]|consultad[oa])\s*$/iu.test(t.slice(Math.max(0, m.index - 25), m.index))) continue;
    parsedDatas.push(m.index); const o = dono(m.index, m.index + m[0].length); if (o) o.datas.add(diaDe(m[1], MESES.indexOf(fold(m[2])) + 1, m[3]));
  }
  for (const m of t.matchAll(RE_DATA)) { parsedDatas.push(m.index); const o = dono(m.index, m.index + m[0].length); if (o) o.datas.add(diaDe(m[1], m[2], m[3])); }
  for (const m of t.matchAll(RE_DATA_EXT)) { parsedDatas.push(m.index); const o = dono(m.index, m.index + m[0].length); if (o) o.datas.add(diaDe(m[1], MESES.indexOf(fold(m[2])) + 1, m[3])); }
  for (const m of t.matchAll(RE_PUB)) { const o = dono(m.index, m.index + m[0].length); if (o) o.pubs.add(diaDe(m[1], m[2], m[3])); }
  for (const m of t.matchAll(RE_UNIDADE)) { const n = numeroOrdinal(m[1]); if (!n || dentroDeNumero(m.index)) continue; const o = dono(m.index, m.index + m[0].length);
    if (o) o.unidades.add(`${n}|${/recursal/i.test(m[2]) ? "recursal" : /se[çc]/i.test(m[2]) ? "secao" : /corte/i.test(m[2]) ? "corte" : "turma"}`); }
  for (const m of t.matchAll(/(?<![\p{L}])TNU(?![\p{L}])|turma\s+nacional/giu)) { const o = dono(m.index, m.index + m[0].length); if (o) o.unidades.add("tnu|tnu"); }
  for (const m of t.matchAll(/corte\s+especial/giu)) { const o = dono(m.index, m.index + m[0].length); if (o) o.unidades.add("corte|corte"); }
  // o que a peça menciona e não foi lido: nunca vira ✅
  for (const m of t.matchAll(new RegExp(RE_MENCIONA_REL.source, "gu"))) { const o = dono(m.index, m.index + m[0].length); if (o && !o.relatores.size) o.relatorNaoLido = true; }
  for (const m of t.matchAll(new RegExp(RE_MENCIONA_ORGAO.source, "gu"))) { const o = dono(m.index, m.index + m[0].length); if (o && !o.unidades.size) o.orgaoNaoLido = true; }
  for (const m of t.matchAll(new RegExp(RE_ANCORA_SEM_DATA.source, "giu"))) { if (parsedDatas.some((x) => Math.abs(x - m.index) <= 2)) continue; const o = dono(m.index, m.index + m[0].length); if (o && !o.datas.size) o.dataNaoLida = true; }
  return marcas.map((o) => ({ d: o.d, relatores: [...o.relatores], datas: [...o.datas], pubs: [...o.pubs], unidades: [...o.unidades],
    relatorNaoLido: o.relatorNaoLido, orgaoNaoLido: o.orgaoNaoLido, dataNaoLida: o.dataNaoLida }));
}

const RE_SUP = /\b(?:AgInt|AgRg|EDcl)?\s*(?:no\s+)?(REsp|AREsp|EREsp|EAREsp|RE|ARE|RMS|RHC|HC|Rcl|ADI|ADPF|ADC)\s*(?:n[º°.]*\s*)?(\d[\d.]{2,})/g;
export const citacoesSuperiores = (t) => [...new Set([...t.matchAll(RE_SUP)].map((m) => `${m[1]} ${m[2].replace(/\./g, "")}`))];

const diasEntre = (a, b) => Math.round(Math.abs(a - b) / 864e5);
const diaDoRecibo = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || "")); return m ? diaDe(m[1], m[2], m[3]) : null; };
const ehIndice = (r) => r.base !== "tnu" && /ndice do portal/i.test(r.orgao_fonte || "");
const ORDEM = { confere: 0, ambiguo: 1, diverge: 2 };
const melhorRelator = (p, nomes, conhecidos) => nomes.map((n) => compararRelator(p, n, conhecidos)).reduce((m, x) => (x && (m === null || ORDEM[x] < ORDEM[m]) ? x : m), null);

/** Compara o que a peça disse com UM recibo (um julgamento). ok = campos que bateram; mal/nao = mensagens. */
function avaliarRecibo(a, r, conhecidos) {
  const ok = [], mal = [], nao = [];
  const djen = r.origem === "djen";
  const nomes = [r.relator, r.relator_texto].filter(Boolean);
  if (a.relatores.size) {
    if (djen || !nomes.length) nao.push(`relator da peça (${[...a.relatores].join(" / ")}) NÃO conferido: o recibo não traz o relator${djen ? " (é publicação do DJEN)" : ""}`);
    else {
      const res = [...a.relatores].map((p) => [p, melhorRelator(p, nomes, conhecidos)]);
      const div = res.filter(([, x]) => x === "diverge").map(([p]) => p), amb = res.filter(([, x]) => x === "ambiguo").map(([p]) => p), cur = res.filter(([, x]) => x === null).map(([p]) => p);
      if (div.length) mal.push(`a peça dá como relator ${div.join(" / ")}; o recibo tem ${nomes.join(" / ")} (o relator pode mudar entre julgamentos do mesmo processo: convocação, embargos)`);
      if (amb.length) mal.push(`relator da peça (${amb.join(" / ")}) só bate EM PARTE com o do recibo (${nomes.join(" / ")}): nome único, sobrenome comum ou final diferente`);
      if (cur.length) nao.push(`relator da peça (${cur.join(" / ")}) NÃO conferido: nome curto demais para comparar com ${nomes.join(" / ")}`);
      if (res.every(([, x]) => x === "confere")) ok.push([...a.relatores].some((p) => nomesDoRelator(p).length === 1) ? "relator (só o sobrenome, único entre os relatores lidos aqui)"
        : [...a.relatores].some((p) => nomesDoRelator(p).length < Math.max(...nomes.map((n) => nomesDoRelator(n).length))) ? "relator (nome incompleto, único entre os relatores lidos aqui)" : "relator");
    }
  }
  if (a.unidades.size) {
    const dele = new Set(unidadesDoTexto(r.orgao));
    if (r.base === "tnu") dele.add("tnu|tnu");
    if (djen || !dele.size) nao.push(`turma da peça NÃO conferida: o recibo não traz turma legível${r.orgao ? ` (traz «${r.orgao}»)` : ""}`);
    else if ([...a.unidades].every((u) => dele.has(u))) ok.push("turma");
    else mal.push(`a peça diz ${[...a.unidades].map(rotuloUnidade).join(" / ")}; o recibo tem ${r.orgao}${ehIndice(r) ? " (órgão do ÍNDICE do portal; o fecho do voto não é exposto no TRF1)" : ""}`);
  }
  if (a.datas.size) {
    const d = diaDoRecibo(r.data_julgamento);
    if (djen || d === null) nao.push(`data da peça (${[...a.datas].map(dataBr).join(" / ")}) NÃO conferida: o recibo não traz data de julgamento`);
    else {
      const sem = [...a.datas].filter((x) => x !== d);
      if (!sem.length) ok.push("data");
      else { const dif = Math.min(...sem.map((x) => diasEntre(x, d))); mal.push(`a peça diz julgado em ${sem.map(dataBr).join(" / ")}; este julgamento é de ${dataBr(d)}${dif <= 3 ? ` (${dif} dia(s) de diferença: sessão de vários dias ou data de publicação?)` : ""}`); }
    }
  }
  if (a.pubs.size) {
    const d = diaDoRecibo(r.data_publicacao);
    if (d === null) nao.push(`data de publicação da peça (${[...a.pubs].map(dataBr).join(" / ")}) NÃO conferida: o recibo não traz data de publicação`);
    else if ([...a.pubs].every((x) => x === d)) ok.push("data de publicação");
    else mal.push(`a peça diz publicado em ${[...a.pubs].map(dataBr).join(" / ")}; o recibo tem publicação em ${dataBr(d)}`);
  }
  return { ok, mal, nao };
}

/** Auditoria sem rede. `env` aponta a pasta de recibos (TRF1_MCP_DIR_RECIBOS). */
export function auditarCitacoes(texto, env = process.env) {
  const t = String(texto || "").slice(0, AUDITORIA_MAX_CHARS);
  if (!t.trim()) return "Cole o texto da peça (ou o trecho com as citações) em `texto`.";
  const porNum = new Map();
  for (const o of ocorrencias(t)) {
    const a = porNum.get(o.d) || { relatores: new Set(), datas: new Set(), pubs: new Set(), unidades: new Set(), relatorNaoLido: false, orgaoNaoLido: false, dataNaoLida: false };
    o.relatores.forEach((r) => a.relatores.add(r)); o.datas.forEach((d) => a.datas.add(d)); o.pubs.forEach((d) => a.pubs.add(d)); o.unidades.forEach((u) => a.unidades.add(u));
    a.relatorNaoLido ||= o.relatorNaoLido; a.orgaoNaoLido ||= o.orgaoNaoLido; a.dataNaoLida ||= o.dataNaoLida;
    porNum.set(o.d, a);
  }
  const recibos = listarRecibos(null, env).filter((r) => r.nr_processo && r.texto !== undefined);
  const conhecidos = [...new Map(recibos.flatMap((r) => [r.relator, r.relator_texto]).filter(Boolean).map(nomesDoRelator).filter((k) => k.length).map((k) => [k.join(" "), k])).values()];
  const L = [], cont = { vermelho: 0, confira: 0, amarelo: 0, ok: 0, outro: 0 };
  for (const [d, a] of porNum) {
    const num = mascara(d), seg = `${d[13]}.${d.slice(14, 16)}`;
    if (!dvCnjValido(d)) { cont.vermelho++; L.push(`🔴 ${num} — dígito verificador NÃO confere: número digitado errado ou inexistente. Não o use em consulta; corrija pela fonte.`); continue; }
    const rs = recibos.filter((r) => soDigitos(r.nr_processo) === d);
    if (!rs.length) {
      if (d[13] === "4" && d.slice(14, 16) === "01") { cont.amarelo++; L.push(`🟡 ${num} — Justiça Federal da 1ª Região, número válido, NÃO lido nesta máquina: abra com obter_decisao_trf1 (ou buscar_djen_trf1, se for posterior a 29/02/2024) antes de citar; relator, turma e data não foram conferidos.`); }
      else if (d[13] === "4") { cont.outro++; L.push(`⚪ ${num} — segmento .${seg}. (outra região da Justiça Federal; também é o número de ORIGEM de julgados da TNU): se a peça cita acórdão da TNU, abra com obter_decisao_trf1 base="tnu"; se for de outro TRF, confira no tribunal respectivo.`); }
      else { cont.outro++; L.push(`⚪ ${num} — de outro ramo ou tribunal (segmento .${seg}.): confira no motor daquele tribunal.`); }
      continue;
    }
    const pend = [];
    if (a.relatorNaoLido) pend.push("a peça menciona o relator ao lado do número, mas o nome não pôde ser lido nem comparado — confira à mão ou escreva \"Rel. Des. Fed. Nome Completo\"");
    if (a.orgaoNaoLido) pend.push("a peça menciona turma, seção ou corte ao lado do número, mas não foi possível ler qual — confira à mão ou escreva \"9ª Turma\"");
    if (a.dataNaoLida) pend.push("a peça dá uma data de julgamento ao lado do número que não pôde ser lida — escreva \"j. dd/mm/aaaa\"");
    const campos = (a.relatores.size ? 1 : 0) + (a.unidades.size ? 1 : 0) + (a.datas.size ? 1 : 0) + (a.pubs.size ? 1 : 0);
    const av = rs.map((r) => ({ r, ...avaliarRecibo(a, r, conhecidos) }));
    const quem = (x) => `id ${x.r.id_documento} · ${x.r.base === "tnu" ? "TNU" : "TRF1"} · ${x.r.tipo || "?"} · ${x.r.data_julgamento || "data ?"}${x.r.origem === "djen" ? " · publicação do DJEN" : ""}`;
    const fechou = campos ? av.find((x) => x.ok.length === campos && !x.mal.length && !x.nao.length) : null;
    const todos = av.map(quem).join("; ");
    const base = rs.some(ehIndice) ? " Base: índice do portal (no TRF1 o fecho do voto não é exposto)." : "";
    const parcial = rs.every((r) => r.origem === "busca" || r.origem === "djen") ? " Recibo parcial (busca/DJEN): a leitura do número inteiro pode trazer outros documentos." : "";
    if (!campos && !pend.length) { cont.amarelo++; L.push(`🟡 ${num} — lido nesta máquina (${todos}), mas a peça não diz relator, turma nem data ao lado do número: nada a comparar.${parcial}`); continue; }
    if (fechou && !pend.length) {
      cont.ok++;
      L.push(`✅ ${num} — lido nesta máquina (${quem(fechou)}). Bate com a peça, neste mesmo julgamento: ${fechou.ok.join(", ")}.${base}${parcial}${rs.length > 1 ? ` Outros documentos lidos deste processo: ${rs.filter((r) => r !== fechou.r).map((r) => `id ${r.id_documento} (${r.data_julgamento || "data ?"})`).join("; ")}.` : ""}`);
      continue;
    }
    // melhor candidato: o recibo em que mais campos bateram e menos divergiram
    const melhor = [...av].sort((p, q) => (p.mal.length - q.mal.length) || (q.ok.length - p.ok.length) || (p.nao.length - q.nao.length))[0];
    const msgs = [...pend, ...melhor.mal, ...melhor.nao];
    if (rs.length > 1 && campos > 1 && av.some((x) => x.ok.length) && !fechou) msgs.push(`nenhum dos ${rs.length} julgamentos lidos bate em tudo o que a peça diz — a peça pode estar misturando dados de julgamentos diferentes do mesmo processo (${todos})`);
    cont.confira++;
    L.push(`🟠 ${num} — lido nesta máquina (${rs.length > 1 ? todos : quem(melhor)}). CONFIRA: ${msgs.join("; ")}.${melhor.ok.length ? ` Bateu${rs.length > 1 ? ` (no id ${melhor.r.id_documento})` : ""}: ${melhor.ok.join(", ")}.` : ""}${base}`);
  }
  const sup = citacoesSuperiores(t);
  const cab = [
    `**Auditoria de citações do TRF1/TNU (sem rede)** — ${porNum.size} número(s) de processo distinto(s)${sup.length ? `, ${sup.length} citação(ões) a tribunal superior` : ""}.`,
    `🔴 ${cont.vermelho} a corrigir · 🟠 ${cont.confira} a conferir · 🟡 ${cont.amarelo} sem comparação possível · ✅ ${cont.ok} conferido(s) contra o recibo · ⚪ ${cont.outro} de outro tribunal.`,
    "_Confere número (dígito verificador), relator, turma e data ao lado do número, contra UM mesmo julgamento lido — NÃO confere se o julgado sustenta o que a peça afirma (isso é a leitura: `verificar_citacao_trf1` para a frase entre aspas e o revisor-adversarial). ✅ quer dizer \"o que a peça diz bate com o recibo\", nunca \"a citação está certa\"._",
    "",
  ];
  if (t.length < String(texto || "").length) cab.push(`_Texto cortado em ${AUDITORIA_MAX_CHARS} caracteres; audite o resto em outra chamada._`, "");
  const rodape = sup.length ? ["", `**Citados a STJ/STF** (não conferidos aqui): ${sup.join("; ")}. STJ: JusRatio e BNP; STF: JusRatio.`] : [];
  return [...cab, ...(L.length ? L : ["Nenhum número de processo no padrão CNJ no texto."]), ...rodape].join("\n");
}

// ------------------------------------------------------------------ lista de leitura
const NAO_SOBRENOME = new Set("desembargador desembargadora juiz juiza convocado convocada relator relatora federal fed filho junior neto".split(" "));
const chaveRelator = (r) => fold(r.relator || r.relator_texto || "").replace(/[^a-z ]+/g, " ").split(" ").filter((w) => w.length >= 4 && !NAO_SOBRENOME.has(w)).slice(-2).join(" ");

/** Dos processos citados nos acórdãos já lidos de um TEMA, quais mais aparecem e esta máquina ainda não leu. */
export function listaDeLeitura({ consulta = "", grupos = null, limite = 10 } = {}, env = process.env) {
  const gs = (Array.isArray(grupos) ? grupos : []).map((g) => (Array.isArray(g) ? g : [g]).map((x) => String(x).trim()).filter(Boolean)).filter((g) => g.length);
  for (const w of String(consulta || "").split(/\s+/).map((x) => x.trim()).filter((x) => x.length > 1)) gs.push([w]);
  if (!gs.length) return "Informe o tema: `grupos` (sinônimos; OU dentro do grupo, E entre grupos) e/ou `consulta` (todas as palavras).";
  const res = gs.map((g) => g.map(regexTermo).filter(Boolean));
  const todos = listarRecibos(null, env).filter((x) => x.texto && x.nr_processo);
  const lidos = new Set(todos.map((x) => soDigitos(x.nr_processo)));
  const tema = todos.filter((x) => x.origem !== "djen" && res.every((g) => g.some((re) => re.test(x._tn || ""))));
  if (!tema.length) return "Nenhum acórdão lido nesta máquina casa com esse tema. Zero aqui não é \"não localizado\": busque com buscar_jurisprudencia_trf1 (e, depois de 29/02/2024, buscar_djen_trf1).";
  const cit = new Map(), dvInvalidos = new Set();
  for (const x of tema) {
    const a = soDigitos(x.nr_processo);
    for (const m of String(x.texto).matchAll(RE_NUM)) {
      const b = m.slice(1, 7).join("");
      if (b === a) continue;
      if (!dvCnjValido(b)) { dvInvalidos.add(mascara(b)); continue; }
      if (b[13] !== "4") continue;   // só Justiça Federal: o resto não se abre por esta extensão
      if (!cit.has(b)) cit.set(b, { d: b, quem: new Map(), rels: new Set() });
      cit.get(b).quem.set(a, x.id_documento);
      const k = chaveRelator(x);
      if (k) cit.get(b).rels.add(k); else cit.get(b).semRel = (cit.get(b).semRel || 0) + 1;   // recibo sem relator não vira "relator distinto"
    }
  }
  const ord = [...cit.values()].map((o) => ({ ...o, n: o.quem.size, k: o.rels.size, lido: lidos.has(o.d) }))
    .sort((p, q) => q.k - p.k || q.n - p.n || (p.d < q.d ? -1 : 1));
  const naoLidos = ord.filter((o) => !o.lido), jaLidos = ord.filter((o) => o.lido);
  const procTema = new Set(tema.map((x) => soDigitos(x.nr_processo)));
  const L = [`**Lista de leitura do TRF1/TNU (sem rede)** — tema: ${gs.map((g) => "(" + g.join(" OU ") + ")").join(" E ")}`,
    `- Acórdãos lidos do tema: ${tema.length} (${procTema.size} processos). Processos da Justiça Federal que eles citam: ${ord.length}; já lidos aqui: ${jaLidos.length}.`, ""];
  const top = naoLidos.filter((o) => o.n >= 2).slice(0, Math.max(1, Math.min(30, limite)));
  L.push(top.length ? "**Mais citados pelo tema e NÃO lidos aqui** (por relatores distintos, depois por processos; muitos processos de 1 relator costuma ser parágrafo-padrão do gabinete):"
    : "Nenhum processo não lido foi citado por 2 ou mais acórdãos do tema.");
  for (const o of top) L.push(`- ${mascara(o.d)}${o.d.slice(14, 16) === "01" ? "" : ` (segmento .${o.d[13]}.${o.d.slice(14, 16)}.: origem de julgado da TNU ou outro TRF)`} — citado em ${o.n} processo(s) por ${o.k} relator(es)${o.semRel ? ` (+${o.semRel} recibo(s) sem relator)` : ""} · ex.: ids ${[...o.quem.values()].slice(0, 3).join(", ")}`);
  if (jaLidos.length) L.push("", `**Já lidos e citados pelo tema:** ${jaLidos.slice(0, 5).map((o) => `${mascara(o.d)} (${o.n})`).join("; ")} — releia com buscar_recibos_trf1, sem rede.`);
  if (dvInvalidos.size) L.push("", `⚠️ DV inválido (número provavelmente errado na origem; não consulte o portal com ele): ${[...dvInvalidos].sort().slice(0, 10).join("; ")}.`);
  L.push("", "_Mais citado é candidato a ler, não leading case nem prova de vigência. Abra no máximo 3 por pesquisa, um por vez (obter_decisao_trf1 respeita o ritmo do portal); depois rode de novo — os lidos saem da lista._");
  return L.join("\n");
}

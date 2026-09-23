/**
 * Funções do servidor MCP TRF1/TNU — porte Node.js do servidor_trf1.py (fonte de verdade:
 * mudança de comportamento entra primeiro lá, com selftest e red team, depois aqui, com o
 * teste de paridade). Separadas de index.js para permitir testes automatizados diretos.
 *
 * Backend (engenharia reversa do portal oficial do CJF, 11/09/2026): app Java/JSF + PrimeFaces
 * 6.2, renderizado no servidor, com sessão (cookies) e javax.faces.ViewState por sessão. Busca =
 * POST partial/ajax; resposta = XML <partial-response> com o HTML dentro de CDATA.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const VERSAO = "1.1.0";
export const REPO_GITHUB = "robertogecia/trf1-jurisprudencia-mcp";

export const SITE = "https://jurisprudencia.cjf.jus.br";
export const BASES = {
  trf1: { caminho: "/trf1/index.xhtml", rotulo: "TRF1", tribunal: "TRF-1",
    tipos: ["ACORDAO", "SUMULA", "ARGUICAO", "DECISAOMONO"], fonte: true, tipoAcordao: false, avancada: true },
  tnu: { caminho: "/tnu/index.xhtml", rotulo: "TNU", tribunal: "TNU",
    tipos: ["ACORDAO", "DECISAOMONO", "DECISAOPRES"], fonte: false, tipoAcordao: true, avancada: false },
  colegiado: { caminho: "/colegiado/index.xhtml", rotulo: "Colegiado CJF", tribunal: "CJF",
    tipos: [], fonte: false, tipoAcordao: false, avancada: false },
};
export const TIPOS_ACORDAO_TNU = { REPRESENTATIVO: "Representativos de Controvérsia", RELEVANTE: "Precedentes Relevantes" };
export const URL_PJE_CONSULTA_PUBLICA = "https://pje2g.trf1.jus.br/consultapublica/ConsultaPublica/listView.seam";

// User-Agent HONESTO por padrão (mesma decisão do servidor Python, 22/09/2026): o cliente se
// identifica como o que é. TRF1_USER_AGENT sobrescreve, por conta e risco de quem troca.
export const userAgentPadrao = (env = process.env) =>
  env.TRF1_USER_AGENT || `trf1-jurisprudencia-mcp/${VERSAO} (pesquisa juridica; cliente MCP; ritmo limitado; +https://github.com/${REPO_GITHUB})`;

export const headersBase = (env = process.env) => ({
  "User-Agent": userAgentPadrao(env),
  "Accept-Language": "pt-BR,pt;q=0.9",
});
const HEADERS_AJAX = {
  "Faces-Request": "partial/ajax",
  "X-Requested-With": "XMLHttpRequest",
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  Accept: "application/xml, text/xml, */*; q=0.01",
};

export const DIR_RECIBOS = (env = process.env) =>
  env.TRF1_MCP_DIR_RECIBOS || path.join(os.homedir(), ".trf1-jurisprudencia-recibos");

export const TIPOS_VALIDOS = ["ACORDAO", "SUMULA", "ARGUICAO", "DECISAOMONO", "DECISAOPRES"];
const TIPOS_ROTULO = {
  ACORDAO: "acórdãos", SUMULA: "súmulas", ARGUICAO: "arguições",
  DECISAOMONO: "decisões monocráticas", DECISAOPRES: "decisões da presidência",
};
export const FONTES_VALIDAS = ["TRF1", "JEF1"];
const TIPOS_DATA = { julgamento: "DTDP", publicacao: "DTPP" };
export const POR_PAGINA_VALIDOS = [10, 30, 50];

const CAMPOS_AVANCADOS_ORDEM = [
  "numero", "classe", "relator", "revisor", "relator_convocado",
  "relator_para_acordao", "orgao_julgador", "origem", "ementa_decisao",
  "referencia_legislativa", "data_inicio", "data_fim",
];
const CAMPOS_AVANCADOS_FALLBACK = {
  numero: "formulario:j_idt28", classe: "formulario:j_idt30", relator: "formulario:j_idt32",
  revisor: "formulario:j_idt34", relator_convocado: "formulario:j_idt36", relator_para_acordao: "formulario:j_idt38",
  orgao_julgador: "formulario:j_idt40", origem: "formulario:j_idt42", ementa_decisao: "formulario:j_idt44",
  referencia_legislativa: "formulario:j_idt46", data_inicio: "formulario:j_idt48_input", data_fim: "formulario:j_idt50_input",
};
const LABELS_AVANCADOS = {
  proc: "numero", combo_classes: "classe", rel: "relator", rev: "revisor",
  relc: "relator_convocado", rela: "relator_para_acordao", combo_orgaos: "orgao_julgador",
  _origem: "origem", emen: "ementa_decisao", refl: "referencia_legislativa",
};
const CAMPO_FONTE = "formulario:j_idt62";

const RESERVADAS = new Set(["E", "OU", "NAO", "NÃO", "ADJ", "PROX", "COM", "MESMO", "XOU"]);
const RE_RESERVADA_N = /^(ADJ|PROX)\d{0,2}$/;

export const GRUPOS_MAX = 6;
export const TERMOS_POR_GRUPO_MAX = 12;
const TERMO_MAX_CHARS = 80;

export const ORCAMENTO_DECISAO = 50_000;
const TRECHO_EMENTA = 800;
const TRECHO_DECISAO = 320;

// --------------------------------------------------------------------------- helpers puros ---
export const fold = (t) => (t || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

export const cnj = (nr) => {
  const d = (nr || "").replace(/\D/g, "");
  return d.length === 20 ? `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d[13]}.${d.slice(14, 16)}.${d.slice(16, 20)}` : nr || "";
};
export const soDigitos = (nr) => (nr || "").replace(/\D/g, "");

export function limpar(texto, limite = 0) {
  if (!texto) return "";
  let t = texto.replace(/<font[^>]*>\s*<b>([\s\S]*?)<\/b>\s*<\/font>/gi, "«$1»");
  t = t.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  t = t.replace(/<br\s*\/?>/gi, " ");
  t = t.replace(/<[^>]+>/g, " ");
  t = decodeEntities(t);
  t = t.replace(/\s+/g, " ").trim();
  if (limite && t.length > limite) {
    const cortado = t.slice(0, limite);
    const i = cortado.lastIndexOf(" ");
    t = (i > 0 ? cortado.slice(0, i) : cortado) + "…";
  }
  return t;
}
export const semDestaque = (t) => (t || "").replaceAll("«", "").replaceAll("»", "");

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", aacute: "á", eacute: "é",
  iacute: "í", oacute: "ó", uacute: "ú", atilde: "ã", otilde: "õ", ccedil: "ç", Aacute: "Á", Eacute: "É",
  Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Atilde: "Ã", Otilde: "Õ", Ccedil: "Ç", acirc: "â", ecirc: "ê",
  ocirc: "ô", ordf: "ª", ordm: "º", deg: "°", sect: "§" };
export function decodeEntities(t) {
  return (t || "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, nome) => (nome in ENTIDADES ? ENTIDADES[nome] : m));
}

export const dataIso = (br) => {
  const m = /^\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(br || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};
export function normalizarData(data, rotulo) {
  const d = (data || "").trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) return d;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  throw new Error(`${rotulo} inválida: ${JSON.stringify(data)} — use AAAA-MM-DD ou DD/MM/AAAA.`);
}

// --------------------------------------------------------------- montagem da consulta ---
const INVALIDOS_PORTAL = "#!+';_|@-";  // hífen no FIM: dentro de [] fica literal, sem virar range
const RE_TRAD_INVALIDOS = new RegExp(`[${INVALIDOS_PORTAL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}]`, "g");
const tradInvalidos = (t) => (t || "").replace(RE_TRAD_INVALIDOS, " ");
// Pontuação (fora dígito/letra Unicode/espaço/$/?/«»): opera sobre texto CRU (não folded),
// por isso usa \p{L}/\p{N} com a flag u — mais fiel ao \w Unicode do Python que o \w ASCII do JS.
const RE_PONTUACAO = /[^\p{L}\p{N}_\s$?«»]/gu;
const RE_CAMPO_SUFIXO = /\[(-?[A-Za-z]{2,4})\]\s*$/;

export function termoParaQuery(termo) {
  let t = (termo || "").replace(/\s+/g, " ").trim().slice(0, TERMO_MAX_CHARS).trim();
  const mCampo = RE_CAMPO_SUFIXO.exec(t);
  const campo = mCampo ? mCampo[1].toUpperCase() : "";
  if (mCampo) t = t.slice(0, mCampo.index);
  t = tradInvalidos(t);
  t = t.replace(RE_PONTUACAO, " ");
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return "";
  t = t.replace(/\$(?=\S)/g, "");
  const sufixo = campo ? `[${campo}]` : "";
  if (t.includes(" ")) return `"${t}"${sufixo}`;
  const up = t.toUpperCase();
  if (RESERVADAS.has(up) || RE_RESERVADA_N.test(up)) return `"${t}"${sufixo}`;
  return t + sufixo;
}

export function montarGrupos(grupos) {
  if (!Array.isArray(grupos)) return "";
  const partes = [];
  for (const g of grupos.slice(0, GRUPOS_MAX)) {
    if (!Array.isArray(g)) continue;
    const vistos = [];
    for (const termo of g.slice(0, TERMOS_POR_GRUPO_MAX)) {
      const q = termoParaQuery(String(termo));
      if (q && !vistos.includes(q)) vistos.push(q);
    }
    if (!vistos.length) continue;
    partes.push(vistos.length === 1 ? vistos[0] : "(" + vistos.join(" OU ") + ")");
  }
  return partes.join(" E ");
}

export function montarConsulta(consulta, grupos) {
  const livre = tradInvalidos(consulta || "").replace(/\s+/g, " ").trim();
  const g = montarGrupos(grupos);
  if (livre && g) return `(${livre}) E ${g}`;
  return livre || g;
}

// ------------------------------------------------------------- extração do XML/HTML ---
export function extrairUpdate(xml, idComponente) {
  const re = new RegExp(`<update id="${idComponente.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></update>`);
  const m = re.exec(xml || "");
  return m ? m[1].replaceAll("]]]]><![CDATA[>", "]]>") : "";
}
export function extrairViewstate(texto) {
  let m = /name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/.exec(texto || "");
  if (m) return m[1];
  m = /<update id="[^"]*ViewState[^"]*"><!\[CDATA\[([^\]]+)\]\]>/.exec(texto || "");
  return m ? m[1] : "";
}
export function extrairMensagens(xml) {
  const bloco = extrairUpdate(xml, "j_idt16:messages") || xml || "";
  let msgs = [...bloco.matchAll(/ui-messages-error-detail">([\s\S]*?)<\/span>/g)].map((m) => m[1]);
  if (!msgs.length) msgs = [...bloco.matchAll(/ui-messages-error-summary">([\s\S]*?)<\/span>/g)].map((m) => m[1]);
  return msgs.map((m) => limpar(m)).filter(Boolean);
}
export function extrairTotal(html) {
  let m = /rowCount:(\d+)/.exec(html || "");
  if (m) return Number(m[1]);
  const contadores = [...(html || "").matchAll(/(\d+) Documento\(s\) encontrado/g)].map((x) => Number(x[1]));
  if (contadores.length) return contadores.reduce((a, b) => a + b, 0);
  m = /Exibindo [\d\s-]+ de\s+(\d+)/.exec(html || "");
  return m ? Number(m[1]) : 0;
}

const RE_DOC_SPLIT = /<table class="table_pesquisa_lista" id="doc_([^"]+)"/;
const RE_CAMPO = /<span class="label_pontilhada">\s*([\s\S]*?)\s*<\/span>\s*<\/td>\s*<\/tr>\s*<tr[^>]*>\s*<td\b[^>]*>([\s\S]*?)<\/td>\s*<\/tr>\s*<\/div>/g;
const RE_SIGLA_CLASSE = /\(([A-ZÇ]{2,10})\)\s*$/;

// split() ao estilo Python re.split com grupo de captura: alterna [texto-antes, captura, texto-depois, captura, ...]
function splitComCaptura(re, texto) {
  const partes = [];
  let ultimo = 0;
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m;
  while ((m = g.exec(texto))) {
    partes.push(texto.slice(ultimo, m.index), m[1]);
    ultimo = m.index + m[0].length;
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  partes.push(texto.slice(ultimo));
  return partes;
}

export function parsearDocumentos(html, base = "trf1") {
  const partes = splitComCaptura(RE_DOC_SPLIT, html || "");
  const docs = [];
  const vistos = new Set();
  for (let i = 1; i < partes.length - 1; i += 2) {
    const docId = partes[i];
    const bloco = partes[i + 1];
    if (vistos.has(docId)) continue;
    vistos.add(docId);
    const campos = {};
    RE_CAMPO.lastIndex = 0;
    let m;
    while ((m = RE_CAMPO.exec(bloco))) {
      const r = limpar(m[1]);
      if (r && !(r in campos)) campos[r] = m[2];
    }
    const d = { id: docId, base, campos: {} };
    for (const [r, v] of Object.entries(campos)) {
      if (["Número", "Inteiro teor", "Fonte da publicação"].includes(r)) d.campos[r] = v;
      else if (["Ementa", "Decisão"].includes(r)) d.campos[r] = limpar(v);
      else d.campos[r] = semDestaque(limpar(v));
    }
    const numRaw = campos["Número"] || "";
    const formas = numRaw.split(/<br\s*\/?>/i).map((x) => limpar(x)).filter(Boolean);
    d.numero = formas[0] || "";
    d.numero_digitos = formas.map((f) => soDigitos(f)).find((dg) => dg.length === 20) || soDigitos(d.numero);
    const meta = (r) => semDestaque(limpar(campos[r] || ""));
    const partesTipo = (campos["Tipo"] || "").split(/<br\s*\/?>/i).map((x) => semDestaque(limpar(x))).filter(Boolean);
    d.tipo = partesTipo[0] || "";
    d.qualificacao = partesTipo.slice(1).join(" / ");
    if ("Tipo" in d.campos) d.campos["Tipo"] = d.tipo;
    if (d.qualificacao) d.campos["Qualificação do precedente"] = d.qualificacao;
    d.classe = meta("Classe");
    const mSigla = RE_SIGLA_CLASSE.exec(d.classe);
    d.sigla = mSigla ? mSigla[1] : "";
    d.relator = meta("Relator(a)");
    d.relator_convocado = meta("Relator convocado");
    d.relator_para_acordao = meta("Relator(a) para acórdão") || meta("Relator para acórdão");
    d.origem = meta("Origem");
    d.orgao = meta("Órgão julgador");
    d.data_julgamento = meta("Data");
    d.data_publicacao = meta("Data da publicação");
    const fontesUnicas = [];
    for (const f of (campos["Fonte da publicação"] || "").split(/<br\s*\/?>/i).map((x) => semDestaque(limpar(x)))) {
      if (f && !fontesUnicas.includes(f)) fontesUnicas.push(f);
    }
    d.fonte_publicacao = fontesUnicas.join("; ");
    d.ementa = limpar(campos["Ementa"] || "");
    d.decisao = limpar(campos["Decisão"] || "");
    const mHref = /href="([^"]+)"/.exec(campos["Inteiro teor"] || "");
    const link = mHref ? decodeEntities(mHref[1]) : "";
    d.link_inteiro_teor = link;
    d.link_tipo = link.includes("arquivo.trf1") ? "arquivo" : link.includes("eproctnu") ? "tnu" : link.includes("pje") ? "pje" : link ? "outro" : "";
    const brutoIt = campos["Inteiro teor"] || "";
    d.inteiro_teor_embutido = brutoIt.toLowerCase().includes("<body") ? textoDocumento(brutoIt) : "";
    docs.push(d);
  }
  return docs;
}

export function textoDocumento(htmlDoc) {
  if (!htmlDoc) return "";
  let t = htmlDoc.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  t = t.replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>|<\/h\d>|<\/li>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ");
  t = decodeEntities(t);
  t = t.replace(/[ \t\r\u00a0]+/g, " ");
  t = t.replace(/\n\s*\n+/g, "\n");
  return t.trim();
}

export function mapearCamposAvancados(painel) {
  const avisos = [];
  const nomes = [...(painel || "").matchAll(/<input[^>]*name="(formulario:j_idt\d+(?:_input)?)"/g)].map((m) => m[1]);
  let mapa;
  if (nomes.length === CAMPOS_AVANCADOS_ORDEM.length) {
    mapa = Object.fromEntries(CAMPOS_AVANCADOS_ORDEM.map((c, i) => [c, nomes[i]]));
  } else {
    avisos.push(`painel avançado com ${nomes.length} campos (esperados ${CAMPOS_AVANCADOS_ORDEM.length}) — usando nomes de fallback; se o filtro for ignorado, o portal mudou de layout`);
    mapa = { ...CAMPOS_AVANCADOS_FALLBACK };
  }
  for (const m of (painel || "").matchAll(/<label for="([^"]+)"/g)) {
    const chave = LABELS_AVANCADOS[m[1]];
    if (!chave) continue;
    const resto = painel.slice(m.index + m[0].length);
    const m2 = /<input[^>]*name="(formulario:j_idt\d+(?:_input)?)"/.exec(resto);
    if (m2 && mapa[chave] !== m2[1]) {
      avisos.push(`campo '${chave}': posição diz ${mapa[chave]}, label diz ${m2[1]} — prevalece o label`);
      mapa[chave] = m2[1];
    }
  }
  return [mapa, avisos];
}

// -------------------------------------------------- resultado do julgamento (offline) ---
const OPOSTOS = [["PROVIDO", "DESPROVIDO"], ["ACOLHIDO", "REJEITADO"]];
const RE_NAO_CONHECIDO = /\bNAO (SE )?CONHEC/;
const RE_CONHECIDO = /(?<!NAO )(?<!NAO SE )\bCONHEC/;
const RE_DESPROVIDO = /\b(DESPROVI|IMPROVI|NAO PROVI|NEG\w*(-(SE|LHE|LHES)| SE)? (INTEGRAL |PARCIAL )?PROVIMENTO|PROVIMENTO NEGADO)/;
const RE_PROVIDO = /(?<!NAO )\b(PROVI(DO|DOS|DA|DAS)\b|D(A|AO|AR|OU|ERAM|EU)(-(SE|LHE|LHES)| SE)? (INTEGRAL |PARCIAL )?PROVIMENTO)/;
const RE_REJEITADO = /\bREJEIT/;
const RE_ACOLHIDO = /\bACOLH/;
const RE_PREJUDICADO = /\bPREJUDICAD/;

export function resultadoDe(texto) {
  const t = fold(texto).toUpperCase();
  const cauda = t.length > 2500 ? t.slice(-2500) : t;
  const r = new Set();
  if (RE_NAO_CONHECIDO.test(cauda)) r.add("NÃO CONHECIDO");
  if (RE_CONHECIDO.test(cauda)) r.add("CONHECIDO");
  if (RE_DESPROVIDO.test(cauda)) r.add("DESPROVIDO");
  if (RE_PROVIDO.test(cauda)) r.add("PROVIDO");
  if (RE_REJEITADO.test(cauda)) r.add("REJEITADO");
  if (RE_ACOLHIDO.test(cauda)) r.add("ACOLHIDO");
  if (RE_PREJUDICADO.test(cauda)) r.add("PREJUDICADO");
  return r;
}
export function ladoDe(conjunto, [a, b]) {
  if (conjunto.has(a) && conjunto.has(b)) return null;
  return conjunto.has(a) ? a : conjunto.has(b) ? b : null;
}
const ROTULOS_RESULTADO = { PROVIDO: "provido", DESPROVIDO: "desprovido", ACOLHIDO: "acolhido",
  REJEITADO: "rejeitado", PREJUDICADO: "prejudicado", "NÃO CONHECIDO": "não conhecido" };

export function resumoResultadosPagina(docs) {
  const porJulgamento = new Map();
  docs.forEach((d) => {
    const chave = `${d.numero_digitos}|${d.data_julgamento}`;
    const conj = resultadoDe(d.decisao || "");
    if (!conj.size) return;
    if (!porJulgamento.has(chave)) porJulgamento.set(chave, new Set());
    for (const c of conj) porJulgamento.get(chave).add(c);
  });
  const contagem = Object.fromEntries(Object.keys(ROTULOS_RESULTADO).map((k) => [k, 0]));
  let semResultado = 0;
  for (const conj of porJulgamento.values()) {
    let algum = false;
    for (const [a, b] of OPOSTOS) {
      const lado = ladoDe(conj, [a, b]);
      if (lado) { contagem[lado]++; algum = true; }
    }
    for (const k of ["PREJUDICADO", "NÃO CONHECIDO"]) if (conj.has(k)) { contagem[k]++; algum = true; }
    if (!algum) semResultado++;
  }
  return { contagem, sem_resultado: semResultado, total_julgamentos: porJulgamento.size };
}

// --------------------------------------------------------------- atribuição (TNU) ---
export function norm(t) {
  let r = (t || "").normalize("NFKC");
  r = fold(r);
  r = r.replace(/\bn\s*[.o°]{1,3}\s*(?=\d)/g, "n ");
  r = r.replace(/§\s+/g, "§");
  r = r.replace(/[""''"'`´]/g, "'");
  r = r.replace(/[–—-]/g, "-");
  r = r.replace(/\s+([.,;:)\]])/g, "$1");
  r = r.replace(/([([])\s+/g, "$1");
  return r.replace(/\s+/g, " ").trim();
}

const TRIB = "(?:tj-?[a-z]{2}|stj|stf|trf-?\\d|tst|trt-?\\d+|tnu)";
const RE_ATRIB = new RegExp(
  "\\(" + TRIB + "\\b" +
  "|\\((?:resp|aresp|agint|agrg|edcl|eresp|rms|adi|adpf|apelacao(?: civel)?|agravo de instrumento|puil|pedilef)\\b[^()]{0,220}" +
  "\\brel(?:ator[a]?|\\.)?\\s*(?:p/|para|min|des|juiz|dr)" +
  "|\\b" + TRIB + "\\s*[-,\u2013]\\s*(?:resp|aresp|agint|agrg|edcl|re|are|hc|rhc|apelacao|ac|ai|puil|pedilef)\\b[^.\\n]{0,200}\\brel",
  "g"
);
const RE_ABRE_BLOCO = /\bementa\s*:|\bementa\b(?=\s*[-.]?\s*[a-z])|\bacordao\s*:|\bprecedentes?\s*:|\btranscrevo\b|\bin verbis\b|\bnos seguintes termos\s*:|\bassim (?:decidiu|se manifestou|ementado)\b|\bsumula\s+(?:vinculante\s+)?n?\s*\d+\s*[:-]/g;
const RE_VOZ_PROPRIA = /\b(nesse sentido|neste sentido|com efeito|no caso dos autos|no caso em tela|entendo|ante o exposto|diante do exposto|pelo exposto|e como voto|voto por|voto pelo|passo a|compulsando)\b/;
const RE_CARA_DE_EMENTA = /\brecurso\s+(?:\w+\s+){0,3}(?:conhecido|provido|desprovido|improvido|nao provido)\b|\btese de julgamento\b|\bcaso em exame\b|\bquestao em discussao\b|\bdispositivos? relevantes?\b|\bsentenca (?:mantida|reformada)\b|\bapelacao\s+(?:civel\s+)?(?:conhecida|provida|desprovida)\b/;
const RE_DIVERGENCIA = /\b(?:peco|pedi[dn]o\s+de?|com a devida|data)\s+venia\b[^.]{0,120}\b(?:diverg|discord)|\bdivirjo\b|\bvoto\s+(?:vencido|divergente|vista)\b|\bouso\s+divergir\b|\bvoto[- ]vista\b/;
const RE_ALEGACAO = /\b(sustent\w+|aleg\w+|aduz\w*|argument\w+|pugn\w+|requer\w*|assever\w+|defende\w*|afirm\w+|em suas razoes|nas razoes|em contrarrazoes|irresignad\w+)\b/g;
const RE_QUEM_ALEGA = /\b(apelante|apelad[oa]|agravante|agravad[oa]|recorrente|recorrid[oa]|embargante|embargad[oa]|autor[a]?|reu|re\b|requerente|requerid[oa]|impetrante|parte|banco|inss|uniao|ministerio publico|parquet|procuradoria)\b/;
const RE_NEGACAO = /\b(nao|jamais|nunca|inexist\w*|descab\w*|incabivel|incabiveis|inaplicav\w*|indevid\w*|afast\w*|improced\w*|nega\w*|rejeit\w*|sem\s+raz(?:ao|oes)|carece\w*|impossibilidade|vedad[oa]s?)\b[^.;:]{0,60}$/;
const RE_NEGACAO_FALSA = /\bnao\s+(obstante|so\b|apenas|somente|se\s+confunde)/;
const RE_TESE_PROPRIA = /\btese\s+(?:jur[ií]dica\s+)?(?:fixada|firmada|proposta)\b|\bfixando a seguinte tese\b|\bseguinte tese\b/;
export const PISO_TRECHO_PALAVRAS = 4, PISO_TRECHO_CHARS = 25, VAO_MAXIMO = 1500, ENCADEIA_MAX = 1200;

function matchesFrom(re, str, start = 0, end = str.length) {
  const trecho = str.slice(start, end);
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const out = [];
  let m;
  while ((m = g.exec(trecho))) {
    out.push({ ...m, index: m.index + start, 0: m[0] });
    if (m[0] === "") g.lastIndex++;
  }
  return out;
}
function searchFrom(re, str, start = 0) {
  const ms = matchesFrom(re, str, start);
  return ms.length ? ms[0] : null;
}

export function faixasTranscritas(tn, inicio = 0) {
  const faixas = [];
  let piso = inicio;
  for (const m of matchesFrom(RE_ATRIB, tn, inicio)) {
    if (m.index < piso) continue;
    let fim = m.index + m[0].length;
    if (tn[m.index] === "(") {
      let prof = 0;
      for (let k = m.index; k < Math.min(tn.length, m.index + 700); k++) {
        prof += (tn[k] === "(" ? 1 : 0) - (tn[k] === ")" ? 1 : 0);
        if (prof === 0) { fim = k + 1; break; }
      }
    } else {
      const pt = tn.indexOf(".", m.index + m[0].length);
      fim = pt >= 0 && pt - (m.index + m[0].length) < 300 ? pt + 1 : m.index + m[0].length;
    }
    const aberturas = matchesFrom(RE_ABRE_BLOCO, tn, piso, m.index).map((a) => a.index);
    const intervalo = tn.slice(piso, m.index);
    let ini;
    if (aberturas.length && m.index - aberturas[aberturas.length - 1] <= 9000) {
      ini = aberturas.find((a) => !RE_VOZ_PROPRIA.test(tn.slice(a, m.index)));
      if (ini === undefined) ini = aberturas[aberturas.length - 1];
    } else if (faixas.length && !RE_VOZ_PROPRIA.test(intervalo) &&
      (intervalo.length < ENCADEIA_MAX || (intervalo.length < 6000 && RE_CARA_DE_EMENTA.test(intervalo)))) {
      ini = piso;
    } else {
      ini = Math.max(piso, m.index - 300);
    }
    faixas.push([ini, fim]);
    piso = fim;
  }
  return faixas;
}

export function faixaDivergente(tn, inicio = 0) {
  const m = searchFrom(RE_DIVERGENCIA, tn, inicio);
  return m ? [m.index, tn.length] : null;
}

export function bruto(corpo, tn, posNorm) {
  if (posNorm <= 0) return 0;
  if (posNorm >= tn.length) return corpo.length;
  const alvo = norm(tn.slice(posNorm, posNorm + 40)).slice(0, 24);
  if (!alvo) return Math.min(corpo.length, Math.floor((posNorm * corpo.length) / Math.max(tn.length, 1)));
  const chute = Math.min(corpo.length - 1, Math.floor((posNorm * corpo.length) / Math.max(tn.length, 1)));
  for (const raio of [60, 400, 2000, corpo.length]) {
    const ini = Math.max(0, chute - raio), fim = Math.min(corpo.length, chute + raio);
    const k = norm(corpo.slice(ini, fim)).indexOf(alvo);
    if (k < 0) continue;
    let conta = 0;
    for (let i = ini; i < fim; i++) {
      const c = norm(corpo.slice(ini, i + 1)).length;
      if (c > conta) conta = c;
      if (conta > k) return i;
    }
    return ini;
  }
  return chute;
}

export function conferir(texto, trecho, tribunal = "TNU", comAtribuicao = true) {
  const frags = (trecho || "").split(/\[\s*\.\.\.\s*\]|\(\s*\.\.\.\s*\)|\[…\]|…/).map((f) => f.trim()).filter(Boolean);
  if (!frags.length) return { ok: false, erro: "trecho vazio" };
  const util = norm(frags.join(" "));
  if (util.split(/\s+/).filter(Boolean).length < PISO_TRECHO_PALAVRAS || util.length < PISO_TRECHO_CHARS) {
    return { ok: false, erro: `trecho curto demais para conferência útil (mínimo ${PISO_TRECHO_PALAVRAS} palavras e ${PISO_TRECHO_CHARS} caracteres): qualquer acórdão contém isso` };
  }
  const tn = norm(texto);
  let pos = 0, ini0 = null;
  const spans = [];
  for (const f of frags) {
    const palavras = norm(f).match(/\w+/g);
    if (!palavras) return { ok: false, fragmento: f };
    const re = new RegExp("(?<!\\w)" + palavras.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\W+") + "(?!\\w)");
    const m = re.exec(tn.slice(pos));
    if (!m) return { ok: false, fragmento: f };
    const a = pos + m.index, b = a + m[0].length;
    if (spans.length && a - spans[spans.length - 1][1] > VAO_MAXIMO) {
      return { ok: false, fragmento: f, erro: `o fragmento aparece, mas a ${a - spans[spans.length - 1][1]} caracteres do anterior (máximo ${VAO_MAXIMO}): \`[...]\` não pode costurar partes distantes do acórdão` };
    }
    spans.push([a, b]);
    if (ini0 === null) ini0 = a;
    pos = b;
  }
  const alertas = [];
  let emTranscricao = false;
  if (comAtribuicao) {
    const faixas = faixasTranscritas(tn, 0);
    emTranscricao = spans.some(([a, b]) => faixas.some(([fa, fb]) => a < fb && b > fa));
    if (emTranscricao) {
      alertas.push(`TRANSCRIÇÃO: o trecho está dentro de bloco que o voto transcreve de OUTRO julgado/tribunal — não é palavra da ${tribunal}. Se for citar, cite como a ${tribunal} citando; melhor: pesquise o original.`);
    }
    const div = faixaDivergente(tn, 0);
    if (div && spans.some(([, b]) => b > div[0])) {
      alertas.push("VOTO DIVERGENTE: o trecho vem depois de um sinal de divergência no acórdão (pedido de vênia, voto vencido ou voto-vista). Pode ser o voto VENCIDO — leia quem venceu antes de citar como entendimento do órgão.");
    }
  }
  if (!emTranscricao) {
    const antesQ = tn.slice(Math.max(0, ini0 - 1200), ini0);
    const depoisQ = tn.slice(pos, pos + 1200);
    const aspas = [...antesQ.matchAll(/(?<![a-z])'|'(?![a-z])/g)].map((m) => m.index);
    const nQ = aspas.length;
    const abre = aspas.length ? aspas[aspas.length - 1] : 0;
    if (nQ % 2 === 1 && /'(?![a-z])/.test(depoisQ) && !RE_TESE_PROPRIA.test(antesQ.slice(Math.max(0, abre - 80), abre))) {
      alertas.push(`ENTRE ASPAS: o trecho parece estar dentro de aspas no acórdão — é o tribunal citando alguém (doutrina, lei, decisão recorrida, outro julgado). Confira de quem é a frase antes de atribuí-la à ${tribunal}.`);
    }
    if (comAtribuicao) {
      const jan = tn.slice(Math.max(0, ini0 - 400), ini0);
      const alegs = [...jan.matchAll(RE_ALEGACAO)];
      const ult = alegs.length ? Math.max(...alegs.map((m) => m.index + m[0].length)) : -1;
      if (ult >= 0 && RE_QUEM_ALEGA.test(jan.slice(Math.max(0, ult - 160), ult + 160)) && !RE_VOZ_PROPRIA.test(jan.slice(ult))) {
        alertas.push("ALEGAÇÃO DA PARTE: pouco antes do trecho o texto relata o que uma parte (INSS, União, recorrente…) sustenta/alega — o trecho pode ser tese da parte, não decisão do tribunal. Confira no relatório/voto quem fala.");
      }
    }
  }
  const antes = tn.slice(Math.max(0, (ini0 || 0) - 90), ini0 || 0);
  if (RE_NEGACAO.test(antes) && !RE_NEGACAO_FALSA.test(antes.slice(-40))) {
    alertas.push("NEGAÇÃO: há negativa logo antes do trecho — o recorte pode inverter o julgado. Não citar sem ler.");
  }
  return { ok: true, alertas, contexto: tn.slice(Math.max(0, (ini0 || 0) - 120), pos + 120).replace(/\s+/g, " "), spans, tn };
}

// ------------------------------------------------------ fecho do inteiro teor da TNU ---
const MESES = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7,
  agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
const RE_FECHO_TNU = /a turma nacional de uniformizacao(?:,)? (?:decidiu|por (?:unanimidade|maioria))|acordam os (?:membros|juizes|integrantes) da turma nacional de uniformizacao/;
const RE_RELATOR_TEXTO = /^\s*RELATOR(?:A)?(?:\s*\(A\))?\s*:\s*(.+?)\s*$/im;
const RE_RELATOR_ACORDAO_TEXTO = /^\s*RELATOR(?:A)?\s+DO\s+AC[ÓO]RD[ÃA]O\s*:\s*(.+?)\s*$/im;
const RE_DATA_FECHO = /bras[ií]lia(?:\s*\/\s*df)?\s*,\s*(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/gi;

export function fechoTnu(texto) {
  const out = { orgao_fecho: "", relator_texto: "", relator_acordao_texto: "", data_fecho: "" };
  if (!texto) return out;
  const tn = norm(texto);
  if (RE_FECHO_TNU.test(tn)) out.orgao_fecho = "TURMA NACIONAL DE UNIFORMIZAÇÃO";
  const m = RE_RELATOR_TEXTO.exec(texto);
  if (m) out.relator_texto = m[1].replace(/\s+/g, " ").trim().replace(/[\s.:]+$/, "");
  const m2 = RE_RELATOR_ACORDAO_TEXTO.exec(texto);
  if (m2) out.relator_acordao_texto = m2[1].replace(/\s+/g, " ").trim().replace(/[\s.:]+$/, "");
  const ms = [...texto.matchAll(RE_DATA_FECHO)];
  const m3 = ms.length ? ms[ms.length - 1] : null;
  if (m3) {
    const mes = MESES[fold(m3[2])];
    if (mes) out.data_fecho = `${String(m3[1]).padStart(2, "0")}/${String(mes).padStart(2, "0")}/${m3[3]}`;
  }
  return out;
}

export function orgaoFonte(d) {
  if (d.orgao_fecho) return "fecho";
  if (d.inteiro_teor_texto) return "índice (fecho não reconhecido no inteiro teor)";
  return "índice do portal — não conferido no fecho (o voto não é exposto nesta base)";
}

export function aplicarFecho(d) {
  const avisos = [];
  const texto = d.inteiro_teor_texto || "";
  if (!texto) return avisos;
  const f = fechoTnu(texto);
  Object.assign(d, f);
  if (f.orgao_fecho && d.orgao && norm(f.orgao_fecho) !== norm(d.orgao)) {
    avisos.push(`DIVERGÊNCIA de órgão no id ${d.id}: índice diz '${d.orgao}', fecho diz '${f.orgao_fecho}'. Vale o fecho.`);
  }
  const relTxt = f.relator_acordao_texto || f.relator_texto;
  if (relTxt && d.relator && !norm(d.relator).includes(norm(relTxt)) && !norm(relTxt).includes(norm(d.relator))) {
    avisos.push(`RELATOR divergente no id ${d.id}: índice diz '${d.relator}', texto diz '${relTxt}'` +
      (f.relator_acordao_texto ? " (relator DO ACÓRDÃO — julgamento por maioria)" : "") + ". Vale o texto.");
  }
  if (f.data_fecho && d.data_julgamento && f.data_fecho !== d.data_julgamento) {
    avisos.push(`DATA divergente no id ${d.id}: índice diz ${d.data_julgamento}, fecho diz ${f.data_fecho} — confira na ata (extrato) qual é a sessão.`);
  }
  return avisos;
}

// --------------------------------------------------------------------- sinais do julgado ---
const RE_ANCORAS = [
  [/s[úu]mula\s+vinculante\s+n?[º°.]*\s*(\d{1,4})/gi, (n) => `Súmula Vinculante ${n}`],
  [/s[úu]mula\s+n?[º°.]*\s*(\d{1,4})/gi, (n) => `Súmula ${n}`],
  [/tema\s+(?:repetitivo\s+|de\s+repercuss[ãa]o\s+geral\s+)?n?[º°.]*\s*(\d{1,4}(?:\.\d{3})?)/gi, (n) => `Tema ${n}`],
  [/\bIRDR\s+n?[º°.]*\s*(\d{1,4})/gi, (n) => `IRDR ${n}`],
  [/\bIAC\s+n?[º°.]*\s*(\d{1,4})/gi, (n) => `IAC ${n}`],
  [/\bPUIL\s+n?[º°.]*\s*(\d{1,7}(?:-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})?)/gi, (n) => `PUIL ${n}`],
];
const ANCORAS_MAX = 6;

export function ancoras(texto, maxItens = ANCORAS_MAX) {
  const achado = new Map();
  for (const [re, rotular] of RE_ANCORAS) {
    for (const m of String(texto || "").matchAll(re)) {
      const n = /^PUIL/.test(rotular("")) ? m[1] : m[1].replace(/\./g, "");
      if (!n || n === "0") continue;
      const nome = rotular(n);
      if (nome.startsWith("Súmula ") && achado.has(`Súmula Vinculante ${n}`)) continue;
      if (!achado.has(nome)) achado.set(nome, m.index ?? 0);
    }
  }
  return [...achado.entries()].sort((a, b) => a[1] - b[1]).map(([nome]) => nome).slice(0, maxItens);
}

export function linhasDeSinais(d) {
  const linhas = [];
  const tipo = fold(d.tipo || "");
  if (tipo.includes("monocrat") || tipo.includes("presid")) {
    linhas.push("⚠️ decisão monocrática/da presidência: não é precedente do colegiado — serve para ver como o relator decide, não para citar como jurisprudência do órgão.");
  }
  if (/turma\s+recursal|juizado/.test(fold(`${d.orgao || ""} ${d.origem || ""}`))) {
    linhas.push("⚠️ Turma Recursal (Juizados Especiais Federais): pesa em processo de JEF; no rito comum é só persuasivo — prefira acórdão de Turma do TRF1 e diga o órgão na citação.");
  }
  const a = ancoras([d.ementa, d.decisao, d.inteiro_teor_texto].filter(Boolean).join(" "));
  if (a.length) linhas.push(`Cita: ${a.join(" · ")} — precedente qualificado citado pelo julgado (peso, e âncora para a próxima busca); confirme a situação de cada um no BNP/fonte.`);
  return linhas;
}

// --------------------------------------------------------------------------- recibos ---
const arqRecibo = (ident, env = process.env) => path.join(DIR_RECIBOS(env), (ident || "").replace(/[^A-Za-z0-9]/g, "") + ".json");
export { arqRecibo };

function textoDeCustodia(d) {
  return [d.ementa, d.decisao, d.inteiro_teor_texto || d.inteiro_teor_embutido].filter(Boolean).join("\n\n");
}

export function camposDeCustodia(d) {
  const texto = textoDeCustodia(d);
  const it = d.inteiro_teor_texto || d.inteiro_teor_embutido || "";
  let transcritos = [], divergente = "";
  if (it) {
    const tn = norm(it);
    transcritos = faixasTranscritas(tn, 0).map(([a, b]) => it.slice(bruto(it, tn, a), bruto(it, tn, b)));
    const div = faixaDivergente(tn, 0);
    divergente = div ? it.slice(bruto(it, tn, div[0])) : "";
  }
  return {
    id_documento: String(d.id || ""),
    nr_processo: d.numero_digitos || soDigitos(d.numero || ""),
    numero: d.numero || "",
    tribunal: (BASES[d.base || "trf1"] || BASES.trf1).rotulo,
    base: d.base || "trf1",
    tipo: d.tipo || "", classe: d.classe || "", qualificacao: d.qualificacao || "",
    data_julgamento: d.data_fecho || d.data_julgamento || "",
    data_publicacao: d.data_publicacao || "",
    orgao: d.orgao_fecho || d.orgao || "", orgao_fonte: orgaoFonte(d),
    relator: d.relator || "", relator_texto: d.relator_acordao_texto || d.relator_texto || "",
    url: d.link_inteiro_teor || "",
    texto, ementa: d.ementa || "", dispositivo: d.decisao || "",
    inteiro_teor_incluido: Boolean(it),
    inteiro_teor: it,
    trechos_transcritos: transcritos, trecho_divergente: divergente,
    normalizacao: "trechos em bruto, recortados de `texto` — normalize com a sua própria função",
    sha256: crypto.createHash("sha256").update(texto, "utf-8").digest("hex"),
    versao_servidor: VERSAO,
    obtido_em: new Date().toISOString().replace(/\.\d+Z$/, ""),
  };
}

export function gravarRecibo(d, env = process.env) {
  try {
    if (!d.id || !textoDeCustodia(d)) return "";
    const dir = DIR_RECIBOS(env);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch { /* melhor esforço */ }
    const rec = camposDeCustodia(d);
    const caminho = arqRecibo(rec.id_documento, env);
    const tmp = `${caminho}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rec), { mode: 0o600 });
    fs.renameSync(tmp, caminho);
    return caminho;
  } catch {
    return "";
  }
}

export function lerRecibo(ident, env = process.env) {
  const caminho = arqRecibo(ident, env);
  let rec, ok;
  try {
    rec = JSON.parse(fs.readFileSync(caminho, "utf-8"));
    ok = rec && typeof rec === "object" && typeof rec.texto === "string" &&
      crypto.createHash("sha256").update(rec.texto, "utf-8").digest("hex") === rec.sha256;
  } catch (e) {
    if (e.code === "ENOENT") return null;
    ok = false;
  }
  if (ok) return rec;
  try { fs.renameSync(caminho, caminho + ".inconsistente"); } catch { /* melhor esforço */ }
  return null;
}

export function recibosDoProcesso(digitos, base, env = process.env) {
  const dir = DIR_RECIBOS(env);
  if ((digitos || "").length !== 20 || !fs.existsSync(dir)) return [];
  const out = [];
  for (const nome of fs.readdirSync(dir).sort()) {
    if (!nome.endsWith(".json")) continue;
    const rec = lerRecibo(nome.slice(0, -5), env);
    if (rec && rec.id_documento && rec.base === base && rec.nr_processo === digitos) out.push(rec);
  }
  return out;
}

export function docDeRecibo(rec, env = process.env) {
  const url = rec.url || "";
  return {
    id: rec.id_documento, base: rec.base || "trf1", numero: rec.numero || "",
    numero_digitos: rec.nr_processo || "", tipo: rec.tipo || "", classe: rec.classe || "",
    qualificacao: rec.qualificacao || "", relator: rec.relator || "", orgao: rec.orgao || "",
    orgao_fecho: rec.orgao_fonte === "fecho" ? rec.orgao || "" : "",
    data_julgamento: rec.data_julgamento || "", data_publicacao: rec.data_publicacao || "",
    ementa: rec.ementa || "", decisao: rec.dispositivo || "",
    inteiro_teor_texto: rec.inteiro_teor || "",
    link_inteiro_teor: url, link_tipo: url.includes("eproctnu") ? "tnu" : url.includes("arquivo.trf1") ? "arquivo" : url.includes("pje") ? "pje" : "",
    campos: {}, recibo: arqRecibo(rec.id_documento, env),
  };
}

// --------------------------------------------------------------- citação e formatação ---
export function citacao(d) {
  const rotulo = d.sigla || d.classe || d.tipo || "Julgado";
  const tribunal = (BASES[d.base || "trf1"] || BASES.trf1).tribunal;
  const partes = [`${tribunal} - ${rotulo}: ${d.numero || cnj(d.numero_digitos || "")}`];
  if (d.qualificacao) partes.push(d.qualificacao);
  const origem = fold(d.origem || "").toUpperCase();
  if (origem && !origem.includes("PRIMEIRA REGI") && !["TNU", "SEI!JULGAR DO CJF"].includes(origem)) partes.push(`Origem: ${d.origem}`);
  if (d.relator) partes.push(`Relator: ${d.relator}`);
  if (d.relator_convocado) partes.push(`Relator convocado: ${d.relator_convocado}`);
  if (d.relator_para_acordao) partes.push(`Relator para acórdão: ${d.relator_para_acordao}`);
  const dj = d.data_fecho || d.data_julgamento;
  if (dj) partes.push(`Data de Julgamento: ${dj}`);
  const orgao = d.orgao_fecho || d.orgao;
  if (orgao) partes.push(orgao);
  if (d.data_publicacao) partes.push(`Data de Publicação: ${d.data_publicacao}`);
  return "(" + partes.join(", ") + ")";
}

export function nivelVerificacao(d, cortado = false) {
  if (d.inteiro_teor_texto || d.inteiro_teor_embutido) return cortado ? "inteiro teor lido EM PARTE" : "inteiro teor lido";
  return "só ementa/índice";
}

export function linkDocumentoEspecifico(d) {
  const link = d.link_inteiro_teor || "";
  return link && !["", "pje"].includes(d.link_tipo) ? link : "";
}

export function citacaoComLink(d) {
  const texto = citacao(d);
  const link = linkDocumentoEspecifico(d);
  return link ? `[${texto}](${link})` : texto;
}

export function notaInteiroTeor(d) {
  if (d.link_tipo === "tnu") {
    return `Inteiro teor: disponível em texto — obter_decisao_trf1(numero, base="tnu") traz o acórdão integral (eproc da TNU: ${d.link_inteiro_teor}).`;
  }
  if (d.inteiro_teor_embutido) return 'Inteiro teor: embutido no resultado — obter_decisao_trf1(numero, base="colegiado") traz o texto.';
  if (d.link_tipo === "arquivo") {
    return `Inteiro teor: ${d.link_inteiro_teor} — abrir NO NAVEGADOR (o arquivo.trf1.jus.br exige desafio Cloudflare; esta ferramenta não o lê).`;
  }
  if (d.link_tipo === "pje") {
    return `Inteiro teor: processo do PJe — o portal só dá o link genérico da consulta pública (${URL_PJE_CONSULTA_PUBLICA}); pesquise lá pelo número ${d.numero || ""} no navegador.`;
  }
  return "Inteiro teor: link não informado pelo portal.";
}

export function formatBusca(docs, total, meta) {
  const consulta = meta.consulta_montada || "";
  const tipos = meta.tipos || [];
  const fontes = meta.fontes || [];
  const pagina = meta.pagina ?? 1;
  const porPagina = meta.por_pagina ?? 30;
  const filtros = meta.filtros || {};
  const base = meta.base || "trf1";
  const linhas = [];
  let cab = `**${total} documento(s)** no portal do CJF/${BASES[base].rotulo} para \`${consulta || "(só filtros)"}\``;
  if (tipos.length) cab += ` · tipo: ${tipos.map((t) => TIPOS_ROTULO[t] || t).join(", ")}`;
  if (fontes.length) cab += ` · fonte: ${fontes.join("+")}`;
  if (meta.tipo_acordao?.length) cab += " · precedentes: " + meta.tipo_acordao.map((t) => TIPOS_ACORDAO_TNU[t] || t).join(", ");
  if (Object.keys(filtros).length) cab += " · filtros: " + Object.entries(filtros).map(([k, v]) => `${k}=${v}`).join("; ");
  const totalPaginas = total ? Math.max(1, Math.ceil(total / porPagina)) : 1;
  cab += ` · página ${pagina}/${totalPaginas} (${porPagina} por página)`;
  linhas.push(cab);
  for (const a of meta.avisos || []) linhas.push(`⚠️ ${a}`);
  if (total > 3000 && pagina === 1) {
    linhas.push('Dica: total alto — restrinja com `E` (ex.: `"dano moral" E negativação`), com `grupos`, com `[EMEN]` para buscar só na ementa, ou com filtro de órgão/relator/data.');
  }
  if (!docs.length) {
    linhas.push("\nNenhum resultado nesta página. Se o total é 0: a busca casa PALAVRAS — tente sinônimos com `OU` ou `grupos`, radical com `$` (`desapropria$`), a súmula/tema que os julgados do assunto citam, e confira se não há preposição/pontuação na consulta (o motor não aceita). Se o total é > 0, a página pedida está além do fim.");
    return linhas.join("\n");
  }
  const porNumero = new Map();
  for (const d of docs) if (d.numero_digitos) {
    if (!porNumero.has(d.numero_digitos)) porNumero.set(d.numero_digitos, []);
    porNumero.get(d.numero_digitos).push(d);
  }
  let houveCorte = false;
  docs.forEach((d, idx) => {
    const i = (pagina - 1) * porPagina + idx + 1;
    let titulo = [d.tipo, d.classe].filter(Boolean).join(" ") || "Documento";
    if (d.qualificacao) titulo += ` ★ ${d.qualificacao}`;
    linhas.push(`\n**${i}. ${titulo} — ${d.numero || "(sem número)"}**  · Id. do documento: ${d.id}`);
    const metaL = [];
    if (d.relator) metaL.push(`Relator(a): ${d.relator}`);
    if (d.relator_convocado) metaL.push(`Relator convocado: ${d.relator_convocado}`);
    if (d.relator_para_acordao) metaL.push(`Relator p/ acórdão: ${d.relator_para_acordao}`);
    if (d.orgao) metaL.push(`Órgão: ${d.orgao}`);
    if (d.origem && !d.origem.toUpperCase().includes("PRIMEIRA REGI")) metaL.push(`Origem: ${d.origem}`);
    if (d.data_julgamento) metaL.push(`Julgamento: ${d.data_julgamento}`);
    if (d.data_publicacao) metaL.push(`Publicação: ${d.data_publicacao}`);
    if (d.fonte_publicacao) metaL.push(`Fonte: ${d.fonte_publicacao}`);
    linhas.push("  " + metaL.join(" · "));
    linhas.push(`  Citação: ${citacaoComLink(d)} — verificação: ${nivelVerificacao(d)}`);
    for (const sl of linhasDeSinais(d)) linhas.push(`  ${sl}`);
    const em = d.ementa || "";
    if (em.length > TRECHO_EMENTA) houveCorte = true;
    linhas.push(`  Ementa (trecho): ${limpar(em, TRECHO_EMENTA) || "—"}`);
    if (d.decisao) linhas.push(`  Dispositivo: ${limpar(d.decisao, TRECHO_DECISAO)}`);
    const irmaos = porNumero.get(d.numero_digitos) || [];
    if (irmaos.length > 1 && irmaos[0] === d) {
      const desc = irmaos.map((x) => `${x.data_julgamento || "?"} ${x.tipo || ""} (id ${x.id}, Rel. ${x.relator || "?"})`).join("; ");
      linhas.push(`  ⚠️ Mesmo número, ${irmaos.length} documentos nesta página: ${desc} — cite pelo id + data, nunca só pelo número.`);
      for (const par of OPOSTOS) {
        const porData = new Map();
        for (const x of irmaos) {
          const l = ladoDe(resultadoDe(x.decisao || ""), par);
          if (l) {
            if (!porData.has(x.data_julgamento)) porData.set(x.data_julgamento, new Set());
            porData.get(x.data_julgamento).add(l);
          }
        }
        for (const [data, ls] of porData) {
          if (ls.size > 1) linhas.push(`  ⚠️ Documentos do julgamento de ${data} declaram resultados opostos (${[...ls].sort().join(" × ")}) — provável voto vencido ou decisão monocrática indexada; leia cada um.`);
        }
      }
    }
    linhas.push(`  ${notaInteiroTeor(d)}`);
  });
  if (houveCorte) {
    linhas.push(`\nℹ️ Ementas cortadas em ${TRECHO_EMENTA} caracteres — ementa numerada aplica a tese nos ÚLTIMOS itens; use obter_decisao_trf1 para a ementa e o dispositivo INTEGRAIS antes de citar.`);
  }
  if (docs.length >= 3) {
    const r = resumoResultadosPagina(docs);
    const partes = Object.entries(ROTULOS_RESULTADO).filter(([k]) => r.contagem[k]).map(([k, v]) => `${r.contagem[k]} ${v}`);
    if (partes.length) {
      const sem = r.sem_resultado ? `; ${r.sem_resultado} sem resultado identificável` : "";
      linhas.push(`\nResumo desta página (offline, pelo dispositivo, 1× por julgamento): ${partes.join(", ")}${sem} — em ${r.total_julgamentos} julgamento(s). Indício para escolher o que ler; recurso provido por outro fundamento também conta como provido.`);
    }
  }
  if (total > pagina * porPagina) linhas.push(`\nPróxima página: pagina=${pagina + 1} (mesmos parâmetros).`);
  return linhas.join("\n");
}

export function formatDecisao(docs, numero, total) {
  if (!docs.length) {
    return `Nenhum documento publicado no portal do CJF/TRF1 sob o número ${numero}. Confira o número (com ou sem pontuação); decisões muito recentes ou de 1º grau não estão na base.`;
  }
  const linhas = [`**${docs.length} documento(s) publicado(s) sob o número ${docs[0].numero || numero}**` +
    (total > docs.length ? ` (o portal informa ${total}; mostrando os primeiros)` : "")];
  if (docs.length > 1) {
    linhas.push("Julgamentos distintos sob o mesmo número — a ficha se identifica por número + data + id:");
    for (const d of docs) linhas.push(`- ${d.data_julgamento || "?"} · ${d.tipo || "?"} · id ${d.id} · Rel. ${d.relator || "?"} · ${d.orgao || ""}`);
  }
  const orcamentoPorDoc = Math.max(8000, Math.floor(ORCAMENTO_DECISAO / Math.max(1, docs.length)));
  for (const d of docs) {
    const it = d.inteiro_teor_texto || d.inteiro_teor_embutido || "";
    let em = d.ementa || "—";
    const cortado = em.length > orcamentoPorDoc || it.length > orcamentoPorDoc;
    const nivel = nivelVerificacao(d, cortado);
    linhas.push(`\n### ${d.tipo || "Documento"} · id ${d.id} · julgado em ${d.data_fecho || d.data_julgamento || "?"}`);
    linhas.push(`Citação: ${citacaoComLink(d)} — verificação: ${nivel}`);
    linhas.push(`  orgao_fonte: ${orgaoFonte(d)}` + (d.relator_acordao_texto || d.relator_texto ? ` · relator no texto: ${d.relator_acordao_texto || d.relator_texto}` : ""));
    const extras = Object.entries(d.campos || {}).filter(([k]) => !["Ementa", "Decisão", "Inteiro teor", "Número", "Fonte da publicação"].includes(k));
    if (extras.length) linhas.push("  " + extras.map(([k, v]) => `${k}: ${v}`).join(" · "));
    if (d.fonte_publicacao) linhas.push(`  Fonte da publicação: ${d.fonte_publicacao}`);
    for (const sl of linhasDeSinais(d)) linhas.push(`  ${sl}`);
    if (em.length > orcamentoPorDoc) {
      const cortadoTxt = em.slice(0, orcamentoPorDoc);
      const i = cortadoTxt.lastIndexOf(" ");
      em = (i > 0 ? cortadoTxt.slice(0, i) : cortadoTxt) + "… [CORTADO pelo orçamento de caracteres — o recibo em disco tem o texto inteiro]";
    }
    linhas.push(`\n**Ementa (integral, literal do portal):**\n${em}`);
    linhas.push(`\n**Dispositivo (campo "Decisão", literal):**\n${d.decisao || "— (não informado pelo portal)"}`);
    if (it) {
      let itSaida = it;
      if (it.length > orcamentoPorDoc) {
        const cortadoTxt = it.slice(0, orcamentoPorDoc);
        const i = cortadoTxt.lastIndexOf(" ");
        itSaida = (i > 0 ? cortadoTxt.slice(0, i) : cortadoTxt) + "… [CORTADO pelo orçamento de caracteres — o recibo em disco tem o texto inteiro; verificação = EM PARTE]";
      }
      linhas.push(`\n**Inteiro teor (literal, ${d.inteiro_teor_texto ? "eproc da TNU" : "embutido no portal"}):**\n${itSaida}`);
    } else {
      linhas.push(`\n${notaInteiroTeor(d)}`);
    }
  }
  const base = docs[0].base || "trf1";
  if (docs.some((d) => d.inteiro_teor_texto || d.inteiro_teor_embutido)) {
    linhas.push(`\n---\nPara a ficha de precedente: \`tribunal: "${BASES[base].rotulo}"\`, \`id_documento\` = id acima, \`julgamento\` em ISO, \`ementa\`/\`dispositivo\`/\`trecho\` literais (cortes com [...]), \`verificacao\` = exatamente o nível que a linha de citação diz ("EM PARTE" nunca vira pleno), \`orgao\` e \`orgao_fonte\` como acima (relator e órgão da ficha vêm do TEXTO quando o fecho foi lido). Antes de pôr aspas, verificar_citacao_trf1 — que diz de quem é a frase.`);
  } else {
    linhas.push('\n---\nPara a ficha de precedente: `tribunal: "TRF1"`, `id_documento` = id acima, `julgamento` em ISO, `ementa`/`dispositivo` literais (cortes com [...]), `orgao_fonte: "índice"`. O portal NÃO expõe o voto: `verificacao` fica em "só ementa/índice" — em `limites`, diga o que só o voto resolveria. "Inteiro teor lido" só depois de abrir o PDF no navegador.');
  }
  return linhas.join("\n");
}

// ------------------------------------------------------------- verificação de trecho ---
function normalizarParaComparar(t) {
  let r = semDestaque(t || "");
  r = fold(r);
  r = r.replace(/[^\w\s]/g, " ");
  return r.replace(/\s+/g, " ").trim();
}

export function verificarTrecho(textos, trecho, tribunal = "TRF1") {
  const frags = (trecho || "").split(/\[\s*\.\.\.\s*\]|\(\s*\.\.\.\s*\)|\[…\]|…/).map((f) => f.trim()).filter(Boolean);
  if (!frags.length) return { valido: false, onde: null, faltando: [], alertas: [], motivo: "trecho vazio" };
  const util = norm(frags.join(" "));
  if (util.split(/\s+/).filter(Boolean).length < PISO_TRECHO_PALAVRAS || util.length < PISO_TRECHO_CHARS) {
    return { valido: false, onde: null, faltando: [], alertas: [],
      motivo: `trecho curto demais para conferência útil (mínimo ${PISO_TRECHO_PALAVRAS} palavras e ${PISO_TRECHO_CHARS} caracteres): qualquer acórdão contém isso` };
  }
  let melhorErro = null;
  for (const [nome, texto] of Object.entries(textos)) {
    if (!(texto || "").trim()) continue;
    const r = conferir(texto, trecho, tribunal, nome === "inteiro teor");
    if (r.ok) {
      return { valido: true, onde: nome, faltando: [], alertas: r.alertas, contexto: r.contexto, motivo: `trecho encontrado literalmente em: ${nome}` };
    }
    if (r.fragmento && (!melhorErro || "erro" in r)) melhorErro = r;
  }
  if (melhorErro && melhorErro.erro) {
    return { valido: false, onde: null, faltando: [melhorErro.fragmento], alertas: [], motivo: melhorErro.erro };
  }
  return { valido: false, onde: null, faltando: melhorErro ? [melhorErro.fragmento] : frags, alertas: [],
    motivo: "trecho NÃO encontrado literalmente — não cite entre aspas; parafraseie ou corrija" };
}
export { normalizarParaComparar };

// --------------------------------------------------------------------------- disjuntor ---
// Mesma disciplina do servidor Python (v1.1.0, 22/09/2026): fail-closed, desafio de navegador
// separado de bloqueio por robotização, escada só sobe com rajada desta máquina, timeout NÃO
// arma o disjuntor, estado ilegível pausa finito com motivo.
const JANELA_MAX_REQS = 24;
const ESCADA_JANELA_MS = [60_000, 5 * 60_000, 10 * 60_000, 20 * 60_000, 30 * 60_000];
const SUCESSOS_PARA_RELAXAR = 100;
const BACKOFF_INICIAL_MS = 10 * 60_000;
const BACKOFF_MAXIMO_MS = 60 * 60_000;
const ESPACAMENTO_MIN_MS = 1_500;
const ESPERA_MAXIMA_MS = 30_000;
const TRAVA_TIMEOUT_MS = 2_000;
const TRAVA_OBSOLETA_MS = 1_000;
const MIN_REQS_PARA_ESCADA = 3;
const PAUSA_ILEGIVEL_MS = 10 * 60_000;
const MAX_INCIDENTES = 20;

let arquivoEstadoDisjuntor = path.join(path.dirname(new URL(import.meta.url).pathname), ".disjuntor_estado_trf1.json");
export function _setArquivoEstadoParaTeste(caminho) {
  arquivoEstadoDisjuntor = caminho;
}
export function _arquivoEstadoAtual() {
  return arquivoEstadoDisjuntor;
}

const ESTADO_PADRAO = {
  versao: 1, requisicoes: [], proximoLivreEm: 0, bloqueadoAte: 0, indiceJanela: 0, sucessos: 0,
  backoffMs: BACKOFF_INICIAL_MS, incidentes: [], ultimaRequisicaoEm: 0, ultimoSucessoEm: 0,
  totalRequisicoes: 0, motivoPausa: "",
};

const dormirSync = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* segue best-effort */ }
};

function comTrava(fn) {
  const lock = arquivoEstadoDisjuntor + ".lock";
  const limite = Date.now() + TRAVA_TIMEOUT_MS;
  let fd = null;
  for (;;) {
    try { fd = fs.openSync(lock, "wx"); break; } catch (e) {
      if (e.code !== "EEXIST" || Date.now() > limite) break;
      try {
        const st = fs.statSync(lock);
        if (Date.now() - st.mtimeMs > TRAVA_OBSOLETA_MS) fs.unlinkSync(lock);
      } catch { /* trava sumiu no meio do caminho */ }
      dormirSync(5);
    }
  }
  try {
    return fn(fd !== null);
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* melhor esforço */ }
      try { fs.unlinkSync(lock); } catch { /* melhor esforço */ }
    }
  }
}

class PesquisaNaoRealizada extends Error {}
class PortalRecusou extends PesquisaNaoRealizada {}
class SessaoInvalida extends Error {}
export { PesquisaNaoRealizada, PortalRecusou, SessaoInvalida };

function lerEstadoDisjuntor() {
  const estado = { ...ESTADO_PADRAO };
  const agora = Date.now();
  let dados;
  try {
    dados = JSON.parse(fs.readFileSync(arquivoEstadoDisjuntor, "utf-8"));
  } catch (e) {
    if (e.code === "ENOENT") return estado;
    estado.bloqueadoAte = agora + PAUSA_ILEGIVEL_MS;
    estado.motivoPausa = `estado do disjuntor ilegível (${e.name}) — fail-closed`;
    estado.indiceJanela = ESCADA_JANELA_MS.length - 1;
    return estado;
  }
  if (!dados || typeof dados !== "object") {
    estado.bloqueadoAte = agora + PAUSA_ILEGIVEL_MS;
    estado.motivoPausa = "estado do disjuntor com tipo inválido — fail-closed";
    estado.indiceJanela = ESCADA_JANELA_MS.length - 1;
    return estado;
  }
  for (const k of Object.keys(ESTADO_PADRAO)) if (k in dados) estado[k] = dados[k];
  const num = (v, padrao) => (Number.isFinite(Number(v)) ? Number(v) : padrao);
  const margem = ESPERA_MAXIMA_MS + ESPACAMENTO_MIN_MS;
  estado.requisicoes = (Array.isArray(estado.requisicoes) ? estado.requisicoes : []).filter(Number.isFinite).filter((t) => t <= agora + margem);
  estado.proximoLivreEm = Math.min(num(estado.proximoLivreEm, 0), agora + margem);
  estado.bloqueadoAte = Math.max(0, Math.min(num(estado.bloqueadoAte, 0), agora + BACKOFF_MAXIMO_MS));
  estado.indiceJanela = Math.max(0, Math.min(Math.trunc(num(estado.indiceJanela, 0)), ESCADA_JANELA_MS.length - 1));
  estado.backoffMs = Math.max(BACKOFF_INICIAL_MS, Math.min(num(estado.backoffMs, BACKOFF_INICIAL_MS), BACKOFF_MAXIMO_MS));
  estado.sucessos = Math.max(0, Math.trunc(num(estado.sucessos, 0)));
  const inc = estado.incidentes;
  const incFmt = (i) => ({ ...i, quando: num(i.quando, 0), reqsUltimos60s: Math.trunc(num(i.reqsUltimos60s, 0)),
    reqsNaJanela: Math.trunc(num(i.reqsNaJanela, 0)), janelaMs: Math.trunc(num(i.janelaMs, 0)),
    operacao: String(i.operacao || "?"), tipo: String(i.tipo || "bloqueio"),
    desdeUltimaReqMs: i.desdeUltimaReqMs == null ? null : Math.trunc(num(i.desdeUltimaReqMs, 0)) });
  estado.incidentes = Array.isArray(inc) ? inc.filter((i) => i && typeof i === "object").map(incFmt).slice(-MAX_INCIDENTES) : [];
  estado.ultimoSucessoEm = num(estado.ultimoSucessoEm, 0);
  estado.motivoPausa = String(estado.motivoPausa || "");
  return estado;
}

let persistenciaIndisponivel = null;
export function _statusPersistencia() { return persistenciaIndisponivel; }

function transacao(fn, obrigatoria = false) {
  return comTrava((travado) => {
    if (!travado) {
      persistenciaIndisponivel = `sem trava em ${arquivoEstadoDisjuntor}.lock`;
      if (obrigatoria) {
        throw new PesquisaNaoRealizada(
          `não consegui a trava do disjuntor (${arquivoEstadoDisjuntor}.lock — permissão?); sem trava não há como dividir o orçamento entre processos, e sem isso não há requisição (fail-closed). Não contornar por navegador, proxy ou outro cliente.`
        );
      }
    }
    const estado = lerEstadoDisjuntor();
    const resultado = fn(estado);
    try {
      const tmp = `${arquivoEstadoDisjuntor}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(estado));
      fs.renameSync(tmp, arquivoEstadoDisjuntor);
      persistenciaIndisponivel = null;
    } catch (e) {
      persistenciaIndisponivel = e.code || e.name || "EIO";
      if (obrigatoria) {
        throw new PesquisaNaoRealizada(
          `não consegui gravar o estado do disjuntor (${arquivoEstadoDisjuntor}: ${persistenciaIndisponivel}); sem registro não há requisição (fail-closed). Verifique permissão e espaço em disco.`
        );
      }
    }
    return resultado;
  });
}

function fmtHms(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h) return m ? `${h}h${String(m).padStart(2, "0")}min` : `${h}h`;
  if (m) return r ? `${m}min${String(r).padStart(2, "0")}s` : `${m}min`;
  return `${r}s`;
}

export function reservarRequisicao(agora = Date.now()) {
  return transacao((e) => {
    if (agora < e.bloqueadoAte) {
      const motivo = e.motivoPausa || "o portal do CJF/TRF1 recusou uma consulta recente (bloqueio, desafio de navegador ou HTTP 403/429)";
      return { erro: `disjuntor em pausa por mais ${fmtHms(e.bloqueadoAte - agora)} — ${motivo}. Para não prolongar o bloqueio, esta ferramenta não tenta de novo antes disso. O portal jurisprudencia.cjf.jus.br/trf1 segue acessível no navegador; não contornar por proxy ou outro cliente.` };
    }
    const janela = ESCADA_JANELA_MS[e.indiceJanela];
    e.requisicoes = e.requisicoes.filter((t) => agora - t <= janela);
    if (e.requisicoes.length >= JANELA_MAX_REQS) {
      const espera = janela - (agora - e.requisicoes[0]);
      return { erro: `Muitas consultas em pouco tempo (limite atual: ${JANELA_MAX_REQS} requisições a cada ${fmtHms(janela)}, compartilhado por todos os processos desta extensão nesta máquina; cada busca gasta 2 a 4). Aguarde ${fmtHms(espera)} e tente de novo.` };
    }
    const vaga = Math.max(agora, e.proximoLivreEm);
    const esperar = vaga - agora;
    if (esperar > ESPERA_MAXIMA_MS) {
      return { erro: `Fila de espera longa demais (${fmtHms(esperar)}) — há consultas demais em andamento em paralelo. Refaça a busca daqui a pouco, de preferência uma por vez.` };
    }
    e.proximoLivreEm = vaga + ESPACAMENTO_MIN_MS;
    e.requisicoes.push(vaga);
    e.ultimaRequisicaoEm = vaga;
    e.totalRequisicoes = (e.totalRequisicoes || 0) + 1;
    return { esperarMs: esperar };
  }, true);
}

export function registrarBloqueioDetectado(agora = Date.now(), operacao = "?", { subirEscada = true, esperaMinimaMs = 0, tipo = "bloqueio" } = {}) {
  try {
    transacao((e) => {
      const reqs = e.requisicoes || [];
      const janela = ESCADA_JANELA_MS[e.indiceJanela];
      const anteriores = e.incidentes || [];
      const ult60 = reqs.filter((t) => agora - t <= 60_000).length;
      e.incidentes = [...anteriores, {
        quando: agora, tipo, operacao, nivel: e.indiceJanela, janelaMs: janela,
        reqsUltimos60s: ult60, reqsNaJanela: reqs.filter((t) => agora - t <= janela).length,
        desdeUltimaReqMs: e.ultimaRequisicaoEm ? agora - e.ultimaRequisicaoEm : null,
        desdeIncidenteAnteriorMs: anteriores.length ? agora - anteriores[anteriores.length - 1].quando : null,
      }].slice(-MAX_INCIDENTES);
      e.bloqueadoAte = agora + Math.max(e.backoffMs, esperaMinimaMs);
      e.motivoPausa = { desafio: "o portal devolveu um desafio de navegador (Cloudflare/F5) — não se contorna; teste outra rede ou o navegador",
        http: "o portal respondeu HTTP 403/429 sem assinatura de bloqueio" }[tipo] || "o portal bloqueou a consulta por suspeita de automação";
      e.backoffMs = Math.min(e.backoffMs * 2, BACKOFF_MAXIMO_MS);
      if (subirEscada && tipo === "bloqueio" && ult60 >= MIN_REQS_PARA_ESCADA && e.indiceJanela < ESCADA_JANELA_MS.length - 1) e.indiceJanela++;
      e.sucessos = 0;
    });
  } catch (e) {
    if (!(e instanceof PesquisaNaoRealizada)) throw e;
  }
}

export function registrarSucesso(agora = Date.now()) {
  try {
    transacao((e) => {
      e.backoffMs = BACKOFF_INICIAL_MS;
      e.ultimoSucessoEm = agora;
      e.motivoPausa = "";
      e.sucessos++;
      if (e.sucessos >= SUCESSOS_PARA_RELAXAR) {
        e.sucessos = 0;
        if (e.indiceJanela > 0) e.indiceJanela--;
      }
    });
  } catch (e) {
    if (!(e instanceof PesquisaNaoRealizada)) throw e;
  }
}

export function bloqueioSistematico(e, agora) {
  const inc = (e.incidentes || []).filter((i) => i && agora - Number(i.quando || 0) <= 86_400_000);
  if (inc.length < 2 || inc.some((i) => Number(i.reqsUltimos60s || 0) > 2)) return false;
  const primeiro = Math.min(...inc.map((i) => Number(i.quando || 0)));
  return Number(e.ultimoSucessoEm || 0) < primeiro;
}

export function diagnosticoRitmo(agora = Date.now()) {
  const e = comTrava(() => lerEstadoDisjuntor());
  const janela = ESCADA_JANELA_MS[e.indiceJanela];
  const naJanela = e.requisicoes.filter((t) => agora - t <= janela).length;
  let nRec = 0;
  try { nRec = fs.readdirSync(DIR_RECIBOS()).filter((f) => f.endsWith(".json")).length; } catch { /* pasta pode não existir */ }
  const linhas = [
    `**Controle de ritmo do MCP TRF1 (portal do CJF) — v${VERSAO}**`,
    `- Nível atual: ${e.indiceJanela + 1} de ${ESCADA_JANELA_MS.length} (limite: ${JANELA_MAX_REQS} requisições a cada ${fmtHms(janela)}; cada busca gasta 2 a 4)`,
    `- Orçamento usado agora: ${naJanela}/${JANELA_MAX_REQS} nesta janela`,
    `- Requisições desde o início (nesta máquina): ${e.totalRequisicoes || 0}`,
    agora < e.bloqueadoAte
      ? `- ⚠️ EM PAUSA — liberando em ${fmtHms(e.bloqueadoAte - agora)}` + (e.motivoPausa ? ` (${e.motivoPausa})` : "")
      : "- Situação: liberado",
    `- User-Agent: ${process.env.TRF1_USER_AGENT ? "definido por TRF1_USER_AGENT" : "padrão (identificado)"}`,
    `- Recibos gravados em ${DIR_RECIBOS()}: ${nRec}`,
  ];
  if (persistenciaIndisponivel) {
    linhas.splice(1, 0, `- ⚠️ AVISO: falha ao usar ${arquivoEstadoDisjuntor} (${persistenciaIndisponivel}) — enquanto isso a reserva de requisição é RECUSADA (fail-closed): verifique permissão e espaço em disco.`);
  }
  const inc = e.incidentes || [];
  if (!inc.length) {
    linhas.push("\nNenhuma recusa do portal registrada até agora nesta máquina.");
    return linhas.join("\n");
  }
  linhas.push(`\n**Recusas registradas: ${inc.length}** (mais recentes primeiro)`);
  for (const i of [...inc].reverse().slice(0, 8)) {
    const quando = new Date(i.quando).toLocaleString("sv-SE").slice(0, 16);
    const intervalo = i.desdeUltimaReqMs == null ? "—" : `${Math.round(i.desdeUltimaReqMs / 1000)}s`;
    linhas.push(`- ${quando} · ${i.tipo || "bloqueio"} · ${i.reqsUltimos60s ?? "?"} requisições no minuto anterior, ${i.reqsNaJanela ?? "?"} na janela de ${fmtHms(i.janelaMs || 0)} · intervalo desde a anterior: ${intervalo} · operação: ${i.operacao || "?"}`);
  }
  const media = inc.reduce((s, i) => s + Number(i.reqsUltimos60s || 0), 0) / inc.length;
  const pouco = inc.filter((i) => i.reqsUltimos60s <= 2).length;
  linhas.push(`\n**Padrão observado:** em média ${media.toFixed(1)} requisições no minuto que antecedeu cada recusa.`);
  if (bloqueioSistematico(e, agora)) {
    linhas.push("⚠️ RECUSA SISTEMÁTICA: 2 ou mais recusas em 24 h, com pouco tráfego desta máquina e nenhum sucesso entre elas. Não é rajada — é o portal (ou a rede desta máquina) recusando este cliente. Espaçar não resolve: teste outra rede, use o portal no navegador e, se persistir, informe o suporte do portal do CJF. Não contornar (proxy, User-Agent de navegador, cookie de sessão).");
  } else if (pouco > inc.length / 2) {
    linhas.push("A maioria das recusas veio com pouquíssimo tráfego desta máquina — indício de causa fora do controle desta ferramenta (outro equipamento no mesmo IP, ou o próprio portal apertando o filtro). Espaçar mais aqui tende a não resolver.");
  } else if (media >= 8) {
    linhas.push("As recusas vieram após rajadas — preferir uma busca ampla a várias seguidas é o que mais ajuda.");
  }
  return linhas.join("\n");
}

// cache de respostas idênticas por processo (não por disco): 5 min, 32 entradas
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 32;
const cacheRespostas = new Map();
export function cacheLer(chave) {
  const item = cacheRespostas.get(chave);
  if (!item) return null;
  if (Date.now() - item.quando > CACHE_TTL_MS) { cacheRespostas.delete(chave); return null; }
  return item.dados;
}
export function cacheGravar(chave, dados) {
  if (cacheRespostas.size >= CACHE_MAX) cacheRespostas.delete(cacheRespostas.keys().next().value);
  cacheRespostas.set(chave, { quando: Date.now(), dados });
}
export function _resetDisjuntorParaTeste() {
  try { fs.unlinkSync(arquivoEstadoDisjuntor); } catch { /* ok */ }
  try { fs.unlinkSync(arquivoEstadoDisjuntor + ".lock"); } catch { /* ok */ }
  persistenciaIndisponivel = null;
  cacheRespostas.clear();
}

// ---------------------------------------------------------- camada HTTP / sessão JSF ---
const RE_DESAFIO = /<title>\s*just a moment|cf-mitigated|challenges\.cloudflare\.com|cf-chl|\/TSPD\/|loaderConfig/i;
const RE_BLOQUEIO_ANTIROBO = /acesso (foi )?bloqueado|p[aá]gina bloqueada|robotiza|suspeita de automa/i;
export const ehDesafioNavegador = (texto) => RE_DESAFIO.test(texto || "");
const RE_SESSAO_EXPIRADA = /ViewExpired|sess[aã]o expirad|view state could not be restored/i;

export function envelope(texto) {
  const e = (texto || "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, " ");
  return e.split("<![CDATA[")[0].slice(0, 20_000);
}

function diagnosticarResposta(status, ctype, texto, esperado) {
  if (ehDesafioNavegador(texto || "")) {
    return `o portal devolveu um DESAFIO DE NAVEGADOR (Cloudflare/F5, HTTP ${status}) em vez da resposta. Isso não é bloqueio por volume e não se contorna (nem por proxy, User-Agent ou cookie): teste outra rede, use o portal no navegador e, se persistir, informe o suporte do portal.`;
  }
  if (RE_BLOQUEIO_ANTIROBO.test(texto || "")) {
    return `o portal recusou a consulta com uma página de bloqueio anti-robô (HTTP ${status}). Costuma ser temporário — a ferramenta pausa e o portal segue acessível no navegador.`;
  }
  if (RE_SESSAO_EXPIRADA.test(texto || "")) return "A sessão do portal expirou (ViewState); a ferramenta vai reabrir a sessão.";
  return `O portal respondeu algo inesperado (esperava ${esperado}; veio HTTP ${status}, content-type=${JSON.stringify(ctype)}). Pode ser instabilidade temporária do CJF — tente de novo em instantes.`;
}

// Cookie jar simples por sessão (Node fetch não persiste cookies entre requisições).
class CookieJar {
  constructor() { this.cookies = new Map(); }
  aplicar(headers) {
    const set = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
    for (const linha of set) {
      const par = linha.split(";", 1)[0];
      const i = par.indexOf("=");
      if (i > 0) this.cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
  }
  cabecalho() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

function paresParaForm(pares) {
  const body = new URLSearchParams();
  if (!pares) return body;
  if (Array.isArray(pares)) {
    for (const [k, v] of pares) body.append(k, v);
  } else {
    for (const [k, v] of Object.entries(pares)) body.append(k, v);
  }
  return body;
}

async function requisitar(jar, metodo, url, operacao, { data, headers = {}, esperado = "html" } = {}, fetchImpl = fetch, env = process.env) {
  const reserva = reservarRequisicao();
  if (reserva.erro) throw new PesquisaNaoRealizada(reserva.erro);
  if (reserva.esperarMs > 0) await new Promise((r) => setTimeout(r, reserva.esperarMs));
  const h = { ...headersBase(env), ...headers };
  if (jar.cookies.size) h.Cookie = jar.cabecalho();
  let r;
  try {
    r = metodo === "GET"
      ? await fetchImpl(url, { headers: h, signal: AbortSignal.timeout(45_000) })
      : await fetchImpl(url, { method: "POST", headers: h, body: paresParaForm(data), signal: AbortSignal.timeout(45_000) });
  } catch (e) {
    throw new PesquisaNaoRealizada(`falha de rede ao consultar o portal (${e.name}: ${e.message}) — tente de novo em instantes`);
  }
  jar.aplicar(r.headers);
  const ctype = (r.headers.get("content-type") || "").toLowerCase();
  // Response.text() do WHATWG fetch decodifica sempre como UTF-8, ignorando o charset do
  // Content-Type — o eproc da TNU declara "charset= ISO-8859-1" (mojibake real, 23/09/2026:
  // acentos viravam replacement char e derrubavam o reconhecimento do fecho). Decodifica pelo
  // charset declarado; sem um TextDecoder reconhecido, cai para utf-8.
  const buf = await r.arrayBuffer();
  const mCharset = /charset\s*=\s*"?([\w-]+)"?/.exec(ctype);
  let texto;
  try {
    texto = new TextDecoder(mCharset ? mCharset[1] : "utf-8").decode(buf);
  } catch {
    texto = new TextDecoder("utf-8").decode(buf);
  }
  const env_ = envelope(texto);
  const ehDesafio = ehDesafioNavegador(env_);
  const ehBloqueio = RE_BLOQUEIO_ANTIROBO.test(env_);
  if (ehDesafio || ehBloqueio || r.status === 403 || r.status === 429) {
    const campos = (data && !Array.isArray(data) ? data : Object.fromEntries(data || [])) || {};
    const operacaoReal = campos.nr_processo && !campos.query ? "inteiro_teor" : "busca";
    let esperaMinimaMs = 0;
    try { esperaMinimaMs = (Number(r.headers.get("retry-after")) || 0) * 1000; } catch { /* ok */ }
    const tipo = ehDesafio ? "desafio" : ehBloqueio ? "bloqueio" : "http";
    registrarBloqueioDetectado(Date.now(), operacao || operacaoReal, { subirEscada: ehBloqueio && !ehDesafio, esperaMinimaMs, tipo });
    throw new PortalRecusou(diagnosticarResposta(r.status, ctype, texto, esperado));
  }
  if (RE_SESSAO_EXPIRADA.test(env_)) throw new SessaoInvalida(diagnosticarResposta(r.status, ctype, texto, esperado));
  if (r.status >= 400) throw new PesquisaNaoRealizada(diagnosticarResposta(r.status, ctype, texto, esperado));
  if (esperado === "xml" && !texto.slice(0, 2000).includes("<partial-response")) {
    throw new PesquisaNaoRealizada(diagnosticarResposta(r.status, ctype, texto, "XML <partial-response>"));
  }
  if (esperado === "html" && !texto.includes("javax.faces.ViewState")) {
    throw new PesquisaNaoRealizada(diagnosticarResposta(r.status, ctype, texto, "a página do formulário"));
  }
  registrarSucesso();
  return texto;
}

function formBusca(consulta, tipos, fontes, viewstate, avancados, mapa, tipoData = "julgamento", tipoAcordao = []) {
  const form = [
    ["javax.faces.partial.ajax", "true"], ["javax.faces.source", "formulario:actPesquisar"],
    ["javax.faces.partial.execute", "@all"], ["javax.faces.partial.render", "formulario"],
    ["formulario:actPesquisar", "formulario:actPesquisar"], ["formulario", "formulario"],
    ["formulario:textoLivre", consulta],
  ];
  for (const t of tipos) form.push(["formulario:selectTiposDocumento", t]);
  for (const f of fontes) form.push([CAMPO_FONTE, f]);
  for (const t of tipoAcordao || []) form.push(["formulario:tipoAcordao", t]);
  if (avancados && Object.keys(avancados).length) {
    const m = mapa || CAMPOS_AVANCADOS_FALLBACK;
    form.push(["formulario:ckbAvancada_input", "on"]);
    form.push(["formulario:combo_tipo_data_input", TIPOS_DATA[tipoData] || "DTDP"]);
    for (const [chave, valor] of Object.entries(avancados)) form.push([m[chave] || CAMPOS_AVANCADOS_FALLBACK[chave], valor]);
  }
  form.push(["javax.faces.ViewState", viewstate]);
  return form;
}
function formToggleAvancada(tipos, fontes, viewstate) {
  const form = [
    ["javax.faces.partial.ajax", "true"], ["javax.faces.source", "formulario:ckbAvancada"],
    ["javax.faces.partial.execute", "formulario:ckbAvancada"], ["javax.faces.partial.render", "formulario:pesquisaAvancada"],
    ["javax.faces.behavior.event", "change"], ["javax.faces.partial.event", "change"],
    ["formulario", "formulario"], ["formulario:ckbAvancada_input", "on"],
  ];
  for (const t of tipos) form.push(["formulario:selectTiposDocumento", t]);
  for (const f of fontes) form.push([CAMPO_FONTE, f]);
  form.push(["javax.faces.ViewState", viewstate]);
  return form;
}
function formPaginacao(first, rows, viewstate) {
  return [
    ["javax.faces.partial.ajax", "true"], ["javax.faces.source", "formulario:tabelaDocumentos"],
    ["javax.faces.partial.execute", "formulario:tabelaDocumentos"], ["javax.faces.partial.render", "formulario:tabelaDocumentos"],
    ["formulario:tabelaDocumentos_pagination", "true"], ["formulario:tabelaDocumentos_first", String(first)],
    ["formulario:tabelaDocumentos_rows", String(rows)], ["formulario:tabelaDocumentos_rppDD", String(rows)],
    ["formulario:tabelaDocumentos_encodeFeature", "true"], ["formulario", "formulario"], ["javax.faces.ViewState", viewstate],
  ];
}

const INTEIRO_TEOR_MAX_DOCS = 3;

export async function consultarPortal(consulta, tipos, fontes, pagina, porPagina, avancados, tipoData, operacao, base = "trf1", tipoAcordao = [], fetchImpl = fetch, env = process.env) {
  const chave = JSON.stringify([base, consulta, tipos, fontes, pagina, porPagina, avancados, tipoData, tipoAcordao]);
  const endpoint = SITE + BASES[base].caminho;
  const headersAjax = { ...HEADERS_AJAX, Referer: endpoint };
  const emCache = cacheLer(chave);
  if (emCache !== null) return emCache;

  async function umaSessao() {
    const avisos = [];
    const jar = new CookieJar();
    const inicial = await requisitar(jar, "GET", endpoint, operacao, { esperado: "html" }, fetchImpl, env);
    let viewstate = extrairViewstate(inicial);
    if (!viewstate) throw new PesquisaNaoRealizada("ViewState não encontrado na página inicial do portal — o layout do CJF mudou?");
    let mapa = null;
    if (avancados && Object.keys(avancados).length) {
      const xmlT = await requisitar(jar, "POST", endpoint, operacao, { data: formToggleAvancada(tipos, fontes, viewstate), headers: headersAjax, esperado: "xml" }, fetchImpl, env);
      viewstate = extrairViewstate(xmlT) || viewstate;
      const painel = extrairUpdate(xmlT, "formulario:pesquisaAvancada");
      const [m, av] = mapearCamposAvancados(painel);
      mapa = m;
      avisos.push(...av);
    }
    const xmlB = await requisitar(jar, "POST", endpoint, operacao, { data: formBusca(consulta, tipos, fontes, viewstate, avancados, mapa, tipoData, tipoAcordao), headers: headersAjax, esperado: "xml" }, fetchImpl, env);
    const msgs = extrairMensagens(xmlB);
    if (msgs.length) throw new PesquisaNaoRealizada("o portal recusou a CONSULTA (não é resultado vazio): " + msgs.join(" | ") + " — corrija a sintaxe/os filtros e refaça");
    const htmlForm = extrairUpdate(xmlB, "formulario");
    const total = extrairTotal(htmlForm);
    let htmlDocs = htmlForm;
    const first = (pagina - 1) * porPagina;
    const zeroDeVerdade = !total && !RE_DOC_SPLIT.test(htmlForm);
    if (zeroDeVerdade) {
      htmlDocs = htmlForm;
    } else if (first > 0 || porPagina !== 30) {
      if (!total) avisos.push("o portal não informou o total desta consulta — a paginação pode estar imprecisa");
      if (total && first >= total) {
        htmlDocs = "";
      } else {
        const viewstateAtual = extrairViewstate(xmlB) || viewstate;
        const xmlP = await requisitar(jar, "POST", endpoint, operacao, { data: formPaginacao(first, porPagina, viewstateAtual), headers: headersAjax, esperado: "xml" }, fetchImpl, env);
        htmlDocs = extrairUpdate(xmlP, "formulario:tabelaDocumentos") || "";
        if (!htmlDocs) { avisos.push("paginação não devolveu resultados — mostrando a 1ª página"); htmlDocs = htmlForm; }
      }
    }
    return { total, docs: parsearDocumentos(htmlDocs, base), avisos };
  }

  let dados;
  try {
    dados = await umaSessao();
  } catch (e) {
    if (e instanceof SessaoInvalida) {
      try {
        dados = await umaSessao();
      } catch (e2) {
        if (e2 instanceof SessaoInvalida) {
          throw new PesquisaNaoRealizada("a sessão do portal expirou duas vezes seguidas (ViewState recusado) — instabilidade do CJF; tente de novo em instantes");
        }
        throw e2;
      }
    } else {
      throw e;
    }
  }
  cacheGravar(chave, dados);
  return dados;
}

export async function anexarInteiroTeorTnu(docs, operacao, fetchImpl = fetch, env = process.env) {
  const avisos = [];
  const todosTnu = docs.filter((d) => d.link_tipo === "tnu");
  const alvos = todosTnu.slice(0, INTEIRO_TEOR_MAX_DOCS);
  if (todosTnu.length > INTEIRO_TEOR_MAX_DOCS) avisos.push(`inteiro teor baixado só para os ${INTEIRO_TEOR_MAX_DOCS} primeiros documentos (teto por chamada)`);
  const jar = new CookieJar();
  for (const d of alvos) {
    try {
      let texto = cacheLer("it:" + d.link_inteiro_teor);
      if (texto === null) {
        const htmlDoc = await requisitar(jar, "GET", d.link_inteiro_teor, operacao, { esperado: "qualquer" }, fetchImpl, env);
        texto = textoDocumento(htmlDoc);
        cacheGravar("it:" + d.link_inteiro_teor, texto);
      }
      d.inteiro_teor_texto = texto;
      if (d.inteiro_teor_texto.length < 200) avisos.push(`inteiro teor do id ${d.id} veio vazio/curto — abra o link no navegador`);
    } catch (e) {
      avisos.push(`inteiro teor do id ${d.id} não baixado (${e.name}: ${e.message})`);
    }
  }
  return avisos;
}

// ------------------------------------------------------------------- funções de tool ---
export function carimboNaoRealizada(motivo) {
  const m = String(motivo).trim().replace(/\.$/, "");
  let ajuda = "";
  if (!/disjuntor em pausa|Muitas consultas|Fila de espera|fail-closed/.test(m)) {
    ajuda = `\nSe persistir, relate: ${linkRelato(tipoDoErro(m))}`;
  }
  return `[PESQUISA NÃO REALIZADA — ${m}]\nIsto NÃO é "não localizado": a consulta não chegou a ser feita ou não foi respondida. Registre a frente como pendente; use diagnostico_ritmo_trf1 antes de concluir que o portal está fora.${ajuda}`;
}
export function erroDeParametro(e) {
  return `Erro de parâmetro (nada foi consultado): ${e.message || e}\nCorrija a chamada e refaça — não registre como pesquisa realizada nem como "não localizado".`;
}

export function validarBase(base) {
  const b = (base || "trf1").trim().toLowerCase();
  if (!(b in BASES)) throw new Error(`base inválida: ${JSON.stringify(base)}; use 'trf1' (padrão), 'tnu' ou 'colegiado'`);
  return b;
}
export function validarTipos(tipo, base = "trf1") {
  const permitidos = BASES[base].tipos;
  if (!permitidos.length) return [];
  const aliases = { "ACÓRDÃO": "ACORDAO", "SÚMULA": "SUMULA", "ARGUIÇÃO": "ARGUICAO",
    "DECISÃO MONOCRÁTICA": "DECISAOMONO", "DECISAO MONOCRATICA": "DECISAOMONO", MONOCRATICA: "DECISAOMONO" };
  let tipos = (tipo && tipo.length ? tipo : ["ACORDAO"]).map((t) => String(t).toUpperCase().trim());
  tipos = tipos.map((t) => aliases[t] || t);
  const inv = tipos.filter((t) => !permitidos.includes(t));
  if (inv.length) throw new Error(`tipo inválido para a base ${base}: ${JSON.stringify(inv)}; use ${JSON.stringify(permitidos)}`);
  return [...new Set(tipos)];
}
export function validarTipoAcordao(tipoAcordao, base) {
  if (!tipoAcordao || !tipoAcordao.length) return [];
  if (!BASES[base].tipoAcordao) throw new Error("tipo_acordao (REPRESENTATIVO/RELEVANTE) só existe na base 'tnu'");
  const vals = tipoAcordao.map((t) => String(t).toUpperCase().trim());
  const inv = vals.filter((v) => !(v in TIPOS_ACORDAO_TNU));
  if (inv.length) throw new Error(`tipo_acordao inválido: ${JSON.stringify(inv)}; use ${JSON.stringify(Object.keys(TIPOS_ACORDAO_TNU))}`);
  return [...new Set(vals)];
}
export function validarFontes(fonte) {
  const fontes = (fonte && fonte.length ? fonte : ["TRF1"]).map((f) => String(f).toUpperCase().trim());
  const inv = fontes.filter((f) => !FONTES_VALIDAS.includes(f));
  if (inv.length) throw new Error(`fonte inválida: ${JSON.stringify(inv)}; use ${JSON.stringify(FONTES_VALIDAS)}`);
  return [...new Set(fontes)];
}

export async function buscar(a, fetchImpl = fetch, env = process.env) {
  let base, tipos, fontes, tipoAcordaoV, pagina, porPagina, avancados = {}, consultaMontada;
  try {
    base = validarBase(a.base);
    tipos = validarTipos(a.tipo, base);
    fontes = BASES[base].fonte ? validarFontes(a.fonte) : [];
    tipoAcordaoV = validarTipoAcordao(a.tipo_acordao, base);
    const tipoData = a.tipo_data || "julgamento";
    if (!(tipoData in { julgamento: 1, publicacao: 1 })) throw new Error(`tipo_data inválido: ${JSON.stringify(tipoData)}; use 'julgamento' ou 'publicacao'`);
    pagina = Math.max(1, Number(a.pagina || 1));
    porPagina = Number(a.por_pagina || 30);
    if (!POR_PAGINA_VALIDOS.includes(porPagina)) throw new Error(`por_pagina inválido: ${porPagina}; o portal aceita ${JSON.stringify(POR_PAGINA_VALIDOS)}`);
    for (const [chave, valor] of [["relator", a.relator], ["orgao_julgador", a.orgao_julgador], ["classe", a.classe],
      ["origem", a.origem], ["numero", a.numero], ["ementa_decisao", a.ementa_decisao], ["referencia_legislativa", a.referencia_legislativa]]) {
      if (valor && String(valor).trim()) avancados[chave] = String(valor).trim();
    }
    if (a.data_inicio) avancados.data_inicio = normalizarData(String(a.data_inicio), "data_inicio");
    if (a.data_fim) avancados.data_fim = normalizarData(String(a.data_fim), "data_fim");
    if (Object.keys(avancados).length && !BASES[base].avancada) {
      throw new Error(`filtros (relator, órgão, classe, número, datas…) só existem na base 'trf1'; na base '${base}' use a sintaxe de campo na consulta: nome[REL], "turma"[ORGA], 20240101[DTDP]`);
    }
    consultaMontada = montarConsulta(a.consulta, a.grupos);
    if (!consultaMontada && !Object.keys(avancados).length && !tipoAcordaoV.length) {
      throw new Error("Informe a consulta, ou grupos de termos, ou pelo menos um filtro.");
    }
    const dados = await consultarPortal(consultaMontada, tipos, fontes, pagina, porPagina, avancados, tipoData, "busca", base, tipoAcordaoV, fetchImpl, env);
    const meta = { consulta_montada: consultaMontada, tipos, fontes, pagina, por_pagina: porPagina, filtros: avancados,
      avisos: dados.avisos, base, tipo_acordao: tipoAcordaoV };
    return formatBusca(dados.docs, dados.total, meta);
  } catch (e) {
    if (e instanceof PesquisaNaoRealizada) return carimboNaoRealizada(e.message);
    if (e.__isParametro) return erroDeParametro(e);
    // erros de validação (throw new Error simples, antes de qualquer rede) são de parâmetro
    return erroDeParametro(e);
  }
}

export function filtrarPorNumero(docs, digitos) {
  return docs.filter((d) => {
    const nd = d.numero_digitos || "";
    return nd && (nd === digitos || (digitos.length < 20 && nd.startsWith(digitos)));
  });
}

export async function localizarPorNumero(numero, base, operacao, comInteiroTeor = true, fetchImpl = fetch, env = process.env) {
  const digitos = soDigitos(numero);
  let dados;
  if (base === "trf1") {
    dados = await consultarPortal("", BASES.trf1.tipos, [...FONTES_VALIDAS], 1, 50, { numero: digitos }, "julgamento", operacao, base, [], fetchImpl, env);
  } else {
    dados = await consultarPortal(digitos, BASES[base].tipos, [], 1, 50, {}, "julgamento", operacao, base, [], fetchImpl, env);
  }
  const docs = filtrarPorNumero(dados.docs, digitos);
  const avisosExtra = docs.length && comInteiroTeor && base === "tnu" ? await anexarInteiroTeorTnu(docs, operacao, fetchImpl, env) : [];
  for (const d of docs) avisosExtra.push(...aplicarFecho(d));
  return [{ total: dados.total, docs: dados.docs, avisos: [...(dados.avisos || []), ...avisosExtra] }, docs];
}

export async function obterDecisao(numero, base = "trf1", fetchImpl = fetch, env = process.env) {
  const digitos = soDigitos(numero);
  if (digitos.length < 7) return `Número muito curto para localizar com segurança: ${JSON.stringify(numero)}.`;
  let dados, docs;
  try {
    base = validarBase(base);
    [dados, docs] = await localizarPorNumero(numero, base, "decisao", true, fetchImpl, env);
    if (!docs.length && dados.docs.length) {
      docs = dados.docs;
      dados = { ...dados, avisos: [...(dados.avisos || []), "o portal devolveu documentos cujo número não bate exatamente — confira"] };
    }
  } catch (e) {
    if (e instanceof PesquisaNaoRealizada) return carimboNaoRealizada(e.message);
    if (e instanceof Error && /base inválida/.test(e.message)) return erroDeParametro(e);
    return carimboNaoRealizada(`erro inesperado (${e.name}: ${e.message})`);
  }
  const gravados = docs.map((d) => gravarRecibo(d, env)).filter(Boolean);
  let saida = formatDecisao(docs, digitos.length === 20 ? cnj(digitos) : numero, dados.total);
  if (gravados.length) saida += `\nRecibo(s) gravado(s) em ${DIR_RECIBOS(env)} (${gravados.length}): o lint da peticao-rg e o revisor-adversarial conferem a ficha contra esse arquivo, sem nova requisição.`;
  for (const av of dados.avisos || []) saida = `⚠️ ${av}\n` + saida;
  return saida;
}

export async function verificarCitacao(numero, trecho, base = "trf1", fetchImpl = fetch, env = process.env) {
  const digitos = soDigitos(numero);
  if (digitos.length < 7) return `Número muito curto para localizar com segurança: ${JSON.stringify(numero)}.`;
  if (!(trecho || "").trim()) return "Informe o trecho que pretende citar entre aspas.";
  let origem = "portal", dados, docs;
  try {
    base = validarBase(base);
    const recs = recibosDoProcesso(digitos, base, env);
    if (recs.length && (base !== "tnu" || recs.every((r) => r.inteiro_teor))) {
      docs = recs.map((r) => docDeRecibo(r, env));
      dados = { avisos: [], total: docs.length };
      origem = "recibo local";
    } else {
      [dados, docs] = await localizarPorNumero(numero, base, "verificacao", true, fetchImpl, env);
      for (const d of docs) gravarRecibo(d, env);
    }
  } catch (e) {
    if (e instanceof PesquisaNaoRealizada) return carimboNaoRealizada(e.message);
    if (e instanceof Error && /base inválida/.test(e.message)) return erroDeParametro(e);
    return carimboNaoRealizada(`erro inesperado (${e.name}: ${e.message})`);
  }
  if (!docs.length) return `Nenhum documento sob o número ${numero} na base ${base} — não há como verificar; não cite.`;
  const rotulo = BASES[base].rotulo;
  const linhas = [];
  let temTeor = false;
  for (const d of docs) {
    const it = d.inteiro_teor_texto || d.inteiro_teor_embutido || "";
    temTeor = temTeor || Boolean(it);
    const textos = { ementa: d.ementa || "", dispositivo: d.decisao || "", "inteiro teor": it };
    const r = verificarTrecho(textos, trecho, rotulo);
    let marca = r.valido ? "✅ VÁLIDO" : "❌ NÃO ENCONTRADO";
    if (r.valido && r.alertas.length) marca = "✅ LITERAL, MAS COM ALERTA DE ATRIBUIÇÃO";
    linhas.push(`${marca} · id ${d.id} · ${d.tipo || "?"} · julgado em ${d.data_fecho || d.data_julgamento || "?"} · ${r.motivo}`);
    for (const al of r.alertas || []) linhas.push(`   ⚠️ ${al}`);
    if (r.valido && r.contexto) linhas.push(`   contexto: …${r.contexto.slice(0, 300)}…`);
    if (!r.valido && r.faltando?.length) for (const f of r.faltando.slice(0, 3)) linhas.push(`   fragmento sem correspondência: «${f.slice(0, 160)}»`);
  }
  const cabec = `**Verificação literal — ${docs[0].numero || numero} (${rotulo}, ${docs.length} documento(s), fonte: ${origem})**`;
  let rodape;
  if (temTeor) {
    rodape = "\nCobre ementa, dispositivo e inteiro teor, dizendo DE QUEM é a frase: TRANSCRIÇÃO (palavra de outro tribunal copiada no voto), VOTO DIVERGENTE (pode ser o vencido), ENTRE ASPAS, ALEGAÇÃO DA PARTE e NEGAÇÃO. Trecho com alerta NÃO entra na ficha como posição do órgão sem resolver a atribuição.";
  } else {
    rodape = "\nCobre SÓ ementa e dispositivo: o portal não expõe o voto nesta base, então a atribuição (transcrição, voto vencido, alegação da parte) NÃO foi analisada — não é que não exista. Aspas em ementa/dispositivo são seguras; qualquer coisa do voto só no navegador.";
  }
  rodape += ` Comparação por palavra inteira, tolerante a caixa, acento e pontuação; mínimo de ${PISO_TRECHO_PALAVRAS} palavras; \`[...]\` separa fragmentos em ordem, a até ${VAO_MAXIMO} caracteres. Se ❌: não cite entre aspas — parafraseie, ou confira no navegador.`;
  for (const a of dados.avisos || []) linhas.unshift(`⚠️ ${a}`);
  return [cabec, ...linhas].join("\n") + rodape;
}

export function diagnosticoRitmoTexto() { return diagnosticoRitmo(); }

// ---------------------------------------------------------------- crédito e versão ---
export const CREDITO = "_Esta extensão foi desenvolvida por @robertogrecia (Roberto Grécia Bessa, OAB/RO 7865-A). Obrigado por usar!_";
let creditoDado = false;
export function comCredito(texto) {
  if (creditoDado) return texto;
  creditoDado = true;
  return `${texto}\n\n${CREDITO}`;
}
export function _resetCreditoParaTeste() { creditoDado = false; }

export const RELEASES_API = `https://api.github.com/repos/${REPO_GITHUB}/releases/latest`;
export const RELEASES_PAGINA = `https://github.com/${REPO_GITHUB}/releases/latest`;
const RE_TAG = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;

export function versaoMaisNova(atual, outra) {
  const a = RE_TAG.exec(String(atual ?? "").trim());
  const b = RE_TAG.exec(String(outra ?? "").trim());
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) {
    const x = Number(a[i]), y = Number(b[i]);
    if (y !== x) return y > x;
  }
  return false;
}
export async function checarVersaoNova({ atual = VERSAO, fetchImpl = globalThis.fetch, env = process.env, timeoutMs = 2000 } = {}) {
  try {
    if (env.TRF1_MCP_SEM_AVISO_ATUALIZACAO === "1" || typeof fetchImpl !== "function") return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetchImpl(RELEASES_API, { signal: ctrl.signal, headers: { Accept: "application/vnd.github+json", "User-Agent": `trf1-jurisprudencia-mcp/${VERSAO}` } });
      if (!r.ok) return null;
      const tag = String((await r.json()).tag_name ?? "").trim();
      return versaoMaisNova(atual, tag) ? tag.replace(/^v/, "") : null;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}
export const avisoAtualizacao = (novaVersao) => `_Há uma versão mais nova desta extensão (v${novaVersao}; a instalada é a v${VERSAO})._ ${RELEASES_PAGINA}`;

let checagem = null, avisoDado = false;
export function iniciarChecagemVersao(opcoes) {
  if (!checagem) checagem = checarVersaoNova(opcoes);
  return checagem;
}
export async function comAvisos(texto) {
  const base = comCredito(texto);
  if (avisoDado) return base;
  const nova = await iniciarChecagemVersao();
  if (!nova) return base;
  avisoDado = true;
  return `${base}\n\n${avisoAtualizacao(nova)}`;
}
export function _resetAvisoParaTeste() { checagem = null; avisoDado = false; }

// -------------------------------------------------------------------- relato de erro ---
export const ISSUES_URL = `https://github.com/${REPO_GITHUB}/issues`;
export const ISSUES_NOVA = `https://github.com/${REPO_GITHUB}/issues/new`;
const SEM_RELATO = new Set(["limite_de_ritmo"]);

export function tipoDoErro(mensagem) {
  const m = String(mensagem || "");
  if (/desafio de navegador|verifica[cç][aã]o de navegador/i.test(m)) return "desafio_navegador";
  if (/robotiza|suspeita de automa[cç][aã]o|bloqueio anti-rob/i.test(m)) return "bloqueio_robotizacao";
  if (/Muitas consultas|disjuntor em pausa|Fila de espera/i.test(m)) return "limite_de_ritmo";
  if (/falha de rede|tempo esgotado/i.test(m)) return "rede_ou_timeout";
  if (/^.*HTTP \d{3}/i.test(m)) return "http_" + (/HTTP (\d{3})/i.exec(m)?.[1] || "?");
  return "outro";
}
export function linkRelato(tipo, agora = Date.now()) {
  let estado = "";
  try {
    const e = comTrava(() => lerEstadoDisjuntor());
    const inc = e.incidentes || [];
    const tipos = inc.slice(-5).map((i) => i.tipo || "sem_tipo").join(", ") || "nenhum";
    const recentes = (e.requisicoes || []).filter((t) => agora - t <= 60_000).length;
    estado = `- Nível do limitador: ${e.indiceJanela + 1} de ${ESCADA_JANELA_MS.length}\n- Consultas no último minuto: ${recentes}\n- Bloqueios registrados: ${inc.length} (últimos tipos: ${tipos})\n`;
  } catch {
    estado = "- Estado do limitador: indisponível\n";
  }
  const titulo = `Erro ${tipo} na v${VERSAO}`;
  const corpo = "**Relato gerado pela extensão** (revise antes de enviar; não inclua número de processo nem o texto da sua busca — issues são públicas)\n\n" +
    `- Versão: ${VERSAO}\n- Sistema: ${process.platform}\n- Tipo do erro: ${tipo}\n` + estado +
    "\n**O que eu estava fazendo:** \n\n**A pesquisa funciona direto no portal (jurisprudencia.cjf.jus.br/trf1), pelo navegador?** sim / não\n\n**Desde quando acontece?** \n";
  return `${ISSUES_NOVA}?title=${encodeURIComponent(titulo)}&body=${encodeURIComponent(corpo)}`;
}

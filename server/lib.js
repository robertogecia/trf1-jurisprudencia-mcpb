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
import { fileURLToPath } from "node:url";
// v1.2.0 (06/10/2026): regras de atribuição do TJRO v1.13/1.15 pelo bloco compartilhado (cópia byte a byte do TRT14/TJSE)
import { norm1, alegacaoDaParte, negacaoEscopo, negacaoProxima, entreAspas, trechosObiter, inicioDaFrase, RE_OBITER, OBITER_JANELA, OBITER_CABECA } from "./atribuicao13.js";
import { posicaoTnu, secoesDaEmenta } from "./posicao2.js";

export const VERSAO = "1.7.2";
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
  if (limite && cpLen(t) > limite) {   // v1.6.0: pontos de código, como o len()/fatia do Python (emoji fora do BMP conta 1)
    const cortado = cpSlice(t, limite);
    const i = cortado.lastIndexOf(" ");
    t = (i >= 0 ? cortado.slice(0, i) : cortado) + "…";
  }
  return t;
}
/** _trecho_centrado: trecho de até `limite` caracteres que MOSTRA o primeiro termo destacado («…») do portal (v1.5.0). */
export function trechoCentrado(bruto, limite = 800) {
  const t = limpar(bruto, 0);
  const cp = [...t];   // v1.6.0: índices e comprimentos em pontos de código, como o Python
  const i = cp.indexOf("«");
  if (i < 0 || i + 40 <= limite) return limpar(bruto, limite);
  let ini = Math.max(0, i - 200);
  const esp = cp.indexOf(" ", ini);
  ini = ini && esp >= 0 && esp < i ? esp + 1 : ini;
  const cauda = cp.slice(ini);
  let corte;
  if (cauda.length <= limite) corte = cauda.join("");
  else {
    const c = cauda.slice(0, limite).join("");
    const k = c.lastIndexOf(" ");
    corte = (k >= 0 ? c.slice(0, k) : c) + "…";
  }
  return "…" + corte;
}
export const semDestaque = (t) => (t || "").replaceAll("«", "").replaceAll("»", "");

// Auxiliares de paridade com o Python (v1.6.0): contagem em PONTOS DE CÓDIGO (len/fatia de str), strip() e round() do Python, repr() de str.
export const cpLen = (s) => { s = s ?? ""; let n = s.length; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { const d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d <= 0xdfff) { n--; i++; } } } return n; };
export const cpSlice = (s, n) => { s = s ?? ""; return s.length <= n ? s : Array.from(s).slice(0, n).join(""); };
const PY_ESPACOS = "\\t-\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const RE_PY_STRIP = new RegExp(`^[${PY_ESPACOS}]+|[${PY_ESPACOS}]+$`, "g");
export const pyStrip = (s) => (s ?? "").replace(RE_PY_STRIP, "");
export function pyRound(x) {   // round() do Python 3: metade para o par
  const f = Math.floor(x), d = x - f;
  return d < 0.5 ? f : d > 0.5 ? f + 1 : (f % 2 === 0 ? f : f + 1);
}
export function pyRepr(s) {   // repr() de str
  s = String(s);
  const aspas = s.includes("'") && !s.includes('"') ? '"' : "'";
  let o = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === "\\") o += "\\\\";
    else if (ch === aspas) o += "\\" + ch;
    else if (ch === "\n") o += "\\n";
    else if (ch === "\r") o += "\\r";
    else if (ch === "\t") o += "\\t";
    else if (c < 0x20 || c === 0x7f) o += "\\x" + c.toString(16).padStart(2, "0");
    else o += ch;
  }
  return aspas + o + aspas;
}

// Entidades HTML5 (v1.6.0): a tabela COMPLETA de html.entities.html5 do Python (2.231 chaves, com e sem ";"), gerada para server/entidades-html5.json.
// Antes havia só Latin-1 e pontuação tipográfica: &le; ficava cru e &notin; virava "¬in;". Sem o arquivo (instalação truncada), cai num conjunto mínimo.
const ENTIDADES_HTML5 = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "entidades-html5.json"), "utf-8"));
  } catch {
    return { "amp;": "&", amp: "&", "lt;": "<", lt: "<", "gt;": ">", gt: ">", "quot;": '"', quot: '"', "apos;": "'", "nbsp;": "\u00a0", nbsp: "\u00a0" };
  }
})();
const html5 = (k) => (Object.hasOwn(ENTIDADES_HTML5, k) ? ENTIDADES_HTML5[k] : undefined);
const CP1252_C1 = { 0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x2c6, 0x89: 0x2030, 0x8a: 0x160, 0x8b: 0x2039,
  0x8c: 0x152, 0x8e: 0x17d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x2dc, 0x99: 0x2122, 0x9a: 0x161,
  0x9b: 0x203a, 0x9c: 0x153, 0x9e: 0x17e, 0x9f: 0x178, 0x81: 0x81, 0x8d: 0x8d, 0x8f: 0x8f, 0x90: 0x90, 0x9d: 0x9d };
function codigoNumerico(n) {   // como html.unescape: inválido -> U+FFFD; 0x80-0x9F lidos como cp1252
  if (n === 0 || (n >= 0xd800 && n <= 0xdfff) || n > 0x10ffff) return "\ufffd";
  if (n in CP1252_C1) return String.fromCodePoint(CP1252_C1[n]);
  if ((n >= 0x1 && n <= 0x8) || (n >= 0xe && n <= 0x1f) || (n >= 0x7f && n <= 0x9f) || (n >= 0xfdd0 && n <= 0xfdef) || n === 0xb || (n & 0xfffe) === 0xfffe) return "";
  return String.fromCodePoint(n);
}
/** html.unescape do Python, passo a passo: referência numérica com ou sem ";"; nome exato (com ";" ou legado sem ";"); senão o MAIOR prefixo que
 *  seja nome conhecido (só legados casam sem ";") seguido do resto. Uma passada só. */
export function decodeEntities(t) {
  return (t || "").replace(/&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/gu, (m, s) => {
    if (s[0] === "#") return codigoNumerico(/^#[xX]/.test(s) ? parseInt(s.slice(2).replace(/;$/, ""), 16) : parseInt(s.slice(1).replace(/;$/, ""), 10));
    const direto = html5(s);
    if (direto !== undefined) return direto;
    for (let x = s.length - 1; x > 1; x--) {
      const pref = html5(s.slice(0, x));
      if (pref !== undefined) return pref + s.slice(x);
    }
    return "&" + s;
  });
}

export const dataIso = (br) => {
  const m = /^\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(br || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};
/** Erro de VALIDAÇÃO de parâmetro (antes de qualquer rede). Só ele vira "Erro de parâmetro (nada foi consultado)"; qualquer outra exceção é
 *  pesquisa NÃO realizada ("erro inesperado"), como o ValueError × Exception do Python (v1.6.0). */
export class ErroDeParametro extends Error {}

export const ENTRADA_TEXTO_MAX = 5000;   // v1.6.0: teto de `consulta`/`trecho` nas ferramentas (entrada gigante só gasta CPU)
export function validarTamanho(rotulo, valor) {
  const n = typeof valor === "string" ? cpLen(valor) : 0;
  if (n > ENTRADA_TEXTO_MAX) throw new ErroDeParametro(`${rotulo} com ${n} caracteres; o máximo é ${ENTRADA_TEXTO_MAX}. Reduza a ${rotulo} ao que interessa (o que decide é o trecho central, não o texto inteiro).`);
}

export function normalizarData(data, rotulo) {
  const d = (data || "").trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) return d;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  throw new ErroDeParametro(`${rotulo} inválida: ${JSON.stringify(data)} — use AAAA-MM-DD ou DD/MM/AAAA.`);
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
// v1.6.0 (espelho do Python v1.5.5): "PROVER" (TNU: "CONHECER e PROVER PARCIALMENTE o pedido") também é provimento.
const RE_PROVIDO = /(?<!NAO )\b(PROVI(DO|DOS|DA|DAS)\b|PROVER\b|D(A|AO|AR|OU|ERAM|EU)(-(SE|LHE|LHES)| SE)? (INTEGRAL |PARCIAL )?PROVIMENTO)/;
// "embargos NÃO acolhidos" é rejeição, não acolhimento.
const RE_REJEITADO = /\bREJEIT|\bNAO ACOLH/;
const RE_ACOLHIDO = /(?<!NAO )\bACOLH/;
const RE_PREJUDICADO = /\bPREJUDICAD/;
// PARCIAL é qualificador do PROVIDO (o par OPOSTOS não muda). Cobre as duas ordens ("parcial provimento", "provimento parcial",
// "parcialmente provido", "provido em parte", "RECURSO PROVIDO PARCIALMENTE").
const RE_PARCIAL = /\bPARCIAL(MENTE)? PROVI|\bPARCIAL PROVIMENTO|\bPROVIMENTO PARCIAL|\bPROVIMENTO EM PARTE|\bPROVID[OA]S? EM PARTE|\bPROVID[OA]S? PARCIALMENTE|\bPROVER (PARCIALMENTE|EM PARTE)/;
// Embargos de declaração: o par ACOLHIDO × REJEITADO só vale neles; "provimento"/"negar provimento" aos embargos é acolhimento/rejeição.
const RE_EMBARGOS_DECL = /\bEMBARGOS (DE DECLARACAO|DECLARATORIOS|ACLARATORIOS|(NAO )?PROVIDOS?|REJEITADOS?|ACOLHIDOS?|PARCIALMENTE)/;
const RE_EMBARGOS_OUTROS = /\bEMBARGOS (DE TERCEIRO|A EXECUCAO|DE EXECUCAO|MONITORIOS|INFRINGENTES)/;
const RE_CLASSE_EMBARGOS = /EMBARGOS DE DECLARA/;
const RE_ED_PARCIAL = /\bPARCIALMENTE (ACOLH|PROVID)|\b(ACOLH|PROVID)\w* (PARCIALMENTE|EM PARTE)|\bPARCIAL (ACOLHIMENTO|PROVIMENTO)|\bPROVIMENTO (PARCIAL|EM PARTE)/;
const RE_ED_OUTRO_OBJETO = /\b(AGRAVO|APELACAO|RECURSO|REMESSA|RECURSAL|RECURSOS)\b/;
const RE_ED_EXPLICITO = /\bEMBARGOS( DE DECLARACAO)?( \w+)? (PARCIALMENTE|EM PARTE)|\bEMBARGOS( DE DECLARACAO)? (ACOLHID|PROVID)\w* (PARCIALMENTE|EM PARTE)/;

/** _parcial_dos_embargos: o qualificador "parcial" é dos EMBARGOS só quando a oração dele fala dos embargos (ou de ninguém mais):
 * "embargos acolhidos, para dar parcial provimento ao recurso" continua acolhimento integral. */
export function parcialDosEmbargos(cauda) {
  return String(cauda ?? "").split(/[,.;:]/).some((seg) => RE_ED_PARCIAL.test(seg) && (!RE_ED_OUTRO_OBJETO.test(seg) || RE_ED_EXPLICITO.test(seg)));
}

/** _eh_embargos_texto: julgamento de embargos de declaração? Pela classe do índice ou pelo próprio dispositivo. */
export function ehEmbargosTexto(caudaFoldUpper, classe = "") {
  if (RE_CLASSE_EMBARGOS.test(fold(classe || "").toUpperCase())) return true;
  return RE_EMBARGOS_DECL.test(caudaFoldUpper) && !RE_EMBARGOS_OUTROS.test(caudaFoldUpper);
}

/** _resultado_com_embargos: [conjunto de rótulos, é-embargos]. */
export function resultadoComEmbargos(texto, classe = "") {
  const t = fold(texto).toUpperCase();
  const cauda = t.length > 2500 ? t.slice(-2500) : t;
  const embargos = ehEmbargosTexto(cauda, classe);
  const r = new Set();
  if (RE_NAO_CONHECIDO.test(cauda)) r.add("NÃO CONHECIDO");
  if (RE_CONHECIDO.test(cauda)) r.add("CONHECIDO");
  if (RE_DESPROVIDO.test(cauda)) r.add("DESPROVIDO");
  if (RE_PROVIDO.test(cauda)) r.add("PROVIDO");
  if (RE_REJEITADO.test(cauda)) r.add("REJEITADO");
  if (RE_ACOLHIDO.test(cauda)) r.add("ACOLHIDO");
  if (RE_PREJUDICADO.test(cauda)) r.add("PREJUDICADO");
  if (RE_PARCIAL.test(cauda)) r.add("PARCIAL");
  if (embargos) {
    // "embargos providos" = acolhidos; "negar provimento aos embargos" = rejeitados; o parcial só vale se for da oração dos embargos
    r.delete("PARCIAL");
    if (r.has("PROVIDO")) { r.delete("PROVIDO"); r.add("ACOLHIDO"); }
    if (r.has("DESPROVIDO")) { r.delete("DESPROVIDO"); r.add("REJEITADO"); }
    if (r.has("ACOLHIDO") && !r.has("REJEITADO") && parcialDosEmbargos(cauda)) r.add("PARCIAL");
  }
  return [r, embargos];
}

export function resultadoDe(texto, classe = "") {
  return resultadoComEmbargos(texto, classe)[0];
}
export function ladoDe(conjunto, [a, b]) {
  if (conjunto.has(a) && conjunto.has(b)) return null;
  return conjunto.has(a) ? a : conjunto.has(b) ? b : null;
}
export const ROTULOS_RESULTADO = { PROVIDO: "provido", PARCIAL: "parcial (provido ou acolhido em parte)", DESPROVIDO: "desprovido",
  ACOLHIDO: "acolhido", REJEITADO: "rejeitado", PREJUDICADO: "prejudicado", "NÃO CONHECIDO": "não conhecido" };

/** _rotulo_do_conjunto: rótulo único de um julgamento (PROVIDO/PARCIAL/DESPROVIDO/ACOLHIDO/REJEITADO) ou null (sem sinal ou ambíguo).
 * Fora de embargos decide o par do MÉRITO ("preliminar rejeitada" não manda o julgamento para "ambíguo"); em embargos o par
 * ACOLHIDO × REJEITADO vem primeiro. Os dois lados do mesmo par continuam ambíguos. */
export function rotuloDoConjunto(conjunto, embargos = false) {
  const ordem = embargos ? [OPOSTOS[1], OPOSTOS[0]] : [OPOSTOS[0], OPOSTOS[1]];
  for (const par of ordem) {
    if (conjunto.has(par[0]) && conjunto.has(par[1])) return null;
    const lado = ladoDe(conjunto, par);
    if (lado) return (lado === "PROVIDO" || lado === "ACOLHIDO") && conjunto.has("PARCIAL") ? "PARCIAL" : lado;
  }
  return null;
}

export function resumoResultadosPagina(docs) {
  // paridade com _resumo_resultados_pagina do Python: sem nº+data a chave é a posição; julgamento sem resultado entra em "sem resultado"
  const porJulgamento = new Map();
  docs.forEach((d, i) => {
    const chave = d.numero_digitos && d.data_julgamento ? `${d.numero_digitos}|${d.data_julgamento}` : `#${i}`;
    if (!porJulgamento.has(chave)) porJulgamento.set(chave, { conj: new Set(), emb: false });
    const j = porJulgamento.get(chave);
    const [conj, emb] = resultadoComEmbargos(d.decisao || "", d.classe || "");
    for (const c of conj) j.conj.add(c);
    j.emb = j.emb || emb;
  });
  const contagem = Object.fromEntries(Object.keys(ROTULOS_RESULTADO).map((k) => [k, 0]));
  let semResultado = 0;
  for (const j of porJulgamento.values()) {
    const rot = rotuloDoConjunto(j.conj, j.emb);
    if (rot) contagem[rot]++;
    else if (j.conj.has("PREJUDICADO")) contagem["PREJUDICADO"]++;
    else if (j.conj.has("NÃO CONHECIDO")) contagem["NÃO CONHECIDO"]++;
    else semResultado++;
  }
  return { contagem, sem_resultado: semResultado, total_julgamentos: porJulgamento.size };
}

// --- Frase do dispositivo que acolhe os embargos (porte do TJRO v1.35.0) ---
const RE_ABREV_FIM = /(?:^|[^A-Za-zÀ-ÿ])(?:art|arts|n|nº|no|nos|fl|fls|id|des|desa|dr|dra|sr|sra|min|rel|inc|par|proc|cf|fed)\.$/i;

/** _frases_do_texto: divide em frases e junta de novo o pedaço que termina em abreviação ("art.", "Des."). */
export function frasesDoTexto(t) {
  const out = [];
  for (const p of String(t || "").split(/(?<=[.;])\s+(?=[A-ZÀ-Ý0-9])/)) {
    if (out.length && RE_ABREV_FIM.test(out[out.length - 1])) out[out.length - 1] += " " + p;
    else out.push(p);
  }
  return out;
}

/** _frase_dos_embargos: a frase LITERAL do dispositivo que acolhe os embargos (sem rótulo de subtipo). Vazio se nenhuma frase fala dos embargos acolhidos. */
export function fraseDosEmbargos(dispositivo, maximo = 360) {
  const ok = (f) => {
    const x = fold(f).toUpperCase();
    return /EMBARGOS|ACLARATORI|DECLARATORI/.test(x) && (RE_ACOLHIDO.test(x) || /\bDOU PROVIMENTO|(?<!NAO )\bPROVIDOS?\b|\bDAR PROVIMENTO|\bDEU PROVIMENTO/.test(x));
  };
  const fr = frasesDoTexto(String(dispositivo || "").replace(/\s+/g, " ").trim()).filter(ok);
  if (!fr.length) return "";
  const f = fr[0];
  const cps = [...f];
  return cps.length > maximo ? cps.slice(0, maximo).join("").trimEnd() + "…" : f;
}

// --------------------------------------------------------------- atribuição (TNU) ---
export function norm(t) {
  let r = (t || "").normalize("NFKC");
  r = fold(r);
  r = r.replace(/\s+/g, " ");   // v1.6.0: colapsa ANTES — `\s+([.,;:)\]])` era quadrático em corridas longas de espaços
  r = r.replace(/\bn\s*[.o°]{1,3}\s*(?=\d)/g, "n ");
  r = r.replace(/§\s+/g, "§");
  r = r.replace(/[\u201c\u201d\u2018\u2019"'`´]/g, "'");   // v1.6.0: aspas curvas unificadas, como o Python
  r = r.replace(/[–—-]/g, "-");
  r = r.replace(/ ([.,;:)\]])/g, "$1");
  r = r.replace(/([([]) /g, "$1");
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

// a MESMA dobra do texto (norm1): com norm() o "º" de "nº" não casava (06/10/2026)
const normalizarCasamento = (t) => (norm1(t).match(/[a-z0-9]+/g) || []).join(" ");
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** _faixa_norm: posição do trecho em norm1(bruto) (mesmo comprimento do bruto), ocorrência mais próxima do casamento oficial. */
export function faixaNorm(nt, fragmentos, pertoDe = 0.0) {
  const lista = fragmentos.map((f) => normalizarCasamento(f).split(" ").filter(Boolean)).filter((ps) => ps.length);
  if (!lista.length) return null;
  const pad = (ps) => new RegExp("(?<![a-z0-9])" + ps.map(escRe).join("[^a-z0-9]+") + "(?![a-z0-9])", "g");
  const inicios = [...nt.matchAll(pad(lista[0]))].map((m) => m.index);
  if (!inicios.length) return null;
  const alvo = pertoDe * nt.length;
  let pos = inicios[0];
  for (const i of inicios) if (Math.abs(i - alvo) < Math.abs(pos - alvo)) pos = i;
  let ini = null, fim = null;
  for (const ps of lista) {
    const re = pad(ps);
    re.lastIndex = pos;
    const m = re.exec(nt);
    if (!m) return null;
    ini = ini === null ? m.index : ini;
    pos = fim = m.index + m[0].length;
  }
  return [ini, fim];
}

/** _obiter_antes_com_pos: além da marca, onde ela está, para o alerta mostrar a frase. (atribuicao13.js é cópia compartilhada: o envoltório fica aqui.) */
export function obiterAntesComPos(tn, ini0, fim, bruto) {
  const cabeca = ini0 + Math.trunc((fim - ini0) * OBITER_CABECA);
  const piso = Math.max(0, ini0 - OBITER_JANELA);
  const frase0 = inicioDaFrase(bruto, tn, piso, cabeca);
  let m = null;
  for (const x of tn.slice(frase0, cabeca).matchAll(RE_OBITER)) m = x;
  return m ? { marca: m[0], de: frase0, pos: frase0 + m.index } : null;
}
const brutoDe = bruto;   // o `const bruto` local de conferir faz sombra da função
const emUmaLinha = (x) => String(x).replace(/\s+/g, " ").trim();
/** _abertura: os primeiros `n` caracteres a partir de `ini`, em uma linha, com reticências só quando cortou. */
export function abertura(texto, ini, n = 220) {
  const f = [...emUmaLinha(texto.slice(ini, ini + n + 1))];
  return f.length > n ? f.slice(0, n).join("").trimEnd() + "…" : f.join("");
}
/** _frase_do_obiter: a frase onde está a marca de obiter, ou o aviso de que a marca já está no começo do próprio trecho citado. */
export function fraseDoObiter(texto, ob, ini0) {
  if (ob.pos >= ini0) return " A marca está no começo do próprio trecho citado.";
  const ini = Math.max(ob.de, ob.pos - 40);
  const f = emUmaLinha(texto.slice(ini, ini0));
  const cps = [...f];
  return ` A frase: «${cps.length > 260 ? cps.slice(0, 260).join("") + "…" : f}» + o trecho.`;
}
// Onde começa o voto de outro juiz que contém `meio` (para o alerta VOTO DIVERGENTE mostrar a abertura). posicao2.js é cópia
// compartilhada com outras extensões: em vez de mexer nela, reconstituo aqui o que a posicaoTnu usa (o voto é o intervalo que começa
// no último cabeçalho de seção anterior ou igual a `meio`).
const RE_CAB_TNU_INICIO = /(?:(?<=\n)|(?<![\s\S]))[ \t]*(?:RELAT[ÓO]RIO|EMENTA|AC[ÓO]RD[ÃA]O|EXTRATO DE ATA[^\n]*|VOTO(?:[ \t-]+[A-ZÀ-Ú]+){0,3})[ \t]*(?=\n|(?![\s\S]))/g;
function inicioDoVotoDeOutro(texto, meio) {
  let ult = null;
  for (const m of texto.matchAll(RE_CAB_TNU_INICIO)) { if (m.index > meio) break; ult = m.index; }
  return ult;
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
      alertas.push("VOTO DIVERGENTE: o trecho vem depois de um sinal de divergência no acórdão (pedido de vênia, voto vencido ou voto-vista). Pode ser o voto VENCIDO — leia quem venceu antes de citar como entendimento do órgão." +
        ` Essa parte começa assim: «${abertura(String(texto || ""), brutoDe(String(texto || ""), tn, div[0]))}».`);
    }
  }
  // v1.2.0: regras do TJRO v1.13/1.15 sobre norm1(bruto) (1:1), localizando o trecho perto do casamento oficial
  const bruto = String(texto || "");
  const nt = norm1(bruto);
  const fx = faixaNorm(nt, frags, (ini0 || 0) / Math.max(1, tn.length));
  if (!emTranscricao && fx) {   // aspas se checam SEMPRE, inclusive na ementa
    if (entreAspas(bruto, nt, fx[0], fx[1]))
      alertas.push(`ENTRE ASPAS: o trecho parece estar dentro de aspas no acórdão — é o tribunal citando alguém (doutrina, lei, decisão recorrida, outro julgado). Confira de quem é a frase antes de atribuí-la à ${tribunal}.`);
    if (comAtribuicao && alegacaoDaParte(nt, fx[0], fx[1], bruto))
      alertas.push("ALEGAÇÃO DA PARTE: o texto relata o que uma parte (INSS, União, recorrente…) sustenta, alega ou requer logo antes do trecho — o trecho pode ser tese da parte, não decisão do tribunal. Confira no relatório/voto quem fala.");
  }
  if (fx && negacaoEscopo(nt, fx[0], fx[1], bruto))
    alertas.push(negacaoProxima(nt, fx[0]) ? "NEGAÇÃO: há negativa logo antes do trecho — o recorte pode inverter o julgado. Não citar sem ler a frase inteira."
      : "NEGAÇÃO (distante)?: há uma negativa algumas palavras antes do trecho, fora dele. Na maioria das vezes ela fecha a própria oração e não inverte o recorte (medido às cegas), mas leia a frase inteira antes de citar.");
  const ob = comAtribuicao && !emTranscricao && fx && !alertas.some((a) => a.startsWith("ENTRE ASPAS")) ? obiterAntesComPos(nt, fx[0], fx[1], bruto) : null;
  if (ob)
    alertas.push(`OBITER DICTUM?: o trecho vem sob «${ob.marca}» — raciocínio hipotético ou fundamento alternativo; o resultado do julgado não dependeu dele. Vale como reforço, não como ratio decidendi; cite dizendo que é obiter.` + fraseDoObiter(bruto, ob, fx[0]));
  const meioTrecho = fx ? Math.floor((fx[0] + fx[1]) / 2) : 0;
  const posicao = comAtribuicao && fx && tribunal === "TNU" ? posicaoTnu(bruto, meioTrecho) : "";
  if (posicao && comAtribuicao) {
    // espelho do Python: na TNU o voto de outro juiz vem do título do documento (gabarito cego de 06/10/2026: 85% × 62%)
    let k = alertas.findIndex((x) => x.startsWith("VOTO DIVERGENTE"));
    if (k >= 0) alertas.splice(k, 1); else k = null;
    if (posicao.startsWith("VOTO de outro juiz") || posicao.startsWith("VOTO do relator VENCIDO")) {
      const iniV = inicioDoVotoDeOutro(bruto, meioTrecho);
      alertas.splice(k !== null ? k : (emTranscricao ? 1 : 0), 0, "VOTO DIVERGENTE: o trecho está num voto que NÃO é o de quem lavrou o acórdão (vista, divergente, vogal ou o " +
        "do relator vencido) — pode ter ficado vencido ou só acompanhado. Leia o acórdão/extrato de ata antes de citar " +
        "como entendimento da TNU." + (iniV !== null ? ` Esse voto começa assim: «${abertura(bruto, iniV)}».` : ""));
    }
  }
  return { ok: true, alertas, contexto: tn.slice(Math.max(0, (ini0 || 0) - 120), pos + 120).replace(/\s+/g, " "), spans, tn, posicao };
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


// --- Votação declarada e FATOS DO JULGADO (porte do TJRO v1.20–v1.26; TRF1 v1.5.0) ----
const RE_VENCIDO = /\bVENCID[OA]S?\b/;
const RE_DIVERGENTE_PREV = /VOTO(?:-VISTA)? DIVERGENTE|\bDIVERG[EÊ]NCIA\b|LAVRAR[AÁ] O ACORDAO|VENCID[OA]S? (?:A|O|AS|OS) RELATOR|NOS TERMOS DO VOTO DIVERGENTE/;

/** _votacao_declarada: "unânime", "por maioria", "por maioria, voto divergente prevaleceu", e/ou "com declaração de voto"; "" se não reconhece. */
export function votacaoDeclarada(texto) {
  if (!texto) return "";
  const p = fold(limpar(texto, 0).replace(/\s+/g, " ")).slice(0, 1500).toUpperCase();
  let v;
  const mp = /\b(?:DECIDE|DECIDIU|DECIDEM|ACORDA|ACORDAM|DECIDIRAM)\b[^.]{0,80}?\b(UNANIMIDADE|MAIORIA|UNANIME|UNANIMEMENTE)\b|\bPOR (UNANIMIDADE|MAIORIA)\b/.exec(p);
  const nucleo = mp ? (mp[1] || mp[2]) : "";   // a palavra da PROCLAMAÇÃO manda
  const maioria = nucleo
    ? nucleo === "MAIORIA" || /\bVENCID[OA]S?\s+(?:O|A|OS|AS)\s+(?:DES|DESEMBARGADOR|JUIZ|MIN|RELATOR|EXMO)/.test(p)
    : /\bMAIORIA\b/.test(p) || RE_VENCIDO.test(p);
  if (maioria) {
    v = RE_DIVERGENTE_PREV.test(p) && !/VENCIDO[^.]{0,40}DIVERGENTE/.test(p) ? "por maioria, voto divergente prevaleceu" : "por maioria";
  } else if (/UNANIMIDADE|\bUNANIME\b|\bUNANIMEMENTE\b/.test(p)) {
    v = "unânime";
  } else {
    return "";
  }
  if (/DECLARA[CÇ][AÃ]O DE VOTO/.test(p)) v += ", com declaração de voto";
  return v;
}

/** _votacao_do_documento: do "Decisão" e, na TNU, do ACÓRDÃO/ata do inteiro teor quando o dispositivo não a diz. */
export function votacaoDoDocumento(d) {
  const tipo = fold(d.tipo || "");
  if (tipo.includes("monocrat") || tipo.includes("presid") || tipo === "sumula" || tipo.startsWith("arguicao")) return "";
  let v = votacaoDeclarada(d.decisao || "");
  const it = d.inteiro_teor_texto || "";
  if (!v && it) {
    const m = [...it.matchAll(/turma nacional de uniformiza[çc][ãa]o\s+decidiu[^.]{0,200}/gi)];
    v = m.length ? votacaoDeclarada(m[m.length - 1][0]) : "";
  }
  const rt = d.relator_texto || "", ra = d.relator_acordao_texto || "";
  if (it && v === "por maioria" && ra && rt && norm(ra) !== norm(rt) && !norm(rt).includes(norm(ra)) && !norm(ra).includes(norm(rt))) {
    v = "por maioria, voto divergente prevaleceu";
  }
  return v;
}

export const FATOS_MAX = 1200;

// TESE DA EMENTA (porte do TJRO v1.29.0, H06; espelho de _tese_da_ementa do Python): tese literal da ementa do modelo CNJ.
// A busca corta a ementa em 800 caracteres e a tese fica nos ÚLTIMOS itens: sem esta linha ela some do resultado.
export const TESE_MAX = 1000;
const RE_TESE_ROTULO = /\bteses? de julgamento ?:? ?/;
export function teseDaEmenta(texto, teto = TESE_MAX) {
  const t = semDestaque(String(texto || ""));
  const iv = secoesDaEmenta(t, 0, t.length).find((x) => x.nome === "dispositivo e tese" || x.nome === "dispositivo");
  if (!iv) return null;
  const seg = t.slice(iv.a, iv.b);
  const nseg = norm1(seg);
  const m = RE_TESE_ROTULO.exec(nseg);
  if (!m) return null;
  const tese = seg.slice(m.index + m[0].length).replace(/\s+/g, " ").trim();
  if (!tese) return null;
  const inicios = [...tese.matchAll(/(?<![^ ])\d{1,2}\. /g)].map((x) => x.index);
  const total = inicios.length >= 2 && inicios[0] < 5 ? inicios.length : 1;
  if (tese.length <= teto) return { texto: tese, total, exibidos: total, completa: true };
  if (total > 1) {
    const ate = inicios.filter((p) => p > 0 && p <= teto);
    if (ate.length) {
      const p = ate[ate.length - 1];
      return { texto: tese.slice(0, p).replace(/ +$/, ""), total, exibidos: inicios.indexOf(p), completa: false };
    }
  }
  const fim = tese.lastIndexOf(". ", teto - 1);
  const corte = fim > 0 ? tese.slice(0, fim + 1) : tese.slice(0, teto).replace(/ \S*$/, "");
  return { texto: corte.trim(), total, exibidos: 0, completa: false };
}
export function linhaTese(te) {
  const inc = te.completa ? "" : " […]";
  const aviso = te.completa ? "" : `${te.total > 1 ? ` ⚠️ TESE INCOMPLETA: ${te.exibidos} de ${te.total} itens` : " ⚠️ TESE INCOMPLETA: trecho parcial"}; abra o inteiro teor antes de fichar.`;
  return `TESE DA EMENTA (literal; tese enunciada pelo órgão, não prova de ratio): «${te.texto}${inc}»${aviso}`;
}
/** Só quando a tese NÃO cabe no trecho de ementa que a busca mostra (senão repetiria o que já está na tela). */
export function linhaTeseDaBusca(ementa) {
  const te = teseDaEmenta(ementa);
  if (!te) return "";
  if (norm1(trechoCentrado(ementa, TRECHO_EMENTA)).includes(norm1(te.texto))) return "";
  return linhaTese(te);
}
const RE_LIXO_WORD = /^\s*(?:\d+(?:\.\d+)?\s+\d+x\d+\s+)?(?:Normal\s+)?(?:\d+\s+){0,3}(?:(?:false|true)\s+){1,3}(?:[A-Z]{2}-[A-Z]{2}\s+|X-NONE\s+){1,3}(?:MicrosoftInternetExplorer\d\s+)?/;
// \w/\W/\b do Python são Unicode; aqui ficam explícitos com \p{L}\p{N}_ (flag u)
const W = "[\\p{L}\\p{N}_]", NW = "[^\\p{L}\\p{N}_]";
const PARTES_FATOS = "(?:agravante|agravad[oa]s?|apelante|apelad[oa]s?|recorrente|recorrid[oa]s?|embargante|embargad[oa]s?|autor(?:a|es|as)?|r[ée]u|" +
  "requerente|requerid[oa]s?|parte|banco|impetrante|exequente|executad[oa]s?|INSS|Instituto|Uni[ãa]o|Fazenda|Caixa|requerente|suscitante)";
const VERBOS_FATOS = `(?:sustent|alega|aleg[oó]u|alegava|aduz|afirm|argument|narra|defende|insurg|pretende|postula|requer)${W}*`;
export const RE_ALEGACAO_FATOS = new RegExp(
  `(?<!${W})(?:${PARTES_FATOS}${NW}+(?:${W}+${NW}+){0,2}?${VERBOS_FATOS}|${VERBOS_FATOS}${NW}+(?:(?:a|o|as|os|que)${NW}+)?${PARTES_FATOS}` +
  "|(?:alegava|alegando|sustentando|afirmando|argumentando|aduzindo|alega[çc][ãa]o))", "iu");

const stripChars = (t, cs) => { let a = 0, b = t.length; while (a < b && cs.includes(t[a])) a++; while (b > a && cs.includes(t[b - 1])) b--; return t.slice(a, b); };

/** _fatos_do_julgado: trecho LITERAL em que o julgado resume os fatos (TNU). Devolve [onde, texto] ou null. */
export function fatosDoJulgado(it) {
  if (!it) return null;
  // v1.6.0 (espelho do Python v1.5.5, porte do TJRO v1.37): o voto pode transcrever a ementa de OUTRO processo; fica o ÚLTIMO
  // "caso em exame" fora de transcrição, que é a ementa do próprio acórdão (a transcrita vem antes, dentro do voto)
  const secs = secoesDaEmenta(it, 0, it.length).filter((x) => x.nome === "caso em exame");
  const trans = secs.length > 1 ? faixasTranscritas(norm1(it), 0) : [];
  const proprias = secs.filter((x) => !trans.some(([a, b]) => a <= x.a && x.a < b));
  for (const sec of [...proprias].reverse()) {
    const ini = sec.a;
    const m = /^\s*(?:[IVXivx]{1,3}\s*[.)-]?\s*)?[Cc][Aa][Ss][Oo] [Ee][Mm] [Ee][Xx][Aa][Mm][Ee]\s*[.:]?\s*/.exec(it.slice(ini, sec.b));
    const txt = it.slice(ini + (m ? m[0].length : 0), sec.b).trim();
    if (cpLen(txt) > 40) return ["ementa › caso em exame", cpSlice(txt, FATOS_MAX)];
  }
  const mr = /(?:(?<=\n)|(?<![\s\S]))[ \t]*RELAT[ÓO]RIO[ \t]*(?=\n|(?![\s\S]))/.exec(cpSlice(it, 6000));
  if (mr) {
    const fimR = mr.index + mr[0].length;
    const reVoto = /(?:(?:(?<=\n)|(?<![\s\S]))[ \t]*VOTO\b[^\n]*(?=\n|(?![\s\S])))|(?<![\p{L}\p{N}_])[ÉEé]\s+o\s+(?:breve\s+)?relat[óo]rio(?![\p{L}\p{N}_])/giu;   // \b do Python é Unicode: sem o flag u o É inicial não tinha fronteira
    reVoto.lastIndex = fimR;
    const mv = reVoto.exec(it);
    const fim = mv ? mv.index : fimR + cpSlice(it.slice(fimR), FATOS_MAX).length;   // FATOS_MAX em pontos de código; o índice segue em UTF-16
    const txt = stripChars(it.slice(fimR, fim), " \t\n:.-").replace(RE_LIXO_WORD, "").trim();
    if (cpLen(txt) > 40 && !/relat[óo]rio\s+(?:formal\s+)?dispensad[oa]|dispensad[oa]\s+o\s+relat[óo]rio|dispens[ao]\s+o\s+relat[óo]rio/i.test(cpSlice(txt, 200))) return ["relatório do acórdão", cpSlice(txt, FATOS_MAX)];
  }
  return null;
}

const RE_RELATOR_VENCIDO_FECHO = /\bvencid[oa]s? (?:\w+ ){0,6}?(?:o|a|o\(a\)) relator(?:a|\(a\))?\b/;
/** _relator_vencido: devolve o relator do acórdão (ou "?") quando o relator do cabeçalho ficou VENCIDO: o fecho diz "vencido o relator"
 * ou a ata traz "RELATOR DO ACÓRDÃO" diferente do relator. Vazio quando não há sinal. */
export function relatorVencido(d) {
  const it = d.inteiro_teor_texto || "";
  if (!it) return "";
  const rt = "relator_texto" in d ? d.relator_texto : fechoTnu(it).relator_texto;
  const ra = "relator_acordao_texto" in d ? d.relator_acordao_texto : fechoTnu(it).relator_acordao_texto;
  const diferente = Boolean(rt && ra && norm(ra) !== norm(rt) && !norm(rt).includes(norm(ra)) && !norm(ra).includes(norm(rt)));
  if (diferente || RE_RELATOR_VENCIDO_FECHO.test(norm1(it.slice(-6000)))) return ra || "?";
  return "";
}

export function linhaFatos(d) {
  const f = fatosDoJulgado(d.inteiro_teor_texto || "");
  if (!f) return "";
  const ft = f[1].replace(/\s+/g, " ") + (cpLen(f[1]) >= FATOS_MAX ? " […]" : "");
  let aviso = "";
  if (f[0].startsWith("relatório")) {
    aviso = " ⚠️ É o relatório: narra o pedido e as alegações das partes, NÃO o fundamento nem o resultado; confira os dois no voto e no fecho.";
    const venc = relatorVencido(d);
    if (venc) aviso += " ⚠️ Relator VENCIDO: o voto que segue o relatório é o vencido; os fatos e fundamentos que decidem estão no voto vencedor" + (venc !== "?" ? ` (relator do acórdão: ${venc}).` : ".");
  } else if (RE_ALEGACAO_FATOS.test(f[1])) aviso = " ⚠️ O trecho contém alegação da parte (sustentou/alega/afirma): é o que a parte diz, não fato reconhecido pelo julgado; não o transforme em fato na ficha.";
  return `📌 FATOS DO JULGADO (trecho literal, ${f[0]}; não é resumo meu): "${ft}"${aviso}`;
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

const RE_SESSAO_DATA = /sess[ãa]o[^.]{0,70}?(\d{2}\/\d{2}\/\d{4})(?:\s*(?:a|à|até|e)\s*(\d{2}\/\d{2}\/\d{4}))?/i;
/** A data de "Julgamento" do índice pode não ser a da sessão (relato de 12/10/2026). Só avisa; quem manda é o dispositivo/inteiro teor. */
export function avisoDataSessao(d) {
  const idx = dataIso(d.data_fecho || d.data_julgamento || "");
  const m = RE_SESSAO_DATA.exec(limpar(d.decisao || "", 0));
  if (!idx || !m) return "";
  const ini = dataIso(m[1]), fim = dataIso(m[2] || m[1]);
  if (!ini || !fim || (ini <= idx && idx <= fim)) return "";
  const cit = m[1] + (m[2] ? ` a ${m[2]}` : "");
  return `⚠️ Data do índice (${idx.slice(8)}/${idx.slice(5, 7)}/${idx.slice(0, 4)}) diverge da sessão citada no dispositivo (${cit}): para citar a data do julgamento, confira no inteiro teor ou na ata.`;
}

export function linhasDeSinais(d) {
  const linhas = [];
  const ad = avisoDataSessao(d);
  if (ad) linhas.push(ad);
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
  // v1.6.0: sem o destaque «» do portal (ele marca o termo pesquisado na lista; recibo de busca e de decisão têm de ter o MESMO texto)
  return [semDestaque(d.ementa || ""), semDestaque(d.decisao || ""), d.inteiro_teor_texto || d.inteiro_teor_embutido].filter(Boolean).join("\n\n");
}

/** `origem`: "decisao" (obter_decisao/verificar_citacao leram o número inteiro) ou "busca" (só o que a lista trouxe). */
export function camposDeCustodia(d, origem = "decisao") {
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
    origem,
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
    texto, ementa: semDestaque(d.ementa || ""), dispositivo: semDestaque(d.decisao || ""),
    inteiro_teor_incluido: Boolean(it),
    inteiro_teor: it,
    trechos_transcritos: transcritos, trecho_divergente: divergente, trechos_obiter: it ? trechosObiter(it) : [],
    normalizacao: "trechos em bruto, recortados de `texto` — normalize com a sua própria função",
    sha256: crypto.createHash("sha256").update(texto, "utf-8").digest("hex"),
    versao_servidor: VERSAO,
    obtido_em: horaLocalIso(),   // v1.6.0: hora LOCAL sem fuso, como o Python (time.strftime)
  };
}

/** AAAA-MM-DDTHH:MM:SS na hora local, sem fuso (igual a time.strftime("%Y-%m-%dT%H:%M:%S") do Python). */
export function horaLocalIso(dt = new Date()) {
  const z = (n, w = 2) => String(n).padStart(w, "0");
  return `${z(dt.getFullYear(), 4)}-${z(dt.getMonth() + 1)}-${z(dt.getDate())}T${z(dt.getHours())}:${z(dt.getMinutes())}:${z(dt.getSeconds())}`;
}

/** Recibo de DECISÃO (0600, escrita atômica; origem "decisao"): vem de obter_decisao_trf1 ou da verificação, que leram o número inteiro no
 *  portal. SOBRESCREVE e promove o recibo de busca do mesmo id. Falha é silenciosa. Devolve o caminho ou "". */
export function gravarRecibo(d, env = process.env) {
  try {
    if (!d.id || !textoDeCustodia(d)) return "";
    const dir = DIR_RECIBOS(env);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir, 0o700); } catch { /* melhor esforço */ }
    const caminho = arqRecibo(String(d.id || ""), env);
    // v1.6.0: regravar não pode PERDER o inteiro teor que um recibo anterior já tinha (download do eproc falhou, ou o documento caiu além do
    // teto de 3): mescla o inteiro teor existente e recalcula texto/sha256 sobre o conteúdo final.
    if (!(d.inteiro_teor_texto || d.inteiro_teor_embutido)) {
      try {
        const antigo = JSON.parse(fs.readFileSync(caminho, "utf-8"));
        const itAntigo = antigo && typeof antigo === "object" ? antigo.inteiro_teor : "";
        if (typeof itAntigo === "string" && pyStrip(itAntigo)) d = { ...d, inteiro_teor_texto: itAntigo };
      } catch { /* sem recibo anterior, ou ilegível */ }
    }
    const rec = camposDeCustodia(d, "decisao");
    escreverJsonAtomico(caminho, rec);
    desindexarBusca(dir, [rec.id_documento]);
    return caminho;
  } catch {
    return "";
  }
}

function removerTmp(tmp) { try { fs.unlinkSync(tmp); } catch { /* já não existe */ } }
/** rename; no Windows (arquivo aberto por antivírus/indexador), até 3 tentativas com espera curta (v1.6.0). */
export function substituirArquivo(tmp, destino) {
  const tentativas = process.platform === "win32" ? 3 : 1;
  for (let k = 0; k < tentativas; k++) {
    try { fs.renameSync(tmp, destino); return; } catch (e) { if (k === tentativas - 1) throw e; dormirSync(50 * (k + 1)); }
  }
}

/** Escreve JSON em arquivo 0600 por temporário + rename; devolve os bytes escritos. O temporário NUNCA fica para trás (try/finally).
 *  `soCriar` (v1.6.0, recibo da busca): o alvo só pode ser CRIADO, jamais substituído — grava o tmp e faz link(tmp, alvo); EEXIST = "já existe",
 *  devolve null sem gravar. Sem suporte a link no FS (alguns Windows), cai para open com flag "wx" escrevendo direto. */
export function escreverJsonAtomico(caminho, obj, soCriar = false) {
  const tmp = `${caminho}.${process.pid}.tmp`;
  const bruto = JSON.stringify(obj);
  try {
    fs.writeFileSync(tmp, bruto, { mode: 0o600 });
    if (soCriar) {
      try {
        fs.linkSync(tmp, caminho);
      } catch (e) {
        if (e.code === "EEXIST") return null;
        try {
          fs.writeFileSync(caminho, bruto, { mode: 0o600, flag: "wx" });
        } catch (e2) {
          if (e2.code === "EEXIST") return null;
          throw e2;
        }
      }
    } else {
      substituirArquivo(tmp, caminho);
    }
    return Buffer.byteLength(bruto, "utf-8");
  } finally {
    removerTmp(tmp);
  }
}

// --- Recibo gravado pela própria busca (porte do TJRO v1.31.0, H01) ---
// A lista da busca já traz ementa e dispositivo (e, no colegiado, o inteiro teor embutido) INTEGRAIS: guardá-los evita reabrir o número só para citar.
// Salvaguardas: (a) a busca NUNCA sobrescreve recibo existente; o de decisão promove o de busca; (b) acima de TRF1_MCP_RECIBOS_BUSCA_MAX_MB
// (padrão 300) saem os recibos de busca MAIS ANTIGOS, nunca os de decisão; (c) na TNU o recibo de busca NÃO tem o inteiro teor (a lista não o
// traz) e quem verifica citação vai ao portal; (d) o recibo de busca não prova que o processo esteja completo.
export const INDICE_BUSCA = ".busca-indice.json";   // {id: [bytes, instante_ms]} dos recibos de origem "busca"; mesmo nome do TJRO
export const RECIBOS_BUSCA_MAX_MB_PADRAO = 300;

export function recibosBuscaMaxBytes(env = process.env) {
  let mb = Number(env.TRF1_MCP_RECIBOS_BUSCA_MAX_MB || RECIBOS_BUSCA_MAX_MB_PADRAO);
  if (!Number.isFinite(mb)) mb = RECIBOS_BUSCA_MAX_MB_PADRAO;
  return Math.trunc(Math.max(10, mb || RECIBOS_BUSCA_MAX_MB_PADRAO) * 1024 * 1024);
}

export function lerIndiceBusca(pasta) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(pasta, INDICE_BUSCA), "utf-8"));
    return d && typeof d === "object" && !Array.isArray(d) ? d : {};
  } catch {
    return {};
  }
}

export function gravarIndiceBusca(pasta, idx) {
  escreverJsonAtomico(path.join(pasta, INDICE_BUSCA), idx);
}

/** Recibo de decisão promove o de busca: o id sai do índice de poda (e nunca mais é podado). */
function desindexarBusca(pasta, ids) {
  try {
    const idx = lerIndiceBusca(pasta);
    if (ids.some((i) => Object.hasOwn(idx, i))) {
      for (const i of ids) delete idx[i];
      gravarIndiceBusca(pasta, idx);
    }
  } catch { /* melhor esforço */ }
}

/** Número tolerante do índice de poda (v1.6.0, igual ao Python): só número finito ou string numérica; o resto vale 0. */
const numIndice = (x) => {
  if (typeof x === "number") return Number.isFinite(x) ? Math.trunc(x) : 0;
  if (typeof x === "string" && /^\s*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\s*$/.test(x)) { const v = Number(x); return Number.isFinite(v) ? Math.trunc(v) : 0; }
  return 0;
};
/** [bytes, instante_ms] de uma entrada do índice; entrada malformada (escalar, `[bytes]` sem instante, lixo) não derruba a poda. */
const entradaIndice = (v) => (Array.isArray(v) ? [v.length > 0 ? numIndice(v[0]) : 0, v.length > 1 ? numIndice(v[1]) : 0] : [0, 0]);

/** Acima do teto saem os recibos de BUSCA mais antigos, até 80% do teto; nunca os de decisão (nem o arquivo que, apesar do índice, não
 *  traga origem "busca"). Devolve quantos removeu. v1.6.0: o arquivo é primeiro RENOMEADO para `<id>.json.podando`, relido e só apagado se a
 *  origem for "busca" — um recibo de decisão gravado entre a leitura e o unlink não se perde (se não for "busca", volta). */
export function podarRecibosDeBusca(pasta = null, maxBytes = null, env = process.env) {
  let removidos = 0;
  try {
    pasta = pasta || DIR_RECIBOS(env);
    const teto = maxBytes !== null && maxBytes !== undefined ? maxBytes : recibosBuscaMaxBytes(env);
    const idx = lerIndiceBusca(pasta);
    let total = Object.values(idx).reduce((acc, v) => acc + entradaIndice(v)[0], 0);
    if (total <= teto) return 0;
    const ordem = Object.entries(idx).sort((a, b) => (entradaIndice(a[1])[1] - entradaIndice(b[1])[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [ident, v] of ordem) {
      if (total <= teto * 0.8) break;
      const cam = path.join(pasta, String(ident).replace(/[^A-Za-z0-9]/g, "") + ".json");
      const pod = cam + ".podando";
      try {
        fs.renameSync(cam, pod);
        let ehBusca = false;
        try {
          const r = JSON.parse(fs.readFileSync(pod, "utf-8"));
          ehBusca = Boolean(r && typeof r === "object" && !Array.isArray(r) && r.origem === "busca");
        } catch { /* ilegível: não é "busca" */ }
        if (ehBusca) {
          fs.unlinkSync(pod);
          removidos++;
        } else {
          try {
            fs.linkSync(pod, cam);   // volta sem sobrescrever o que a decisão tenha gravado nesse meio-tempo
          } catch (e) {
            if (e.code !== "EEXIST" && !fs.existsSync(cam)) fs.renameSync(pod, cam);
          }
          removerTmp(pod);
        }
      } catch { /* já removido */ }
      total -= entradaIndice(v)[0];
      delete idx[ident];
    }
    gravarIndiceBusca(pasta, idx);
  } catch { /* melhor esforço */ }
  return removidos;
}

/** Guarda, como recibo origem "busca", os documentos da página que a busca trouxe. NUNCA sobrescreve um recibo existente (de busca ou de
 *  decisão). Tira o destaque «» do portal (o texto fica igual ao que obter_decisao grava). Falha é silenciosa. Devolve quantos gravou. */
export function gravarRecibosDaBusca(docs, pasta = null, env = process.env) {
  let n = 0;
  try {
    pasta = pasta || DIR_RECIBOS(env);
    fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(pasta, 0o700); } catch { /* melhor esforço */ }
    const novos = {};
    for (const d of docs || []) {
      if (!d.id || !textoDeCustodia(d)) continue;
      const alvo = path.join(pasta, String(d.id).replace(/[^A-Za-z0-9]/g, "") + ".json");
      if (fs.existsSync(alvo) || fs.existsSync(alvo + ".inconsistente")) continue;
      const rec = camposDeCustodia(d, "busca");
      const tam = escreverJsonAtomico(alvo, rec, true);   // v1.6.0: só CRIA (um recibo de decisão gravado agora não é substituído)
      if (tam === null) continue;
      novos[rec.id_documento] = [tam, Date.now()];
      n++;
    }
    if (n) {
      const idx = lerIndiceBusca(pasta);
      Object.assign(idx, novos);
      gravarIndiceBusca(pasta, idx);
      podarRecibosDeBusca(pasta, null, env);
    }
  } catch { /* melhor esforço */ }
  return n;
}

/** sha256 divergente ou JSON inválido = corrupção/edição → posto de lado (.inconsistente), null. v1.6.0: erro de E/S (permissão, disco, arquivo
 *  preso) devolve null SEM renomear — recibo válido não vai para quarentena por falha de leitura. A quarentena nunca apaga uma quarentena
 *  anterior (sufixo com o instante se o nome já existe). */
export function lerRecibo(ident, env = process.env) {
  const caminho = arqRecibo(ident, env);
  let texto;
  try {
    texto = fs.readFileSync(caminho, "utf-8");
  } catch (e) {
    return null;   // ENOENT: não há recibo; qualquer outro erro de E/S: não é prova de corrupção
  }
  let rec, ok;
  try {
    rec = JSON.parse(texto);
    ok = rec && typeof rec === "object" && typeof rec.texto === "string" &&
      crypto.createHash("sha256").update(rec.texto, "utf-8").digest("hex") === rec.sha256;
  } catch {
    ok = false;
  }
  if (ok) return rec;
  let destino = caminho + ".inconsistente";
  if (fs.existsSync(destino)) destino = `${destino}.${Date.now()}`;
  try { fs.renameSync(caminho, destino); } catch { /* melhor esforço */ }
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
    campos: {}, recibo: arqRecibo(rec.id_documento, env), origem_recibo: rec.origem || "decisao",
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

/** `exibido`: "completo" (padrão), "lista" (a lista da busca mostra só ementa e trecho do dispositivo) ou "triagem" (nada do inteiro teor aparece).
 *  v1.6.0: o nível reflete o que foi EXIBIDO. */
export function nivelVerificacao(d, cortado = false, exibido = "completo") {
  if (exibido === "triagem") return "triagem — nada lido; reabra no modo completo para citar";
  if (exibido === "lista") return "só ementa/índice";
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

// --- Julgado recente (porte do TJRO v1.34.0; espelho do Python v1.5.5) ---
export const RECENTE_DIAS = 30;
const DIA_MS = 86_400_000;
const utcDe = (a, m, d) => { const t = new Date(0); t.setUTCFullYear(a, m - 1, d); t.setUTCHours(0, 0, 0, 0); return t; };

/** `hoje`: Date (vale a data local), "AAAA-MM-DD" ou ausente (hoje, no relógio local). */
function diaDeHoje(hoje) {
  if (typeof hoje === "string") { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hoje); if (m) return utcDe(+m[1], +m[2], +m[3]); }
  const h = hoje instanceof Date ? hoje : new Date();
  return utcDe(h.getFullYear(), h.getMonth() + 1, h.getDate());
}
export function diasDesdeDataBr(dataBr, hoje) {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(String(dataBr || ""));
  if (!m) return null;
  const [dd, mm, aa] = [+m[1], +m[2], +m[3]];
  if (aa < 1) return null;
  const dt = utcDe(aa, mm, dd);
  if (dt.getUTCFullYear() !== aa || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null;   // "31/11/2026" não vira "recente"
  return Math.round((diaDeHoje(hoje).getTime() - dt.getTime()) / DIA_MS);
}
/** _dias_recente: dias desde o julgamento, se forem até RECENTE_DIAS; senão null. Olha a data do índice e a do fecho (TNU, quando o
 * inteiro teor veio) e fica com a menor distância; data futura ou inválida não conta. */
export function diasRecente(d, hoje) {
  const dias = [diasDesdeDataBr(d.data_julgamento || "", hoje), diasDesdeDataBr(d.data_fecho || "", hoje)].filter((x) => x !== null && x >= 0 && x <= RECENTE_DIAS);
  return dias.length ? Math.min(...dias) : null;
}

// --- Resultados no mesmo número (porte do TJRO v1.30 e v1.35) ---
export function rotuloDocumento(conj, emb) {
  const r = rotuloDoConjunto(conj, emb);
  return r ? ROTULOS_RESULTADO[r] ?? "sem resultado identificável" : "sem resultado identificável";
}
function agruparPorData(irmaos) {
  const porData = new Map();
  for (const x of irmaos) if (x.data_julgamento) {
    if (!porData.has(x.data_julgamento)) porData.set(x.data_julgamento, []);
    porData.get(x.data_julgamento).push(x);
  }
  return porData;
}
/** _avisos_opostos: documentos do MESMO julgamento (nº + data) que declaram lados opostos. O par ACOLHIDO × REJEITADO só vale entre
 * embargos de declaração e o par PROVIDO × DESPROVIDO só fora deles. O aviso diz qual documento diz o quê. */
export function avisosOpostos(irmaos) {
  const out = [];
  for (const [data, grupo] of agruparPorData(irmaos)) {
    const info = grupo.map((x) => [x, ...resultadoComEmbargos(x.decisao || "", x.classe || "")]);
    for (const par of OPOSTOS) {
      const lados = info.filter(([, , emb]) => emb === (par[0] === "ACOLHIDO")).map(([x, conj]) => [x, ladoDe(conj, par), conj]).filter((t) => t[1]);
      if (new Set(lados.map((t) => t[1])).size > 1) {
        const quem = lados.map(([x, l, conj]) => `id ${x.id} (${x.tipo || "?"}): ${l === "PROVIDO" && conj.has("PARCIAL") ? ROTULOS_RESULTADO.PARCIAL : ROTULOS_RESULTADO[l]}`).join("; ");
        out.push(`⚠️ Documentos do julgamento de ${data} declaram resultados opostos: ${quem}. Provável voto vencido ou decisão monocrática indexada; leia cada um e cite pelo id.`);
      }
    }
  }
  return out;
}
/** _avisos_entre_julgamentos: julgamentos de datas diferentes sob o mesmo número: resultados de mérito diferentes e embargos ACOLHIDOS. */
export function avisosEntreJulgamentos(irmaos) {
  const porData = agruparPorData(irmaos);
  if (porData.size < 2) return [];
  const res = [], edAc = [];
  for (const [data, grupo] of porData) {
    const info = grupo.map((x) => resultadoComEmbargos(x.decisao || "", x.classe || ""));
    const conj = new Set(info.flatMap(([c]) => [...c]));
    const emb = info.some(([, e]) => e);
    const r = rotuloDoConjunto(conj, emb);
    const ident = `${data} (id ${grupo[0].id})`;
    if (emb) { if (r === "ACOLHIDO" || r === "PARCIAL") edAc.push(ident); }
    else if (r === "PROVIDO" || r === "PARCIAL" || r === "DESPROVIDO") res.push([ident, ROTULOS_RESULTADO[r]]);
  }
  const out = [];
  if (new Set(res.map(([, r]) => r)).size > 1) {
    out.push("⚠️ Os julgamentos deste número declaram resultados diferentes: " + res.map(([i, r]) => `${i}: ${r}`).join("; ") +
      ". Pode ser recurso diferente (apelação e agravo interno) ou reemissão; confira qual vigora antes de citar o resultado.");
  }
  if (edAc.length) {
    out.push("⚠️ Embargos de declaração ACOLHIDOS em " + edAc.join("; ") +
      ": se tiveram efeito infringente, o resultado vigente é o deles, não o da decisão embargada; leia o dispositivo dos embargos.");
  }
  return out;
}

// --- Placar do limitador no fim da busca (porte do TJRO v1.34.0) ---
/** _linha_de_ritmo: quantas requisições esta máquina fez na janela atual e o nível do limitador. Só LÊ o estado do disjuntor (nenhuma
 * requisição nova); o estado é compartilhado por todos os processos desta extensão nesta máquina. */
export function linhaDeRitmo(agora = Date.now()) {
  try {
    const e = comTrava(() => lerEstadoDisjuntor());
    const idx = Math.max(0, Math.min(Math.trunc(Number(e.indiceJanela) || 0), ESCADA_JANELA_MS.length - 1));
    const janela = ESCADA_JANELA_MS[idx];
    const naJanela = (e.requisicoes || []).filter((t) => agora - t <= janela).length;
    return `\n_Ritmo do portal: ${naJanela} de ${JANELA_MAX_REQS} requisições na janela atual de ${fmtHms(janela)} (nível ${idx + 1} de ` +
      `${ESCADA_JANELA_MS.length}), contando todos os processos desta extensão nesta máquina; cada busca gasta 2 a 4. Se o seu roteiro ` +
      "tem teto por frente, conte as suas chamadas: este número só diz o fôlego do limitador._";
  } catch {
    return "";
  }
}

// --- Saída grande (porte do TJRO v1.33.0) ---
export const SAIDA_MAX_CHARS = 80_000;
const comprimento = (t) => [...t].length;   // o Python mede em pontos de código; o JS, em unidades UTF-16 (emoji astral conta 2)
/** _limitar_saida_busca: acima de `maximo` caracteres corta no limite de UM resultado, mantém o rodapé (resumo da página), tira o
 * "Próxima página" e diz quantos couberam e como pedir o resto. */
export function limitarSaidaBusca(texto, maximo = SAIDA_MAX_CHARS, pagina = 1, porPagina = 30) {
  const t = String(texto ?? "");
  if (comprimento(t) <= maximo) return t;
  const cp = (i) => comprimento(t.slice(0, i));   // índice UTF-16 → ponto de código
  const ini = [...t.matchAll(/\n\*\*(\d+)\. /g)].map((m) => m.index);
  if (ini.length < 2) return [...t].slice(0, maximo).join("") + "\n\n[SAÍDA CORTADA no limite de caracteres; repita com por_pagina menor.]\n";
  const reRod = /\n(?:ℹ️ Ementas cortadas|Resumo desta página|Próxima página:)/g;
  reRod.lastIndex = ini[ini.length - 1];
  const rod = reRod.exec(t);
  const corpoFim = rod ? rod.index : t.length;
  let rodape = t.slice(corpoFim);
  rodape = rodape.replace(/\nPróxima página:[^\n]*/g, "");   // a página seguinte pularia os resultados cortados
  const limite = maximo - comprimento(rodape) - 600;
  const caber = [];
  ini.forEach((_, i) => { if (cp(i + 1 < ini.length ? ini[i + 1] : corpoFim) <= limite) caber.push(i); });
  if (!caber.length) caber.push(0);
  const k = caber[caber.length - 1] + 1;   // resultados inteiros que cabem
  const ate = k < ini.length ? ini[k] : corpoFim;
  const primeira = (pagina - 1) * porPagina;
  const sugestao = porPagina > 10 && primeira % 10 === 0 ? `por_pagina=10 e pagina=${Math.floor(primeira / 10) + 1}` : "por_pagina=10";
  const aviso = `\n\n[SAÍDA CORTADA: ${k} de ${ini.length} resultados cabem aqui (limite de ${Math.floor(maximo / 1000)} mil caracteres, para a resposta não ser ` +
    `desviada para arquivo). Repita com ${sugestao}; os ${ini.length - k} restantes desta página não vieram.]\n`;
  return t.slice(0, ate).trimEnd() + aviso + rodape;
}

// --- Consulta grande recusada pelo portal (porte do TJRO v1.33.0) ---
const RE_OPERADOR_CONSULTA = /^(?:E|OU|NAO|NÃO|ADJ\d*|PROX\d*|COM|MESMO|XOU)$/;   // operadores saem em maiúsculas; termo isolado igual a eles vai entre aspas
/** _tamanho_da_consulta: [grupos, termos] da consulta que o portal recebeu. */
export function tamanhoDaConsulta(consultaMontada, grupos) {
  const termos = (String(consultaMontada || "").match(/"[^"]*"|[^\s()]+/g) || []).filter((x) => !RE_OPERADOR_CONSULTA.test(x));
  const nG = Array.isArray(grupos)
    ? grupos.filter((g) => Array.isArray(g) && g.some((x) => String(x).trim())).length
    : consultaMontada ? String(consultaMontada).split(/\s+E\s+/).length : 0;
  return [nG, termos.length];
}
/** _dica_consulta_grande: quando o portal recusa com 'BRSResultSet.errWhenExecutingSearch' ou HTTP 500, diz o tamanho da consulta e manda reduzir. */
export function dicaConsultaGrande(mensagem, consultaMontada, grupos) {
  if (!/errWhenExecutingSearch|HTTP 500/.test(String(mensagem ?? ""))) return "";
  const [nG, nT] = tamanhoDaConsulta(consultaMontada, grupos);
  if (!nT) return "";
  return ` O portal recusou uma consulta de ${nG} grupo(s) e ${nT} termo(s); consultas maiores falham com mais frequência, mas o ` +
    "gatilho exato não está provado. Reduza os termos, use `grupos` ou divida em duas buscas e junte os resultados.";
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
  if (total >= 1000) {   // porte do TJRO v1.35: a página é só o topo da ordenação
    linhas.push(`⚠️ Consulta pouco seletiva (${total} documentos): a página mostra só o topo da ordenação, que não representa o conjunto. ` +
      "Antes de concluir algo sobre ele, restrinja com `E`, `grupos`, `[EMEN]` (só na ementa) ou filtro de órgão, relator ou data.");
  }
  if (fold(filtros.orgao_julgador || "").includes("recursal") && (meta.base || "trf1") === "trf1") {
    linhas.push('⚠️ O filtro de órgão casa por TRECHO do nome. Em 2026 parte das Turmas Recursais aparece com nome novo (ex.: "PRIMEIRA TURMA 4.0 - ADJUNTA A TR-AC", medido em 12/10/2026) e fica de fora de "TURMA RECURSAL". Para cobrir os dois nomes, filtre por "PRIMEIRA TURMA" (ou o trecho comum) e identifique a unidade pelo número CNJ.');
  }
  if (!docs.length && !total && filtros.origem) {
    linhas.push('⚠️ O filtro `origem` casa o campo "Origem" do portal, que é o TRIBUNAL de origem (nos resultados aparece "TRF - PRIMEIRA REGIÃO"), e NÃO o estado nem a seção judiciária: "RO" ou "Rondônia" nunca casam. Refaça sem `origem`; a unidade de origem aparece nos 4 últimos dígitos do número CNJ de cada resultado (ex.: .4.01.4100). Zero aqui foi do filtro, não do assunto.');
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
    const rec = diasRecente(d, meta.hoje);
    if (d.data_julgamento) metaL.push(`Julgamento: ${d.data_julgamento}` + (rec !== null ? " 🆕" : ""));
    if (d.data_publicacao) metaL.push(`Publicação: ${d.data_publicacao}`);
    if (d.fonte_publicacao) metaL.push(`Fonte: ${d.fonte_publicacao}`);
    linhas.push("  " + metaL.join(" · "));
    linhas.push(`  Citação: ${citacaoComLink(d)} — verificação: ${nivelVerificacao(d, false, "lista")}`);
    if (rec !== null) linhas.push(`  🆕 JULGADO RECENTE (${rec} dia(s)): pode ainda não ter sido publicado e cabe embargos de declaração; confira a publicação antes de citar.`);
    const vot = votacaoDoDocumento(d);
    if (vot) linhas.push(`  🗳️ Votação declarada no dispositivo: ${vot} (não diz quem foi o vencido; o voto vencido só se vê no inteiro teor)`);
    for (const sl of linhasDeSinais(d)) linhas.push(`  ${sl}`);
    const em = d.ementa || "";
    if (em.length > TRECHO_EMENTA) houveCorte = true;
    linhas.push(`  Ementa (trecho): ${trechoCentrado(em, TRECHO_EMENTA) || "—"}`);
    const lt = linhaTeseDaBusca(em);
    if (lt) linhas.push(`  ${lt}`);
    if (d.decisao) {
      linhas.push(`  Dispositivo: ${trechoCentrado(d.decisao, TRECHO_DECISAO)}`);
      const [conjD, embD] = resultadoComEmbargos(d.decisao, d.classe || "");
      if (embD && ["ACOLHIDO", "PARCIAL"].includes(rotuloDoConjunto(conjD, true))) {
        const fe = fraseDosEmbargos(d.decisao);
        // frase literal, não rótulo: o subtipo (erro material, omissão, efeito infringente) não se lê com segurança
        if (fe) linhas.push(`  ✏️ Embargos acolhidos, frase do dispositivo (literal, para ver se houve efeito infringente; não é rótulo): «${fe}»`);
      }
    }
    const irmaos = porNumero.get(d.numero_digitos) || [];
    if (irmaos.length > 1 && irmaos[0] === d) {
      const desc = irmaos.map((x) => `${x.data_julgamento || "?"} ${x.tipo || ""} (id ${x.id}, Rel. ${x.relator || "?"})`).join("; ");
      linhas.push(`  ⚠️ Mesmo número, ${irmaos.length} documentos nesta página: ${desc} — cite pelo id + data, nunca só pelo número.`);
      for (const av of avisosOpostos(irmaos)) linhas.push(`  ${av}`);
      for (const av of avisosEntreJulgamentos(irmaos)) linhas.push(`  ${av}`);
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

// --- Inteiro teor sem repetição (porte do TJRO v1.29.0, H04; só TNU) ---
// Na TNU o portal entrega a ementa e o dispositivo e o eproc entrega o inteiro teor, que traz a ementa e o acórdão de novo. Quando o texto do
// portal está CONTIDO letra a letra no inteiro teor exibido (só espaços e o destaque «» são normalizados; nunca similaridade), ele vira um ponteiro.
// Se o inteiro teor é cortado pelo orçamento e o trecho cai na parte não exibida, NÃO se substitui. Texto curto não vira ponteiro (seria maior).
export const SEM_REPETICAO_MIN_CHARS = 150;
export const SEM_REPETICAO_ANCORA = 40;
const RE_ESPACOS_PY = /[ \t\n\r\f\v]+/g;   // só ASCII, como o Python (não colapsa NBSP)

export function compacto(t) {
  return pyStrip(semDestaque(t || "").replace(RE_ESPACOS_PY, " "));
}

/** Ponteiro no lugar de `texto` se ele está contido, exato, no inteiro teor exibido; senão "". Tamanhos em pontos de código, como o Python. */
export function ponteiroContido(texto, itExibidoCompacto, rotulo) {
  const c = compacto(texto);
  const n = cpLen(c);
  if (n < SEM_REPETICAO_MIN_CHARS || !itExibidoCompacto.includes(c)) return "";
  const ptr = `[${rotulo}: texto idêntico a trecho do inteiro teor abaixo (${n} caracteres); começa em «${cpSlice(c, SEM_REPETICAO_ANCORA)}…»]`;
  return cpLen(ptr) < n ? ptr : "";   // só troca quando o ponteiro é menor que o texto
}

/** s[:n].rsplit(" ", 1)[0] do Python (com o espaço na posição 0 devolve ""). */
const corteNoEspaco = (s) => { const i = s.lastIndexOf(" "); return i >= 0 ? s.slice(0, i) : s; };

export function formatDecisao(docs, numero, total, semRepeticao = true) {
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
    // inteiro teor como será exibido (cortado no orçamento, se for o caso) e o que dele repete a ementa e o dispositivo do portal
    const itCortado = cpLen(it) > orcamentoPorDoc;
    const itExibido = itCortado ? corteNoEspaco(cpSlice(it, orcamentoPorDoc)) : it;
    let ptrEm = "", ptrDec = "";
    if (semRepeticao && d.inteiro_teor_texto) {
      const ic = compacto(itExibido);
      ptrEm = ponteiroContido(d.ementa || "", ic, "Ementa");
      ptrDec = ponteiroContido(d.decisao || "", ic, "Dispositivo");
    }
    const cortado = (cpLen(em) > orcamentoPorDoc && !ptrEm) || itCortado;
    const nivel = nivelVerificacao(d, cortado);
    linhas.push(`\n### ${d.tipo || "Documento"} · id ${d.id} · julgado em ${d.data_fecho || d.data_julgamento || "?"}`);
    linhas.push(`Citação: ${citacaoComLink(d)} — verificação: ${nivel}`);
    linhas.push(`  orgao_fonte: ${orgaoFonte(d)}` + (d.relator_acordao_texto || d.relator_texto ? ` · relator no texto: ${d.relator_acordao_texto || d.relator_texto}` : ""));
    const extras = Object.entries(d.campos || {}).filter(([k]) => !["Ementa", "Decisão", "Inteiro teor", "Número", "Fonte da publicação"].includes(k));
    if (extras.length) linhas.push("  " + extras.map(([k, v]) => `${k}: ${v}`).join(" · "));
    if (d.fonte_publicacao) linhas.push(`  Fonte da publicação: ${d.fonte_publicacao}`);
    const vot = votacaoDoDocumento(d);
    if (vot) linhas.push(`  🗳️ Votação declarada: ${vot} (não diz quem foi o vencido)`);
    for (const sl of linhasDeSinais(d)) linhas.push(`  ${sl}`);
    const lf = linhaFatos(d);
    if (lf) linhas.push(`  ${lf}`);
    if (ptrEm) {
      em = ptrEm;
    } else if (cpLen(em) > orcamentoPorDoc) {
      em = corteNoEspaco(cpSlice(em, orcamentoPorDoc)) + "… [CORTADO pelo orçamento de caracteres — o recibo em disco tem o texto inteiro]";
    }
    linhas.push(`\n**Ementa (integral, literal do portal):**\n${em}`);
    linhas.push(`\n**Dispositivo (campo "Decisão", literal):**\n${ptrDec || d.decisao || "— (não informado pelo portal)"}`);
    if (it) {
      let itSaida = it;
      if (itCortado) {
        itSaida = itExibido + "… [CORTADO pelo orçamento de caracteres — o recibo em disco tem o texto inteiro; verificação = EM PARTE]";
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

// --- Modo triagem (porte do TJRO v1.33.0): ler barato para decidir se vale ler por inteiro ---
export const TRIAGEM_DISPOSITIVO_MAX = 300;
export const MODOS_DECISAO = ["completo", "triagem"];

/** Um bloco por JULGAMENTO (mesma data): resultado declarado, votação, peças com id e link, citação, início do dispositivo, tese da ementa,
 *  fatos do julgado (TNU) e sinais (Cita: …), SEM o texto da ementa nem do inteiro teor. Indício para escolher o que ler; para aspas vale o
 *  modo completo ou verificar_citacao_trf1. */
export function formatTriagem(docs, numero, total) {
  if (!docs.length) return formatDecisao([], numero, total);
  const grupos = new Map();
  for (const d of docs) {
    const chave = d.data_fecho || d.data_julgamento || `sem data (id ${d.id})`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(d);
  }
  const ordenados = [...grupos.entries()].sort((a, b) => { const x = dataIso(a[0]), y = dataIso(b[0]); return x < y ? 1 : x > y ? -1 : 0; });
  const out = [`**Triagem do número ${docs[0].numero || numero}** (${ordenados.length} julgamento(s), ${docs.length} documento(s)` +
    (total > docs.length ? `; o portal informa ${total}, mostrando os primeiros` : "") +
    "). Modo triagem: resultado, tese, fatos e sinais, SEM a ementa nem o inteiro teor. Para ler, chame de novo sem `modo`; " +
    "para pôr trecho entre aspas, use o modo completo ou `verificar_citacao_trf1`. Indício para decidir o que ler, não citação."];
  for (const [data, ds] of ordenados) {
    const rep = ds.find((x) => fold(x.tipo || "").includes("acordao")) || ds[0];
    const conj = new Set();
    let emb = false;
    for (const x of ds) {
      const [c_, e_] = resultadoComEmbargos(x.decisao || "", x.classe || "");
      for (const k of c_) conj.add(k);
      emb = emb || e_;
    }
    const res = rotuloDocumento(conj, emb);
    const orgao = rep.orgao_fecho || rep.orgao || "órgão não informado";
    const linhas = [`### ${data} · Rel. ${rep.relator || "—"} · ${orgao} (${orgaoFonte(rep).split(" — ")[0]}) · ${rep.classe || rep.tipo || ""}`.replace(/[ ·]+$/, ""),
      `- Resultado declarado: ${res} (lido do dispositivo)`];
    const vot = votacaoDoDocumento(rep);
    if (vot) linhas.push(`- Votação declarada: ${vot}`);
    linhas.push("- Peças: " + ds.map((x) => `${x.tipo || "documento"} id ${x.id}` + (linkDocumentoEspecifico(x) ? ` (${linkDocumentoEspecifico(x)})` : "")).join(" · "));
    const cz = ds.some((x) => x.inteiro_teor_texto || x.inteiro_teor_embutido);
    linhas.push(`- Citação: ${citacaoComLink(rep)} — verificação: ${nivelVerificacao(rep, false, "triagem")}`);
    if (rep.decisao) linhas.push(`- Dispositivo (início, literal): «${trechoCentrado(rep.decisao, TRIAGEM_DISPOSITIVO_MAX)}»`);
    const te = teseDaEmenta(rep.ementa || "");
    if (te) linhas.push("- " + linhaTese(te));
    const lf = linhaFatos(ds.find((x) => x.inteiro_teor_texto) || rep);
    if (lf) linhas.push("- " + lf);
    for (const sl of linhasDeSinais(rep)) linhas.push(`- ${sl}`);
    if (ds.length > 1) for (const av of avisosOpostos(ds)) linhas.push(`- ${av}`);
    if (!cz) linhas.push("- Sem inteiro teor nesta base: o voto não é exposto pelo portal.");
    out.push(linhas.join("\n"));
  }
  for (const av of avisosEntreJulgamentos(docs)) out.push(av);
  return out.join("\n\n");
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
      return { valido: true, onde: nome, faltando: [], alertas: r.alertas, contexto: r.contexto, posicao: r.posicao || "", motivo: `trecho encontrado literalmente em: ${nome}` };
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

// O estado do disjuntor fica numa pasta do USUÁRIO (escrita garantida), nunca dentro da pasta da extensão: ela é reescrita a cada
// atualização e, no Windows, `new URL(import.meta.url).pathname` dava "\\C:\\...\\Claude%20Extensions" (relato de 12/10/2026).
function dirEstadoDisjuntor() {
  const cand = [process.env.TRF1_MCP_DIR_ESTADO, path.join(os.homedir(), ".trf1-jurisprudencia"),
                path.dirname(fileURLToPath(import.meta.url))].filter(Boolean);
  for (const d of cand) {
    try { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); fs.accessSync(d, fs.constants.W_OK); return d; } catch { /* tenta o próximo */ }
  }
  return cand[cand.length - 1];
}
let arquivoEstadoDisjuntor = path.join(dirEstadoDisjuntor(), ".disjuntor_estado_trf1.json");
let ultimoErroTrava = "";
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
      ultimoErroTrava = `${e.code || "erro"}${e.message ? `: ${String(e.message).slice(0, 120)}` : ""}`;
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
          `não consegui a trava do disjuntor (${arquivoEstadoDisjuntor}.lock — erro real: ${ultimoErroTrava || "desconhecido"}); sem trava não há como dividir o orçamento entre processos, e sem isso não há requisição (fail-closed). Não contornar por navegador, proxy ou outro cliente.`
        );
      }
    }
    const estado = lerEstadoDisjuntor();
    const resultado = fn(estado);
    const tmp = `${arquivoEstadoDisjuntor}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(estado));
      substituirArquivo(tmp, arquivoEstadoDisjuntor);
      persistenciaIndisponivel = null;
    } catch (e) {
      removerTmp(tmp);
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
      return { erro: `Muitas consultas em pouco tempo (limite atual: ${JANELA_MAX_REQS} requisições a cada ${fmtHms(janela)}, compartilhado por todos os processos desta extensão nesta máquina; cada busca gasta 2 a 4). Aguarde ${fmtHms(Math.max(1000, Math.ceil(espera / 1000) * 1000))} e tente de novo (esta tentativa não gastou requisição).` };
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
  let nRec = 0, nBusca = 0;
  try { nRec = fs.readdirSync(DIR_RECIBOS()).filter((f) => f.endsWith(".json") && !f.startsWith(".")).length; } catch { /* pasta pode não existir */ }
  try { if (fs.statSync(DIR_RECIBOS()).isDirectory()) nBusca = Object.keys(lerIndiceBusca(DIR_RECIBOS())).length; } catch { /* pasta pode não existir */ }
  const linhas = [
    `**Controle de ritmo do MCP TRF1 (portal do CJF) — v${VERSAO}**`,
    `- Nível atual: ${e.indiceJanela + 1} de ${ESCADA_JANELA_MS.length} (limite: ${JANELA_MAX_REQS} requisições a cada ${fmtHms(janela)}; cada busca gasta 2 a 4)`,
    `- Orçamento usado agora: ${naJanela}/${JANELA_MAX_REQS} nesta janela`,
    `- Requisições desde o início (nesta máquina): ${e.totalRequisicoes || 0}`,
    agora < e.bloqueadoAte
      ? `- ⚠️ EM PAUSA — liberando em ${fmtHms(e.bloqueadoAte - agora)}` + (e.motivoPausa ? ` (${e.motivoPausa})` : "")
      : "- Situação: liberado",
    `- User-Agent: ${process.env.TRF1_USER_AGENT ? "definido por TRF1_USER_AGENT" : "padrão (identificado)"}`,
    `- Recibos gravados em ${DIR_RECIBOS()}: ${nRec}` + (nBusca ? ` (${nBusca} de busca, sujeitos ao teto de ${Math.floor(recibosBuscaMaxBytes() / (1024 * 1024))} MB; os demais, de decisão)` : ""),
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

// --------------------------------------------------------------------------- //
// Livro-razão de requisições e relatório de ritmo (porte do TJRO v1.28.0)          //
// Cada requisição ao portal deixa UMA linha em ~/.trf1-jurisprudencia-ritmo.jsonl (0600, últimas 3.000):  //
//   {"t": instante em ms, "impl": "py"|"node", "pid": n, "id": "honesta"|"personalizada", "op": "busca"|"decisao"|…,  //
//    "res": "ok"|"bloqueio"|"desafio"|"http_NNN"|"timeout"|"rede"|"sessao"|"inesperada", "status": http|null, "durMs": n|null}  //
// NUNCA texto de busca, parte, relator nem número de processo. A extensão Python escreve no MESMO arquivo e formato (o campo `impl` as distingue). //
// Com ele se mede a taxa de falha por faixa de intervalo e a maior rajada sem falha. O relatório recomenda; nada é alterado automaticamente. //
// --------------------------------------------------------------------------- //
export const ARQUIVO_RITMO = (env = process.env) => env.TRF1_MCP_ARQUIVO_RITMO || path.join(os.homedir(), ".trf1-jurisprudencia-ritmo.jsonl");
const RITMO_MAX_LINHAS = 3000;
const RITMO_TAMANHO_PARA_RODAR = 700_000;
// sob `node --test` o livro-razão fica desligado (como o Python sob o selftest): teste nunca grava no arquivo real
let ritmoAtivo = !process.env.NODE_TEST_CONTEXT && !process.execArgv.includes("--test") && !process.argv.includes("--test");
export function _setRitmoAtivoParaTeste(v) { const a = ritmoAtivo; ritmoAtivo = Boolean(v); return a; }
export const RITMO_MIN_REQS_PARA_RECOMENDAR = 100;
const FAIXAS_S = [[0.0, 1.5, "< 1,5 s"], [1.5, 3.0, "1,5–3 s"], [3.0, 5.0, "3–5 s"], [5.0, 10.0, "5–10 s"], [10.0, 30.0, "10–30 s"], [30.0, Infinity, "≥ 30 s"]];
const RE_OP_RITMO = /^[a-z_]{1,24}$/;
const RE_RES_RITMO = /^(?:ok|bloqueio|desafio|timeout|rede|sessao|inesperada|http_\d{3})$/;

const pct = (a, b) => (b ? Math.trunc(100 * a / b + 0.5) : 0);
const fmtS = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1).replace(".", ","));
const identidadeNode = (env = process.env) => (env.TRF1_USER_AGENT ? "personalizada" : "honesta");

/** Acrescenta uma linha ao livro-razão. Nunca lança; desligado sob o teste, salvo `arquivo` explícito. */
export function ritmoAnotar(tMs, op, res, status = null, durMs = null, arquivo = null, env = process.env) {
  if (arquivo === null && !ritmoAtivo) return;
  try {
    arquivo = arquivo || ARQUIVO_RITMO(env);
    op = RE_OP_RITMO.test(String(op || "")) ? op : "?";
    res = RE_RES_RITMO.test(String(res || "")) ? res : "inesperada";
    const linha = JSON.stringify({ t: pyRound(tMs), impl: "node", pid: process.pid, id: identidadeNode(env), op, res,
      status: status === undefined ? null : status, durMs: durMs === null || durMs === undefined ? null : pyRound(durMs) });
    const fd = fs.openSync(arquivo, "a", 0o600);
    try { fs.writeSync(fd, linha + "\n"); } finally { fs.closeSync(fd); }
    if (fs.statSync(arquivo).size > RITMO_TAMANHO_PARA_RODAR) {
      const linhas = fs.readFileSync(arquivo, "utf-8").split("\n").filter(Boolean);
      const tmp = `${arquivo}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(tmp, linhas.slice(-RITMO_MAX_LINHAS).join("\n") + "\n", { mode: 0o600 });
        substituirArquivo(tmp, arquivo);
      } finally {
        removerTmp(tmp);
      }
    }
  } catch { /* o livro-razão nunca derruba uma consulta */ }
}

export function ritmoLer(arquivo = null, env = process.env) {
  try {
    const out = [];
    for (const linha of fs.readFileSync(arquivo || ARQUIVO_RITMO(env), "utf-8").split("\n")) {
      if (!linha) continue;
      let d;
      try { d = JSON.parse(linha); } catch { continue; }
      if (d && typeof d === "object" && !Array.isArray(d) && typeof d.t === "number" && Number.isFinite(d.t)) out.push(d);
    }
    return out.sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}

const ehFalhaRitmo = (r) => String(r.res || "") !== "ok";

/** Taxa de falha por faixa de intervalo desde a requisição anterior (qualquer origem), por desfecho e por origem, e a maior rajada em 60 s
 *  SEM nenhuma falha dentro da janela. Falha é todo desfecho diferente de "ok". */
export function analisarRitmo(ritmo, { espacamentoMinMs = ESPACAMENTO_MIN_MS, janelaMax = JANELA_MAX_REQS, agoraMs = null } = {}) {
  agoraMs = agoraMs === null || agoraMs === undefined ? Date.now() : agoraMs;
  const n = ritmo.length;
  const faixas = FAIXAS_S.map(([a, b, nome]) => ({ nome, de: a, ate: b, reqs: 0, falhas: 0 }));
  for (let k = 1; k < n; k++) {
    const gap = (ritmo[k].t - ritmo[k - 1].t) / 1000;
    const f = faixas.find((x) => x.de <= gap && gap < x.ate);
    f.reqs += 1;
    f.falhas += ehFalhaRitmo(ritmo[k]) ? 1 : 0;
  }
  const porDesfecho = new Map(), porOrigem = new Map();
  const soma = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const r of ritmo) {
    soma(porDesfecho, String(r.res || "?"));
    soma(porOrigem, String(r.impl || "?"));
  }
  // maior janela de 60 s sem falha: duas pontas, com a falha mais recente como piso
  let maxRajada = 0, ini = 0, ultimaFalha = -1;
  ritmo.forEach((r, k) => {
    if (ehFalhaRitmo(r)) { ultimaFalha = k; ini = k + 1; return; }
    while (ini < k && r.t - ritmo[ini].t > 60_000) ini++;
    maxRajada = Math.max(maxRajada, k - Math.max(ini, ultimaFalha + 1) + 1);
  });
  const inicio = n ? ritmo[0].t : null;
  const acima = faixas.filter((f) => f.de * 1000 >= espacamentoMinMs);
  const abaixo = faixas.filter((f) => f.ate * 1000 <= espacamentoMinMs);
  const som = (arr, c) => arr.reduce((t, f) => t + f[c], 0);
  return { n, falhas: ritmo.filter(ehFalhaRitmo).length, inicio,
    diasCobertos: inicio ? Math.max(1, Math.trunc((agoraMs - inicio) / 86_400_000 + 0.5)) : 0,
    faixas, porDesfecho, porOrigem, maxRajadaSemFalha: maxRajada,
    reqsAcima: som(acima, "reqs"), falhasAcima: som(acima, "falhas"), reqsAbaixo: som(abaixo, "reqs"), falhasAbaixo: som(abaixo, "falhas"),
    espacamentoMinMs, janelaMax };
}

export function recomendacaoRitmo(a) {
  const minimo = RITMO_MIN_REQS_PARA_RECOMENDAR;
  if (a.n < minimo) {
    return [`Dados insuficientes: ${a.n} requisições registradas (mínimo ${minimo} para recomendar mudança).`,
      "**Manter os parâmetros atuais.** O livro-razão acumula a cada consulta; rode este relatório de novo depois."];
  }
  const esp = fmtS(a.espacamentoMinMs / 1000);
  const out = [];
  if (a.falhasAcima === 0 && a.reqsAcima >= minimo) {
    out.push(`Com intervalo ≥ ${esp} s: ${a.reqsAcima} requisições, **nenhuma falha**. O espaçamento mínimo atual está adequado.`);
  } else if (a.falhasAcima > 0) {
    out.push(`Com intervalo ≥ ${esp} s ainda houve ${a.falhasAcima} falha(s) em ${a.reqsAcima} requisições (${pct(a.falhasAcima, a.reqsAcima)}%): ` +
      "o gatilho NÃO é só o espaçamento; veja o desfecho de cada falha (bloqueio, desafio, rede, timeout) e os incidentes do disjuntor.");
  }
  if (a.falhasAbaixo > 0) {
    out.push(`Com intervalo abaixo de ${esp} s: ${a.falhasAbaixo} falha(s) em ${a.reqsAbaixo} requisições (${pct(a.falhasAbaixo, a.reqsAbaixo)}%). Não reduzir o espaçamento.`);
  }
  out.push(`Maior rajada em 60 s SEM falha: ${a.maxRajadaSemFalha} requisições (teto configurado: ${a.janelaMax} por janela). ` +
    "Decisão sobre qualquer parâmetro é humana; este relatório não altera nada.");
  return out;
}

const ordenaPares = (m) => [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));

export function formatarRelatorioRitmo(a) {
  const utc = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().slice(0, 16).replace("T", " ");
  const L = ["**Relatório de ritmo do portal do CJF (livro-razão de requisições)**"];
  L.push(`- Livro-razão: ${a.n} requisições registradas` + (a.inicio ? ` desde ${utc(a.inicio)} UTC (${a.diasCobertos} dia(s))` : "") + `; falhas (desfecho diferente de ok): ${a.falhas}.`);
  L.push(`- Parâmetros atuais: espaçamento mínimo ${fmtS(a.espacamentoMinMs / 1000)} s; teto de ${a.janelaMax} requisições por janela.`);
  if (a.n) {
    L.push("- Origem das linhas: " + ordenaPares(a.porOrigem).map(([k, v]) => `${k} ${v}`).join(", ") + ".");
    L.push("\n**Taxa de falha por intervalo desde a requisição anterior (qualquer origem, qualquer processo desta máquina):**");
    L.push("| Intervalo | Requisições | Falhas | Taxa |");
    L.push("|---|---|---|---|");
    for (const f of a.faixas) L.push(`| ${f.nome} | ${f.reqs} | ${f.falhas} | ${f.reqs ? pct(f.falhas, f.reqs) + "%" : "—"} |`);
    L.push("\n**Por desfecho:** " + [...a.porDesfecho.entries()].sort((x, y) => (y[1] - x[1]) || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).map(([k, v]) => `${k} ${v}`).join(", ") + ".");
  }
  L.push("\n**Recomendação (a partir dos dados; nada é alterado automaticamente):**");
  for (const r of recomendacaoRitmo(a)) L.push(`- ${r}`);
  L.push("\n_Privacidade: o livro-razão guarda só horário, operação, origem e desfecho; nunca texto de busca, partes, relatores nem números de processo._");
  return L.join("\n");
}

export function relatorioDeRitmo(agoraSeg = null, arquivo = null, env = process.env) {
  return formatarRelatorioRitmo(analisarRitmo(ritmoLer(arquivo, env), { agoraMs: agoraSeg === null || agoraSeg === undefined ? null : agoraSeg * 1000 }));
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
export class CookieJar {
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

export async function requisitar(jar, metodo, url, operacao, { data, headers = {}, esperado = "html" } = {}, fetchImpl = fetch, env = process.env) {
  const reserva = reservarRequisicao();
  if (reserva.erro) throw new PesquisaNaoRealizada(reserva.erro);
  if (reserva.esperarMs > 0) await new Promise((r) => setTimeout(r, reserva.esperarMs));
  const h = { ...headersBase(env), ...headers };
  if (jar.cookies.size) h.Cookie = jar.cabecalho();
  const t0Ms = Date.now();
  let r;
  try {
    r = metodo === "GET"
      ? await fetchImpl(url, { headers: h, signal: AbortSignal.timeout(45_000) })
      : await fetchImpl(url, { method: "POST", headers: h, body: paresParaForm(data), signal: AbortSignal.timeout(45_000) });
  } catch (e) {
    const causa = e.cause?.code || e.cause?.message || ""; // "fetch failed" sozinho não diz se foi DNS, certificado, reset ou o portal fora
    ritmoAnotar(t0Ms, operacao, String(e.name || "").toLowerCase().includes("timeout") ? "timeout" : "rede", null, Date.now() - t0Ms, null, env);
    throw new PesquisaNaoRealizada(`falha de rede ao consultar o portal (${e.name}: ${e.message}${causa ? ` — causa: ${String(causa).slice(0, 120)}` : ""}) — tente de novo em instantes`);
  }
  jar.aplicar(r.headers);
  const ctype = (r.headers.get("content-type") || "").toLowerCase();
  // Response.text() do WHATWG fetch decodifica sempre como UTF-8, ignorando o charset do
  // Content-Type — o eproc da TNU declara "charset= ISO-8859-1" (mojibake real, 23/09/2026:
  // acentos viravam replacement char e derrubavam o reconhecimento do fecho). Decodifica pelo
  // charset declarado; sem um TextDecoder reconhecido, cai para utf-8.
  // v1.6.0: a leitura do corpo (rede/timeout no meio dele) e o decode ficam DENTRO do try — viram PesquisaNaoRealizada, como no Python,
  // e nunca "Erro de parâmetro (nada foi consultado)".
  let texto;
  try {
    const buf = await r.arrayBuffer();
    const mCharset = /charset\s*=\s*"?([\w-]+)"?/.exec(ctype);
    try {
      texto = new TextDecoder(mCharset ? mCharset[1] : "utf-8").decode(buf);
    } catch {
      texto = new TextDecoder("utf-8").decode(buf);
    }
  } catch (e) {
    const causa = e.cause?.code || e.cause?.message || "";
    ritmoAnotar(t0Ms, operacao, String(e.name || "").toLowerCase().includes("timeout") ? "timeout" : "rede", null, Date.now() - t0Ms, null, env);
    throw new PesquisaNaoRealizada(`falha de rede ao ler a resposta do portal (${e.name}: ${e.message}${causa ? ` — causa: ${String(causa).slice(0, 120)}` : ""}) — tente de novo em instantes`);
  }
  const durMs = Date.now() - t0Ms;
  const env_ = envelope(texto);
  const ehDesafio = ehDesafioNavegador(env_);
  const ehBloqueio = RE_BLOQUEIO_ANTIROBO.test(env_);
  if (ehDesafio || ehBloqueio || r.status === 403 || r.status === 429) {
    const campos = (data && !Array.isArray(data) ? data : Object.fromEntries(data || [])) || {};
    const operacaoReal = campos.nr_processo && !campos.query ? "inteiro_teor" : "busca";
    let esperaMinimaMs = 0;
    try { esperaMinimaMs = (Number(r.headers.get("retry-after")) || 0) * 1000; } catch { /* ok */ }
    const tipo = ehDesafio ? "desafio" : ehBloqueio ? "bloqueio" : "http";
    ritmoAnotar(t0Ms, operacao, tipo !== "http" ? tipo : `http_${r.status}`, r.status, durMs, null, env);
    registrarBloqueioDetectado(Date.now(), operacao || operacaoReal, { subirEscada: ehBloqueio && !ehDesafio, esperaMinimaMs, tipo });
    throw new PortalRecusou(diagnosticarResposta(r.status, ctype, texto, esperado));
  }
  if (RE_SESSAO_EXPIRADA.test(env_)) {
    ritmoAnotar(t0Ms, operacao, "sessao", r.status, durMs, null, env);
    throw new SessaoInvalida(diagnosticarResposta(r.status, ctype, texto, esperado));
  }
  if (r.status >= 400) {
    ritmoAnotar(t0Ms, operacao, `http_${r.status}`, r.status, durMs, null, env);
    throw new PesquisaNaoRealizada(diagnosticarResposta(r.status, ctype, texto, esperado));
  }
  if (esperado === "xml" && !texto.slice(0, 2000).includes("<partial-response")) {
    ritmoAnotar(t0Ms, operacao, "inesperada", r.status, durMs, null, env);
    throw new PesquisaNaoRealizada(diagnosticarResposta(r.status, ctype, texto, "XML <partial-response>"));
  }
  if (esperado === "html" && !texto.includes("javax.faces.ViewState")) {
    ritmoAnotar(t0Ms, operacao, "inesperada", r.status, durMs, null, env);
    throw new PesquisaNaoRealizada(diagnosticarResposta(r.status, ctype, texto, "a página do formulário"));
  }
  ritmoAnotar(t0Ms, operacao, "ok", r.status, durMs, null, env);
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
    ajuda = `\nSe persistir, relate: ${linkRelato(tipoDoErro(m))}` +
      "\n`diagnostico_erros_trf1` com relatorio=true gera o relatório técnico já sanitizado para colar na issue.";
  }
  return `[PESQUISA NÃO REALIZADA — ${m}]\nIsto NÃO é "não localizado": a consulta não chegou a ser feita ou não foi respondida. Registre a frente como pendente; use diagnostico_ritmo_trf1 antes de concluir que o portal está fora.${ajuda}`;
}
export function erroDeParametro(e) {
  return `Erro de parâmetro (nada foi consultado): ${e.message || e}\nCorrija a chamada e refaça — não registre como pesquisa realizada nem como "não localizado".`;
}

export function validarBase(base) {
  const b = (base || "trf1").trim().toLowerCase();
  if (!(b in BASES)) throw new ErroDeParametro(`base inválida: ${JSON.stringify(base)}; use 'trf1' (padrão), 'tnu' ou 'colegiado'`);
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
  if (inv.length) throw new ErroDeParametro(`tipo inválido para a base ${base}: ${JSON.stringify(inv)}; use ${JSON.stringify(permitidos)}`);
  return [...new Set(tipos)];
}
export function validarTipoAcordao(tipoAcordao, base) {
  if (!tipoAcordao || !tipoAcordao.length) return [];
  if (!BASES[base].tipoAcordao) throw new ErroDeParametro("tipo_acordao (REPRESENTATIVO/RELEVANTE) só existe na base 'tnu'");
  const vals = tipoAcordao.map((t) => String(t).toUpperCase().trim());
  const inv = vals.filter((v) => !(v in TIPOS_ACORDAO_TNU));
  if (inv.length) throw new ErroDeParametro(`tipo_acordao inválido: ${JSON.stringify(inv)}; use ${JSON.stringify(Object.keys(TIPOS_ACORDAO_TNU))}`);
  return [...new Set(vals)];
}
export function validarFontes(fonte) {
  const fontes = (fonte && fonte.length ? fonte : ["TRF1"]).map((f) => String(f).toUpperCase().trim());
  const inv = fontes.filter((f) => !FONTES_VALIDAS.includes(f));
  if (inv.length) throw new ErroDeParametro(`fonte inválida: ${JSON.stringify(inv)}; use ${JSON.stringify(FONTES_VALIDAS)}`);
  return [...new Set(fontes)];
}

export async function buscar(a, fetchImpl = fetch, env = process.env) {
  let base, tipos, fontes, tipoAcordaoV, pagina, porPagina, avancados = {}, consultaMontada;
  try {
    validarTamanho("consulta", a.consulta);
    base = validarBase(a.base);
    tipos = validarTipos(a.tipo, base);
    fontes = BASES[base].fonte ? validarFontes(a.fonte) : [];
    tipoAcordaoV = validarTipoAcordao(a.tipo_acordao, base);
    const tipoData = a.tipo_data || "julgamento";
    if (!(tipoData in { julgamento: 1, publicacao: 1 })) throw new ErroDeParametro(`tipo_data inválido: ${JSON.stringify(tipoData)}; use 'julgamento' ou 'publicacao'`);
    pagina = Math.max(1, Number(a.pagina || 1));
    porPagina = Number(a.por_pagina || 30);
    if (!POR_PAGINA_VALIDOS.includes(porPagina)) throw new ErroDeParametro(`por_pagina inválido: ${porPagina}; o portal aceita ${JSON.stringify(POR_PAGINA_VALIDOS)}`);
    if (a.origem && validarOrigem(String(a.origem))) throw new ErroDeParametro(validarOrigem(String(a.origem)));
    for (const [chave, valor] of [["relator", a.relator], ["orgao_julgador", a.orgao_julgador], ["classe", a.classe],
      ["origem", a.origem], ["numero", a.numero], ["ementa_decisao", a.ementa_decisao], ["referencia_legislativa", a.referencia_legislativa]]) {
      if (valor && String(valor).trim()) avancados[chave] = String(valor).trim();
    }
    if (a.data_inicio) avancados.data_inicio = normalizarData(String(a.data_inicio), "data_inicio");
    if (a.data_fim) avancados.data_fim = normalizarData(String(a.data_fim), "data_fim");
    if (Object.keys(avancados).length && !BASES[base].avancada) {
      throw new ErroDeParametro(`filtros (relator, órgão, classe, número, datas…) só existem na base 'trf1'; na base '${base}' use a sintaxe de campo na consulta: nome[REL], "turma"[ORGA], 20240101[DTDP]`);
    }
    consultaMontada = montarConsulta(a.consulta, a.grupos);
    if (!consultaMontada && !Object.keys(avancados).length && !tipoAcordaoV.length) {
      throw new ErroDeParametro("Informe a consulta, ou grupos de termos, ou pelo menos um filtro.");
    }
    const dados = await consultarPortal(consultaMontada, tipos, fontes, pagina, porPagina, avancados, tipoData, "busca", base, tipoAcordaoV, fetchImpl, env);
    gravarRecibosDaBusca(dados.docs, null, env);   // v1.6.0 (porte do TJRO v1.31, H01): a lista já trouxe o texto; guardar evita reabrir o número só para citar
    const meta = { consulta_montada: consultaMontada, tipos, fontes, pagina, por_pagina: porPagina, filtros: avancados,
      avisos: dados.avisos, base, tipo_acordao: tipoAcordaoV };
    return limitarSaidaBusca(formatBusca(dados.docs, dados.total, meta), SAIDA_MAX_CHARS, pagina, porPagina) + linhaDeRitmo();
  } catch (e) {
    if (e instanceof PesquisaNaoRealizada) return carimboNaoRealizada(String(e.message).trim().replace(/\.+$/, "") + dicaConsultaGrande(e.message, consultaMontada || "", a.grupos));
    // v1.6.0: só erro de validação é de parâmetro; o resto (rede, timeout na leitura do corpo, bug) é pesquisa NÃO realizada
    if (e instanceof ErroDeParametro) return erroDeParametro(e);
    return carimboNaoRealizada(`erro inesperado (${e.name}: ${e.message})`);
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

export async function obterDecisao(numero, base = "trf1", modo = "completo", fetchImpl = fetch, env = process.env) {
  const digitos = soDigitos(numero);
  if (digitos.length < 7) return `Número muito curto para localizar com segurança: ${JSON.stringify(numero)}.`;
  modo = pyStrip(modo || "completo").toLowerCase();
  if (!MODOS_DECISAO.includes(modo)) return erroDeParametro(`modo inválido: ${pyRepr(modo)}; use ${MODOS_DECISAO.map(pyRepr).join(" ou ")}`);
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
    if (e instanceof ErroDeParametro) return erroDeParametro(e);
    return carimboNaoRealizada(`erro inesperado (${e.name}: ${e.message})`);
  }
  const gravados = docs.map((d) => gravarRecibo(d, env)).filter(Boolean);
  const num = digitos.length === 20 ? cnj(digitos) : numero;
  let saida = modo === "triagem" ? formatTriagem(docs, num, dados.total) : formatDecisao(docs, num, dados.total);
  if (gravados.length) saida += `\nRecibo(s) gravado(s) em ${DIR_RECIBOS(env)} (${gravados.length}): o lint da peticao-rg e o revisor-adversarial conferem a ficha contra esse arquivo, sem nova requisição.`;
  for (const av of dados.avisos || []) saida = `⚠️ ${av}\n` + saida;
  return saida;
}

export async function verificarCitacao(numero, trecho, base = "trf1", fetchImpl = fetch, env = process.env) {
  const digitos = soDigitos(numero);
  if (digitos.length < 7) return `Número muito curto para localizar com segurança: ${JSON.stringify(numero)}.`;
  if (!(trecho || "").trim()) return "Informe o trecho que pretende citar entre aspas.";
  try { validarTamanho("trecho", trecho); } catch (e) { return erroDeParametro(e); }
  let origem = "portal", dados = {}, docs = [], soBusca = false;
  try {
    base = validarBase(base);
    // recibo local primeiro (0 requisições): o que o portal entregou da última vez, com sha256
    const recs = recibosDoProcesso(digitos, base, env);
    // TNU: recibo sem inteiro teor (inclusive o de busca) não serve para conferir voto: vai ao portal, como se não houvesse recibo
    if (recs.length && (base !== "tnu" || recs.every((r) => r.inteiro_teor))) {
      docs = recs.map((r) => docDeRecibo(r, env));
      dados = { avisos: [], total: docs.length };
      origem = "recibo local";
      // v1.6.0 (porte do TJRO v1.31): recibo gravado só pela BUSCA não prova que o processo esteja completo (a lista traz só os
      // documentos que casaram). Se o trecho está nele, vale; se não está, a ausência NÃO se conclui: lê o número inteiro no portal.
      if (recs.every((r) => r.origem === "busca")) {
        const rot = BASES[base].rotulo;
        if (docs.some((d_) => verificarTrecho({ ementa: d_.ementa || "", dispositivo: d_.decisao || "", "inteiro teor": d_.inteiro_teor_texto || "" }, trecho, rot).valido)) {
          origem = "recibo local (de busca; o processo pode ter outros documentos)";
        } else {
          docs = []; soBusca = true;
        }
      }
    }
    if (!docs.length) {
      [dados, docs] = await localizarPorNumero(numero, base, "verificacao", true, fetchImpl, env);
      origem = "portal";
      for (const d of docs) gravarRecibo(d, env);
    }
  } catch (e) {
    if (e instanceof PesquisaNaoRealizada) {
      return carimboNaoRealizada(String(e.message).trim().replace(/\.+$/, "") + (soBusca
        ? ". Só há recibos de BUSCA para este número, e o trecho não está neles: isso não prova que esteja fora do processo, " +
          "porque a busca traz só os documentos que casaram" : ""));
    }
    if (e instanceof ErroDeParametro) return erroDeParametro(e);
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
    if (r.valido && r.posicao) linhas.push(`   ℹ POSIÇÃO NO JULGADO: ${r.posicao}.`);
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

// ------------------------------------------------- busca nos recibos locais (0 requisição) ---
// Porte do buscar_recibos_tjro / _buscar_recibos do servidor Python (v1.5.0).
export const RECIBOS_LIMITE_MAX = 30, RECIBOS_GRUPOS_MAX = 6, RECIBOS_TERMOS_POR_GRUPO_MAX = 12;
const STOP_RECIBOS = new Set(["a", "o", "e", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas", "por", "para", "com", "um", "uma", "que", "se", "ao", "aos"]);

/** _regex_termo: `$`/`*` no fim = radical; frase com espaço = palavras vizinhas, em ordem. */
export function regexTermo(t) {
  const s = norm(String(t || "")).trim();
  const radical = s.endsWith("$") || s.endsWith("*");
  const partes = s.split(/[^a-z0-9]+/).filter(Boolean);
  if (!partes.length) return null;
  return new RegExp("(?<![a-z0-9])" + partes.join("[^a-z0-9]+") + (radical ? "" : "(?![a-z0-9])"));
}
const contarRe = (rx, tn) => (tn.match(new RegExp(rx.source, "g")) || []).length;

export function listarRecibos(pasta = null, env = process.env) {
  const dirPadrao = DIR_RECIBOS(env);
  const dir = pasta || dirPadrao;
  let nomes;
  try { nomes = fs.readdirSync(dir).sort(); } catch { return []; }
  const out = [];
  for (const nome of nomes) {
    if (!nome.endsWith(".json")) continue;
    let rec = null;
    if (dir === dirPadrao) rec = lerRecibo(nome.slice(0, -5), env);
    else {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(dir, nome), "utf-8"));
        if (r && typeof r === "object" && typeof r.texto === "string" &&
          crypto.createHash("sha256").update(r.texto, "utf-8").digest("hex") === r.sha256) rec = r;
      } catch { rec = null; }
    }
    if (rec && rec.id_documento) {
      const c = { ...rec };
      for (const campo of ["id_documento", "nr_processo", "numero", "base", "tipo", "classe", "orgao", "orgao_fonte", "relator", "relator_texto",
        "data_julgamento", "obtido_em", "inteiro_teor", "ementa", "dispositivo", "origem"]) {
        const v = c[campo];
        c[campo] = typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
      }
      c._tn = norm(c.inteiro_teor || c.texto);
      out.push(c);
    }
  }
  return out;
}

export function trechoEmVolta(texto, tn, rx, largura = 160) {
  if (!rx) return "";
  const m = rx.exec(tn);
  if (!m) return "";
  const i = tn.length === texto.length ? m.index : Math.max(0, Math.trunc(m.index * texto.length / Math.max(1, tn.length)));
  return texto.slice(Math.max(0, i - largura), i + largura).replace(/\s+/g, " ").trim();
}

// --- Consulta em linguagem natural: ranking BM25 sobre a ementa (porte do TJRO v1.37) ---
// O E de TODAS as palavras de um relato de fatos quase sempre dá zero (o TJRO mediu zero nas 40 consultas de teste). Com 3+ palavras e zero
// no E, devolve os recibos com MAIS delas: BM25 (k1 1,2; b 0,75) sobre a ementa, por palavra e por par de palavras vizinhas (peso 1,5).
// Medido offline em 17/10/2026 no servidor Python: 20 consultas de relato de fatos, escritas a partir de ementas sorteadas dos 141 recibos locais;
// o julgado de origem ficou no top 10 em 19 e no top 3 em 18. Corpus pequeno e consultas escritas por quem conhecia a ementa: indício, não validação cega.
export const RECIBOS_BM25_MEDIDA = "em 20 consultas de teste em linguagem natural, pôs o julgado certo no top 10 em 19 e no top 3 em 18; o E de todas as palavras deu zero nas 20";
export const BM25_MIN_PALAVRAS = 3;
export const BM25_MIN_LETRAS = 4;
export const BM25_EMENTA_MAX = 6000;
export const BM25_K1 = 1.2, BM25_B = 0.75, BM25_PESO_PAR = 1.5;
const STOP_BM25 = new Set(("para pela pelo pelos pelas como mais pois sobre entre sendo seja sejam este esta estes estas esse essa isso isto aquele aquela quando onde " +
  "qual quais cujo cuja cujos cujas assim ainda tambem porem contudo todavia entretanto portanto logo entao apenas mesmo mesma mesmos mesmas " +
  "outro outra outros outras cada todo toda todos todas nada tudo muito muita muitos muitas pouco pouca desde apos antes depois durante conforme " +
  "segundo mediante perante contra atraves acerca junto face nos nas dos das uma uns umas nesse nessa neste nesta deste desta desse dessa sido " +
  "foram sera serao seria seriam tendo haver havendo houve fica ficam ficou deve devem devendo pode podem podendo sem sob com ela ele seu sua " +
  "seus suas foi tem ser nao que por aos").split(" "));
const ROMANO_BM25 = /^[ivxlcdm]+$/;
const IDX_BM25 = new Map();

/** Palavras do texto, sem acento: BM25_MIN_LETRAS+ letras, só letras (sem algarismo), sem palavra de ligação e sem algarismo romano. */
export function palavrasBm25(texto) {
  const out = [];
  for (const w of String(texto || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
    const f = fold(w);
    if (f.length < BM25_MIN_LETRAS || !/^[a-z]+$/.test(f) || STOP_BM25.has(f) || ROMANO_BM25.test(f)) continue;
    out.push(f);
  }
  return out;
}

const q6 = (x) => Math.floor(x * 1e6 + 0.5);

function docBm25(r) {
  const k = `${r.id_documento}:${cpLen(r.ementa || "")}:${cpLen(r.texto || "")}`;
  let v = IDX_BM25.get(k);
  if (v === undefined) {
    if (IDX_BM25.size > 20000) IDX_BM25.clear();
    const t = palavrasBm25(cpSlice(r.ementa || r.texto || "", BM25_EMENTA_MAX));
    const tf = new Map(), tfb = new Map();
    for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
    for (let i = 0; i < t.length - 1; i++) { const b = `${t[i]}_${t[i + 1]}`; tfb.set(b, (tfb.get(b) || 0) + 1); }
    v = { len: t.length, tf, tfb };
    IDX_BM25.set(k, v);
  }
  return v;
}

/** [[recibo, nota×10^6]] dos `limite` melhores por BM25 (palavras e pares vizinhos da consulta sobre a ementa). Vazio se a consulta tem
 *  menos de BM25_MIN_PALAVRAS palavras úteis ou nenhum recibo pontua. Desempate: data de julgamento mais recente, depois id. */
export function rankearPorConsulta(consulta, recibos, limite = 10) {
  const q = palavrasBm25(consulta);
  if (q.length < BM25_MIN_PALAVRAS || !recibos.length) return [];
  const qb = []; for (let i = 0; i < q.length - 1; i++) qb.push(`${q[i]}_${q[i + 1]}`);
  const docs = recibos.map((r) => [r, docBm25(r)]);
  const n = docs.length;
  const avg = docs.reduce((t, [, d]) => t + d.len, 0) / n || 1;
  const uq = [...new Set(q)], uqb = [...new Set(qb)];
  const df = new Map(uq.map((w) => [w, docs.filter(([, d]) => d.tf.has(w)).length]));
  const dfb = new Map(uqb.map((w) => [w, docs.filter(([, d]) => d.tfb.has(w)).length]));
  const peso = (f, ln) => (f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * ln) / avg));
  const out = [];
  for (const [r, d] of docs) {
    let sc = 0.0;
    for (const w of uq) {
      const f = d.tf.get(w);
      if (f) sc += Math.log(1 + (n - df.get(w) + 0.5) / (df.get(w) + 0.5)) * peso(f, d.len);
    }
    for (const w of uqb) {
      const f = d.tfb.get(w);
      if (f) sc += BM25_PESO_PAR * Math.log(1 + (n - dfb.get(w) + 0.5) / (dfb.get(w) + 0.5)) * peso(f, d.len);
    }
    if (sc > 0) out.push([r, q6(sc)]);
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);   // sort() do JS é estável, como o do Python
  out.sort((x, y) => cmp(String(x[0].id_documento), String(y[0].id_documento)));
  out.sort((x, y) => cmp(dataIso(y[0].data_julgamento || ""), dataIso(x[0].data_julgamento || "")));
  out.sort((x, y) => y[1] - x[1]);
  return out.slice(0, limite);
}

export function buscarRecibos(a = {}, env = process.env) {
  const { consulta, grupos, limite = 10, pasta = null, nr_processo: nrProcesso = "", id_documento: idDocumento = "", relator = "", base = "" } = a;
  validarTamanho("consulta", consulta);
  const palavras = norm(String(consulta || "")).split(/[^a-z0-9*$]+/).filter((p) => p && p.replace(/[*$]+$/, "") && !STOP_RECIBOS.has(p.replace(/[*$]+$/, "")));
  const gs = [];
  if (Array.isArray(grupos)) {
    for (const g of grupos.filter((g) => Array.isArray(g) && g.length).slice(0, RECIBOS_GRUPOS_MAX)) {
      const termos = g.map((x) => String(x || "").trim()).filter((t) => t && /[A-Za-z0-9À-ÿ]/.test(t)).slice(0, RECIBOS_TERMOS_POR_GRUPO_MAX);
      if (termos.length) gs.push(termos);
    }
  }
  const dig = soDigitos(String(nrProcesso || ""));
  const idDoc = String(idDocumento || "").trim();
  if (idDoc && !/^[A-Za-z0-9]{1,40}$/.test(idDoc)) return `BUSCA LOCAL NÃO REALIZADA — id_documento inválido (recebi «${idDoc.slice(0, 40)}»).`;
  if (String(nrProcesso || "").trim() && dig.length < 7) return "BUSCA LOCAL NÃO REALIZADA — nr_processo precisa de pelo menos 7 dígitos (número CNJ, com ou sem máscara, ou o início dele).";
  const relN = norm(String(relator || "")).replace(/[^a-z0-9]+/g, " ").trim();
  const b = String(base || "").trim().toLowerCase();
  if (b && !(b in BASES)) return `BUSCA LOCAL NÃO REALIZADA — base deve ser uma de ${Object.keys(BASES).join(", ")}.`;
  if (!palavras.length && !gs.length && !dig && !idDoc && !relN) {
    return "BUSCA LOCAL NÃO REALIZADA — informe `consulta` (palavras), `grupos` (sinônimos), `nr_processo`, `id_documento` ou `relator`.";
  }
  let lim = Number.parseInt(limite, 10);
  if (!Number.isFinite(lim)) lim = 0;
  lim = Math.max(1, Math.min(lim || 10, RECIBOS_LIMITE_MAX));
  let todos = listarRecibos(pasta, env);
  const totalGeral = todos.length;
  if (b) todos = todos.filter((r) => (r.base || "trf1") === b);
  if (idDoc) todos = todos.filter((r) => String(r.id_documento) === idDoc);
  if (dig) todos = todos.filter((r) => { const nd = soDigitos(String(r.nr_processo || "")); return Boolean(nd) && (nd === dig || (dig.length < 20 && nd.startsWith(dig))); });
  if (relN) todos = todos.filter((r) => norm(`${r.relator || ""} ${r.relator_texto || ""}`).replace(/[^a-z0-9]+/g, " ").includes(relN));
  const resP = palavras.map(regexTermo).filter(Boolean);
  const resG = gs.map((grp) => grp.map(regexTermo).filter(Boolean)).filter((g) => g.length);
  let achados = [];
  for (const r of todos) {
    const tn = r._tn;
    if (!resP.every((p) => p.test(tn))) continue;
    if (!resG.every((g) => g.some((p) => p.test(tn)))) continue;
    const soma = resP.reduce((s, p) => s + contarRe(p, tn), 0) + resG.flat().reduce((s, p) => s + contarRe(p, tn), 0);
    achados.push([soma / Math.log(tn.length + 10), dataIso(r.data_julgamento || ""), r]);
  }
  achados.sort((x, y) => (x[1] < y[1] ? 1 : x[1] > y[1] ? -1 : 0));
  achados.sort((x, y) => y[0] - x[0]);
  // E de todas as palavras deu zero com consulta em linguagem natural: devolve os que têm MAIS delas (ranking BM25 sobre a ementa), dizendo isso
  let ranqueado = false;
  if (!achados.length && !gs.length && !dig && !idDoc && palavras.length >= BM25_MIN_PALAVRAS && todos.length) {
    for (const [r_, sc] of rankearPorConsulta(consulta, todos, lim)) achados.push([sc, dataIso(r_.data_julgamento || ""), r_]);
    ranqueado = achados.length > 0;
  }
  const filtroTxt = [
    dig ? `processo ${dig.length === 20 ? cnj(dig) : dig + "…"}` : "", idDoc ? `id ${idDoc}` : "",
    relN ? `relator «${String(relator).trim()}»` : "", b ? `base ${b}` : ""].filter(Boolean).join(", ");
  const termosMostrados = [...palavras, ...gs.flat()].join(", ") || "(sem termos)";
  const linhas = [
    (ranqueado
      ? `**Recibos locais do TRF1/TNU — nenhum dos ${totalGeral} documento(s) já lidos tem TODAS as palavras de «${termosMostrados}»; abaixo, os ` +
        `${achados.length} que têm MAIS delas (ranking BM25 sobre a ementa, palavras e pares vizinhos; ${RECIBOS_BM25_MEDIDA}) · ZERO requisição ao portal**`
      : `**Recibos locais do TRF1/TNU — ${achados.length} de ${totalGeral} documento(s) já lidos nesta máquina atendem a «${termosMostrados}»` +
        `${filtroTxt ? " em " + filtroTxt : ""} · ZERO requisição ao portal**`),
    "⚠️ Isto NÃO é pesquisa no acervo do CJF: só olha o que a busca e obter_decisao_trf1 já trouxeram para esta máquina. Zero aqui NUNCA é " +
      "\"não localizado\" — para isso, buscar_jurisprudencia_trf1. Recibo da base trf1 guarda ementa e dispositivo (sem voto); o inteiro teor só existe nos recibos da TNU " +
      "(lidos por obter_decisao_trf1) e do colegiado (embutido no resultado). Recibo de BUSCA guarda só o que a lista trouxe (na TNU, sem inteiro teor) e não prova que o processo esteja completo.",
    "",
  ];
  if (!todos.length) linhas.push(`_(nenhum recibo em ${pasta || DIR_RECIBOS(env)})_`);
  achados.slice(0, lim).forEach(([, , r], i) => {
    const vot = votacaoDoDocumento(docDeRecibo(r, env));
    linhas.push(
      `${i + 1}. ${r.tipo || "?"}${r.classe ? " " + r.classe : ""} · ${r.orgao || "órgão não registrado"} (${r.orgao_fonte || "?"}) ` +
      `· julgado em ${r.data_julgamento || "?"} · Rel. ${r.relator_texto || r.relator || "—"} · ${r.numero || cnj(r.nr_processo || "")} ` +
      `· id ${r.id_documento} · base ${r.base || "trf1"}` + (vot ? ` · 🗳️ ${vot}` : ""));
    const pat = resP.length ? resP[0] : resG.length ? resG[0][0] : null;
    const tre = trechoEmVolta(r.inteiro_teor || r.texto, r._tn, pat);
    if (tre) linhas.push(`   «…${tre}…»`);
    const cust = r.inteiro_teor_incluido ? `inteiro teor ${(BASES[r.base || "trf1"] || BASES.trf1).rotulo} incluído` : "só ementa/dispositivo (sem voto)";
    const orig = r.origem === "busca" ? "da busca" : "de decisão (obter_decisao_trf1)";
    linhas.push(`   recibo ${orig}, lido do portal em ${String(r.obtido_em || "?").slice(0, 16).replace("T", " ")} · ${cust}`);
  });
  if (achados.length > lim) linhas.push(`\n_(mais ${achados.length - lim} recibo(s) atendem; aumente \`limite\` até ${RECIBOS_LIMITE_MAX} ou refine os termos)_`);
  linhas.push("\nPara conferir uma frase antes das aspas: verificar_citacao_trf1(numero, trecho) — usa o recibo, 0 requisições. " +
    "Para a ementa e o dispositivo integrais: obter_decisao_trf1(numero).");
  return linhas.join("\n");
}

// ------------------------------------------------------------ diário local de erros ---
// Só dado técnico: NUNCA texto de busca, grupos, nome de relator/parte nem número de processo. O registro jamais quebra uma ferramenta.
export const ARQUIVO_ERROS = (env = process.env) => env.TRF1_MCP_ARQUIVO_ERROS || path.join(os.homedir(), ".trf1-jurisprudencia-erros.jsonl");
const MAX_LINHAS_ERROS = 500, MAX_BYTES_ERROS = 400_000;
const VALORES_SEGUROS = new Set(["tipo", "tipo_acordao", "fonte", "base", "tipo_data", "pagina", "por_pagina", "limite", "dias", "modo"]);
const LISTA_BRANCA = { tipo: new Set(["ACORDAO", "SUMULA", "ARGUICAO", "DECISAOMONO", "DECISAOPRES"]), tipo_acordao: new Set(["REPRESENTATIVO", "RELEVANTE"]),
  fonte: new Set(["TRF1", "JEF1"]), base: new Set(["trf1", "tnu", "colegiado"]), tipo_data: new Set(["julgamento", "publicacao"]),
  modo: new Set(["completo", "triagem"]) };
export const VERSAO_SERVIDOR = `node-${VERSAO}`;
const RE_MARC_PARCIAL = /\[PESQUISA (?:NÃO REALIZADA|INCOMPLETA)\b/;

/** O campo "Origem" do portal é o TRIBUNAL de origem ("TRF - PRIMEIRA REGIÃO"); UF e seção judiciária nunca casam (medido 12/10/2026). Recusa antes de gastar requisição. */
export function validarOrigem(v) {
  const f = fold(v).trim();
  if (/^[a-z]{2}$/.test(f) || /(secao|subsecao|judiciari|rondonia|estado de)/.test(f)) {
    return `o filtro origem não aceita estado nem seção judiciária ("${v.slice(0, 40)}"): ele casa o TRIBUNAL de origem ("TRF - PRIMEIRA REGIÃO"). Nada foi consultado. Refaça sem origem; a unidade aparece nos 4 últimos dígitos do número CNJ de cada resultado (ex.: .4.01.4100).`;
  }
  return "";
}

export function tipoDoErroDiario(m) {
  m = String(m ?? "");
  if (/disjuntor em pausa|Muitas consultas|Fila de espera|fail-closed|evitando novas tentativas/i.test(m)) return "limite_de_ritmo";
  if (/desafio|verifica[çc][ãa]o de navegador|cloudflare|just a moment/i.test(m)) return "desafio_navegador";
  if (/recusa sistem[áa]tica|bloque|robotiza|automa[çc][ãa]o|HTTP 40[39]|HTTP 429/i.test(m)) return "bloqueio_do_portal";
  if (/Muitos Usu[áa]rios/i.test(m)) return "portal_congestionado";
  if (/tempo esgotado|timed? ?out/i.test(m)) return "timeout";
  const mm = /\bHTTP (\d{3})\b|Server error '(\d{3})/.exec(m);
  if (mm) return "http_" + (mm[1] || mm[2]);
  if (/certificate|CERT_|SSL|TLS|self[- ]signed|UNABLE_TO_VERIFY/i.test(m)) return "certificado";
  if (/getaddrinfo|ENOTFOUND|EAI_AGAIN|Name or service|ECONNREFUSED|Connection refused|ENETUNREACH|EHOSTUNREACH/i.test(m)) return "dns_ou_rede_local";
  if (/ConnectError|ReadError|ECONNRESET|ECONN|Connection reset|UND_ERR|socket|fetch failed/i.test(m)) return "conexao_interrompida";
  if (/sess[ãa]o|ViewState|resposta inesperada|n[ãa]o reconhec/i.test(m)) return "resposta_inesperada";
  return "outro";
}

export function sanitizar(texto, maximo = 300) {
  let t = String(texto ?? "").slice(0, 2000);   // red team 12/10/2026: regex sobre entrada ilimitada travava o servidor
  t = t.replace(/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g, "<nº-processo>");
  t = t.replace(/\b\d{1,7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g, "<nº-processo>");
  t = t.replace(/\b\d{4}\.\d{2}\.\d{2}\.\d{5,7}-?\d?\b/g, "<nº-processo>");
  t = t.replace(/\d[\d.\-/]{8,40}\d/g, "<nº>");
  t = t.replace(/\b\d{7,}\b/g, "<nº>");
  t = t.replace(/[\w.+-]{1,64}@[\w-]{1,63}\.[\w.-]{1,100}/g, "<email>");
  t = t.replace(/https?:\/\/[^\s)"']{1,300}/g, (u) => u.replace(/[?#;].*$/, ""));
  t = t.replace(/["“”][^"“”\n]{4,200}["“”]/g, "«…»");
  t = t.replace(/'[^'\n]{4,200}'/g, "«…»");
  t = t.replace(/«(?!…»)[^»\n]{1,200}»/g, "«…»");
  return t.replace(/\s+/g, " ").trim().slice(0, maximo);
}

const nomeTipo = (v) => (typeof v === "boolean" ? "bool" : typeof v === "number" ? (Number.isInteger(v) ? "int" : "float") : typeof v === "object" ? "dict" : typeof v);
export function descreverArgs(args) {
  const out = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
    if (VALORES_SEGUROS.has(k) && (typeof v === "number" || typeof v === "boolean" || typeof v === "string" || Array.isArray(v))) {
      const ok = LISTA_BRANCA[k];
      const FORA = "<valor fora da lista>";
      const conv = (x) => ((typeof x === "string" || Number.isInteger(x)) ? (!ok || ok.has(String(x)) ? x : FORA) : FORA);
      out[k] = Array.isArray(v) ? v.map(conv).slice(0, 10) : conv(v);
      if (!ok) out[k] = Array.isArray(out[k]) ? out[k].filter(Number.isInteger) : Number.isInteger(out[k]) ? out[k] : FORA;
    } else if (Array.isArray(v)) {
      out[k] = Array.isArray(v[0]) ? `${v.length} grupo(s), ${v.reduce((s, g) => s + (g?.length || 0), 0)} termo(s)` : `${v.length} item(ns)`;
    } else if (typeof v === "string") {
      out[k] = `<texto: ${v.length} car.>`;
    } else {
      out[k] = nomeTipo(v);
    }
  }
  return out;
}

export function registrarErro(ferramenta, { erro = null, texto = "", args = null, ms = null, parcial = false } = {}, env = process.env) {
  try {
    const msg = erro !== null && erro !== undefined ? String(erro?.message ?? erro) : String(texto || "");
    const mh = /\bHTTP (\d{3})\b|Server error '(\d{3})/.exec(msg);
    let lim = null;
    try {
      const e = comTrava(() => lerEstadoDisjuntor());
      const agora = Date.now();
      lim = { nivel: e.indiceJanela + 1, de: ESCADA_JANELA_MS.length,
        ultimoMinuto: (e.requisicoes || []).filter((t) => agora - t <= 60_000).length, bloqueios: (e.incidentes || []).length };
    } catch { lim = null; }
    const entrada = {
      quando: new Date().toISOString(), versao: VERSAO_SERVIDOR, sistema: `${process.platform} node ${process.versions.node}`,
      ferramenta, tipo: tipoDoErroDiario(msg), http: mh ? (mh[1] || mh[2]) : null, parcial, ms,
      args: descreverArgs(args), limitador: lim, mensagem: sanitizar(msg),
    };
    const arq = ARQUIVO_ERROS(env);
    const fd = fs.openSync(arq, "a", 0o600);
    try { fs.writeSync(fd, JSON.stringify(entrada) + "\n"); } finally { fs.closeSync(fd); }
    try {
      if (fs.statSync(arq).size > MAX_BYTES_ERROS) {
        const ls = fs.readFileSync(arq, "utf-8").split("\n").filter(Boolean);
        fs.writeFileSync(arq, ls.slice(-MAX_LINHAS_ERROS).join("\n") + "\n");
      }
    } catch { /* melhor esforço */ }
    return entrada;
  } catch {
    return null;
  }
}

/** _diario: anota exceção e resposta de falha ([PESQUISA NÃO REALIZADA/INCOMPLETA]); nunca quebra a ferramenta.
 * Falha de ritmo LOCAL (disjuntor, fila) não é anotada: é o limitador funcionando, não erro. */
export function comDiario(nome, fn, env = process.env) {
  return async (a) => {
    const t0 = Date.now();
    let r;
    try {
      r = await fn(a);
    } catch (e) {
      registrarErro(nome, { erro: e, args: a, ms: Date.now() - t0 }, env);
      throw e;
    }
    try {
      if (nome !== "diagnostico_erros_trf1" && typeof r === "string" && RE_MARC_PARCIAL.test(r) && tipoDoErroDiario(r) !== "limite_de_ritmo") {
        const mm = /^\s*\[([^\]]{0,400})\]/.exec(r);   // só o motivo entre colchetes: o corpo da resposta traz consulta e filtros
        registrarErro(nome, { texto: mm ? `[${mm[1]}]` : "[PESQUISA NÃO REALIZADA]", args: a, ms: Date.now() - t0, parcial: r.slice(0, 40).includes("INCOMPLETA") }, env);
      }
    } catch { /* o registro nunca quebra a ferramenta */ }
    return r;
  };
}

const CAUSAS_ERRO = {
  limite_de_ritmo: ["Muitas consultas na janela do limitador local.", "Espere o tempo indicado; use `buscar_recibos_trf1` para o que já foi lido.", "usuario"],
  bloqueio_do_portal: ["O portal do CJF recusou ou bloqueou a consulta.", "Espere a pausa terminar e faça UMA busca; o site jurisprudencia.cjf.jus.br segue como alternativa. Se repetir com pouco tráfego, a causa é externa.", "portal"],
  desafio_navegador: ["O portal pediu verificação de navegador (Cloudflare/WAF).", "Use o site pelo navegador; esta extensão não contorna.", "portal"],
  portal_congestionado: ["O portal respondeu \"Muitos Usuários\" (congestionamento do CJF).", "Tente de novo em alguns minutos; não é erro da extensão.", "portal"],
  timeout: ["O portal demorou mais que o limite.", "Repita com por_pagina menor ou mais tarde.", "portal"],
  certificado: ["Certificado TLS recusado (antivírus, proxy ou data do computador errada).", "Verifique a data/hora do computador e se há antivírus ou proxy inspecionando HTTPS.", "usuario"],
  dns_ou_rede_local: ["Sem rede, DNS ou rota até o portal (lado do seu computador).", "Confira a internet/VPN/proxy; teste o portal no navegador.", "usuario"],
  conexao_interrompida: ["A conexão caiu no meio: pode ser o portal fora do ar ou a rede.", "Espere alguns minutos e tente UMA vez; se o portal abre no navegador e a extensão não, relate com o relatório.", "portal"],
  rede_ou_certificado_antigo: ["Falha de rede, DNS ou certificado.", "Confira a conexão/VPN/proxy. Se só esta extensão falha, relate.", "usuario"],
  resposta_inesperada: ["O portal respondeu num formato que a extensão não reconhece.", "Pode ser mudança no portal: envie o relatório ao autor.", "autor"],
  outro: ["Erro não classificado.", "É o mais útil para o autor: envie o relatório.", "autor"],
};
export function causaErro(tipo) {
  if (tipo in CAUSAS_ERRO) return CAUSAS_ERRO[tipo];
  if (tipo.startsWith("http_5")) return ["O portal respondeu erro de servidor.", "Repita depois; se só acontece com certos filtros, pode ser consulta mal formada (relate).", "portal"];
  if (tipo.startsWith("http_4")) return ["O portal recusou a requisição (4xx).", "Provável filtro com grafia errada ou consulta mal formada: relate.", "autor"];
  return CAUSAS_ERRO.outro;
}

export function lerErros(dias = 30, env = process.env) {
  try {
    const corte = Date.now() - dias * 86400_000;
    const out = [];
    for (const l of fs.readFileSync(ARQUIVO_ERROS(env), "utf-8").split("\n")) {
      try {
        const e = JSON.parse(l);
        if (new Date(e.quando).getTime() >= corte) out.push(e);
      } catch { continue; }
    }
    return out;
  } catch {
    return [];
  }
}

const p2 = (n) => String(n).padStart(2, "0");
export function fmtDataLocal(iso) {
  const d = new Date(iso);
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
// json.dumps do Python (separadores ", " e ": ", sem escapar não-ASCII)
export function jsonPy(v) {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return "[" + v.map(jsonPy).join(", ") + "]";
  if (typeof v === "object") return "{" + Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${jsonPy(x)}`).join(", ") + "}";
  return JSON.stringify(v);
}

export function resumirErros(ent, limite = 15, env = process.env) {
  if (!ent.length) return "Nenhum erro registrado no período. O diário só anota falhas das ferramentas (nunca o que foi pesquisado).";
  const grupos = new Map();
  for (const e of ent) {
    const chave = `${e.tipo}\u0000${e.ferramenta}`;
    if (!grupos.has(chave)) grupos.set(chave, { tipo: e.tipo, ferramenta: e.ferramenta, n: 0, parciais: 0, primeiro: e.quando, ultimo: e.quando, versoes: new Set(), amostra: e });
    const g = grupos.get(chave);
    g.n += 1;
    g.parciais += e.parcial ? 1 : 0;
    g.versoes.add(String(e.versao));
    if (e.quando < g.primeiro) g.primeiro = e.quando;
    if (e.quando >= g.ultimo) { g.ultimo = e.quando; g.amostra = e; }
  }
  const lista = [...grupos.values()].sort((a, b) => b.n - a.n);
  const out = [`**Diário de erros** — ${ent.length} registro(s) em ${lista.length} padrão(ões), de ${fmtDataLocal(ent[0].quando)} a ${fmtDataLocal(ent[ent.length - 1].quando)}. Arquivo: ${ARQUIVO_ERROS(env)}`, ""];
  for (const g of lista.slice(0, Math.max(1, limite))) {
    const [causa, acao, quem] = causaErro(g.tipo);
    const a = g.amostra;
    out.push(`- **${g.tipo}** em \`${g.ferramenta}\` · ${g.n}× (${g.parciais} parcial/incompleto) · de ${fmtDataLocal(g.primeiro)} a ${fmtDataLocal(g.ultimo)} · ${[...g.versoes].sort().join(", ")}\n` +
      `  Causa provável: ${causa} Ação: ${acao} _(quem corrige: ${quem})_\n  Última mensagem: ${a.mensagem}${a.http ? " (HTTP " + a.http + ")" : ""}`);
  }
  const autor = lista.filter((g) => causaErro(g.tipo)[2] === "autor").reduce((s, g) => s + g.n, 0);
  out.push("", autor
    ? `⚠️ ${autor} registro(s) são de causa que o AUTOR pode corrigir: rode \`diagnostico_erros_trf1\` com relatorio=true e abra uma issue com o relatório.`
    : "Nenhum registro de causa corrigível pelo autor neste período (os demais vêm do portal, da rede ou do ritmo).");
  return out.join("\n");
}

export function relatorioErros(ent, limite = 20) {
  const ult = ent.slice(-limite);
  const linhas = ult.map((e) => {
    const lim = e.limitador;
    const limT = lim && typeof lim === "object" ? `${lim.nivel}/${lim.de}, ${lim.ultimoMinuto}/min` : "";
    return `| ${String(e.quando).slice(0, 16).replace("T", " ")} | ${e.ferramenta} | ${e.tipo}${e.http ? " (" + e.http + ")" : ""}` +
      `${e.parcial ? " parcial" : ""} | ${e.ms || ""} | ${limT} | ${e.mensagem} | ${jsonPy(e.args || {})} |`;
  });
  return ["**Relatório técnico para análise** (sem texto de busca, sem nomes e sem número de processo; pode ser colado em issue pública)", "",
    `- Versão: ${VERSAO_SERVIDOR} · Sistema: ${process.platform} node ${process.versions.node}`, `- Registros: ${ent.length} (últimos ${ult.length} abaixo)`, "",
    "| Quando | Ferramenta | Tipo | ms | Limitador | Mensagem | Parâmetros |", "|---|---|---|---|---|---|---|", ...linhas, "",
    `Abrir issue: ${ISSUES_NOVA}`].join("\n");
}

/** Tool diagnostico_erros_trf1 (sem rede). */
export function diagnosticoErros({ dias = 30, limite = 15, relatorio = false } = {}, env = process.env) {
  try {
    const d = Math.max(1, Math.min(Math.trunc(Number(dias) || 30), 365));
    const l = Math.trunc(Number(limite) || 15);
    const ent = lerErros(d, env);
    return relatorio && ent.length ? relatorioErros(ent, Math.max(1, Math.min(l, 50))) : resumirErros(ent, l, env);
  } catch (e) {
    return carimboNaoRealizada(`diagnóstico de erros falhou (${e.name}: ${e.message})`);
  }
}

// ----------------------------------------- julgados que citam este e linha do tempo por tese ---
// Porte do TJRO v1.25. Leitura assistida: NÃO detecta superação.
const RE_SINAL_AFASTA = /(?<![a-z0-9])(?:distingue|distinguish\w*|distincao|nao se aplica|inaplicavel|nao se amolda|nao guarda similitude|nao ha similitude|situacao diversa|hipotese diversa|caso diverso|em sentido contrario|em sentido diverso|contrariamente|diverge|divergente|afasta(?:-se)? a aplicacao|nao ha identidade|nao incide|nao se verifica a mesma)(?![a-z0-9])/;
export const ANOS_TIMELINE_MAX = 6;

/** Sinal lexical FRACO de que quem cita distingue ou não aplica o citado (não medido no TRF1/TNU). */
export function sinalAfastamento(janela) { return RE_SINAL_AFASTA.test(norm(janela)); }

/** Trechos em volta do termo destacado («…») na ementa e no dispositivo do documento que CITA. */
export function janelasDestacadas(d, antes = 300, depois = 220, maximo = 2) {
  const out = [];
  for (const campo of ["ementa", "decisao"]) {
    const t = limpar(d[campo] || "", 0);
    let pos = 0;
    while (out.length < maximo) {
      const i = t.indexOf("«", pos);
      if (i < 0) break;
      const j = t.indexOf("»", i);
      const fimDestaque = (j >= 0 ? j : i) + 1;
      out.push(t.slice(Math.max(0, i - antes), fimDestaque + depois).replace(/\s+/g, " ").trim());
      pos = fimDestaque + depois;
    }
  }
  return out;
}

const paraInt = (v, rotulo) => {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) throw new ErroDeParametro(`invalid literal for int() with base 10: ${JSON.stringify(String(v))} (${rotulo})`);
  return n;
};

export async function julgadosQueCitam(a = {}, fetchImpl = fetch, env = process.env) {
  let base, dig, limite, dados;
  try {
    base = validarBase(a.base);
    dig = soDigitos(a.numero);
    if (dig.length < 15) throw new ErroDeParametro("informe o número do processo citado com pelo menos 15 dígitos (CNJ de 20 dígitos, com ou sem máscara; ou o número antigo do Pedilef)");
    limite = Math.max(1, Math.min(paraInt(a.limite || 10, "limite"), 30));
  } catch (e) {
    if (e instanceof ErroDeParametro) return erroDeParametro(e);
    return carimboNaoRealizada(`erro inesperado (${e.name}: ${e.message})`);
  }
  try {
    const formas = dig.length === 20 ? [cnj(dig), dig] : [dig];
    const tipos = validarTipos(base !== "colegiado" ? ["ACORDAO", "DECISAOMONO"] : null, base);
    const fontes = BASES[base].fonte ? validarFontes(null) : [];
    dados = await consultarPortal(montarConsulta("", [formas]), tipos, fontes, 1, 50, {}, "julgamento", "citantes", base, [], fetchImpl, env);
  } catch (e) {
    if (e instanceof PesquisaNaoRealizada) return carimboNaoRealizada(e.message);
    return carimboNaoRealizada(`erro inesperado (${e.name}: ${e.message})`);
  }
  const { docs, total } = dados;
  const rotulo = BASES[base].rotulo;
  const outros = docs.filter((d) => d.numero_digitos !== dig);
  const proprios = docs.length - outros.length;
  const achados = outros.map((d) => [d, janelasDestacadas(d)]);
  const comJanela = achados.filter((x) => x[1].length);
  const out = [`**Julgados do ${rotulo} que citam ${dig.length === 20 ? cnj(dig) : dig}** — ${comJanela.length} com o número na ementa ou no dispositivo, ` +
    `entre os ${docs.length} documento(s) lidos dos ${total} que o portal casou com o número` +
    (proprios ? ` (${proprios} são do próprio processo e foram descartados).` : ".")];
  comJanela.slice(0, limite).forEach(([d, jan], k) => {
    const sinal = jan.some((j) => sinalAfastamento(j)) ? " · ⚠️ sinal lexical de afastamento (fraco)" : "";
    out.push(`\n${k + 1}. ${d.numero || "(sem número)"} · ${d.orgao || "?"} · ${d.data_julgamento || "—"} · Rel. ${d.relator || "—"} · id ${d.id}${sinal}\n> ${jan[0].slice(0, 520)}`);
  });
  const semJanela = achados.length - comJanela.length;
  if (semJanela) out.push(`\n_${semJanela} documento(s) casaram o número só fora da ementa e do dispositivo (por exemplo no campo de número ou no inteiro teor): abra com obter_decisao_trf1 para ver o contexto._`);
  if (!comJanela.length && !semJanela) out.push("Nenhum outro julgado do portal traz esse número. Zero aqui não prova que ninguém o aplicou: o portal indexa ementa e dispositivo, e o número pode estar escrito de outro jeito.");
  if (total > docs.length) out.push(`_O portal casou ${total} documentos; esta ferramenta lê só os 50 primeiros._`);
  out.push("\n_Só leitura assistida, sem medição própria no TRF1/TNU (no TJRO, em 486 citações medidas às cegas: 51% seguem o citado, 44% só mencionam, 3% o afastam e nenhuma o declarou superado). " +
    "Superação NÃO é detectada aqui: leia as janelas. Superação vinculante (súmula, repetitivo, IRDR) se confere no BNP/fonte oficial._");
  return out.join("\n");
}

export function formatarLinhaDoTempo(linhas, filtros, incompleta = "") {
  const cab = incompleta ? `[PESQUISA INCOMPLETA — ${incompleta}]\n` : "";
  const out = [cab + `**Linha do tempo no TRF1** (${filtros}) — contagem por documento do portal; resultado declarado lido do dispositivo, 1× por julgamento, ` +
    "em AMOSTRA (os 50 primeiros de cada ano). Mudança de proporção é sinal para ler, nunca prova de superação.", "",
    "| Ano | Documentos | Julgamentos na amostra | Resultado declarado |", "|---|---|---|---|"];
  for (const l of linhas) {
    const res = l.res.map(([rot, n]) => `${n} ${rot}`).join(", ") || "—";
    out.push(`| ${l.ano} | ${l.total} | ${l.julgamentos} | ${res} |`);
  }
  return out.join("\n");
}

export async function linhaDoTempo(a = {}, fetchImpl = fetch, env = process.env) {
  let consultaM, ai, af, tipos, fontes;
  const orgao = a.orgao_julgador;
  try {
    validarTamanho("consulta", a.consulta);
    consultaM = montarConsulta(a.consulta || "", a.grupos);
    if (!consultaM) throw new ErroDeParametro("informe `consulta` ou `grupos`: a linha do tempo precisa de uma tese");
    const hoje = new Date().getFullYear();
    af = paraInt(a.ano_fim || hoje, "ano_fim");
    ai = paraInt(a.ano_inicio || (af - 4), "ano_inicio");
    if (ai > af || ai < 1989 || af > hoje + 1) throw new ErroDeParametro(`anos inválidos (${ai}–${af})`);
    if (af - ai + 1 > ANOS_TIMELINE_MAX) throw new ErroDeParametro(`no máximo ${ANOS_TIMELINE_MAX} anos por chamada (cada ano gasta 3 a 4 requisições ao portal); recebi ${af - ai + 1}`);
    tipos = validarTipos(["ACORDAO"], "trf1");
    fontes = validarFontes(null);
  } catch (e) {
    if (e instanceof ErroDeParametro) return erroDeParametro(e);
    return carimboNaoRealizada(`erro inesperado (${e.name}: ${e.message})`);
  }
  const filtros = `${consultaM} · ${ai}–${af}` + (orgao ? ` · órgão: ${orgao}` : "");
  const linhas = [];
  for (let ano = ai; ano <= af; ano++) {
    const av = { data_inicio: `01/01/${ano}`, data_fim: `31/12/${ano}` };
    if (orgao && String(orgao).trim()) av.orgao_julgador = String(orgao).trim();
    let dados;
    try {
      dados = await consultarPortal(consultaM, tipos, fontes, 1, 50, av, "julgamento", "linha_do_tempo", "trf1", [], fetchImpl, env);
    } catch (e) {
      if (e instanceof PesquisaNaoRealizada) {
        if (!linhas.length) return carimboNaoRealizada(e.message);
        return formatarLinhaDoTempo(linhas, filtros, `parou em ${ano} (${e.message.trim().replace(/\.$/, "").slice(0, 160)}); anos feitos: ${linhas[0].ano}–${linhas[linhas.length - 1].ano}`);
      }
      return carimboNaoRealizada(`erro inesperado em ${ano} (${e.name}: ${e.message})`);
    }
    const r = resumoResultadosPagina(dados.docs);
    const res = Object.keys(ROTULOS_RESULTADO).filter((k) => r.contagem[k]).map((k) => [ROTULOS_RESULTADO[k], r.contagem[k]]);
    linhas.push({ ano, total: dados.total, julgamentos: r.total_julgamentos, res });
  }
  return formatarLinhaDoTempo(linhas, filtros);
}

// ---------------------------------------------------------------- crédito e versão ---
export const CREDITO = "_Esta extensão foi desenvolvida por @robertogrecia (Roberto Grécia Bessa, OAB/RO 7865-A). Obrigado por usar!_";
let creditoDado = false;
export function comCredito(texto) {
  if (creditoDado) return texto;
  creditoDado = true;
  return `${texto}\n\n${CREDITO}`;
}
export function _resetCreditoParaTeste() { creditoDado = false; }

// (07/10/2026) a versão nova e o .mcpb são publicados no repositório da EXTENSÃO; o do Python não traz o pacote
export const REPO_RELEASES = "robertogecia/trf1-jurisprudencia-mcpb";
export const RELEASES_API = `https://api.github.com/repos/${REPO_RELEASES}/releases/latest`;
export const RELEASES_PAGINA = `https://github.com/${REPO_RELEASES}/releases/latest`;
export const PACOTE_MCPB_URL = `https://github.com/${REPO_RELEASES}/releases/latest/download/Jurisprudencia-TRF1.mcpb`;
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
export const avisoAtualizacao = (novaVersao) => `⬆️ Há versão nova desta extensão (v${novaVersao}; a instalada é a v${VERSAO}).\nBaixar: ${PACOTE_MCPB_URL}\nDepois dê dois cliques no arquivo baixado e reinicie o Claude Desktop. O que mudou: ${RELEASES_PAGINA}`;

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

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as lib from "../server/lib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Rede de segurança (v1.6.0): a busca grava recibo e o livro-razão grava requisição. Nenhum teste toca a pasta real (~/.trf1-jurisprudencia-recibos)
// nem o arquivo real (~/.trf1-jurisprudencia-ritmo.jsonl): o que não passar `env` próprio cai nestas pastas temporárias.
const TMP_SEGURO = fs.mkdtempSync(path.join(os.tmpdir(), "trf1-mcpb-teste-"));
process.env.TRF1_MCP_DIR_RECIBOS = path.join(TMP_SEGURO, "recibos");
process.env.TRF1_MCP_ARQUIVO_RITMO = path.join(TMP_SEGURO, "ritmo.jsonl");
process.on("exit", () => { try { fs.rmSync(TMP_SEGURO, { recursive: true, force: true }); } catch { /* melhor esforço */ } });
const fx = path.join(__dirname, "fixtures");
const ler = (nome, enc = "utf-8") => fs.readFileSync(path.join(fx, nome), enc);

// ------------------------------------------------------------------- montagem da consulta ---
test("termoParaQuery — frase, radical, campo, reservada", () => {
  assert.equal(lib.termoParaQuery("dano moral"), '"dano moral"');
  assert.equal(lib.termoParaQuery("consign*"), "consign");
  assert.equal(lib.termoParaQuery("negativação[EMEN]"), "negativação[EMEN]");
  assert.equal(lib.termoParaQuery("e"), '"e"');
  assert.equal(lib.termoParaQuery("auxílio-doença"), '"auxílio doença"');
});

test("montarGrupos — OU dentro, E entre", () => {
  const q = lib.montarGrupos([["dano moral"], ["negativação", "inscrição indevida"]]);
  assert.equal(q, '"dano moral" E (negativação OU "inscrição indevida")');
});

test("montarConsulta — livre + grupos combinados", () => {
  assert.equal(lib.montarConsulta("", [["dano moral"]]), '"dano moral"');
  assert.equal(lib.montarConsulta("responsabilidade civil", [["dano moral"]]), '(responsabilidade civil) E "dano moral"');
});

// -------------------------------------------------------------------------- XML/HTML ---
test("extrairUpdate — CDATA partido recomposto", () => {
  const xml = '<update id="formulario"><![CDATA[antes ]]]]><![CDATA[> depois]]></update>';
  assert.equal(lib.extrairUpdate(xml, "formulario"), "antes ]]> depois");
});

test("extrairTotal — rowCount preferido sobre contadores", () => {
  assert.equal(lib.extrairTotal('lorem rowCount:1234 ipsum "1 Documento(s) encontrado"'), 1234);
  assert.equal(lib.extrairTotal('"3 Documento(s) encontrado" e mais "2 Documento(s) encontrado"'), 5);
  assert.equal(lib.extrairTotal("nada aqui"), 0);
});

test("parsearDocumentos — fixture real de busca TRF1", () => {
  const xml = ler("02_busca_dano_moral.xml");
  const html = lib.extrairUpdate(xml, "formulario");
  const docs = lib.parsearDocumentos(html, "trf1");
  assert.ok(docs.length > 0, "deveria achar ao menos 1 documento");
  const d0 = docs[0];
  assert.ok(d0.id, "documento sem id");
  assert.equal(d0.numero_digitos.length, 20, `numero_digitos deveria ter 20 dígitos: ${d0.numero_digitos}`);
  assert.ok(d0.ementa.length > 50, "ementa vazia/curta demais");
  assert.equal(d0.base, "trf1");
});

test("parsearDocumentos — TNU: ids não numéricos, qualificação de precedente", () => {
  const xml = ler("11_tnu_busca.xml");
  const html = lib.extrairUpdate(xml, "formulario");
  const docs = lib.parsearDocumentos(html, "tnu");
  assert.ok(docs.length > 0);
  const d0 = docs[0];
  assert.match(d0.id, /^TNU\d+$/);
  assert.equal(d0.numero, "0011441-43.2015.4.03.6301");
  assert.equal(d0.relator, "FABIO DE SOUZA SILVA");
  assert.equal(d0.orgao, "TURMA NACIONAL DE UNIFORMIZAÇÃO");
});

test("parsearDocumentos — colegiado: inteiro teor embutido", () => {
  const xml = ler("09_colegiado_busca.xml");
  const html = lib.extrairUpdate(xml, "formulario");
  const docs = lib.parsearDocumentos(html, "colegiado");
  assert.ok(docs.length > 0);
  const d0 = docs[0];
  assert.equal(d0.data_julgamento, "");
  assert.ok(d0.data_publicacao);
  assert.ok(d0.inteiro_teor_embutido.length > 5000);
  assert.match(d0.inteiro_teor_embutido, /RELATOR/);
  assert.equal(lib.linkDocumentoEspecifico(d0), "");
  assert.equal(lib.citacaoComLink(d0), lib.citacao(d0));
  assert.ok(lib.citacao(d0).startsWith("(CJF - "));
  assert.ok(!lib.citacao(d0).includes("Origem:"));
});

test("textoDocumento — inteiro teor da TNU (fixture real)", () => {
  const html = ler("12_tnu_inteiro_teor.html", "latin1");
  const t = lib.textoDocumento(html);
  assert.ok(t.length > 10_000 && t.length < 20_000, `tamanho inesperado: ${t.length}`);
  assert.match(t, /RELATOR/);
  assert.match(t, /Votante/);
  assert.ok(!t.slice(0, 5000).includes("<"));
});

// -------------------------------------------------------------------- atribuição (TNU) ---
test("norm — pontuação, nº e aspas tolerantes", () => {
  assert.equal(lib.norm("Lei n.º 8.213"), lib.norm("Lei nº 8.213"));
  assert.equal(lib.norm("Lei n.º 8.213"), "lei n 8.213");
});

test("conferir — TRANSCRIÇÃO, VOTO DIVERGENTE, ALEGAÇÃO DA PARTE, NEGAÇÃO, ENTRE ASPAS", () => {
  const votoTr =
    "RELATÓRIO. O INSS sustenta que o benefício é indevido porque o segurado voltou a trabalhar. " +
    "VOTO. Nesse sentido, transcrevo: EMENTA: PREVIDENCIÁRIO. AUXÍLIO-DOENÇA. O retorno ao trabalho não impede " +
    "a percepção do benefício quando comprovada a incapacidade. Recurso conhecido e provido. " +
    "(STJ, REsp 1.234.567/RS, Rel. Min. Fulano, DJe 01/01/2020). No caso dos autos, entendo que a " +
    "incapacidade ficou provada e o retorno ao trabalho foi tentativa frustrada. Fixo a seguinte tese: " +
    "\"o retorno ao trabalho por tentativa não afasta o direito ao benefício\". Não há como acolher o pedido " +
    "de repetição dos valores recebidos de boa-fé. Peço vênia para divergir do relator: o retorno ao trabalho " +
    "afasta o benefício desde o primeiro dia.";
  const r1 = lib.conferir(votoTr, "o retorno ao trabalho não impede a percepção do benefício", "TNU", true);
  assert.ok(r1.ok && r1.alertas.some((a) => a.startsWith("TRANSCRIÇÃO")), JSON.stringify(r1));
  const r2 = lib.conferir(votoTr, "afasta o benefício desde o primeiro dia", "TNU", true);
  assert.ok(r2.ok && r2.alertas.some((a) => a.startsWith("VOTO DIVERGENTE")));
  const r3 = lib.conferir(votoTr, "o benefício é indevido porque o segurado voltou a trabalhar", "TNU", true);
  assert.ok(r3.ok && r3.alertas.some((a) => a.startsWith("ALEGAÇÃO DA PARTE")));
  const r4 = lib.conferir(votoTr, "acolher o pedido de repetição dos valores recebidos", "TNU", true);
  assert.ok(r4.ok && r4.alertas.some((a) => a.startsWith("NEGAÇÃO")));
  const r5 = lib.conferir(votoTr, "o retorno ao trabalho por tentativa não afasta o direito ao benefício", "TNU", true);
  assert.ok(r5.ok && !r5.alertas.some((a) => a.startsWith("ENTRE ASPAS")), "tese própria não deveria disparar ENTRE ASPAS");
  const votoQ = "VOTO. Como ensina a doutrina: \"a boa-fé objetiva impõe deveres anexos de conduta às partes\". Entendo aplicável.";
  const r6 = lib.conferir(votoQ, "a boa-fé objetiva impõe deveres anexos de conduta", "TNU", true);
  assert.ok(r6.ok && r6.alertas.some((a) => a.startsWith("ENTRE ASPAS")));
  const r7 = lib.conferir(votoTr, "o retorno ao trabalho não impede a percepção do benefício", "TRF1", false);
  assert.ok(r7.ok && !r7.alertas.some((a) => a.startsWith("TRANSCRIÇÃO")), "sem atribuição, TRANSCRIÇÃO não deveria disparar");
});

test("conferir — piso de palavras/caracteres e vão máximo do [...]", () => {
  const r1 = lib.conferir("A tese fixada: «benefício» por incapacidade, art. 42.", "tese fixada");
  assert.ok(!r1.ok && /curto demais/.test(r1.erro), JSON.stringify(r1));
  const longe =
    "a tese fixada pela turma foi clara " + "lorem ipsum dolor sit amet ".repeat(80) + "e por isso nego provimento ao recurso";
  const r2 = lib.conferir(longe, "a tese fixada pela turma [...] nego provimento ao recurso");
  assert.ok(!r2.ok && /caracteres do anterior/.test(r2.erro), JSON.stringify(r2));
});

test("verificarTrecho — ✅/❌, ordem errada, vazio", () => {
  const vt = { ementa: "A TESE fixada: «benefício» por incapacidade, art. 42.", dispositivo: "negar provimento" };
  const r1 = lib.verificarTrecho(vt, "a tese fixada: beneficio [...] por incapacidade, art 42");
  assert.ok(r1.valido && r1.onde === "ementa", JSON.stringify(r1));
  const r2 = lib.verificarTrecho(vt, "a tese fixada: beneficio [...] por incapacidade, art 43");
  assert.ok(!r2.valido && r2.faltando[0] === "por incapacidade, art 43", JSON.stringify(r2));
  assert.ok(!lib.verificarTrecho(vt, "por incapacidade a tese fixada beneficio").valido);
  assert.ok(!lib.verificarTrecho(vt, "").valido);
});

// ------------------------------------------------------------------------- fecho TNU ---
test("fechoTnu — fixture real: órgão, relator, data (fecho, não precedente transcrito)", () => {
  const html = ler("12_tnu_inteiro_teor.html", "latin1");
  const it = lib.textoDocumento(html);
  const f = lib.fechoTnu(it);
  assert.equal(f.orgao_fecho, "TURMA NACIONAL DE UNIFORMIZAÇÃO");
  assert.equal(f.data_fecho, "14/05/2025");
  assert.match(f.relator_acordao_texto, /FABIO DE SOUZA SILVA/);
});

test("fechoTnu — usa a ÚLTIMA data (não a de um precedente transcrito)", () => {
  const it =
    "RELATOR : Juiz Federal FULANO DE TAL\nVOTO\nA matéria já foi enfrentada por esta Turma: 'ementa...' (PEDILEF 123, " +
    "julgado em sessão de Brasília, 10 de março de 2020).\nACÓRDÃO\nA Turma Nacional de Uniformização decidiu, por " +
    "unanimidade, negar provimento.\nBrasília, 14 de maio de 2025.";
  assert.equal(lib.fechoTnu(it).data_fecho, "14/05/2025");
});

test("aplicarFecho — DIVERGÊNCIA de órgão/relator/data; citação prefere o fecho", () => {
  const it = ler("12_tnu_inteiro_teor.html", "latin1");
  const texto = lib.textoDocumento(it);
  const dOk = { id: "TNU1", inteiro_teor_texto: texto, orgao: "TURMA NACIONAL DE UNIFORMIZAÇÃO",
    relator: "FABIO DE SOUZA SILVA", data_julgamento: "14/05/2025" };
  assert.deepEqual(lib.aplicarFecho({ ...dOk }), []);
  const dDiv = { id: "TNU2", inteiro_teor_texto: texto, orgao: "TURMA REGIONAL", relator: "BELTRANO", data_julgamento: "01/01/2020" };
  const av = lib.aplicarFecho(dDiv);
  assert.equal(av.length, 3);
  assert.match(av[0], /^DIVERGÊNCIA/);
  assert.match(av[1], /^RELATOR/);
  assert.match(av[2], /^DATA/);
  assert.ok(lib.citacao(dDiv).includes("TURMA NACIONAL DE UNIFORMIZAÇÃO") && lib.citacao(dDiv).includes("14/05/2025"));
});

test("orgaoFonte — base trf1 sem inteiro teor diz que o fecho não foi conferido", () => {
  const s = lib.orgaoFonte({});
  assert.ok(s.startsWith("índice do portal") && s.includes("não conferido no fecho"));
});

// --------------------------------------------------------------------- sinais e ancoras ---
test("ancoras — súmula vinculante não duplica como súmula comum", () => {
  const a = lib.ancoras("aplica-se a Súmula 7 do STJ e o Tema 1.124; ver Súmula Vinculante 10 e o IRDR 3");
  assert.deepEqual(a, ["Súmula 7", "Tema 1124", "Súmula Vinculante 10", "IRDR 3"]);
});
test("linhasDeSinais — monocrática, Turma Recursal, Cita", () => {
  const s1 = lib.linhasDeSinais({ tipo: "Decisão Monocrática", ementa: "Tema 692 do STJ" });
  assert.ok(s1.some((x) => x.includes("monocrática")) && s1.some((x) => x.startsWith("Cita: Tema 692")));
  const s2 = lib.linhasDeSinais({ orgao: "1ª TURMA RECURSAL" });
  assert.ok(s2.some((x) => x.includes("Turma Recursal")));
});

// ------------------------------------------------------------------------------ recibos ---
test("recibos — grava, lê, sha divergente é posto de lado, recibo do processo, doc reconstruído", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trf1-mcpb-recibos-"));
  const env = { TRF1_MCP_DIR_RECIBOS: dir };
  const html = ler("12_tnu_inteiro_teor.html", "latin1");
  const it = lib.textoDocumento(html);
  const d = { id: "TNU00033758", base: "tnu", numero: "0011441-43.2015.4.03.6301", numero_digitos: "00114414320154036301",
    tipo: "Acórdão", ementa: "ementa de teste", decisao: "negar provimento", inteiro_teor_texto: it,
    orgao: "TURMA NACIONAL DE UNIFORMIZAÇÃO", relator: "FABIO DE SOUZA SILVA", data_julgamento: "14/05/2025" };
  lib.aplicarFecho(d);
  const caminho = lib.gravarRecibo(d, env);
  assert.ok(caminho && fs.existsSync(caminho));
  if (process.platform !== "win32") assert.equal(fs.statSync(caminho).mode & 0o777, 0o600);
  const rec = lib.lerRecibo(d.id, env);
  assert.equal(rec.id_documento, d.id);
  assert.equal(rec.nr_processo, d.numero_digitos);
  assert.equal(rec.orgao_fonte, "fecho");
  assert.ok(rec.inteiro_teor_incluido);
  assert.equal(rec.tribunal, "TNU");
  assert.equal(rec.sha256, crypto.createHash("sha256").update(rec.texto, "utf-8").digest("hex"));
  assert.ok(Array.isArray(rec.trechos_transcritos));
  assert.equal(rec.versao_servidor, lib.VERSAO);
  assert.equal(lib.recibosDoProcesso(d.numero_digitos, "tnu", env).length, 1);
  assert.equal(lib.recibosDoProcesso(d.numero_digitos, "trf1", env).length, 0);
  const dr = lib.docDeRecibo(rec, env);
  assert.equal(dr.inteiro_teor_texto, rec.inteiro_teor);
  assert.equal(dr.orgao_fecho, "TURMA NACIONAL DE UNIFORMIZAÇÃO");
  assert.equal(dr.link_tipo, "");
  // sha divergente → posto de lado
  const j = JSON.parse(fs.readFileSync(caminho, "utf-8"));
  j.texto += " editado";
  fs.writeFileSync(caminho, JSON.stringify(j));
  assert.equal(lib.lerRecibo(d.id, env), null);
  assert.ok(fs.existsSync(caminho + ".inconsistente"));
  assert.equal(lib.lerRecibo("inexistente", env), null);
  assert.equal(lib.gravarRecibo({ id: "", ementa: "x" }, env), "");
  // número parcial não usa recibo local (evita misturar processos)
  assert.equal(lib.recibosDoProcesso(d.numero_digitos.slice(0, 7), "tnu", env).length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// --------------------------------------------------------------------- citação/formatação ---
test("citacao/citacaoComLink — hiperlink só com link específico do documento", () => {
  const dArquivo = { base: "trf1", numero: "0020777-05.2018.4.01.3300", relator: "X", data_julgamento: "02/06/2026",
    orgao: "TURMA", link_inteiro_teor: "https://arquivo.trf1.jus.br/x", link_tipo: "arquivo" };
  assert.match(lib.citacaoComLink(dArquivo), /^\[\(TRF-1 - .*\)\]\(https:\/\/arquivo\.trf1\.jus\.br\/x\)$/);
  const dPje = { base: "trf1", numero: "1", link_inteiro_teor: "https://pje2g.trf1.jus.br/x", link_tipo: "pje" };
  assert.equal(lib.citacaoComLink(dPje), lib.citacao(dPje));
});

test("formatBusca/formatDecisao — verificação, orgao_fonte, EM PARTE quando cortado", () => {
  const html = ler("12_tnu_inteiro_teor.html", "latin1");
  const it = lib.textoDocumento(html);
  const dTnu = { id: "TNU1", base: "tnu", numero: "0011441-43.2015.4.03.6301", numero_digitos: "00114414320154036301",
    tipo: "Acórdão", ementa: "ementa curta", decisao: "negar provimento", inteiro_teor_texto: it,
    campos: {}, orgao: "", relator: "", data_julgamento: "" };
  lib.aplicarFecho(dTnu);
  const sd = lib.formatDecisao([dTnu], dTnu.numero, 1);
  assert.match(sd, /— verificação: inteiro teor lido/);
  assert.match(sd, /orgao_fonte: fecho/);
  const sb = lib.formatBusca([dTnu], 1, { base: "tnu", pagina: 1, por_pagina: 30 });
  assert.match(sb, /— verificação: só ementa\/índice/);   // v1.6.0: a lista da busca não exibe o inteiro teor, então não diz "lido"
  assert.doesNotMatch(sb, /inteiro teor lido/);
  const dTrf1 = { id: "1", base: "trf1", numero: "1", numero_digitos: "1".repeat(20), ementa: "e", decisao: "d", campos: {} };
  const sd2 = lib.formatDecisao([dTrf1], "1", 1);
  assert.match(sd2, /— verificação: só ementa\/índice/);
  assert.match(sd2, /não conferido no fecho/);
});

// -------------------------------------------------------------------------- disjuntor ---
test("disjuntor — reserva, escada só com rajada, fail-closed em estado ilegível", async (t) => {
  const arqOrig = lib._arquivoEstadoAtual();
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "trf1-mcpb-disj-")), "estado.json");
  lib._setArquivoEstadoParaTeste(tmp);
  t.after(() => { lib._resetDisjuntorParaTeste(); lib._setArquivoEstadoParaTeste(arqOrig); });

  const r1 = lib.reservarRequisicao(1000);
  assert.ok(!r1.erro);
  // 1 recusa isolada (poucas reqs no minuto): não alarga a escada
  lib.registrarBloqueioDetectado(2000, "busca", { subirEscada: true, tipo: "bloqueio" });
  let d1 = lib.diagnosticoRitmo(2000);
  assert.match(d1, /Nível atual: 1 de 5/);
  // estado ilegível: fail-closed, pausa finita
  fs.writeFileSync(tmp, "{ isso não é json");
  const r2 = lib.reservarRequisicao(3000);
  assert.match(r2.erro, /disjuntor em pausa/);
  fs.unlinkSync(tmp);
  // estado com tipos malformados não derruba o registro nem o diagnóstico
  fs.writeFileSync(tmp, JSON.stringify({ sucessos: "x", incidentes: [{ quando: "abc", tipo: "bloqueio" }] }));
  lib.registrarSucesso(4000);
  lib.registrarBloqueioDetectado(4000, "busca");
  assert.doesNotThrow(() => lib.diagnosticoRitmo(4000));
});

test("desafio de navegador ≠ bloqueio por robotização", () => {
  assert.ok(lib.ehDesafioNavegador("<title>Just a moment...</title>"));
  assert.ok(!lib.ehDesafioNavegador("acesso bloqueado por robotização"));
});

test("envelope — some com o conteúdo dos CDATA", () => {
  const xml = '<partial-response><update id="x"><![CDATA[acesso bloqueado dentro de uma ementa]]></update></partial-response>';
  assert.ok(!lib.envelope(xml).includes("acesso bloqueado"));
});

// ------------------------------------------------------------------------- validações ---
test("validarBase/validarTipos/validarFontes/validarTipoAcordao", () => {
  assert.equal(lib.validarBase(undefined), "trf1");
  assert.throws(() => lib.validarBase("xyz"));
  assert.deepEqual(lib.validarTipos(null, "colegiado"), []);
  assert.deepEqual(lib.validarTipos(["DECISAOMONO"], "tnu"), ["DECISAOMONO"]);
  assert.throws(() => lib.validarTipos(["SUMULA"], "tnu"));
  assert.deepEqual(lib.validarFontes(null), ["TRF1"]);
  assert.throws(() => lib.validarFontes(["XYZ"]));
  assert.deepEqual(lib.validarTipoAcordao(["representativo"], "tnu"), ["REPRESENTATIVO"]);
  assert.throws(() => lib.validarTipoAcordao(["x"], "trf1"));
});

// ------------------------------------------------------------------------- versão/crédito ---
test("versaoMaisNova / comCredito / comAvisos", async () => {
  assert.ok(lib.versaoMaisNova("1.1.0", "v1.1.1"));
  assert.ok(!lib.versaoMaisNova("1.1.0", "1.1.0"));
  assert.ok(!lib.versaoMaisNova("1.1.0", "abc"));
  lib._resetCreditoParaTeste();
  const c1 = lib.comCredito("a");
  const c2 = lib.comCredito("b");
  assert.ok(c1.includes(lib.CREDITO));
  assert.equal(c2, "b");
  assert.ok(!lib.avisoAtualizacao("9.9.9").endsWith("_"));
});

test("filtrarPorNumero — igual ou prefixo; nunca vazio", () => {
  const docs = [{ numero_digitos: "" }, { numero_digitos: "12345678901234567890" }, { numero_digitos: "1234567" }];
  assert.deepEqual(lib.filtrarPorNumero(docs, "12345678901234567890").map((d) => d.numero_digitos), ["12345678901234567890"]);
  assert.deepEqual(lib.filtrarPorNumero(docs, "1234567").map((d) => d.numero_digitos), ["12345678901234567890", "1234567"]);
});

test("v1.2.1: 'sem razão' é operador de NEGAÇÃO (paridade com o Python)", () => {
  const r = lib.conferir("VOTO Sem razão o apelante ao dizer que o benefício é devido desde o requerimento administrativo.", "o benefício é devido desde o requerimento", "TRF1", true);
  assert.ok(r.ok && r.alertas.some((a) => a.startsWith("NEGAÇÃO")), JSON.stringify(r.alertas));
});

// ============================================ v1.5.0 (paridade com o selftest "v1.5.0" do Python) ===
const tnuIt = () => lib.textoDocumento(ler("12_tnu_inteiro_teor.html", "latin1"));

test("v1.5.0: votação declarada (5 casos + monocrática + TNU pelo inteiro teor)", () => {
  assert.equal(lib.votacaoDeclarada("Decide a Quinta Turma, por unanimidade, negar provimento às Apelações, nos termos do voto do Relator."), "unânime");
  assert.equal(lib.votacaoDeclarada("Decide a Turma, por maioria, dar provimento, nos termos do voto divergente, vencido o relator."), "por maioria, voto divergente prevaleceu");
  assert.equal(lib.votacaoDeclarada("Decide a Turma, por maioria, negar provimento, vencido o Juiz X, que dava provimento."), "por maioria");
  assert.equal(lib.votacaoDeclarada("Por unanimidade, com declaração de voto do Juiz Y, negar provimento."), "unânime, com declaração de voto");
  assert.equal(lib.votacaoDeclarada("Nega provimento."), "");
  assert.equal(lib.votacaoDeclarada(""), "");
  assert.equal(lib.votacaoDoDocumento({ tipo: "Decisão Monocrática", decisao: "por unanimidade" }), "");
  assert.equal(lib.votacaoDoDocumento({ tipo: "Súmula", decisao: "por unanimidade" }), "");
  assert.equal(lib.votacaoDoDocumento({ inteiro_teor_texto: tnuIt(), decisao: "", tipo: "Acórdão" }), "unânime");
});

test("v1.5.0: FATOS DO JULGADO — seção, relatório, vazio e regex de alegação", () => {
  const it = tnuIt();
  const lf = lib.linhaFatos({ inteiro_teor_texto: it, decisao: "", tipo: "Acórdão" });
  assert.ok(lf.includes("FATOS DO JULGADO") && lf.includes("ementa › caso em exame") && lf.includes("PUIL contra acórdão"), lf);
  const lf2 = lib.linhaFatos({ inteiro_teor_texto: it.replace("I. Caso em exame", "XX") });
  assert.ok(lf2.includes("relatório do acórdão") && lf2.includes("NÃO o fundamento nem o resultado"), lf2);
  assert.equal(lib.linhaFatos({ inteiro_teor_texto: "" }), "");
  assert.equal(lib.fatosDoJulgado(""), null);
  const re = lib.RE_ALEGACAO_FATOS;
  assert.ok(re.test("o apelado sustenta que o prazo") && re.test("sustenta a autora que") && re.test("o INSS alega, em suas razões, que"));
  assert.ok(re.test("o INSS alega, em suma") && !re.test("o tribunal fixou a tese"));
});

test("v1.5.0: trecho centrado traz o termo destacado para dentro da janela", () => {
  const longo = "palavra ".repeat(200) + "«alvo» fim do texto";
  const tc = lib.trechoCentrado(longo, 300);
  assert.ok(tc.includes("«alvo»") && tc.startsWith("…") && tc.length <= 310, tc.slice(0, 80));
  assert.equal(lib.trechoCentrado("pouco «alvo» texto", 300), "pouco «alvo» texto");
  assert.equal(lib.trechoCentrado("sem destaque ".repeat(100), 300), lib.limpar("sem destaque ".repeat(100), 300));
});

test("v1.5.0: formatBusca e formatDecisao trazem votação, trecho centrado e fatos", () => {
  const d = { id: "TNU1", base: "tnu", numero: "0011441-43.2015.4.03.6301", numero_digitos: "00114414320154036301", tipo: "Acórdão",
    ementa: "palavra ".repeat(200) + "«alvo» fim", decisao: "A TNU decidiu, por unanimidade, negar provimento.", inteiro_teor_texto: tnuIt() };
  const b = lib.formatBusca([d], 1, { consulta_montada: "x", base: "tnu", pagina: 1, por_pagina: 30 });
  assert.ok(b.includes("  🗳️ Votação declarada no dispositivo: unânime (não diz quem foi o vencido; o voto vencido só se vê no inteiro teor)"), b);
  assert.ok(b.indexOf("Citação:") < b.indexOf("🗳️") && b.includes("Ementa (trecho): …") && b.includes("«alvo»"));
  const o = lib.formatDecisao([d], "x", 1);
  assert.ok(o.includes("  🗳️ Votação declarada: unânime (não diz quem foi o vencido)") && o.includes("📌 FATOS DO JULGADO"), o.slice(0, 600));
  assert.ok(o.indexOf("🗳️") < o.indexOf("📌"));
});

test("v1.5.0: buscar_recibos_trf1 — local, filtros, ordenação e recibo adulterado", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trf1-mcpb-rb-"));
  const env = { TRF1_MCP_DIR_RECIBOS: dir };
  const d1 = { id: "TNU00033758", base: "tnu", numero: "0011441-43.2015.4.03.6301", numero_digitos: "00114414320154036301", tipo: "Acórdão",
    relator: "FABIO DE SOUZA SILVA", orgao: "TURMA NACIONAL DE UNIFORMIZAÇÃO", data_julgamento: "14/05/2025",
    ementa: "PUIL. incapacidade preexistente ao reingresso.", decisao: "A TNU decidiu, por unanimidade, negar provimento.", inteiro_teor_texto: tnuIt() };
  const d2 = { id: "1174043", base: "trf1", numero: "0001369-17.2017.4.01.3606", numero_digitos: "00013691720174013606", tipo: "Acórdão",
    relator: "CHARLES RENAUD", orgao: "QUINTA TURMA", data_julgamento: "10/03/2024", ementa: "Dano moral coletivo. Ação civil pública.",
    decisao: "Decide a Quinta Turma, por maioria, negar provimento." };
  assert.ok(lib.gravarRecibo(d1, env) && lib.gravarRecibo(d2, env));
  const br = (a) => lib.buscarRecibos(a, env);
  const r = br({ consulta: "incapacidade" });
  assert.ok(r.includes("1 de 2") && r.includes("TNU00033758") && r.includes("ZERO requisição") && r.includes("🗳️ unânime"), r);
  assert.ok(r.startsWith("**Recibos locais do TRF1/TNU — 1 de 2 documento(s) já lidos nesta máquina atendem a «incapacidade»"));
  assert.ok(br({ grupos: [["dano moral", "dano material"], ["coletiv$"]] }).includes("1174043"));
  assert.ok(!br({ consulta: "incapacidade" }).includes("1174043"));
  assert.ok(br({ nr_processo: "0011441-43.2015" }).includes("TNU00033758"));
  assert.ok(br({ nr_processo: "123" }).includes("BUSCA LOCAL NÃO REALIZADA"));
  assert.ok(br({}).includes("BUSCA LOCAL NÃO REALIZADA"));
  assert.ok(br({ id_documento: "../x" }).includes("id_documento inválido"));
  assert.ok(br({ relator: "charles" }).includes("1174043") && !br({ relator: "charles" }).includes("TNU00033758"));
  assert.ok(br({ consulta: "incapacidade", base: "tnu" }).includes("TNU00033758") && !br({ consulta: "incapacidade", base: "trf1" }).includes("TNU00033758"));
  assert.ok(br({ consulta: "x", base: "zzz" }).includes("BUSCA LOCAL NÃO REALIZADA"));
  assert.ok(br({ consulta: "palavrainexistente" }).includes("0 de 2"));
  assert.ok(lib.buscarRecibos({ consulta: "dano moral", pasta: dir }, { TRF1_MCP_DIR_RECIBOS: "/nao/existe" }).includes("1174043"));
  // recibo adulterado sai da busca
  const p = lib.arqRecibo("1174043", env);
  const j = JSON.parse(fs.readFileSync(p, "utf-8")); j.texto += " adulterado";
  fs.writeFileSync(p, JSON.stringify(j));
  assert.ok(!br({ grupos: [["dano moral"]] }).includes("1174043"));
  assert.ok(!lib.buscarRecibos({ grupos: [["dano moral"]], pasta: dir }, env).includes("1174043"));
});

test("v1.5.0: diário de erros — privacidade, modo 0600, ritmo local ignorado, relatório", async (t) => {
  const arqOrig = lib._arquivoEstadoAtual();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trf1-mcpb-err-"));
  lib._setArquivoEstadoParaTeste(path.join(dir, "estado.json"));
  t.after(() => { lib._resetDisjuntorParaTeste(); lib._setArquivoEstadoParaTeste(arqOrig); });
  const env = { TRF1_MCP_ARQUIVO_ERROS: path.join(dir, "erros.jsonl") };
  assert.equal(lib.tipoDoErroDiario("HTTP 503 do portal"), "http_503");
  assert.equal(lib.tipoDoErroDiario("tempo esgotado"), "timeout");
  assert.equal(lib.tipoDoErroDiario("disjuntor em pausa por mais 10 min"), "limite_de_ritmo");
  assert.equal(lib.tipoDoErroDiario("Muitos Usuários"), "portal_congestionado");
  const e = lib.registrarErro("buscar_jurisprudencia_trf1", {
    texto: '[PESQUISA NÃO REALIZADA — HTTP 503 em 0011441-43.2015.4.03.6301 "dano moral coletivo"]',
    args: { consulta: "dano moral secreto", grupos: [["a", "b"], ["c"]], relator: "Fulano de Tal", pagina: 2, tipo: ["ACORDAO"] }, ms: 1234 }, env);
  const js = JSON.stringify(e);
  assert.ok(e && !js.includes("secreto") && !js.includes("Fulano") && !js.includes("0011441"), js);
  assert.equal(e.args.pagina, 2);
  assert.deepEqual(e.args.tipo, ["ACORDAO"]);
  assert.equal(e.args.grupos, "2 grupo(s), 3 termo(s)");
  assert.equal(e.tipo, "http_503");
  assert.equal(e.versao, `node-${lib.VERSAO}`);
  if (process.platform !== "win32") assert.equal((fs.statSync(env.TRF1_MCP_ARQUIVO_ERROS).mode & 0o777).toString(8), "600");
  assert.ok(!fs.readFileSync(env.TRF1_MCP_ARQUIVO_ERROS, "utf-8").match(/secreto|Fulano|0011441/));
  const ent = lib.lerErros(30, env);
  assert.equal(ent.length, 1);
  assert.ok(lib.resumirErros(ent, 15, env).includes("http_503"));
  const rel = lib.relatorioErros(ent);
  assert.ok(rel.includes("Relatório técnico") && rel.includes("issues/new") && rel.includes('"pagina": 2'), rel);
  assert.ok(lib.resumirErros([]).includes("Nenhum erro"));
  assert.ok(lib.diagnosticoErros({ relatorio: true }, env).includes("Relatório técnico"));
  // o wrapper anota resposta de falha, ignora ritmo local e não quebra a ferramenta
  await lib.comDiario("obter_decisao_trf1", async () => "[PESQUISA NÃO REALIZADA — HTTP 502]", env)({});
  await lib.comDiario("obter_decisao_trf1", async () => "[PESQUISA NÃO REALIZADA — disjuntor em pausa]", env)({});
  await lib.comDiario("obter_decisao_trf1", async () => "tudo certo", env)({});
  assert.equal(lib.lerErros(30, env).length, 2);
  await assert.rejects(lib.comDiario("obter_decisao_trf1", async () => { throw new Error("boom"); }, env)({}), /boom/);
  assert.equal(lib.lerErros(30, env).length, 3);
  // arquivo de erros ilegível/ausente não quebra a anotação
  assert.equal(lib.registrarErro("x", { texto: "y" }, { TRF1_MCP_ARQUIVO_ERROS: "/nao/existe/erros.jsonl" }), null);
  assert.ok(lib.carimboNaoRealizada("HTTP 500 no portal").includes("diagnostico_erros_trf1` com relatorio=true"));
  assert.ok(!lib.carimboNaoRealizada("disjuntor em pausa").includes("diagnostico_erros_trf1"));
});

test("v1.5.0: julgados que citam / linha do tempo (parte sem rede)", async () => {
  assert.ok(lib.sinalAfastamento("o caso é distinto: hipótese diversa da do precedente") && !lib.sinalAfastamento("aplica-se o precedente ao caso"));
  const jan = lib.janelasDestacadas({ ementa: "a ".repeat(200) + "conforme «0011441-43.2015.4.03.6301» firmou a tese", decisao: "" });
  assert.ok(jan.length === 1 && jan[0].includes("«0011441-43.2015.4.03.6301»") && jan[0].length < 700, JSON.stringify(jan));
  assert.deepEqual(lib.janelasDestacadas({ ementa: "sem destaque", decisao: "" }), []);
  const lt = lib.formatarLinhaDoTempo([{ ano: 2023, total: 120, julgamentos: 40, res: [["provido", 25], ["desprovido", 15]] }], "x · 2023–2023");
  assert.ok(lt.includes("| 2023 | 120 | 40 | 25 provido, 15 desprovido |") && lt.includes("nunca prova de superação") && !lt.startsWith("[PESQUISA"));
  assert.ok(lib.formatarLinhaDoTempo([{ ano: 2023, total: 1, julgamentos: 1, res: [] }], "x", "parou em 2024").startsWith("[PESQUISA INCOMPLETA — parou em 2024]"));
  const falha = () => { throw new Error("sem rede: não deveria chegar aqui"); };
  assert.ok((await lib.linhaDoTempo({}, falha)).includes("Erro de parâmetro"));
  assert.ok((await lib.linhaDoTempo({ consulta: "tese", ano_inicio: 2010, ano_fim: 2020 }, falha)).includes("Erro de parâmetro"));
  assert.ok((await lib.julgadosQueCitam({ numero: "123", base: "trf1", limite: 5 }, falha)).includes("Erro de parâmetro"));
  assert.ok((await lib.julgadosQueCitam({ numero: "0011441-43.2015.4.03.6301", base: "zzz" }, falha)).includes("Erro de parâmetro"));
});

test("v1.5.0 red team 12/10/2026: regressões (votação, sanitização, args, recibos, fatos, diário)", async (t) => {
  assert.equal(lib.votacaoDeclarada("Decide a Turma, por unanimidade, negar provimento, nos termos do precedente julgado por maioria (AC 1234)."), "unânime");
  assert.equal(lib.votacaoDeclarada("A Turma, por unanimidade, deu provimento, considerando vencido o prazo prescricional."), "unânime");
  assert.equal(lib.votacaoDeclarada("Decide a Turma, por maioria, negar provimento, vencido o Des. Fulano."), "por maioria");
  const s = lib.sanitizar("relator 'João da Silva' consulta «Fulano de Tal» proc 2009.34.00.012345-6 e 12345-67.2019.4.01.3400 e 1234567 url https://x.br/a;jsessionid=ABC?q=1 a@b.com");
  for (const v of ["João", "Fulano", "2009.34", "12345-67", "1234567", "jsessionid", "a@b.com"]) assert.ok(!s.includes(v), `${v}: ${s}`);
  assert.deepEqual(lib.descreverArgs({ fonte: "Fulano", base: "trf1 João", tipo: ["Maria Souza"], pagina: 2, tipo_data: "julgamento" }),
    { fonte: "<valor fora da lista>", base: "<valor fora da lista>", tipo: ["<valor fora da lista>"], pagina: 2, tipo_data: "julgamento" });
  const a0 = Date.now(); lib.sanitizar('"' + "a".repeat(400000)); lib.sanitizar("a.".repeat(400000) + "@");
  assert.ok(Date.now() - a0 < 2000, "sanitizar lento");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trf1-mcpb-rt-"));
  // diário: só o motivo entre colchetes
  const arqOrig = lib._arquivoEstadoAtual();
  lib._setArquivoEstadoParaTeste(path.join(dir, "estado.json"));
  t.after(() => { lib._resetDisjuntorParaTeste(); lib._setArquivoEstadoParaTeste(arqOrig); });
  const env = { TRF1_MCP_ARQUIVO_ERROS: path.join(dir, "e.jsonl") };
  await lib.comDiario("linha_do_tempo_trf1", async () => "[PESQUISA INCOMPLETA — parou em 2022 (HTTP 503)]\n**Linha do tempo no TRF1** (Maria Souza aposentadoria · 2021–2023 · órgão: Gab. Des. Fulano)", env)({});
  const txt = fs.readFileSync(env.TRF1_MCP_ARQUIVO_ERROS, "utf-8");
  assert.ok(!txt.includes("Maria") && !txt.includes("Fulano") && txt.includes("HTTP 503"), txt);
  // recibos: campo não-string e termo só com $
  const rd = path.join(dir, "rec"); fs.mkdirSync(rd);
  const texto = "aposentadoria especial do segurado";
  fs.writeFileSync(path.join(rd, "9.json"), JSON.stringify({ id_documento: "9", texto, sha256: crypto.createHash("sha256").update(texto).digest("hex"), data_julgamento: 20200101, base: "trf1" }));
  assert.ok(lib.buscarRecibos({ consulta: "aposentadoria", pasta: rd }).includes("9"));
  assert.ok(lib.buscarRecibos({ consulta: "$", pasta: rd }).includes("BUSCA LOCAL NÃO REALIZADA"));
  assert.ok(lib.buscarRecibos({ grupos: [["$", "*"]], pasta: rd }).includes("BUSCA LOCAL NÃO REALIZADA"));
  // fatos
  const f1 = lib.fatosDoJulgado("RELATÓRIO\nPUIL interposto contra acórdão que reformou a sentença. É o relatório.\nVoto\nNego provimento ao recurso por unanimidade, pois a tese não procede.\n");
  assert.ok(f1 && !f1[1].includes("Nego"));
  assert.equal(lib.fatosDoJulgado("RELATÓRIO\nRelatório dispensado (art. 38 da Lei 9.099/95), conforme a regra do rito sumaríssimo.\nVOTO\nNego provimento.\n"), null);
});

test("estado do disjuntor: caminho absoluto de usuário, sem %20 nem barra antes da letra do drive (relato Windows 12/10/2026)", async () => {
  const m = await import("../server/lib.js");
  const c = m._arquivoEstadoAtual();
  assert.ok(path.isAbsolute(c), c);
  assert.ok(!/%20|^[\\/][A-Za-z]:/.test(c), c);
});

test("origem que não casa: o zero é atribuído ao filtro, não ao assunto (relato Windows 12/10/2026)", () => {
  const out = lib.formatBusca([], 0, { consulta_montada: "consignado", tipos: [], fontes: [], pagina: 1, por_pagina: 10, filtros: { origem: "RO" }, base: "trf1" });
  assert.match(out, /filtro `origem`.*TRIBUNAL de origem/);
});

test("origem: UF, seção judiciária e estado são recusados ANTES da requisição; o campo certo passa", async () => {
  assert.ok(lib.validarOrigem("RO") && lib.validarOrigem("SEÇÃO JUDICIÁRIA DE RONDÔNIA") && lib.validarOrigem("Rondônia"));
  assert.equal(lib.validarOrigem("TRF - PRIMEIRA REGIÃO"), "");
  let chamou = false;
  const out = await lib.buscar({ consulta: "x", origem: "RO", base: "trf1" }, async () => { chamou = true; throw new Error("não devia chamar"); });
  assert.match(out, /Erro de parâmetro.*Nada foi consultado/s);
  assert.equal(chamou, false);
});

test("diário: rede local, certificado e conexão interrompida são tipos diferentes", () => {
  assert.equal(lib.tipoDoErroDiario("getaddrinfo ENOTFOUND x"), "dns_ou_rede_local");
  assert.equal(lib.tipoDoErroDiario("unable to verify the first certificate"), "certificado");
  assert.equal(lib.tipoDoErroDiario("TypeError: fetch failed — causa: ECONNRESET"), "conexao_interrompida");
});

test("regressão v1.5.2: cada parâmetro do painel avançado tem a SUA descrição (relator, órgão, classe, origem, ementa, referência)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "server", "index.js"), "utf-8");
  const descr = {};
  for (const k of ["relator", "orgao_julgador", "classe", "origem", "ementa_decisao", "referencia_legislativa"]) {
    const m = new RegExp(`\\n\\s+${k}: z\\.string\\(\\)\\.optional\\(\\)\\.describe\\("([^"]+)"`).exec(src);
    assert.ok(m, k);
    descr[k] = m[1];
  }
  assert.equal(new Set(Object.values(descr)).size, 6, JSON.stringify(descr));
  assert.match(descr.origem, /TRIBUNAL de origem/);
  assert.doesNotMatch(descr.relator, /Origem/);
});

test("data do índice que diverge da sessão citada no dispositivo vira aviso; coerente ou sem sessão, não", () => {
  assert.match(lib.avisoDataSessao({ data_julgamento: "04/02/2026", decisao: "Decide a Turma, por unanimidade, na sessão virtual de 21/07/2025 a 25/07/2025, negar provimento." }), /diverge da sessão/);
  assert.equal(lib.avisoDataSessao({ data_julgamento: "23/07/2025", decisao: "Na sessão virtual de 21/07/2025 a 25/07/2025, por unanimidade." }), "");
  assert.equal(lib.avisoDataSessao({ data_julgamento: "04/02/2026", decisao: "por unanimidade, negar provimento" }), "");
});

test("filtro de órgão 'recursal' avisa do nome novo 'TURMA 4.0 - ADJUNTA'", () => {
  const out = lib.formatBusca([], 0, { consulta_montada: "x", tipos: [], fontes: [], pagina: 1, por_pagina: 10, filtros: { orgao_julgador: "PRIMEIRA TURMA RECURSAL" }, base: "trf1" });
  assert.match(out, /TRECHO do nome/);
});

test("TESE DA EMENTA (porte do TJRO v1.29.0): literal, só quando não cabe no trecho, cortada em item inteiro", () => {
  const emt = "EMENTA DIREITO CIVIL. I. CASO EM EXAME Apelação. II. QUESTÃO EM DISCUSSÃO Dano moral. III. RAZÕES DE DECIDIR Fundamento. IV. DISPOSITIVO E TESE Recurso provido. Tese de julgamento: 1. A negativação indevida gera dano moral. 2. O valor segue a razoabilidade. Dispositivos relevantes citados: CDC, art. 42.";
  assert.deepEqual(lib.teseDaEmenta(emt), { texto: "1. A negativação indevida gera dano moral. 2. O valor segue a razoabilidade.", total: 2, exibidos: 2, completa: true });
  assert.equal(lib.teseDaEmenta("EMENTA sem seções. Recurso provido."), null);
  assert.equal(lib.teseDaEmenta("I. CASO EM EXAME x. IV. DISPOSITIVO E TESE Recurso provido."), null);
  const longa = "I. CASO EM EXAME x. IV. DISPOSITIVO E TESE Recurso provido. Teses de julgamento: " + [1, 2, 3, 4].map((n) => `${n}. ` + "Item longo da tese. ".repeat(20)).join(" ");
  const tl = lib.teseDaEmenta(longa);
  assert.equal(tl.completa, false); assert.equal(tl.total, 4); assert.equal(tl.exibidos, 2); assert.ok(tl.texto.length <= 1000 && !tl.texto.includes("3. Item"));
  assert.match(lib.linhaTese(tl), /TESE INCOMPLETA: 2 de 4 itens; abra o inteiro teor antes de fichar/);
  assert.ok(lib.linhaTese(lib.teseDaEmenta(emt)).startsWith("TESE DA EMENTA (literal; tese enunciada pelo órgão, não prova de ratio): «1. A negativação"));
  const emlonga = "DIREITO X. I. CASO EM EXAME " + "texto do caso. ".repeat(120) + "IV. DISPOSITIVO E TESE Recurso «provido». Tese de julgamento: 1. A tese «literal» do órgão.";
  const lt = lib.linhaTeseDaBusca(emlonga);
  assert.ok(lt.includes("literal") && !lt.split("«", 2)[1].split("»")[0].includes("«"));
  assert.equal(lib.linhaTeseDaBusca(emt), ""); assert.equal(lib.linhaTeseDaBusca(""), "");
});

// ============================================================================================================
// v1.6.0 — lote 1 do porte do TJRO v1.30–v1.37 (espelho do selftest do Python v1.5.5, commit 790f487)
// ============================================================================================================
const docs02 = () => lib.parsearDocumentos(lib.extrairUpdate(ler("02_busca_dano_moral.xml"), "formulario"), "trf1");
const docs04 = () => lib.parsearDocumentos(lib.extrairUpdate(ler("04_pagina2.xml"), "formulario:tabelaDocumentos"), "trf1");
const M1 = { consulta_montada: "x", pagina: 1, por_pagina: 30, base: "trf1" };

test("v1.6.0 (1) julgado recente 🆕: até 30 dias, pela data do índice ou do fecho; futura/impossível não conta", () => {
  const h = "2026-10-17";
  assert.equal(lib.diasRecente({ data_julgamento: "10/10/2026" }, h), 7);
  assert.equal(lib.diasRecente({ data_julgamento: "17/09/2026" }, h), 30);
  assert.equal(lib.diasRecente({ data_julgamento: "16/09/2026" }, h), null);
  assert.equal(lib.diasRecente({ data_julgamento: "20/10/2026" }, h), null);
  assert.equal(lib.diasRecente({ data_julgamento: "31/11/2026" }, h), null);
  assert.equal(lib.diasRecente({}, h), null);
  assert.equal(lib.diasRecente({ data_julgamento: "01/08/2026", data_fecho: "10/10/2026" }, h), 7);   // vale a menor distância
  const rec = { ...docs02()[0], data_julgamento: "10/10/2026", data_publicacao: "" };
  const sr = lib.formatBusca([rec], 1, { ...M1, hoje: h });
  assert.ok(sr.includes("Julgamento: 10/10/2026 🆕") && sr.includes("🆕 JULGADO RECENTE (7 dia(s)): pode ainda não ter sido publicado e cabe embargos de declaração"), sr);
  assert.ok(!lib.formatBusca([rec], 1, { ...M1, hoje: "2026-12-01" }).includes("JULGADO RECENTE"));
  assert.equal(lib.diasRecente({ data_julgamento: lib_hoje() }, undefined), 0);   // sem `hoje`: relógio local
});
function lib_hoje() { const d = new Date(); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; }

test("v1.6.0 (3) consulta pouco seletiva: a partir de 1.000 documentos, em qualquer página", () => {
  const d0 = docs02()[0];
  assert.ok(lib.formatBusca([d0], 1000, M1).includes("Consulta pouco seletiva (1000 documentos)"));
  assert.ok(!lib.formatBusca([d0], 999, M1).includes("pouco seletiva"));
  assert.ok(lib.formatBusca([d0], 1500, { ...M1, pagina: 3 }).includes("pouco seletiva"));
});

test("v1.6.0 (5) rótulo PARCIAL nas duas ordens; 'parcial' de embargos só quando é da oração dos embargos", () => {
  for (const t of ["A Turma, por unanimidade, deu parcial provimento à apelação.", "RECURSO PROVIDO PARCIALMENTE.", "apelação provida em parte",
    "A Turma, por unanimidade, deu provimento parcial à apelação.", "A TNU decidiu, por maioria, CONHECER e PROVER PARCIALMENTE o pedido."]) {
    const c = lib.resultadoDe(t);
    assert.ok(c.has("PARCIAL") && c.has("PROVIDO") && lib.rotuloDoConjunto(c) === "PARCIAL", `${t} ${[...c]}`);
  }
  for (const t of ["A Turma, por unanimidade, negou provimento à apelação.", "A TNU decidiu CONHECER PARCIALMENTE do recurso e, nesse ponto, a ele NEGAR PROVIMENTO.", "A Turma deu provimento à apelação."]) {
    assert.ok(!lib.resultadoDe(t).has("PARCIAL"), t);
  }
  const ep = lib.resultadoDe("A Turma, por unanimidade, acolheu parcialmente os embargos de declaração.");
  assert.ok(ep.has("ACOLHIDO") && ep.has("PARCIAL") && lib.rotuloDoConjunto(ep, true) === "PARCIAL", [...ep].join());
  assert.ok(lib.resultadoDe("Embargos de declaração parcialmente acolhidos.").has("PARCIAL") && lib.resultadoDe("embargos de declaração acolhidos em parte").has("PARCIAL"));
  const ei = lib.resultadoDe("A Turma acolheu os embargos de declaração, para dar parcial provimento ao recurso.");
  assert.ok(ei.has("ACOLHIDO") && !ei.has("PARCIAL"), [...ei].join());   // o parcial é do recurso, não dos embargos
  assert.ok(lib.resultadoDe("negar provimento aos embargos de declaração").has("REJEITADO") && !lib.resultadoDe("negar provimento aos embargos de declaração").has("DESPROVIDO"));
  assert.ok(lib.resultadoDe("dou provimento ao recurso", "EMBARGOS DE DECLARAÇÃO NA APELAÇÃO CIVEL (EDAC)").has("ACOLHIDO"));
  assert.ok(!lib.resultadoDe("dou provimento ao recurso", "EMBARGOS DE DECLARAÇÃO CÍVEL (EDCIV)").has("PROVIDO"));
  assert.ok(lib.resultadoDe("embargos NÃO acolhidos").has("REJEITADO") && !lib.resultadoDe("embargos NÃO acolhidos").has("ACOLHIDO"));
  assert.ok(lib.resultadoDe("embargos de terceiro: dar provimento ao recurso").has("PROVIDO") && !lib.resultadoDe("embargos de terceiro: dar provimento ao recurso").has("ACOLHIDO"));
  assert.equal(lib.rotuloDoConjunto(new Set(["REJEITADO", "PROVIDO"])), "PROVIDO");   // preliminar rejeitada não torna ambíguo o mérito
  assert.equal(lib.rotuloDoConjunto(new Set(["REJEITADO", "PROVIDO"]), true), "REJEITADO");
  assert.equal(lib.rotuloDoConjunto(new Set(["PROVIDO", "DESPROVIDO"])), null);
  assert.equal(lib.rotuloDoConjunto(new Set(["ACOLHIDO", "REJEITADO"]), true), null);
  const d0 = docs02()[0];
  const ra = lib.resumoResultadosPagina(["deu parcial provimento", "deu provimento", "negou provimento", "deu parcial provimento"].map((t, i) => ({ ...d0, numero_digitos: String(i), decisao: t })));
  assert.ok(ra.contagem.PARCIAL === 2 && ra.contagem.PROVIDO === 1 && ra.contagem.DESPROVIDO === 1, JSON.stringify(ra));
  assert.ok(lib.formatBusca(Array.from({ length: 3 }, (_, i) => ({ ...d0, numero_digitos: String(i), decisao: "deu parcial provimento" })), 3, M1).includes("parcial (provido ou acolhido em parte)"));
});

test("v1.6.0 (4) resultados opostos só no MESMO julgamento; embargos não se comparam com apelação; o aviso diz qual é qual", () => {
  const d0 = docs02()[0];
  const ap = { ...d0, id: "A1", tipo: "Acórdão", classe: "APELAÇÃO CIVEL (AC)", data_julgamento: "01/02/2025", decisao: "A Turma, por unanimidade, deu parcial provimento à apelação." };
  const mo = { ...ap, id: "B2", tipo: "Decisão Monocrática", decisao: "Nego provimento ao recurso." };
  const av = lib.avisosOpostos([ap, mo]);
  assert.ok(av.length === 1 && av[0].includes("id A1 (Acórdão): parcial (provido ou acolhido em parte)") && av[0].includes("id B2 (Decisão Monocrática): desprovido") && av[0].includes("01/02/2025"), av.join());
  const edR = { ...ap, id: "C3", classe: "EMBARGOS DE DECLARAÇÃO NA APELAÇÃO CIVEL (EDAC)", decisao: "A Turma, por unanimidade, rejeitou os embargos de declaração." };
  assert.deepEqual(lib.avisosOpostos([{ ...ap, decisao: "A Turma deu provimento à apelação." }, edR]), []);   // apelação provida × embargos rejeitados: normal
  const pa = { ...ap, id: "D4", decisao: "A Turma acolheu a preliminar de ilegitimidade." };
  const pr = { ...ap, id: "E5", decisao: "A Turma rejeitou a preliminar de cerceamento." };
  assert.deepEqual(lib.avisosOpostos([pa, pr]), []);   // "preliminar acolhida × rejeitada" fora de embargos era falso alarme
  const e1 = { ...edR, id: "F6", decisao: "A Turma acolheu os embargos de declaração." };
  const av2 = lib.avisosOpostos([e1, edR]);
  assert.ok(av2.length === 1 && av2[0].includes("id F6 (Acórdão): acolhido") && av2[0].includes("id C3 (Acórdão): rejeitado"), av2.join());
  assert.deepEqual(lib.avisosOpostos([{ ...ap, data_julgamento: "" }, { ...mo, data_julgamento: "" }]), []);   // sem data não se presume mesmo julgamento
  const ent = { ...ap, id: "G7", data_julgamento: "01/02/2024", decisao: "A Turma deu provimento à apelação." };
  const ent2 = { ...ap, id: "H8", data_julgamento: "01/06/2025", decisao: "A Turma negou provimento ao agravo interno." };
  const ae = lib.avisosEntreJulgamentos([ent, ent2]);
  assert.ok(ae.length === 1 && ae[0].includes("01/02/2024 (id G7): provido") && ae[0].includes("01/06/2025 (id H8): desprovido"), ae.join());
  assert.deepEqual(lib.avisosEntreJulgamentos([ent, { ...edR, data_julgamento: "01/06/2025" }]), []);   // embargos rejeitados depois da apelação provida: o normal
  const ae3 = lib.avisosEntreJulgamentos([ent, { ...e1, data_julgamento: "01/06/2025" }]);
  assert.ok(ae3.length === 1 && ae3[0].includes("Embargos de declaração ACOLHIDOS em 01/06/2025 (id F6)"), ae3.join());
  assert.ok(lib.formatBusca([ap, mo], 2, M1).includes("declaram resultados opostos: id A1"));
});

test("v1.6.0 (6) embargos acolhidos: a frase literal do dispositivo, sem rótulo de subtipo", () => {
  const fd = "Decide a Turma, por unanimidade, acolher os embargos de declaração para sanar omissão, nos termos do art. 1.022 do CPC. Desembargador Federal X Relator";
  assert.equal(lib.fraseDosEmbargos(fd), "Decide a Turma, por unanimidade, acolher os embargos de declaração para sanar omissão, nos termos do art. 1.022 do CPC.");
  assert.ok(lib.fraseDosEmbargos("A Turma, por unanimidade, acolheu os embargos de declaração da parte autora e rejeitou embargos de declaração da União.").startsWith("A Turma, por unanimidade, acolheu os embargos"));
  assert.equal(lib.fraseDosEmbargos("Decide a Turma, por unanimidade, rejeitar os embargos de declaração."), "");
  assert.equal(lib.fraseDosEmbargos(""), "");
  assert.ok(lib.fraseDosEmbargos("acolher os embargos de declaração " + "x ".repeat(400)).length <= 361);
  const d0 = docs02()[0];
  const ap = { ...d0, id: "A1", tipo: "Acórdão", classe: "APELAÇÃO CIVEL (AC)", data_julgamento: "01/02/2025", decisao: "A Turma, por unanimidade, deu parcial provimento à apelação." };
  const edR = { ...ap, id: "C3", classe: "EMBARGOS DE DECLARAÇÃO NA APELAÇÃO CIVEL (EDAC)", decisao: "A Turma, por unanimidade, rejeitou os embargos de declaração." };
  const sed = lib.formatBusca([{ ...ap, classe: "EMBARGOS DE DECLARAÇÃO NA APELAÇÃO CIVEL (EDAC)", decisao: "A Turma, por unanimidade, acolheu os embargos de declaração." }], 1, M1);
  assert.ok(sed.includes("✏️ Embargos acolhidos, frase do dispositivo (literal") && sed.includes("«A Turma, por unanimidade, acolheu os embargos de declaração.»"), sed);
  assert.ok(!lib.formatBusca([edR], 1, M1).includes("✏️") && !lib.formatBusca([ap], 1, M1).includes("✏️"));
});

test("v1.6.0 (2) placar do limitador: só lê o estado, nenhuma requisição nova", (t) => {
  const arqOrig = lib._arquivoEstadoAtual();
  lib._setArquivoEstadoParaTeste(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "trf1-mcpb-ritmo-")), "estado.json"));
  t.after(() => { lib._resetDisjuntorParaTeste(); lib._setArquivoEstadoParaTeste(arqOrig); });
  lib._resetDisjuntorParaTeste();
  const l0 = lib.linhaDeRitmo();
  assert.ok(l0.includes("0 de 24 requisições") && l0.includes("nível 1 de 5") && l0.includes("todos os processos desta extensão nesta máquina"), l0);
  lib.reservarRequisicao(); lib.reservarRequisicao();
  assert.ok(lib.linhaDeRitmo().includes("2 de 24 requisições na janela atual de 1min"), lib.linhaDeRitmo());
  assert.ok(lib.linhaDeRitmo().includes("2 de 24"));   // ler o placar não gasta requisição
  assert.equal(JSON.parse(fs.readFileSync(lib._arquivoEstadoAtual(), "utf8")).totalRequisicoes, 2);
  fs.writeFileSync(lib._arquivoEstadoAtual(), "{ lixo");   // estado ilegível: nível máximo, sem lançar
  assert.ok(lib.linhaDeRitmo().includes("nível 5 de 5"));
});

test("v1.6.0 (7) consulta grande recusada: diz o tamanho, manda reduzir, sem prometer limiar", () => {
  const dg = lib.dicaConsultaGrande("o portal respondeu algo inesperado (esperava xml; veio HTTP 500, content-type='text/html')", "(a OU b) E (c OU d OU e)", [["a", "b"], ["c", "d", "e"]]);
  assert.ok(dg.includes("2 grupo(s) e 5 termo(s)") && dg.includes("use `grupos`") && dg.includes("divida em duas buscas") && dg.includes("não está provado"), dg);
  assert.ok(lib.dicaConsultaGrande("BRSResultSet.errWhenExecutingSearch", "servidor$ OU tribut$ OU compet$", null).includes("1 grupo(s) e 3 termo(s)"));
  assert.equal(lib.dicaConsultaGrande("falha de rede (ReadTimeout)", "a OU b", null), "");
  assert.equal(lib.dicaConsultaGrande("disjuntor em pausa", "a", null), "");
});

// portal simulado: GET devolve o formulário (fixture 01), POST devolve a busca (fixture 02) e, na paginação, a tabela com os documentos pedidos
function portalFalso({ status500 = false, htmlDocsPagina = null } = {}) {
  let n = 0;
  return async (url, init = {}) => {
    n++;
    const get = !init.method || init.method === "GET";
    if (get) return new Response(ler("01_index.html"), { status: 200, headers: { "content-type": "text/html;charset=UTF-8" } });
    if (status500) return new Response("<html>erro</html>", { status: 500, headers: { "content-type": "text/html" } });
    const corpo = String(init.body || "");
    if (htmlDocsPagina && /first=/.test(corpo)) {
      return new Response(`<?xml version="1.0"?><partial-response><changes><update id="formulario:tabelaDocumentos"><![CDATA[${htmlDocsPagina}]]></update></changes></partial-response>`,
        { status: 200, headers: { "content-type": "text/xml;charset=UTF-8" } });
    }
    return new Response(ler("02_busca_dano_moral.xml"), { status: 200, headers: { "content-type": "text/xml;charset=UTF-8" } });
  };
}

test("v1.6.0 (7/8/2) fluxo de buscar com portal simulado: consulta grande, saída grande e placar de ritmo", async (t) => {
  const arqOrig = lib._arquivoEstadoAtual();
  lib._setArquivoEstadoParaTeste(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "trf1-mcpb-fluxo-")), "estado.json"));
  t.after(() => { lib._resetDisjuntorParaTeste(); lib._setArquivoEstadoParaTeste(arqOrig); });
  lib._resetDisjuntorParaTeste();
  const envT = { TRF1_MCP_DIR_RECIBOS: fs.mkdtempSync(path.join(os.tmpdir(), "trf1-mcpb-recibos-")) };   // a busca grava recibo: nunca na pasta real
  t.after(() => fs.rmSync(envT.TRF1_MCP_DIR_RECIBOS, { recursive: true, force: true }));
  // 500 do portal: PESQUISA NÃO REALIZADA com o tamanho da consulta
  const e500 = await lib.buscar({ grupos: [["a", "b"], ["c"], ["d", "e", "f"]] }, portalFalso({ status500: true }), envT);
  assert.ok(e500.startsWith("[PESQUISA NÃO REALIZADA") && e500.includes("3 grupo(s) e 6 termo(s)") && e500.includes("divida em duas buscas"), e500);
  lib._resetDisjuntorParaTeste();
  // saída grande: 60 documentos pedidos como página de 50 -> corta no limite de um resultado, mantém o resumo, tira a próxima página
  const htmlDocs = lib.extrairUpdate(ler("02_busca_dano_moral.xml"), "formulario") + lib.extrairUpdate(ler("04_pagina2.xml"), "formulario:tabelaDocumentos");
  const gr = await lib.buscar({ consulta: "dano moral", por_pagina: 50 }, portalFalso({ htmlDocsPagina: htmlDocs }), envT);
  assert.ok(gr.includes("Consulta pouco seletiva (25943 documentos)"), gr.slice(0, 400));
  assert.ok(gr.includes("SAÍDA CORTADA:") && gr.includes("resultados cabem aqui") && gr.includes("por_pagina=10 e pagina=1") && !gr.includes("Próxima página"), gr.slice(-900));
  assert.ok(gr.trimEnd().endsWith("Se o seu roteiro tem teto por frente, conte as suas chamadas: este número só diz o fôlego do limitador._"));
  assert.ok(gr.length < lib.SAIDA_MAX_CHARS + 1500 && gr.includes("Resumo desta página") && gr.includes("**1. "));
  const kk = Number(gr.split("SAÍDA CORTADA: ")[1].split(" de ")[0]);
  assert.ok(gr.includes(`**${kk}. `) && !gr.includes(`**${kk + 1}. `));
  assert.ok(/_Ritmo do portal: \d+ de 24 requisições/.test(gr));
});

test("v1.6.0 (8) limitarSaidaBusca: corta no limite de um resultado e mantém o rodapé", () => {
  assert.equal(lib.limitarSaidaBusca("curto"), "curto");
  const grande = "cab\n" + Array.from({ length: 10 }, (_, i) => `\n**${i + 1}. Acórdão — x**\n  ` + "y".repeat(3000)).join("") + "\n\nResumo desta página: ok\nPróxima página: pagina=2";
  const lg = lib.limitarSaidaBusca(grande, 10000, 1, 30);
  assert.ok(lg.includes("SAÍDA CORTADA: 3 de 10") && lg.includes("Resumo desta página: ok") && !lg.includes("Próxima página") && !lg.includes("**4. ") && lg.includes("**3. ") && lg.length <= 10000, lg.slice(-400));
});

test("v1.6.0 (9) alertas que dizem ONDE: VOTO DIVERGENTE mostra a abertura; OBITER mostra a frase", () => {
  const votoTr = "RELATÓRIO. O INSS sustenta que o benefício é indevido porque o segurado voltou a trabalhar. VOTO. Nesse sentido, transcrevo: EMENTA: PREVIDENCIÁRIO. AUXÍLIO-DOENÇA. O retorno ao trabalho não impede " +
    "a percepção do benefício quando comprovada a incapacidade. Recurso conhecido e provido. (STJ, REsp 1.234.567/RS, Rel. Min. Fulano, DJe 01/01/2020). No caso dos autos, entendo que a " +
    "incapacidade ficou provada e o retorno ao trabalho foi tentativa frustrada. Fixo a seguinte tese: 'o retorno ao trabalho por tentativa não afasta o direito ao benefício'. Não há como acolher o pedido " +
    "de repetição dos valores recebidos de boa-fé. Peço vênia para divergir do relator: o retorno ao trabalho afasta o benefício desde o primeiro dia.";
  const ad = lib.conferir(votoTr, "afasta o benefício desde o primeiro dia", "TNU").alertas.find((a) => a.startsWith("VOTO DIVERGENTE"));
  assert.ok(ad.includes("Essa parte começa assim: «Peço vênia para divergir do relator"), ad);
  const tnuV = "Documento:1\nTIMBRE\nRELATOR : Juiz Federal FULANO DE TAL\nRELATÓRIO\nTrata-se de pedido de uniformização contra acórdão que negou o benefício assistencial.\n" +
    "VOTO\nNego provimento ao pedido, pois a renda familiar supera o limite legal.\nassinado por FULANO DE TAL,\n" +
    "Documento:2\nTIMBRE\nRELATOR : Juiz Federal FULANO DE TAL\nVOTO-VISTA\nPeço vênia ao relator para divergir, porque a renda per capita deve excluir os gastos com medicamentos de alto custo.\nassinado por BELTRANO SILVA,\n" +
    "Documento:3\nTIMBRE\nRELATOR : Juiz Federal FULANO DE TAL\nACÓRDÃO\nA Turma Nacional de Uniformização decidiu, por maioria, negar provimento. Brasília, 10 de maio de 2025.\n";
  const av3 = lib.conferir(tnuV, "a renda per capita deve excluir os gastos com medicamentos de alto custo", "TNU").alertas.find((a) => a.startsWith("VOTO DIVERGENTE"));
  assert.ok(av3.includes("Esse voto começa assim: «VOTO-VISTA Peço vênia ao relator para divergir"), av3);
  const ob = "A sentença merece reforma. Ainda que assim não fosse, o benefício seria indevido porque a parte não comprovou a incapacidade laboral para o trabalho habitual.";
  const ao = lib.conferir(ob, "o benefício seria indevido porque a parte não comprovou a incapacidade laboral", "TNU").alertas.find((a) => a.startsWith("OBITER"));
  assert.ok(ao.endsWith("A frase: «Ainda que assim não fosse,» + o trecho."), ao);
  const ao2 = lib.conferir(ob, "Ainda que assim não fosse, o benefício seria indevido porque a parte não comprovou", "TNU").alertas.find((a) => a.startsWith("OBITER"));
  assert.ok(ao2.endsWith("A marca está no começo do próprio trecho citado."), ao2);
});

test("v1.6.0 (10) FATOS DO JULGADO: o ÚLTIMO 'caso em exame' fora de transcrição; relator vencido avisa", () => {
  const pEmenta = "EMENTA. I. CASO EM EXAME Pedido de uniformização sobre o benefício assistencial do autor, com renda familiar discutida nos autos. II. QUESTÃO EM DISCUSSÃO Renda. IV. DISPOSITIVO E TESE Recurso provido.";
  const outra = "Nesse sentido, transcrevo: EMENTA: I. CASO EM EXAME Ação previdenciária sobre aposentadoria rural de outra segurada, em processo diverso deste. " +
    "II. QUESTÃO EM DISCUSSÃO Prova. IV. DISPOSITIVO E TESE Recurso desprovido. (TRF4, AC 5000000-00.2020.4.04.9999, Rel. Des. Fulano, julgado em 01/01/2021).";
  const it2 = "VOTO\nNo caso dos autos, a renda familiar excede o limite. " + outra + " Assim, aplico o precedente.\n" + pEmenta;
  const f2 = lib.fatosDoJulgado(it2);
  assert.ok(f2 && f2[0] === "ementa › caso em exame" && f2[1].startsWith("Pedido de uniformização sobre o benefício assistencial"), JSON.stringify(f2));
  assert.ok(lib.fatosDoJulgado(pEmenta)[1].startsWith("Pedido de uniformização") && lib.fatosDoJulgado(it2.replace("(TRF4,", "(xx,")) !== null);
  const rel = "RELATÓRIO\nTrata-se de pedido de uniformização contra acórdão da turma recursal que negou o benefício assistencial ao autor idoso.\nVOTO\nNego provimento ao pedido.\n";
  const venc = { inteiro_teor_texto: rel + "ACÓRDÃO\nA Turma Nacional de Uniformização decidiu, por maioria, vencido o relator, dar provimento ao pedido.", relator_texto: "X", relator_acordao_texto: "" };
  assert.ok(lib.linhaFatos(venc).includes("Relator VENCIDO: o voto que segue o relatório é o vencido"));
  const venc2 = { inteiro_teor_texto: rel + "ACÓRDÃO\nA TNU decidiu, por maioria, dar provimento.", relator_texto: "Juiz Federal FULANO", relator_acordao_texto: "Juiz Federal BELTRANO" };
  assert.ok(lib.linhaFatos(venc2).includes("relator do acórdão: Juiz Federal BELTRANO"));
  assert.ok(!lib.linhaFatos({ inteiro_teor_texto: rel + "ACÓRDÃO\nA TNU decidiu, por unanimidade, negar provimento.", relator_texto: "Juiz Federal FULANO", relator_acordao_texto: "" }).includes("VENCIDO"));
  assert.ok(!lib.linhaFatos({ ...venc, inteiro_teor_texto: pEmenta + " vencido o relator" }).includes("VENCIDO"));   // fatos da ementa do acórdão: nada a avisar
  // o "É o breve relatório" que fecha o trecho: \b do Python é Unicode, o do JS não — o É inicial precisa de fronteira própria
  const itB = "RELATÓRIO\nTrata-se de pedido de uniformização contra acórdão da turma recursal que negou o benefício assistencial ao autor idoso, distribuído à minha relatoria. É o breve relatório\nVOTO\nNego.";
  assert.ok(!lib.linhaFatos({ inteiro_teor_texto: itB }).includes("É o breve relatório"));
});

test("v1.6.0 (11) TESE DA EMENTA: corte acima de 1.000 caracteres igual ao rfind(\". \", 0, teto + 1) do Python", () => {
  const tesePt = (pos) => "I. CASO EM EXAME x. IV. DISPOSITIVO E TESE Recurso provido. Tese de julgamento: Frase um. " + "a".repeat(pos - 10) + ". " + "b".repeat(400);
  const t1 = lib.teseDaEmenta(tesePt(lib.TESE_MAX - 1)), t2 = lib.teseDaEmenta(tesePt(lib.TESE_MAX)), t3 = lib.teseDaEmenta(tesePt(lib.TESE_MAX - 2));
  assert.ok(t1.texto.length === lib.TESE_MAX && t1.texto.endsWith("a.") && !t1.completa, String(t1.texto.length));   // ponto em teto-1: entra
  assert.ok(t2.texto === "Frase um." && t3.texto.length === lib.TESE_MAX - 1, `${t2.texto.slice(0, 20)} ${t3.texto.length}`);   // ponto em teto: fica de fora
});

// ================================================ v1.6.0 lote 2 (paridade com o selftest "v1.6.0" do Python) ===
const docsDoFixture = (nome, base, comp = "formulario") => lib.parsearDocumentos(lib.extrairUpdate(ler(nome), comp), base);
const pastaTmp = (t, prefixo = "trf1-mcpb-l2-") => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const sha = (arq) => crypto.createHash("sha256").update(fs.readFileSync(arq)).digest("hex");
const respXml = (corpo) => new Response(corpo, { status: 200, headers: { "content-type": "text/xml;charset=UTF-8" } });
// portal simulado POR NÚMERO: formulário (GET), painel avançado (POST ckbAvancada), busca (POST) e o inteiro teor do eproc da TNU (GET)
function portalNumero({ falha = false } = {}) {
  const chamadas = [];
  const f = async (url, init = {}) => {
    chamadas.push(`${init.method || "GET"} ${url}`);
    if (falha) return new Response("<html>erro</html>", { status: 500, headers: { "content-type": "text/html" } });
    const get = !init.method || init.method === "GET";
    const tnu = /\/tnu\//.test(url);
    if (get) {
      if (/eproctnu/.test(url)) return new Response(fs.readFileSync(path.join(fx, "12_tnu_inteiro_teor.html")), { status: 200, headers: { "content-type": "text/html; charset=ISO-8859-1" } });
      return new Response(ler(tnu ? "10_tnu_index.html" : "01_index.html"), { status: 200, headers: { "content-type": "text/html;charset=UTF-8" } });
    }
    if (!/actPesquisar/.test(String(init.body || "")) && /ckbAvancada/.test(String(init.body || ""))) return respXml(ler("05_ckbavancada.xml"));
    return respXml(ler(tnu ? "11_tnu_busca.xml" : "02_busca_dano_moral.xml"));
  };
  f.chamadas = chamadas;
  return f;
}
const comEstadoLimpo = (t) => {
  const arqOrig = lib._arquivoEstadoAtual();
  lib._setArquivoEstadoParaTeste(path.join(pastaTmp(t, "trf1-mcpb-l2-estado-"), "estado.json"));
  t.after(() => { lib._resetDisjuntorParaTeste(); lib._setArquivoEstadoParaTeste(arqOrig); });
  lib._resetDisjuntorParaTeste();
};

test("v1.6.0 L2 (1) recibo gravado pela busca: campos, origem, destaque, nunca sobrescreve, decisão promove", (t) => {
  const dir = pastaTmp(t);
  const env = { TRF1_MCP_DIR_RECIBOS: dir };
  const docs = docsDoFixture("02_busca_dano_moral.xml", "trf1");
  const d0 = docs[0];
  const CHAVES_ANTIGAS = ["id_documento", "nr_processo", "numero", "tribunal", "base", "tipo", "classe", "qualificacao", "data_julgamento", "data_publicacao", "orgao", "orgao_fonte",
    "relator", "relator_texto", "url", "texto", "ementa", "dispositivo", "inteiro_teor_incluido", "inteiro_teor", "trechos_transcritos", "trecho_divergente", "trechos_obiter",
    "normalizacao", "sha256", "versao_servidor", "obtido_em"];
  assert.deepEqual(Object.keys(lib.camposDeCustodia(d0)).sort(), [...CHAVES_ANTIGAS, "origem"].sort());   // o lint continua lendo: só se ACRESCENTA `origem`
  assert.equal(lib.camposDeCustodia(d0).origem, "decisao");
  assert.equal(lib.camposDeCustodia(d0, "busca").origem, "busca");
  assert.equal(lib.camposDeCustodia(d0).versao_servidor, "1.7.2");
  const db = docs.slice(0, 3).map((x, k) => ({ ...x, ementa: k === 0 ? "«dano» " + x.ementa : x.ementa }));
  assert.equal(lib.gravarRecibosDaBusca(db, null, env), 3);
  const rb = lib.lerRecibo(db[0].id, env);
  assert.ok(rb.origem === "busca" && !rb.texto.includes("«") && !rb.ementa.includes("«") && !rb.inteiro_teor_incluido);
  if (process.platform !== "win32") assert.equal(fs.statSync(lib.arqRecibo(db[0].id, env)).mode & 0o777, 0o600);
  const idx = lib.lerIndiceBusca(dir);
  assert.deepEqual(Object.keys(idx).sort(), db.map((x) => x.id).sort());
  assert.ok(Object.values(idx).every((v) => v[0] > 100 && v[1] > 1e12));
  // (a) a busca NUNCA sobrescreve; o recibo de decisão sobrescreve e promove
  const h0 = sha(lib.arqRecibo(db[0].id, env));
  assert.equal(lib.gravarRecibosDaBusca([{ ...db[0], ementa: "TEXTO NOVO diferente" }], null, env), 0);
  assert.equal(sha(lib.arqRecibo(db[0].id, env)), h0);
  assert.ok(lib.gravarRecibo({ ...docs[0], ementa: docs[0].ementa + " (relida)" }, env));
  const rd0 = lib.lerRecibo(docs[0].id, env);
  assert.ok(rd0.origem === "decisao" && rd0.ementa.endsWith("(relida)") && !(docs[0].id in lib.lerIndiceBusca(dir)));
  assert.equal(lib.gravarRecibosDaBusca([{ ...docs[0], ementa: "de novo pela busca" }], null, env), 0);
  assert.equal(lib.lerRecibo(docs[0].id, env).origem, "decisao");
  // mesmo texto: busca e decisão guardam o MESMO `texto` (sem o destaque «»)
  assert.equal(lib.lerRecibo(db[1].id, env).texto, lib.camposDeCustodia(docs[1]).texto);
  // recibo antigo (sem `origem`) conta como decisão
  const { origem: _o, ...antigo } = rd0;
  assert.equal(lib.docDeRecibo(antigo, env).origem_recibo, "decisao");
  assert.equal(lib.docDeRecibo(rb, env).origem_recibo, "busca");
  // (e) buscar_recibos diz a origem de cada recibo
  const brb = lib.buscarRecibos({ grupos: [["dano", "apelação", "recurso", "sentença", "turma", "relida"]], limite: 30 }, env);
  assert.ok(brb.includes("recibo da busca") && brb.includes("recibo de decisão"), brb.slice(-700));
  // documento sem texto ou sem id não vira recibo; id estranho é saneado no nome do arquivo
  assert.equal(lib.gravarRecibosDaBusca([{ id: "", ementa: "x" }, { id: "Z1", ementa: "", decisao: "" }], null, env), 0);
  assert.equal(lib.gravarRecibosDaBusca([{ ...d0, id: "../../etc/passwd" }], null, env), 1);
  assert.ok(fs.existsSync(path.join(dir, "etcpasswd.json")));
});

test("v1.6.0 L2 (1b) poda dos recibos de busca: os mais antigos saem, os de decisão nunca; teto por env", (t) => {
  const dir = pastaTmp(t);
  const env = { TRF1_MCP_DIR_RECIBOS: dir };
  const docs = docsDoFixture("02_busca_dano_moral.xml", "trf1");
  const ds = Array.from({ length: 5 }, (_, k) => ({ ...docs[k], id: `P${k}` }));
  assert.equal(lib.gravarRecibosDaBusca(ds, null, env), 5);
  const ix = lib.lerIndiceBusca(dir);
  for (let k = 0; k < 5; k++) ix[`P${k}`][1] = 1000 + k;   // P0 o mais antigo
  assert.ok(lib.gravarRecibo({ ...docs[5], id: "Z9" }, env));
  ix.Z9 = [100, 1];   // a mais antiga de todas, mas é recibo de decisão: não pode sair
  lib.gravarIndiceBusca(dir, ix);
  const tot = Object.values(ix).reduce((s, v) => s + v[0], 0);
  assert.equal(lib.podarRecibosDeBusca(dir, tot * 10), 0);
  const n = lib.podarRecibosDeBusca(dir, Math.floor(tot * 0.5));
  assert.ok(n >= 2 && !fs.existsSync(lib.arqRecibo("P0", env)) && !fs.existsSync(lib.arqRecibo("P1", env)) && fs.existsSync(lib.arqRecibo("P4", env)), String(n));
  assert.ok(fs.existsSync(lib.arqRecibo("Z9", env)) && lib.lerRecibo("Z9", env).origem === "decisao" && !("Z9" in lib.lerIndiceBusca(dir)));
  // o índice aponta para um arquivo que (apesar do índice) não é de busca: não é apagado
  const ix2 = lib.lerIndiceBusca(dir); ix2.Z9 = [10 ** 9, 1]; lib.gravarIndiceBusca(dir, ix2);
  lib.podarRecibosDeBusca(dir, 1000);
  assert.ok(fs.existsSync(lib.arqRecibo("Z9", env)));
  // teto: padrão 300 MB, mínimo 10 MB, lixo volta ao padrão
  assert.equal(lib.recibosBuscaMaxBytes({}), 300 * 1024 * 1024);
  assert.equal(lib.recibosBuscaMaxBytes({ TRF1_MCP_RECIBOS_BUSCA_MAX_MB: "500" }), 500 * 1024 * 1024);
  assert.equal(lib.recibosBuscaMaxBytes({ TRF1_MCP_RECIBOS_BUSCA_MAX_MB: "abc" }), 300 * 1024 * 1024);
  assert.equal(lib.recibosBuscaMaxBytes({ TRF1_MCP_RECIBOS_BUSCA_MAX_MB: "1" }), 10 * 1024 * 1024);
  // o diagnóstico conta os de busca e diz o teto
  assert.equal(lib.gravarRecibosDaBusca([{ ...docs[7], id: "Q1" }], null, env), 1);
  const env0 = process.env.TRF1_MCP_DIR_RECIBOS; process.env.TRF1_MCP_DIR_RECIBOS = dir;
  try { assert.match(lib.diagnosticoRitmo(), /Recibos gravados em .*: \d+ \(\d+ de busca, sujeitos ao teto de 300 MB; os demais, de decisão\)/); }
  finally { process.env.TRF1_MCP_DIR_RECIBOS = env0; }
});

test("v1.6.0 L2 (1c) buscar com portal simulado grava os recibos da página (origem busca)", async (t) => {
  comEstadoLimpo(t);
  const dir = pastaTmp(t);
  const env = { TRF1_MCP_DIR_RECIBOS: dir };
  const docs = docsDoFixture("02_busca_dano_moral.xml", "trf1");
  const out = await lib.buscar({ consulta: "dano moral" }, portalNumero(), env);
  assert.ok(out.includes("documento(s)"), out.slice(0, 300));
  assert.equal(Object.keys(lib.lerIndiceBusca(dir)).length, docs.length);
  assert.equal(lib.lerRecibo(docs[0].id, env).origem, "busca");
});

test("v1.6.0 L2 (1d) verificar_citacao com recibo de busca: TNU vai ao portal; trf1 vale se o trecho está; senão portal; portal fora = NÃO REALIZADA", async (t) => {
  comEstadoLimpo(t);
  const dir = pastaTmp(t);
  const env = { TRF1_MCP_DIR_RECIBOS: dir };
  // TNU: o recibo de busca NÃO tem inteiro teor -> vai ao portal, nunca conclui ❌ por falta de texto
  const dTnu = docsDoFixture("11_tnu_busca.xml", "tnu")[0];
  assert.equal(lib.gravarRecibosDaBusca([dTnu], null, env), 1);
  assert.ok(!lib.lerRecibo(dTnu.id, env).inteiro_teor);
  const trechoTnu = "A Turma Nacional de Uniformização decidiu, por unanimidade, CONHECER PARCIALMENTE do recurso";
  const f1 = portalNumero();
  const vt = await lib.verificarCitacao(dTnu.numero, trechoTnu, "tnu", f1, env);
  assert.ok(f1.chamadas.length >= 3 && vt.includes("fonte: portal") && vt.includes("✅"), vt.slice(0, 400));
  const rp = lib.lerRecibo(dTnu.id, env);
  assert.ok(rp.origem === "decisao" && rp.inteiro_teor_incluido);   // o portal promoveu o recibo
  lib._resetDisjuntorParaTeste();
  const f2 = portalNumero();
  const vt2 = await lib.verificarCitacao(dTnu.numero, trechoTnu, "tnu", f2, env);
  assert.ok(f2.chamadas.length === 0 && vt2.includes("fonte: recibo local"), vt2.slice(0, 300));   // agora há recibo com inteiro teor: 0 requisições
  // trf1: o recibo de busca vale quando o trecho está nele (0 requisições)
  lib._resetDisjuntorParaTeste();
  const d0 = docsDoFixture("02_busca_dano_moral.xml", "trf1")[0];
  const frase = d0.ementa.split(/\s+/).slice(0, 8).join(" ");
  assert.equal(lib.gravarRecibosDaBusca([d0], null, env), 1);
  const f3 = portalNumero();
  const vb = await lib.verificarCitacao(d0.numero, frase, "trf1", f3, env);
  assert.ok(f3.chamadas.length === 0 && vb.includes("recibo local (de busca; o processo pode ter outros documentos)") && vb.includes("✅"), vb.slice(0, 300));
  // trf1: trecho que NÃO está no recibo de busca (ele guarda só o começo da ementa) -> ausência não se conclui; lê o número inteiro no portal
  const dir2 = pastaTmp(t); const env2 = { TRF1_MCP_DIR_RECIBOS: dir2 };
  const palavras = d0.ementa.split(/\s+/);
  const final = palavras.slice(-9).join(" ");
  assert.equal(lib.gravarRecibosDaBusca([{ ...d0, ementa: palavras.slice(0, 20).join(" "), decisao: "" }], null, env2), 1);
  lib._resetDisjuntorParaTeste();
  const f4 = portalNumero();
  const vb2 = await lib.verificarCitacao(d0.numero, final, "trf1", f4, env2);
  assert.ok(f4.chamadas.length >= 3 && vb2.includes("fonte: portal") && vb2.includes("✅ VÁLIDO"), vb2.slice(0, 400));
  assert.equal(lib.lerRecibo(d0.id, env2).origem, "decisao");
  // trf1 com recibo de DECISÃO: a ausência vale (comportamento anterior), sem portal
  lib._resetDisjuntorParaTeste();
  const f5 = portalNumero();
  const vd = await lib.verificarCitacao(d0.numero, "frase que certamente não consta de nenhum documento deste processo", "trf1", f5, env2);
  assert.ok(f5.chamadas.length === 0 && vd.includes("❌ NÃO ENCONTRADO") && vd.includes("fonte: recibo local"), vd.slice(0, 300));
  // portal falha e só há recibo de busca: carimbo de pesquisa NÃO realizada que explica
  const dir3 = pastaTmp(t); const env3 = { TRF1_MCP_DIR_RECIBOS: dir3 };
  assert.equal(lib.gravarRecibosDaBusca([d0], null, env3), 1);
  lib._resetDisjuntorParaTeste();
  const vf = await lib.verificarCitacao(d0.numero, "trecho inexistente em qualquer lugar do processo todo aqui", "trf1", portalNumero({ falha: true }), env3);
  assert.ok(vf.startsWith("[PESQUISA NÃO REALIZADA") && vf.includes("recibos de BUSCA") && !vf.includes("❌"), vf.slice(0, 500));
});

test("v1.6.0 L2 (2) buscar_recibos em linguagem natural: BM25 sobre a ementa, só quando o E de todas dá zero", (t) => {
  assert.deepEqual(lib.palavrasBm25("O INSS negou o benefício de 2024 art. XII por falta de prova"), ["inss", "negou", "beneficio", "falta", "prova"]);
  assert.deepEqual(lib.rankearPorConsulta("duas palavras", [{ id_documento: "1", ementa: "duas palavras" }]), []);
  const dir = pastaTmp(t);
  const env = { TRF1_MCP_DIR_RECIBOS: dir };
  const em = {
    A1: ["Previdenciário. Pensão por morte. Filho maior inválido. Dependência econômica presumida relativa.", "10/03/2024"],
    A2: ["Administrativo. Servidor público. Adicional de fronteira durante as férias. Indenização indevida.", "11/03/2024"],
    A3: ["Processual civil. Mandado de segurança. Conflito de competência entre varas federais. Domicílio do impetrante.", "12/03/2024"],
    A4: ["Previdenciário. Salário-maternidade. Adoção de adolescente. Prazo de cento e vinte dias.", "13/03/2024"],
  };
  for (const [id, [txt, dt]] of Object.entries(em)) {
    lib.gravarRecibo({ id, base: "trf1", numero: "0000000-00.2020.4.01.0000", numero_digitos: "00000000020204010000", tipo: "Acórdão", relator: "FULANO",
      orgao: "QUINTA TURMA", data_julgamento: dt, ementa: txt, decisao: "Nega provimento." }, env);
  }
  const nl = "o filho já adulto e inválido pediu a pensão de pai falecido provando que dependia dele";
  const rn = lib.buscarRecibos({ consulta: nl, limite: 3 }, env);
  assert.ok(rn.includes("nenhum dos 4 documento(s)") && rn.includes("MAIS delas") && rn.includes("BM25") && rn.includes("ZERO requisição"), rn.slice(0, 400));
  assert.ok(rn.split("2. ")[0].includes("id A1"), rn);
  assert.ok(!lib.buscarRecibos({ consulta: "pensão morte filho", limite: 3 }, env).includes("MAIS delas") && lib.buscarRecibos({ consulta: "pensão morte filho", limite: 3 }, env).includes("id A1"));   // E satisfeito: modo normal
  assert.ok(!lib.buscarRecibos({ consulta: "pensão xyzzy", limite: 3 }, env).includes("MAIS delas") && lib.buscarRecibos({ consulta: "pensão xyzzy", limite: 3 }, env).includes("0 de 4"));   // menos de 3 palavras: nada de ranking
  assert.ok(!lib.buscarRecibos({ grupos: [["pensão"], ["inexistentepalavra"]], limite: 3 }, env).includes("MAIS delas"));   // com `grupos` o ranking não entra
  assert.ok(!lib.buscarRecibos({ consulta: "pensão filho zzzz yyyy", nr_processo: "0000000-00.2020", limite: 3 }, env).includes("MAIS delas"));   // com filtro de processo também não
  const top = lib.rankearPorConsulta(nl, lib.listarRecibos(null, env), 10);
  assert.ok(top[0][0].id_documento === "A1" && top.every((x) => Number.isInteger(x[1])));
  // empate: data mais recente primeiro, depois id
  const emp = [{ id_documento: "B", ementa: "pensão morte filho inválido", data_julgamento: "01/01/2020", texto: "x" },
    { id_documento: "A", ementa: "pensão morte filho inválido", data_julgamento: "01/01/2021", texto: "x" },
    { id_documento: "C", ementa: "pensão morte filho inválido", data_julgamento: "01/01/2021", texto: "x" }];
  assert.deepEqual(lib.rankearPorConsulta("pensão morte filho inválido", emp, 10).map(([r]) => r.id_documento), ["A", "C", "B"]);
});

test("v1.6.0 L2 (3) modo triagem: bloco por julgamento, sem ementa nem inteiro teor; recibos gravados; modo inválido é erro de parâmetro", async (t) => {
  comEstadoLimpo(t);
  const docs = docsDoFixture("02_busca_dano_moral.xml", "trf1");
  const d0 = docs[0];
  const dTnu = { ...docsDoFixture("11_tnu_busca.xml", "tnu")[0], inteiro_teor_texto: tnuIt() };
  lib.aplicarFecho(dTnu);
  const tri = lib.formatTriagem([dTnu], dTnu.numero, 1);
  const comp = lib.formatDecisao([dTnu], dTnu.numero, 1);
  assert.ok(tri.includes("Triagem do número") && tri.includes("Resultado declarado: desprovido") && tri.includes("Votação declarada: unânime") && tri.includes("FATOS DO JULGADO"), tri.slice(0, 900));
  assert.ok(tri.includes("Cita: Súmula 42 · Tema 692") && tri.includes(`id ${dTnu.id}`) && tri.includes("eproctnu-jur.cjf.jus.br") && tri.includes("verificação: triagem — nada lido; reabra no modo completo para citar") && !tri.includes("verificação: inteiro teor lido"));
  assert.ok(!tri.includes("Inteiro teor (literal") && !tri.includes("Ementa (integral") && tri.length < comp.length * 0.25, `${tri.length} ${comp.length}`);
  const irmao = { ...d0, id: "999", tipo: "Decisão Monocrática", data_julgamento: "01/02/2025", decisao: "dou provimento ao recurso" };
  const t2 = lib.formatTriagem([d0, irmao], d0.numero, 2);   // dois julgamentos de datas diferentes: dois blocos
  assert.ok((t2.match(/\n### /g) || []).length === 2 && t2.includes("Sem inteiro teor nesta base"), t2.slice(0, 700));
  const t3 = lib.formatTriagem([d0, { ...irmao, data_julgamento: d0.data_julgamento }], d0.numero, 2);   // mesmo julgamento: UM bloco com as duas peças e o aviso de opostos
  assert.ok((t3.match(/\n### /g) || []).length === 1 && t3.includes("resultados opostos") && (t3.match(/ id /g) || []).length >= 2, t3.slice(0, 900));
  assert.ok(lib.formatTriagem([], "123", 0).includes("Nenhum documento"));
  // fluxo: obter_decisao em modo triagem (portal simulado) grava o recibo nos dois modos; modo inválido não consulta nada
  const dir = pastaTmp(t); const env = { TRF1_MCP_DIR_RECIBOS: dir };
  const f = portalNumero();
  const st = await lib.obterDecisao(d0.numero, "trf1", "triagem", f, env);
  assert.ok(st.includes("Triagem do número") && !st.includes("Ementa (integral") && lib.lerRecibo(d0.id, env).origem === "decisao", st.slice(0, 300));
  lib._resetDisjuntorParaTeste();
  assert.ok((await lib.obterDecisao(d0.numero, "trf1", undefined, portalNumero(), env)).includes("Ementa (integral"));
  lib._resetDisjuntorParaTeste();
  assert.ok((await lib.obterDecisao(d0.numero, "trf1", " COMPLETO ", portalNumero(), env)).includes("Ementa (integral"));
  const f6 = portalNumero();
  const inv = await lib.obterDecisao(d0.numero, "trf1", "resumo", f6, env);
  assert.ok(inv.startsWith("Erro de parâmetro") && inv.includes("modo inválido: 'resumo'; use 'completo' ou 'triagem'") && f6.chamadas.length === 0, inv);
  assert.deepEqual(lib.descreverArgs({ modo: "triagem" }), { modo: "triagem" });
  assert.deepEqual(lib.descreverArgs({ modo: "Fulano" }), { modo: "<valor fora da lista>" });
});

test("v1.6.0 L2 (4) inteiro teor sem repetição (só TNU): ponteiro quando o texto está contido letra a letra", () => {
  const EM = "PREVIDENCIÁRIO. PEDIDO DE UNIFORMIZAÇÃO. «incapacidade» preexistente ao reingresso no RGPS. Súmula 53 da TNU aplicada ao caso concreto, " +
    "com divergência demonstrada entre o acórdão recorrido e o paradigma indicado pela parte requerente do pedido.";
  const DEC = "A Turma Nacional de Uniformização decidiu, por unanimidade, conhecer do pedido e negar-lhe provimento, nos termos do voto do relator, " +
    "ficando prejudicado o exame das demais questões suscitadas pela parte requerente nas razões do pedido de uniformização.";
  const EM_LIMPA = EM.replace("«", "").replace("»", "");
  const IT = "Documento:1\nTIMBRE\nRELATOR : Juiz Federal FULANO DE TAL\nRELATÓRIO\nTrata-se de pedido de uniformização contra acórdão da turma recursal que negou o benefício. É o relatório.\n" +
    "EMENTA\n" + EM_LIMPA.replaceAll(". ", ".\n") + "\nVOTO\nNego provimento ao pedido porque a incapacidade é anterior.\n" +
    "ACÓRDÃO\n" + DEC.replaceAll(", ", ",\n") + "\nBrasília, 14 de maio de 2025.\n";
  const dTnu = docsDoFixture("11_tnu_busca.xml", "tnu")[0];
  const dh = { ...dTnu, ementa: EM, decisao: DEC, inteiro_teor_texto: IT };
  const sh = lib.formatDecisao([dh], dh.numero, 1);
  assert.ok(!sh.includes("incapacidade» preexistente") && (sh.match(/Súmula 53 da TNU aplicada/g) || []).length === 1);   // a ementa só aparece no inteiro teor
  assert.ok((sh.match(/texto idêntico a trecho do inteiro teor abaixo/g) || []).length === 2 && sh.includes(`(${lib.compacto(EM).length} caracteres)`) && sh.includes("começa em «PREVIDENCIÁRIO. PEDIDO DE UNIFORMIZAÇÃO.…»"), sh.slice(0, 1500));
  assert.ok(sh.length < lib.formatDecisao([dh], dh.numero, 1, false).length - 200);
  assert.ok(!lib.formatDecisao([dh], dh.numero, 1, false).includes("texto idêntico"));
  assert.ok(sh.includes("— verificação: inteiro teor lido") && !sh.includes("lido EM PARTE") && sh.includes("Inteiro teor (literal, eproc da TNU)"));
  // contenção é exata: palavra trocada ou caixa diferente -> o texto continua inteiro
  const sEx = lib.formatDecisao([{ ...dh, inteiro_teor_texto: IT.replace("Súmula 53", "Súmula 54") }], "x", 1);
  assert.ok(sEx.split("**Dispositivo")[0].includes("Súmula 53 da TNU aplicada"));
  assert.ok((sEx.match(/texto idêntico a trecho do inteiro teor abaixo/g) || []).length === 1 && sEx.includes("Dispositivo: texto idêntico"));
  const sCx = lib.formatDecisao([{ ...dh, inteiro_teor_texto: IT.replace("negar-lhe", "NEGAR-lhe") }], "x", 1);
  assert.ok(sCx.split("**Inteiro teor")[0].includes("negar-lhe provimento") && sCx.includes("Ementa: texto idêntico"));
  // texto curto não vira ponteiro; base trf1 (sem inteiro teor do eproc): nada muda
  assert.ok(!lib.formatDecisao([{ ...dh, decisao: "Nego provimento.", ementa: "" }], "x", 1).split("**Inteiro teor")[0].includes("texto idêntico"));
  assert.ok(!lib.formatDecisao([docsDoFixture("02_busca_dano_moral.xml", "trf1")[0]], "x", 1).includes("texto idêntico"));
  // contagem em pontos de código (como o Python): emoji vale 1
  assert.equal(lib.cpLen("a😀b"), 3);
  assert.equal(lib.cpSlice("😀😀😀", 2), "😀😀");
  assert.equal(lib.ponteiroContido("x".repeat(100), "x".repeat(100), "Ementa"), "");   // abaixo de 150
  // inteiro teor cortado pelo orçamento e trecho na parte não exibida: NÃO substitui
  const ENCH = "palavra comum de enchimento. ";
  const sl = lib.formatDecisao([{ ...dh, inteiro_teor_texto: "Documento:1\nRELATÓRIO\n" + ENCH.repeat(2000) + "\nEMENTA\n" + EM_LIMPA + "\nACÓRDÃO\n" + DEC }], "x", 1);
  assert.ok(sl.includes("CORTADO") && !sl.includes("texto idêntico") && sl.includes("inteiro teor lido EM PARTE") && sl.split("**Inteiro teor")[0].includes("Súmula 53 da TNU aplicada"));
  const sc = lib.formatDecisao([{ ...dh, inteiro_teor_texto: "Documento:1\nEMENTA\n" + EM_LIMPA + "\nACÓRDÃO\n" + DEC + "\n" + ENCH.repeat(2500) }], "x", 1);   // trecho na parte exibida, resto cortado
  assert.ok(sc.includes("CORTADO") && (sc.match(/texto idêntico a trecho do inteiro teor abaixo/g) || []).length === 2 && sc.includes("lido EM PARTE"));
});

test("v1.6.0 L2 (5) livro-razão: formato, sanitização, 0600, rotação, tolerância de leitura, desligado sob o teste", (t) => {
  const dir = pastaTmp(t);
  const lr = path.join(dir, "ritmo.jsonl");
  assert.equal(lib._setRitmoAtivoParaTeste(false), false);   // sob `node --test` o livro-razão nasce desligado
  lib.ritmoAnotar(1_000, "busca", "ok", 200, 12.4, null, { TRF1_MCP_ARQUIVO_RITMO: lr });
  assert.ok(!fs.existsSync(lr), "desligado: não grava");
  lib.ritmoAnotar(1_700_000_000_000, "busca", "ok", 200, 12.4, lr);
  lib.ritmoAnotar(1_700_000_001_500, "decisao zzz", "http_503", 503, null, lr);   // op fora do padrão vira "?"
  lib.ritmoAnotar(1_700_000_003_000, "busca", "texto livre da busca", null, 5, lr);   // desfecho fora do padrão vira "inesperada"
  lib.ritmoAnotar(1_700_000_004_000, "busca", "ok", 200, 12.5, lr);   // round() do Python: metade para o par
  lib.ritmoAnotar(1_700_000_005_000, "busca", "ok", 200, 13.5, lr);
  const lin = fs.readFileSync(lr, "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x));
  if (process.platform !== "win32") assert.equal(fs.statSync(lr).mode & 0o777, 0o600);
  assert.equal(lin.length, 5);
  assert.deepEqual(Object.keys(lin[0]), ["t", "impl", "pid", "id", "op", "res", "status", "durMs"]);
  assert.ok(lin[0].impl === "node" && lin[0].pid === process.pid && lin[0].t === 1_700_000_000_000 && lin[0].op === "busca" && lin[0].res === "ok" && lin[0].status === 200 && lin[0].durMs === 12);
  assert.ok(lin[1].op === "?" && lin[1].res === "http_503" && lin[1].durMs === null && lin[2].res === "inesperada");
  assert.ok(lin[3].durMs === 12 && lin[4].durMs === 14);
  assert.ok(!fs.readFileSync(lr, "utf8").includes("zzz") && !fs.readFileSync(lr, "utf8").includes("texto livre"));
  // identidade: personalizada quando TRF1_USER_AGENT está definido
  lib.ritmoAnotar(1_700_000_006_000, "busca", "ok", 200, 1, lr, { TRF1_USER_AGENT: "x" });
  assert.equal(JSON.parse(fs.readFileSync(lr, "utf8").trim().split("\n").pop()).id, "personalizada");
  // leitura tolera linhas do outro porte, lixo e tipos errados
  fs.appendFileSync(lr, '{"t":1700000007000,"impl":"py","pid":7,"id":"honesta","op":"busca","res":"ok","status":200,"durMs":30}\nlixo{\n{"t":"x"}\n[1]\n{"t":true}\n');
  const lido = lib.ritmoLer(lr);
  assert.ok(lido.length === 7 && lido.at(-1).impl === "py" && lido.every((x, i) => i === 0 || lido[i - 1].t <= x.t));
  assert.deepEqual(lib.ritmoLer(path.join(dir, "nao-existe.jsonl")), []);
  // rotação: acima de ~700 KB guarda só as últimas 3.000 linhas
  const lr2 = path.join(dir, "rot.jsonl");
  const modelo = JSON.stringify({ t: 2_000_000_000_000, impl: "py", pid: 1, id: "honesta", op: "busca", res: "ok", status: 200, durMs: 1 });
  fs.writeFileSync(lr2, Array.from({ length: 7000 }, (_, k) => modelo.replace("2000000000000", String(2_000_000_000_000 + k * 1000))).join("\n") + "\n");
  assert.ok(fs.statSync(lr2).size > 700_000);
  lib.ritmoAnotar(2_100_000_000_000, "busca", "ok", 200, 1, lr2);
  const rl = lib.ritmoLer(lr2);
  assert.ok(rl.length === 3000 && rl.at(-1).t === 2_100_000_000_000 && rl[0].t === 2_000_000_000_000 + 4001 * 1000, `${rl.length}`);
});

test("v1.6.0 L2 (5b) análise do ritmo confere com a conta direta; relatório e recomendação; nunca altera parâmetro", () => {
  let t = 1_800_000_000_000, semente = 7;
  const rnd = () => { semente = (semente * 1664525 + 1013904223) % 4294967296; return semente / 4294967296; };   // gerador determinístico
  const gaps = [800, 1200, 1600, 2500, 4000, 7000, 15000, 45000];
  const falhas = ["bloqueio", "http_503", "timeout", "rede", "desafio"];
  const seq = [];
  for (let k = 0; k < 160; k++) {
    t += gaps[Math.floor(rnd() * gaps.length)];
    seq.push({ t, impl: k % 3 ? "py" : "node", pid: 1, id: "honesta", op: "busca", res: rnd() > 0.08 ? "ok" : falhas[Math.floor(rnd() * falhas.length)], status: 200, durMs: 5 });
  }
  const a = lib.analisarRitmo(seq, { agoraMs: t + 1000 });
  assert.equal(a.n, 160);
  assert.equal(a.falhas, seq.filter((r) => r.res !== "ok").length);
  assert.equal(a.faixas.reduce((s, f) => s + f.reqs, 0), 159);
  assert.equal(a.faixas.reduce((s, f) => s + f.falhas, 0), seq.slice(1).filter((r) => r.res !== "ok").length);
  assert.ok([...a.porDesfecho.values()].reduce((s, v) => s + v, 0) === 160 && [...a.porOrigem.values()].reduce((s, v) => s + v, 0) === 160);
  let melhor = 0;
  for (let i = 0; i < seq.length; i++) {
    for (let j = i; j < seq.length; j++) {
      if (seq[j].t - seq[i].t > 60_000) break;
      if (seq.slice(i, j + 1).every((x) => x.res === "ok")) melhor = Math.max(melhor, j - i + 1);
    }
  }
  assert.ok(a.maxRajadaSemFalha === melhor && melhor > 0, `${a.maxRajadaSemFalha} ${melhor}`);
  const f0 = a.faixas.find((f) => f.nome === "< 1,5 s");
  assert.equal(f0.reqs, seq.slice(1).filter((r, k) => r.t - seq[k].t < 1500).length);
  const pouco = lib.formatarRelatorioRitmo(lib.analisarRitmo(seq.slice(0, 40), { agoraMs: t }));
  assert.ok(pouco.includes("Dados insuficientes: 40 requisições") && pouco.includes("Manter os parâmetros atuais") && pouco.includes("nada é alterado automaticamente"), pouco);
  const ok = lib.formatarRelatorioRitmo(lib.analisarRitmo(seq, { agoraMs: t }));
  assert.ok(ok.includes("| < 1,5 s |") && ok.includes("**Por desfecho:**") && ok.includes("node ") && ok.includes("Maior rajada em 60 s SEM falha") && ok.includes("Decisão sobre qualquer parâmetro é humana"));
  assert.ok(!ok.includes("Dados insuficientes") && ok.includes("nunca texto de busca"));
  assert.ok(lib.relatorioDeRitmo(1_800_000_000, "/nao/existe/vazio.jsonl").includes("0 requisições registradas"));
});

test("v1.6.0 L2 (5c) fim a fim: requisitar anota cada desfecho, sem URL, consulta nem número de processo", async (t) => {
  comEstadoLimpo(t);
  const dir = pastaTmp(t);
  const lr = path.join(dir, "ritmo.jsonl");
  const env = { TRF1_MCP_ARQUIVO_RITMO: lr };
  const antes = lib._setRitmoAtivoParaTeste(true);
  t.after(() => lib._setRitmoAtivoParaTeste(antes));
  const resp = (status, texto, ctype = "text/html") => async () => new Response(texto, { status, headers: { "content-type": ctype } });
  const lanca = (nome, msg) => async () => { const e = new Error(msg); e.name = nome; throw e; };
  const casos = [[resp(200, "<html>javax.faces.ViewState</html>"), "ok"], [resp(503, "<html>erro</html>"), "http_503"], [resp(429, "<html>vazio</html>"), "http_429"],
    [resp(200, "<html>Acesso bloqueado por suspeita de automação</html>"), "bloqueio"], [resp(403, "<html><title>Just a moment...</title></html>"), "desafio"],
    [lanca("TimeoutError", "lento"), "timeout"], [lanca("TypeError", "fetch failed"), "rede"], [resp(200, "<html>sem formulario</html>"), "inesperada"]];
  for (const [fetchImpl, esperado] of casos) {
    lib._resetDisjuntorParaTeste();
    try { await lib.requisitar(new lib.CookieJar(), "GET", "https://jurisprudencia.cjf.jus.br/trf1/index.xhtml?q=segredo-0001369-17.2017.4.01.3606", "busca", { esperado: "html" }, fetchImpl, env); }
    catch (e) { assert.ok(e instanceof lib.PesquisaNaoRealizada || e instanceof lib.PortalRecusou || e instanceof lib.SessaoInvalida, String(e)); }
    assert.equal(lib.ritmoLer(lr).at(-1).res, esperado);
  }
  lib._resetDisjuntorParaTeste();
  const bruto = fs.readFileSync(lr, "utf8");
  assert.ok(!bruto.includes("segredo") && !bruto.includes("0001369") && !bruto.includes("jurisprudencia.cjf") && bruto.split("\n").filter(Boolean).length === 8, bruto);
  if (process.platform !== "win32") assert.equal(fs.statSync(lr).mode & 0o777, 0o600);
  assert.ok(lib.relatorioDeRitmo(null, lr, env).includes("Relatório de ritmo do portal do CJF"));
  assert.ok(lib.ritmoLer(lr).every((x) => x.impl === "node" && x.durMs !== undefined));
});

test("v1.6.0 L2 (6) decodeEntities como o html.unescape do Python (entidades nomeadas, numéricas sem ';' e legado)", () => {
  const d = lib.decodeEntities;
  assert.equal(d("Região &ndash; TRF4 &ldquo;ágil&rdquo; &hellip; &ordm; &sect;"), "Região – TRF4 “ágil” … º §");
  assert.equal(d("&#233;&#xe9;&#233 &quot&amp;#38; &#38;amp; &ordmfoo &foo; &;"), "ééé \"&#38; &amp; ºfoo &foo; &;");
  assert.equal(d("&#0;&#128;&#129;&#xD800;&#x110000;"), "�€\u0081��");
});

test("v1.6.0 L2 (7) a pasta real de recibos e o livro-razão real não são tocados pelos testes", () => {
  assert.ok(process.env.TRF1_MCP_DIR_RECIBOS.startsWith(os.tmpdir()) || process.env.TRF1_MCP_DIR_RECIBOS.includes("trf1-mcpb-teste-"));
  assert.ok(process.env.TRF1_MCP_ARQUIVO_RITMO.includes("trf1-mcpb-teste-"));
});

// ==================================================== red team (lote 2): correções v1.6.0 ===================================================
const sha16 = (x) => crypto.createHash("sha256").update(x, "utf-8").digest("hex").slice(0, 16);

test("red team L2 (1) o nível de verificação reflete o que foi EXIBIDO (triagem e lista da busca)", () => {
  const d0 = docsDoFixture("02_busca_dano_moral.xml", "trf1")[0];
  const col = { ...d0, id: "COL1", base: "colegiado", inteiro_teor_embutido: "texto do inteiro teor do colegiado ".repeat(100) };
  const sl = lib.formatBusca([col], 1, { base: "colegiado", pagina: 1, por_pagina: 30, consulta_montada: "x" });
  assert.ok(sl.includes("— verificação: só ementa/índice") && !sl.includes("inteiro teor lido"), sl.slice(0, 700));
  assert.ok(lib.formatDecisao([col], col.numero, 1).includes("— verificação: inteiro teor lido"));   // o modo completo continua como estava
  const tri = lib.formatTriagem([col], col.numero, 1);
  assert.ok(tri.includes("— verificação: triagem — nada lido; reabra no modo completo para citar") && !tri.includes("inteiro teor lido"), tri.slice(0, 600));
  assert.equal(lib.nivelVerificacao(col, false, "lista"), "só ementa/índice");
  assert.equal(lib.nivelVerificacao(col, true), "inteiro teor lido EM PARTE");
});

test("red team L2 (2) a busca só CRIA o recibo (corrida com o de decisão) e a poda não apaga o de decisão", (t) => {
  const dir = pastaTmp(t);
  const env = { TRF1_MCP_DIR_RECIBOS: dir };
  const d0 = docsDoFixture("02_busca_dano_moral.xml", "trf1")[0];
  const plano = { ...d0 };
  let feito = false;
  const comCorrida = { ...plano, get tipo() { if (!feito) { feito = true; lib.gravarRecibo(plano, env); } return plano.tipo; } };   // a decisão aparece DEPOIS do `exists` da busca
  assert.equal(lib.gravarRecibosDaBusca([comCorrida], null, env), 0);
  assert.equal(lib.lerRecibo(d0.id, env).origem, "decisao");
  assert.ok(!Object.hasOwn(lib.lerIndiceBusca(dir), d0.id));
  const alvo = path.join(dir, "X.json");
  assert.ok(lib.escreverJsonAtomico(alvo, { a: 1 }, true) > 0);
  assert.equal(lib.escreverJsonAtomico(alvo, { a: 2 }, true), null);
  assert.deepEqual(JSON.parse(fs.readFileSync(alvo, "utf-8")), { a: 1 });
  assert.deepEqual(fs.readdirSync(dir).filter((x) => x.endsWith(".tmp")), []);
  // poda: recibo de decisão listado no índice sobrevive; o de busca sai; nada fica como .podando
  lib.gravarRecibo({ ...d0, id: "DEC1" }, env);
  assert.equal(lib.gravarRecibosDaBusca([{ ...d0, id: "BUS1" }], null, env), 1);
  lib.gravarIndiceBusca(dir, { DEC1: [500, 1], BUS1: [500, 2] });
  assert.equal(lib.podarRecibosDeBusca(dir, 100, env), 1);
  assert.ok(lib.lerRecibo("DEC1", env) && lib.lerRecibo("BUS1", env) === null);
  assert.deepEqual(fs.readdirSync(dir).filter((x) => x.endsWith(".podando")), []);
});

test("red team L2 (3) regravar o recibo sem inteiro teor não apaga o que ele já tinha", (t) => {
  const dir = pastaTmp(t);
  const env = { TRF1_MCP_DIR_RECIBOS: dir };
  const dTnu = { ...docsDoFixture("11_tnu_busca.xml", "tnu")[0], inteiro_teor_texto: tnuIt() };
  lib.gravarRecibo(dTnu, env);
  const r1 = lib.lerRecibo(dTnu.id, env);
  assert.ok(r1 && r1.inteiro_teor && r1.inteiro_teor_incluido === true);
  const { inteiro_teor_texto, ...semTeor } = dTnu;
  lib.gravarRecibo(semTeor, env);
  const r2 = lib.lerRecibo(dTnu.id, env);   // lerRecibo confere o sha256: hash coerente com o conteúdo final
  assert.ok(r2 && r2.inteiro_teor === r1.inteiro_teor && r2.inteiro_teor_incluido === true && r2.texto === r1.texto && r2.origem === "decisao");
});

test("red team L2 (4) falha de rede/timeout na leitura do corpo é PESQUISA NÃO REALIZADA, nunca erro de parâmetro", async (t) => {
  comEstadoLimpo(t);
  const dir = pastaTmp(t);
  const lr = path.join(dir, "ritmo.jsonl");
  const env = { TRF1_MCP_DIR_RECIBOS: dir, TRF1_MCP_ARQUIVO_RITMO: lr };
  const falhaNoCorpo = async () => {
    const r = new Response("x", { status: 200, headers: { "content-type": "text/html" } });
    r.arrayBuffer = async () => { const e = new Error("terminated"); e.name = "TimeoutError"; throw e; };
    return r;
  };
  const b = await lib.buscar({ consulta: "dano moral" }, falhaNoCorpo, env);
  assert.ok(b.startsWith("[PESQUISA NÃO REALIZADA") && !b.includes("Erro de parâmetro"), b.slice(0, 300));
  const o = await lib.obterDecisao("0011441-43.2015.4.01.3500", "trf1", "completo", falhaNoCorpo, env);
  assert.ok(o.startsWith("[PESQUISA NÃO REALIZADA") && !o.includes("Erro de parâmetro"), o.slice(0, 300));
  // exceção que não é de validação, vinda de dentro do fluxo, também não vira erro de parâmetro
  const quebrada = async () => { throw new TypeError("bug"); };
  assert.ok((await lib.buscar({ consulta: "dano moral" }, quebrada, env)).startsWith("[PESQUISA NÃO REALIZADA"));
  // validação continua sendo erro de parâmetro
  assert.ok((await lib.buscar({ consulta: "x", base: "zzz" }, quebrada, env)).startsWith("Erro de parâmetro"));
  assert.ok((await lib.buscar({ consulta: "x", por_pagina: 7 }, quebrada, env)).startsWith("Erro de parâmetro"));
});

test("red team L2 (5) decodeEntities: 8.710 casos gerados pelo html.unescape do Python, 0 diferenças", () => {
  const f = JSON.parse(ler("entidades-html5-casos.json"));
  assert.ok(f.casos.length >= 2000 && f.casos.length === f.esperado.length);
  const dif = f.casos.filter((c, i) => lib.decodeEntities(c) !== f.esperado[i]);
  assert.deepEqual(dif.slice(0, 5), []);
  assert.equal(lib.decodeEntities("a &le; b &notin; c &NotEqualTilde; &lt &ltx; &amp"), "a ≤ b ∉ c ≂̸ < <x; &");
  assert.ok(fs.existsSync(path.join(__dirname, "..", "server", "entidades-html5.json")));   // vai no pacote .mcpb (não há lista de arquivos; só *.bak* é ignorado)
});

test("red team L2 (6) erro de E/S não põe recibo válido em quarentena; quarentena não apaga quarentena", (t) => {
  const dir = pastaTmp(t);
  const env = { TRF1_MCP_DIR_RECIBOS: dir };
  const d0 = docsDoFixture("02_busca_dano_moral.xml", "trf1")[0];
  lib.gravarRecibo(d0, env);
  const cam = lib.arqRecibo(d0.id, env);
  if (process.getuid && process.getuid() !== 0) {
    fs.chmodSync(cam, 0);
    try {
      assert.equal(lib.lerRecibo(d0.id, env), null);
      assert.ok(fs.existsSync(cam) && !fs.existsSync(cam + ".inconsistente"));
    } finally { fs.chmodSync(cam, 0o600); }
  }
  assert.ok(lib.lerRecibo(d0.id, env));
  for (const k of [1, 2]) {
    fs.writeFileSync(cam, `{ruim ${k}`);
    assert.equal(lib.lerRecibo(d0.id, env), null);
  }
  const q = fs.readdirSync(dir).filter((x) => x.includes(".inconsistente"));
  assert.equal(q.length, 2);
  assert.deepEqual(new Set(q.map((x) => fs.readFileSync(path.join(dir, x), "utf-8"))), new Set(["{ruim 1", "{ruim 2"]));
});

test("red team L2 (7) norm linear em corridas de espaço, igual ao algoritmo antigo, e limite de 5.000 caracteres", async (t) => {
  const antiga = (x) => {
    let r = fold(x.normalize("NFKC"));
    r = r.replace(/\bn\s*[.o°]{1,3}\s*(?=\d)/g, "n ").replace(/§\s+/g, "§").replace(/[\u201c\u201d\u2018\u2019"'`´]/g, "'").replace(/[–—-]/g, "-");
    return r.replace(/\s+([.,;:)\]])/g, "$1").replace(/([([])\s+/g, "$1").replace(/\s+/g, " ").trim();
  };
  const fold = (x) => x.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const alf = ["a", "B", "ç", "n", "º", "5", ".", ",", ";", ":", "(", ")", "[", "]", " ", " ", "  ", "\n", "\t", "§", "\u201c", "\u201d", "-", "—", "\u00a0", "Art", "n.", "N°"];
  for (let i = 0; i < 600; i++) {
    let x = "";
    for (let k = rnd(40); k > 0; k--) x += alf[rnd(alf.length)];
    assert.equal(lib.norm(x), antiga(x), JSON.stringify(x));
  }
  const t0 = Date.now();
  assert.equal(lib.norm("a" + " ".repeat(40000) + "b ."), "a b.");
  const vt = lib.verificarTrecho({ ementa: ("a" + " ".repeat(40000) + "b ."). repeat(2) }, "a" + " ".repeat(40000) + "b ccc ddd eee fff ggg hhh");
  assert.ok(Date.now() - t0 < 3000 && !vt.valido, String(Date.now() - t0));
  comEstadoLimpo(t);
  assert.ok((await lib.verificarCitacao("0011441-43.2015.4.01.3500", "x".repeat(5001))).startsWith("Erro de parâmetro"));
  assert.ok((await lib.buscar({ consulta: "y".repeat(5001) })).startsWith("Erro de parâmetro"));
  assert.ok((await lib.linhaDoTempo({ consulta: "y".repeat(5001) })).startsWith("Erro de parâmetro"));
  assert.throws(() => lib.buscarRecibos({ consulta: "y".repeat(5001), pasta: pastaTmp(t) }), /5000/);
});

test("red team L2 (8) índice de poda malformado: mesmo resultado do Python (instante desempata por id)", (t) => {
  const dir = pastaTmp(t);
  const env = { TRF1_MCP_DIR_RECIBOS: dir };
  const d0 = docsDoFixture("02_busca_dano_moral.xml", "trf1")[0];
  assert.equal(lib.gravarRecibosDaBusca(["A1", "A2", "A3"].map((id) => ({ ...d0, id })), null, env), 3);
  lib.gravarIndiceBusca(dir, { A1: [100], A2: 5, A3: [100, 10], A4: null, A5: "x" });
  assert.equal(lib.podarRecibosDeBusca(dir, 150, env), 1);
  assert.ok(lib.lerRecibo("A1", env) === null && lib.lerRecibo("A2", env) && lib.lerRecibo("A3", env));
});

test("red team L2 (9) o .tmp não fica para trás quando o rename falha", (t) => {
  const dir = pastaTmp(t);
  const destino = path.join(dir, "destino");
  fs.mkdirSync(destino);
  assert.throws(() => lib.escreverJsonAtomico(destino, { a: 1 }));
  assert.deepEqual(fs.readdirSync(dir).filter((x) => x.endsWith(".tmp")), []);
});

test("red team L2 (10) `t` não finito no livro-razão não derruba o relatório de ritmo", (t) => {
  const dir = pastaTmp(t);
  const lr = path.join(dir, "ritmo.jsonl");
  fs.writeFileSync(lr, '{"t": NaN, "res": "ok"}\n{"t": Infinity, "res": "ok"}\n{"t": -Infinity}\n{"t": 1e400}\n{"t": 5000, "res": "ok", "op": "busca"}\n{"t": 9000, "res": "ok", "op": "busca"}\n');
  assert.deepEqual(lib.ritmoLer(lr).map((x) => x.t), [5000, 9000]);
  assert.ok(lib.relatorioDeRitmo(null, lr, {}).includes("Relatório de ritmo"));
});

test("red team L2 (11) paridade: obtido_em em hora local, aspas curvas no norm, trechoCentrado/fatosDoJulgado por ponto de código", () => {
  const ia = lib.camposDeCustodia(docsDoFixture("02_busca_dano_moral.xml", "trf1")[0]).obtido_em;
  assert.match(ia, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/);
  assert.ok(Math.abs(new Date(ia).getTime() - Date.now()) < 5000, ia);   // sem fuso, o JS lê como local: tem de ser "agora"
  assert.equal(lib.norm("\u201cOlá\u201d \u2018x\u2019"), "'ola' 'x'");
  // valores de referência calculados pelo Python (sha256, 16 hex) para entradas com emoji fora do BMP
  const b1 = "😀".repeat(300) + " ementa " + "x ".repeat(100) + "«termo» " + "palavra😀 ".repeat(300);
  const b2 = "😀".repeat(50) + " «termo» " + "z😀 ".repeat(400);
  assert.equal(sha16(lib.trechoCentrado(b1, 800)), "bf1827d9a63807a0");
  assert.equal(sha16(lib.trechoCentrado(b1, 320)), "8a53588bffbb6e8e");
  assert.equal(sha16(lib.trechoCentrado(b2, 800)), "98a810ef543c8216");
  assert.equal(sha16(lib.trechoCentrado(b2, 320)), "8a69b5fc1eeaf592");
  assert.equal(sha16(lib.limpar("😀 abc ".repeat(500), 100)), "7524fcdae9c0ef3c");
  const it = "Documento:1\nRELATÓRIO\n" + "fato 😀 narrado pelo autor. ".repeat(80) + "\nVOTO\nvoto aqui\n";
  const it2 = "Documento:1\nRELATÓRIO\n" + "fato 😀 narrado pelo autor. ".repeat(80);
  assert.equal(sha16(lib.fatosDoJulgado(it)[1]), "bc050ee594569927");
  assert.equal(sha16(lib.fatosDoJulgado(it2)[1]), "f92252b0278feeb2");
  assert.equal(sha16(lib.linhaFatos({ inteiro_teor_texto: it })), "8d35b197b57ccc07");
  assert.equal(sha16(lib.linhaFatos({ inteiro_teor_texto: it2 })), "ecb3c986e11a7760");
});

test("red team L2 (12) buscar_recibos rotula a base certa e não diz que o inteiro teor só existe na TNU", (t) => {
  const dir = pastaTmp(t);
  const env = { TRF1_MCP_DIR_RECIBOS: dir };
  const d0 = docsDoFixture("02_busca_dano_moral.xml", "trf1")[0];
  const dTnu = { ...docsDoFixture("11_tnu_busca.xml", "tnu")[0], inteiro_teor_texto: tnuIt() };
  lib.gravarRecibo({ ...d0, id: "COL1", base: "colegiado", inteiro_teor_embutido: "texto do inteiro teor do colegiado ".repeat(20) }, env);
  lib.gravarRecibo(dTnu, env);
  const bc = lib.buscarRecibos({ id_documento: "COL1", pasta: dir }, env);
  assert.ok(bc.includes("inteiro teor Colegiado CJF incluído") && !bc.includes("inteiro teor da TNU incluído") && bc.includes("só existe nos recibos da TNU"), bc.slice(0, 900));
  assert.ok(lib.buscarRecibos({ id_documento: dTnu.id, pasta: dir }, env).includes("inteiro teor TNU incluído"));
});

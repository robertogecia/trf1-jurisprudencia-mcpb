import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as lib from "../server/lib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  assert.equal(fs.statSync(caminho).mode & 0o777, 0o600);
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
  assert.match(sb, /— verificação: inteiro teor lido/);
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
  assert.equal((fs.statSync(env.TRF1_MCP_ARQUIVO_ERROS).mode & 0o777).toString(8), "600");
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

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
    "'o retorno ao trabalho por tentativa não afasta o direito ao benefício'. Não há como acolher o pedido " +
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
  const votoQ = "VOTO. Como ensina a doutrina: 'a boa-fé objetiva impõe deveres anexos de conduta às partes'. Entendo aplicável.";
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

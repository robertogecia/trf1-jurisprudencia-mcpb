// Smoke test: o servidor sobe de uma pasta COM ESPAÇO no nome (o Claude Desktop instala em "Claude Extensions/")
// e responde tools/list. Lição do TCE-RO: uma guarda por caminho deixou a extensão muda por semanas sem nenhum teste acusar.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("servidor sobe de pasta com espaço e lista as ferramentas", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "trf1 smoke "));
  const destino = path.join(base, "Claude Extensions", "trf1 teste");
  fs.mkdirSync(destino, { recursive: true });
  fs.cpSync(path.join(raiz, "server"), path.join(destino, "server"), { recursive: true });
  fs.cpSync(path.join(raiz, "package.json"), path.join(destino, "package.json"));
  fs.symlinkSync(path.join(raiz, "node_modules"), path.join(destino, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const estado = path.join(base, "estado");
  const cliente = new Client({ name: "smoke", version: "1" });
  const transporte = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(destino, "server", "index.js")],
    env: { ...process.env, TRF1_MCP_SEM_AVISO_ATUALIZACAO: "1", TRF1_MCP_DIR_ESTADO: estado,
      TRF1_MCP_DIR_RECIBOS: path.join(base, "recibos"), TRF1_MCP_ARQUIVO_ERROS: path.join(base, "erros.jsonl"), TRF1_MCP_ARQUIVO_RITMO: path.join(base, "ritmo.jsonl") },
  });
  try {
    await cliente.connect(transporte);
    const nomes = (await cliente.listTools()).tools.map((t) => t.name);
    for (const n of ["buscar_jurisprudencia_trf1", "obter_decisao_trf1", "verificar_citacao_trf1", "diagnostico_ritmo_trf1"]) assert.ok(nomes.includes(n), n);
    const diag = await cliente.callTool({ name: "diagnostico_ritmo_trf1", arguments: {} });
    assert.ok(!diag.isError && /n[íi]vel|limite|requisi/i.test(diag.content[0].text));
    // v1.6.0: parâmetros novos no esquema e relatório do livro-razão (arquivo vazio na pasta temporária)
    const ferramentas = (await cliente.listTools()).tools;
    assert.deepEqual(ferramentas.find((t) => t.name === "obter_decisao_trf1").inputSchema.properties.modo.enum, ["completo", "triagem"]);
    assert.equal(ferramentas.find((t) => t.name === "diagnostico_ritmo_trf1").inputSchema.properties.relatorio.type, "boolean");
    const rel = await cliente.callTool({ name: "diagnostico_ritmo_trf1", arguments: { relatorio: true } });
    assert.ok(!rel.isError && rel.content[0].text.includes("Relatório de ritmo do portal do CJF") && rel.content[0].text.includes("0 requisições registradas"), rel.content[0].text.slice(-600));
  } finally {
    await cliente.close().catch(() => {});
    fs.rmSync(base, { recursive: true, force: true });
  }
});

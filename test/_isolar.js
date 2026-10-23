// Isola os testes da pasta real do usuário. DEVE ser o PRIMEIRO import de cada arquivo de teste: os imports ESM
// executam na ordem em que aparecem, e o server/lib.js resolve a pasta de estado do disjuntor ao ser carregado.
// Todos os padrões do que a extensão grava (estado do disjuntor, recibos, ritmo, diário de erros, aviso de versão)
// derivam de os.homedir(); apontar HOME (POSIX) e USERPROFILE (Windows) para uma pasta nova em os.tmpdir() leva
// todos eles para lá sem mudar a semântica das variáveis TRF1_MCP_* que os próprios testes exercitam.
// O processo do servidor no smoke test herda este HOME pelo spread de process.env.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

for (const v of ["TRF1_MCP_DIR_ESTADO", "TRF1_MCP_DIR_RECIBOS", "TRF1_MCP_ARQUIVO_RITMO", "TRF1_MCP_ARQUIVO_ERROS", "TRF1_MCP_ARQUIVO_AVISO_VERSAO"]) {
  delete process.env[v]; // herdadas do shell poderiam apontar para a pasta real
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), "trf1-teste-home-"));
const home = path.join(base, "home");
fs.mkdirSync(home, { recursive: true });

process.env.HOME = home;
process.env.USERPROFILE = home;

if (path.resolve(os.homedir()) !== path.resolve(home)) {
  throw new Error(`isolamento falhou: os.homedir() = ${os.homedir()}`);
}

process.on("exit", () => {
  try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ }
});

export const HOME_DE_TESTE = home;

import fs from "node:fs";
import * as lib from "../../server/lib.js";
const casos = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = casos.map((c) => { const r = lib.conferir(c.texto, c.trecho, c.trib, c.atr); return { ok: r.ok, alertas: r.alertas ?? [], spans: (r.spans ?? []).map((x) => [...x]), erro: r.erro ?? null, fragmento: r.fragmento ?? null }; });
process.stdout.write(JSON.stringify(out));

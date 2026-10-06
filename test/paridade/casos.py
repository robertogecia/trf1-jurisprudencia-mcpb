#!/usr/bin/env python3
"""Paridade Python × Node de conferir() (v1.2.1, 06/10/2026: a 1.2.0 saiu com "sem razão" só no Node, e nada pegou).
Janelas determinísticas dos recibos locais (~/.trf1-jurisprudencia-recibos): texto, ementa, dispositivo e inteiro teor;
compara ok, alertas e spans. Sem rede.  python3 casos.py [dir-python]"""
import glob, json, os, random, re, subprocess, sys
PY = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/MCP/trf1-jurisprudencia")
sys.path.insert(0, PY)
import servidor_trf1 as s  # noqa: E402
AQUI = os.path.dirname(os.path.abspath(__file__))
random.seed(20261006)
casos = []
for f in sorted(glob.glob(os.path.expanduser("~/.trf1-jurisprudencia-recibos/*.json"))):
    r = json.load(open(f, encoding="utf-8"))
    for campo in ("texto", "ementa", "dispositivo", "inteiro_teor"):
        t = r.get(campo) or ""
        if len(t) < 200:
            continue
        pal = t.split()
        for _ in range(60):
            n = random.choice([4, 6, 8, 12, 20]); a = random.randrange(0, max(1, len(pal) - n))
            casos.append({"texto": t, "trecho": " ".join(pal[a:a + n]), "trib": r.get("base", "trf1").upper(), "atr": campo != "ementa"})
sint = ["VOTO Sem razão o apelante ao dizer que o benefício é devido desde o requerimento administrativo.",
        "VOTO Ainda que assim não fosse, a ausência de prova da contratação já bastaria para afastar a cobrança.",
        "RELATÓRIO O INSS sustenta que o benefício é indevido porque o segurado voltou a trabalhar. VOTO Nego provimento.",
        'VOTO Como ensina a doutrina: "a boa-fé objetiva impõe deveres anexos de conduta às partes". Entendo aplicável.']
for t in sint:
    pal = t.split()
    for a in range(1, len(pal) - 6, 2):
        casos.append({"texto": t, "trecho": " ".join(pal[a:a + 6]), "trib": "TNU", "atr": True})
py = []
for c in casos:
    r = s.conferir(c["texto"], c["trecho"], c["trib"], c["atr"])
    py.append({"ok": r["ok"], "alertas": r.get("alertas", []), "spans": [list(x) for x in r.get("spans", [])], "erro": r.get("erro"), "fragmento": r.get("fragmento")})
ent = os.path.join(AQUI, "_casos.json"); json.dump(casos, open(ent, "w"), ensure_ascii=False)
out = subprocess.run(["node", os.path.join(AQUI, "casos.mjs"), ent], capture_output=True, text=True, check=True).stdout
nd = json.loads(out); os.remove(ent)
dif = [i for i, (a, b) in enumerate(zip(py, nd)) if a != b]
print(f"paridade conferir: {len(casos)} casos · {len(casos) - len(dif)} idênticos · {len(dif)} diferentes")
for i in dif[:8]:
    print("  ", repr(casos[i]["trecho"][:70]), "\n     py:", py[i]["alertas"], py[i]["spans"], "\n   node:", nd[i]["alertas"], nd[i]["spans"])
sys.exit(1 if dif else 0)

"""Convierte la historieta HTML original en datos: genesis.json + library.svg.

Uso:  python3 scripts/extraer.py <historieta.html>
Genera src/genesis.json (capítulos y viñetas) y src/library.svg (la biblioteca de piezas).
"""
import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
src = Path(sys.argv[1]).read_text(encoding="utf8")
soup = BeautifulSoup(src, "html.parser")

# --- Biblioteca de piezas: el contenido de <defs> tal cual ---
# (se copia del texto crudo: el parser de HTML pasaría viewBox a minúsculas)
defs = src.split("<defs>", 1)[1].split("</defs>", 1)[0]
(ROOT / "src" / "library.svg").write_text(defs.strip() + "\n", encoding="utf8")

# --- Secciones del índice (Arranque, Los primeros años, ...) ---
grupos = {}
for sec in soup.select(".toc > section"):
    titulo = sec.select_one("h3").get_text(strip=True)
    for btn in sec.select("button"):
        n = int(btn.select_one(".n").get_text(strip=True))
        grupos[n] = {"n": n, "titulo": btn.select_one(".t").get_text(strip=True),
                     "anios": btn.select_one(".y").get_text(strip=True), "grupo": titulo}


def bg_token(style):
    m = re.search(r"--bg:\s*var\(--(p\d)\)", style or "")
    if m:
        return m.group(1)
    if "#23214a" in (style or ""):
        return "noche"
    return "p1"


vinetas = []
for page in soup.select("main section.page"):
    head = page.select_one("header.running")
    if not head:
        continue
    n = int(re.search(r"\d+", head.select_one(".eyebrow").get_text()).group())
    for fig in page.select("figure.panel"):
        cap = fig.select_one(".cap")
        b = cap.find("b")
        lead = b.get_text(strip=True) if b else ""
        if b:
            b.extract()
        texto = cap.get_text(" ", strip=True)
        svg = fig.select_one(".art svg")
        alt = svg.get("aria-label", "")
        # El fondo base (#base) lo agrega siempre el visor, no se guarda.
        for u in svg.find_all("use", href="#base"):
            u.extract()
        arte = "".join(str(c) for c in svg.contents).strip()
        arte = re.sub(r"\n\s+", "\n", arte)
        globos = []
        for p in fig.select(".bubble"):
            lado = "izq" if "b-l" in p.get("class", []) else "der"
            globos.append({"t": p.get_text(" ", strip=True), "lado": lado})
        vinetas.append({
            "i": len(vinetas) + 1,
            "cap": n,
            "fondo": bg_token(fig.get("style")),
            "epigrafe": {"b": lead, "t": texto},
            "arte": arte,
            "globos": globos,
            "alt": alt,
        })

out = {"capitulos": [grupos[k] for k in sorted(grupos)], "vinetas": vinetas}
(ROOT / "src" / "genesis.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf8")
print(f"{len(out['capitulos'])} capítulos, {len(vinetas)} viñetas")

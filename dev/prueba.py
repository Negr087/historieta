"""Prueba de punta a punta contra el servidor de desarrollo (npm run dev).

Uso: python3 dev/prueba.py <npub-curadora> <nsec-curadora>
Recorre: lector, editor (publica una viñeta con una identidad nueva), curaduría
(la aprueba como canon) y verifica que el tronco creció.
"""
import json
import sys
from playwright.sync_api import sync_playwright

NPUB, NSEC = sys.argv[1], sys.argv[2]
URL = "http://localhost:8080/"
AJUSTES = json.dumps({"relays": ["ws://localhost:7777"], "curadores": [NPUB]})
SHOTS = "/tmp/shots"
errores = []


def contexto(browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    ctx.add_init_script(f"localStorage.setItem('historieta.ajustes', {json.dumps(AJUSTES)});")
    return ctx


def vigilar(page, nombre):
    page.on("pageerror", lambda e: errores.append(f"{nombre}: {e}"))
    page.on("console", lambda m: m.type == "error" and errores.append(f"{nombre} console: {m.text}"))


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])

    # --- Lectora / autora de la comunidad ---
    ctx = contexto(browser)
    page = ctx.new_page()
    vigilar(page, "autora")
    page.goto(URL)
    page.wait_for_timeout(2500)
    page.screenshot(path=f"{SHOTS}/01-portada.png")
    print("estado:", page.inner_text("#estado"), "| contador:", page.inner_text("#count"))
    page.click("#next"); page.click("#next"); page.wait_for_timeout(300)
    page.screenshot(path=f"{SHOTS}/02-indice.png", full_page=False)
    page.click("#next"); page.wait_for_timeout(600)
    page.screenshot(path=f"{SHOTS}/03-cap1.png")
    print("viñetas en pág:", page.locator("#vista-leer figure.panel").count())

    # Editor
    page.click(".nav [data-vista=crear]"); page.wait_for_timeout(500)
    page.click(".piezas button[title='Agregar una moneda']")
    page.click(".piezas button[title='Agregar cartel']")
    page.fill(".grupo:has(> b:text('Pieza elegida')) input", "HALVING 2028")
    # arrastrar el cartel
    box = page.locator(".lienzo svg").bounding_box()
    page.mouse.move(box["x"] + box["width"] * 0.28, box["y"] + box["height"] * 0.19)
    page.mouse.down(); page.mouse.move(box["x"] + box["width"] * 0.35, box["y"] + box["height"] * 0.30, steps=6); page.mouse.up()
    page.fill("input[placeholder='Ej.: Abril de 2028.']", "Abril de 2028.")
    page.fill("textarea[placeholder='Qué pasó, en una o dos frases.']", "Llega el quinto halving: la recompensa baja a 1,5625 bitcoins por bloque.")
    page.fill("input[placeholder='Lo que dice Sat (opcional)']", "¡Otra vez a la mitad!")
    page.fill(".grupo:has(> b:text('Fuentes')) input >> nth=0", "https://bitcoin.org/bitcoin.pdf")
    page.evaluate("document.getElementById('stage').scrollTop=0"); page.screenshot(path=f"{SHOTS}/04-editor.png")
    page.click("text=Entrar y publicar"); page.wait_for_timeout(300)
    page.screenshot(path=f"{SHOTS}/05-entrar.png")
    page.click("text=Crear una identidad nueva acá"); page.wait_for_timeout(2500)
    print("toast:", page.inner_text("#toast"))
    page.screenshot(path=f"{SHOTS}/06-publicada.png")

    # Una rama alternativa desde una viñeta del génesis (cap. 4, Pizza Day)
    page.goto(URL + "#pag-2"); page.wait_for_timeout(1500)
    page.click(".toc button:has-text('El Pizza Day')"); page.wait_for_timeout(500)
    page.locator("#vista-leer .pie button:has-text('Seguir')").first.click(); page.wait_for_timeout(500)
    page.fill("textarea[placeholder='Qué pasó, en una o dos frases.']", "¿Y si Laszlo se comía las pizzas y guardaba los 10.000 bitcoins?")
    page.click("text=Firmar y publicar"); page.wait_for_timeout(2500)
    print("toast rama:", page.inner_text("#toast"))
    page.click(".nav [data-vista=ramas]"); page.wait_for_timeout(800)
    page.screenshot(path=f"{SHOTS}/07-ramas.png")
    print("tarjetas en ramas:", page.locator("#vista-ramas .tarjeta").count())

    # --- Curadora ---
    ctx2 = contexto(browser)
    cur = ctx2.new_page()
    vigilar(cur, "curadora")
    cur.goto(URL); cur.wait_for_timeout(2000)
    cur.click("#nav-yo"); cur.fill("input[placeholder='nsec1…']", NSEC)
    cur.click("text=Entrar con esta clave"); cur.wait_for_timeout(800)
    print("nav curar visible:", cur.is_visible("#nav-curar"))
    cur.click("#nav-curar"); cur.wait_for_timeout(800)
    cur.screenshot(path=f"{SHOTS}/08-curar.png", full_page=True)
    cands = cur.locator("text=✓ Aprobar como canon").count()
    print("candidatas:", cands)
    cur.locator("text=✓ Aprobar como canon").first.click(); cur.wait_for_timeout(1500)
    print("toast curadora:", cur.inner_text("#toast"))

    # La autora ve el tronco crecer en vivo
    page.wait_for_timeout(1500)
    page.goto(URL + "#pag-2"); page.wait_for_timeout(2500)
    total = page.inner_text("#count")
    print("páginas ahora:", total)
    n = int(total.split("/")[1])
    page.goto(URL + f"#pag-{n - 2}"); page.wait_for_timeout(2000)
    page.screenshot(path=f"{SHOTS}/09-ultima-pag.png", full_page=True)
    page.goto(URL + f"#pag-{n - 1}"); page.wait_for_timeout(1500)
    page.screenshot(path=f"{SHOTS}/10-fin.png", full_page=True)

    # Zap: abre el diálogo
    page.goto(URL + f"#pag-{n - 2}"); page.wait_for_timeout(1500)
    page.locator("#vista-leer .pie .zap").last.click(); page.wait_for_timeout(800)
    page.screenshot(path=f"{SHOTS}/11-zap.png")

    # Móvil
    m = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    m.add_init_script(f"localStorage.setItem('historieta.ajustes', {json.dumps(AJUSTES)});")
    mp = m.new_page(); vigilar(mp, "movil")
    mp.goto(URL + "#crear"); mp.wait_for_timeout(2500)
    mp.screenshot(path=f"{SHOTS}/12-movil-editor.png")
    browser.close()

print("\nERRORES:" if errores else "\nSin errores de JS.")
for e in errores:
    print(" -", e)

from playwright.sync_api import sync_playwright
ICON = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="{rx}" fill="#13241c"/>
<g transform="translate(256 {cy}) scale({k})"><rect x="-150" y="-118" width="84" height="236" rx="12" fill="#a9c58f"/><rect x="-42" y="-118" width="84" height="150" rx="12" fill="#e8c9a0"/><rect x="-42" y="48" width="84" height="70" rx="12" fill="#f6f9f6" opacity=".28"/><rect x="66" y="-118" width="84" height="236" rx="12" fill="#e4521b"/></g></svg>'''
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    for name, size, rx, k in [("icon-192.png", 192, 96, 1.0), ("icon-512.png", 512, 96, 1.0), ("icon-maskable-512.png", 512, 0, 0.78)]:
        page = b.new_page(viewport={"width": size, "height": size})
        page.set_content(f'<html><body style="margin:0;background:transparent">{ICON.format(rx=rx, cy=256, k=k)}</body></html>')
        page.locator("svg").evaluate(f"el => {{ el.style.width = '{size}px'; el.style.height = '{size}px'; el.style.display = 'block'; }}")
        page.screenshot(path=f"/home/claude/little-river-planner/icons/{name}", omit_background=True)
        page.close()
    b.close()

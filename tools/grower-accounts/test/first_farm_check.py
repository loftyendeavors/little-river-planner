"""First grower session and a fresh phone session against a disposable, in-memory farm.

Build grower-accounts with SUPABASE_URL=http://127.0.0.1:54321 and a test
publishable key, then run python test/first_farm_check.py from that directory.
CHROMIUM_BIN selects a locally installed Chromium; otherwise Playwright's is used.
The account is already verified. No email, real credentials or hosted data are used.
"""
import base64
import functools
import http.server
import json
import os
import secrets
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright

from browser_flow import open_session

DIST = Path(__file__).resolve().parents[1] / "dist"
API = "http://127.0.0.1:54321"
USER_ID = "00000000-0000-4000-a000-000000000001"
EMAIL = "sprout@example.test"
HANDLE = "sprout"
FARM = "Willow Row Farm"
FIELD = "West field"
START = date(2027, 6, 1)
TODAY = datetime(2026, 11, 1, 12, tzinfo=timezone.utc)


class QuietStatic(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class LocalFarm:
    """The account endpoints used by both profiles, with one revision-checked farm."""

    def __init__(self, base):
        self.base = base
        self.farm = None
        self.password = secrets.token_urlsafe(24)
        self.user = {"id": USER_ID, "aud": "authenticated", "email": EMAIL, "role": "authenticated"}
        def segment(value):
            return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()
        claims = {"sub": USER_ID, "role": "authenticated", "exp": 1893456000}
        self.token = segment({"alg": "HS256", "typ": "JWT"}) + "." + segment(claims) + ".eA"
        self.failures = []

    def route(self, route):
        request = route.request
        url = urlsplit(request.url)
        origin = f"{url.scheme}://{url.netloc}"
        if origin == self.base:
            route.continue_()
            return
        if origin != API:
            self.failures.append("Unexpected origin " + origin)
            route.abort()
            return
        headers = {"Access-Control-Allow-Origin": self.base, "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                   "Access-Control-Allow-Headers": request.headers.get("access-control-request-headers", "*")}
        if request.method == "OPTIONS":
            route.fulfill(status=204, headers=headers)
            return
        try:
            result = self.respond(request, url)
        except (AssertionError, ValueError, KeyError) as error:
            self.failures.append(f"{request.method} {url.path}: {error}")
            route.fulfill(status=400, headers=headers, json={"message": "Invalid test request"})
            return
        route.fulfill(status=200, headers=headers, json=result)

    def respond(self, request, url):
        if url.path in ("/auth/v1/token", "/functions/v1/username-login"):
            assert request.method == "POST"
            payload = request.post_data_json
            identifier = "email" if url.path == "/auth/v1/token" else "username"
            assert payload[identifier] == (EMAIL if identifier == "email" else HANDLE)
            assert payload["password"] == self.password
            return {"access_token": self.token, "refresh_token": "test-refresh", "token_type": "bearer",
                    "expires_in": 3600, "user": self.user}
        assert request.headers.get("authorization") == "Bearer " + self.token, "Missing fixture session"
        if url.path == "/auth/v1/user" and request.method == "GET":
            return self.user
        if url.path == "/rest/v1/grower_farms" and request.method == "GET":
            assert parse_qs(url.query)["owner_id"] == ["eq." + USER_ID]
            return [self.farm] if self.farm else []
        assert request.method == "POST"
        payload = request.post_data_json
        assert payload["expected_owner"] == USER_ID
        if url.path == "/rest/v1/rpc/start_grower_farm":
            assert self.farm is None
            self.farm = {"owner_id": USER_ID, "username": payload["handle"], "name": payload["farm_name"],
                         "plan": payload["initial_plan"], "revision": 1}
        elif url.path == "/rest/v1/rpc/save_grower_farm":
            assert self.farm["revision"] == payload["expected_revision"], "Stale revision"
            self.farm.update(plan=payload["next_plan"], revision=self.farm["revision"] + 1)
        else:
            raise ValueError("Unexpected API call")
        if parse_qs(url.query).get("select") == ["owner_id,revision"]:
            return {key: self.farm[key] for key in ("owner_id", "revision")}
        return self.farm


def open_profile(browser, store, width, identifier, when):
    context = browser.new_context(viewport={"width": width, "height": 844}, timezone_id="UTC", service_workers="block")
    context.route("**/*", store.route)
    page = context.new_page()
    page.clock.set_fixed_time(when)
    page.goto(store.base)
    expect(page.get_by_role("heading", name="Sign in to your farm")).to_be_visible()
    open_session(page, identifier, store.password)
    return context, page, page.frame_locator("iframe[title='Farm planner']")


def set_value(editor, hook, value):
    field = editor.locator(f'[data-hook="{hook}"]')
    field.fill(value)
    field.press("Tab")


def walk(browser, store, first_width=1280):
    desktop, page, editor = open_profile(browser, store, first_width, EMAIL, TODAY)
    page.get_by_label("Username", exact=True).fill(HANDLE)
    page.get_by_label("Farm name").fill(FARM)
    page.get_by_label("An empty farm").check()
    page.get_by_role("button", name="Create my farm").click()
    page.get_by_role("button", name="Add your first field").click()
    page.get_by_label("Field name").fill(FIELD)
    expect(page.get_by_label("Beds", exact=True)).to_have_value("4")
    expect(page.get_by_label("Length (ft)")).to_have_value("20")
    page.get_by_role("button", name="Save field and open planner").click()
    expect(editor.locator("text[data-garden]").filter(has_text=FIELD)).to_be_visible()
    editor.get_by_role("button", name="Successions", exact=True).click()
    editor.locator('[data-hook="succ-crop"]').select_option("lettuce_head")
    editor.locator('[data-hook="succ-plan-by"] [data-value="beds"]').click()
    editor.locator('[data-hook="succ-dates-are-for"] [data-value="planting"]').click()
    expect(editor.locator('[data-hook="succ-garden"] option:checked')).to_contain_text(FIELD)
    set_value(editor, "succ-from", START.isoformat())
    set_value(editor, "succ-to", (START + timedelta(days=14)).isoformat())
    set_value(editor, "succ-every", "7")
    expect(editor.locator('[data-hook="succ-row"]')).to_have_count(3)
    sow_days = editor.locator('[data-hook="succ-sow"]').all_inner_texts()
    dates = [datetime.strptime(f"{START.year} {text}", "%Y %b %d").date() for text in sow_days]
    assert dates == [dates[0] + timedelta(days=7 * week) for week in range(3)]
    first_sow = dates[0].isoformat()
    editor.get_by_role("button", name="Add 3 plantings", exact=True).click()
    expect(editor.locator("#saveState")).to_have_text("Saved", timeout=20000)
    page.get_by_role("button", name="Farm settings").click()
    expect(page.locator("#summary")).to_contain_text("3 plantings")
    expect(page.get_by_text(FIELD + " · 4 spaces")).to_be_visible()
    saved = store.farm["plan"]
    beds = saved["beds"]
    assert len(beds) == 4 and all(bed["l"] == 20 for bed in beds)
    plantings = sorted(saved["plantings"], key=lambda planting: planting["date"])
    assert [p["date"] for p in plantings] == [(START + timedelta(days=7*i)).isoformat() for i in range(3)]
    assert all(p["cropId"] == "lettuce_head" and p["bedId"] in {bed["id"] for bed in beds} for p in plantings)
    page.get_by_role("button", name="Open planner").click()
    if first_width <= 700:
        editor.get_by_role("button", name="Full planner", exact=True).click()
    editor.get_by_role("button", name="Map", exact=True).click()
    editor.get_by_role("button", name="Backup", exact=True).click()
    with page.expect_download() as download:
        editor.get_by_role("button", name="Download a backup", exact=False).click()
    backup_plan = json.loads(Path(download.value.path()).read_text())["lrfNextKeep"]["grower"]["plan"]
    assert backup_plan["plantings"] == saved["plantings"], "Planner backup must include the three account sowings"
    due = datetime.fromisoformat(first_sow + "T12:00:00+00:00")
    page.clock.set_fixed_time(due)
    editor.get_by_role("button", name="Tasks", exact=True).click()
    first = editor.locator(f'[data-hook="tasks-row"][data-due="{first_sow}"]').filter(has_text="lettuce").first
    expect(first.get_by_role("checkbox", name="Sow head lettuce, Head lettuce")).to_be_visible()
    expect(first).to_contain_text(FIELD + " 1")
    desktop.close()

    mobile, phone, reopened = open_profile(browser, store, 390, HANDLE, due)
    expect(phone.locator("#identity")).to_have_text(FARM)
    mobile_task = reopened.locator(f'[data-hook="tasks-row"][data-due="{first_sow}"]')
    expect(mobile_task.get_by_role("checkbox", name="Sow head lettuce, Head lettuce")).to_be_visible()
    expect(mobile_task).to_contain_text(FIELD + " 1")
    assert phone.evaluate("document.documentElement.scrollWidth <= innerWidth")
    reopened.get_by_role("button", name="Full planner", exact=True).click()
    reopened.get_by_role("button", name="Map", exact=True).click()
    expect(reopened.locator("text[data-garden]").filter(has_text=FIELD)).to_be_visible()
    reopened.get_by_role("button", name="Successions", exact=True).click()
    expect(reopened.locator('[data-hook="succ-run"]').filter(has_text="3 sowings")).to_contain_text("Head lettuce")
    phone.get_by_role("button", name="Farm settings").click()
    expect(phone.locator("#summary")).to_contain_text("4 beds and growing spaces · 3 plantings")
    assert phone.evaluate("document.documentElement.scrollWidth <= innerWidth")
    mobile.close()
    return first_sow


def main():
    html = (DIST / "index.html").read_text()
    assert f"connect-src 'self' {API};" in html, "Build the test site with the loopback SUPABASE_URL first"
    handler = functools.partial(QuietStatic, directory=DIST)
    with http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler) as server, sync_playwright() as pw:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        store = LocalFarm(f"http://127.0.0.1:{server.server_port}")
        browser = pw.chromium.launch(executable_path=os.getenv("CHROMIUM_BIN"))
        try:
            first = walk(browser, store)
            assert not store.failures, store.failures
            store = LocalFarm(f"http://127.0.0.1:{server.server_port}")
            first = walk(browser, store, first_width=375)
        finally:
            browser.close()
            server.shutdown()
            assert not store.failures, store.failures
    print(f"PASS: four 20-foot beds, three weekly lettuce plantings in the account and planner backup, first task on {first}, reopened on a fresh phone profile.")


if __name__ == "__main__":
    main()

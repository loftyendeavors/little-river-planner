"""Run against a disposable local account stack and RFC822 mail capture."""
import json
import os
import secrets
import time
from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


def local_url(value):
    url = urlsplit(value)
    if url.scheme != "http" or url.hostname not in {"localhost", "127.0.0.1"}:
        raise ValueError("Use a local test stack with mail capture.")
    return value


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attributes):
        if tag == "a":
            self.urls.append(dict(attributes).get("href", ""))


def email_link(capture, recipient):
    for _ in range(100):
        if capture.exists():
            mail = BytesParser(policy=policy.default).parsebytes(capture.read_bytes())
            if recipient in str(mail.get("To", "")):
                body = mail.get_body(preferencelist=("html",))
                if body:
                    links = Links()
                    links.feed(body.get_content())
                    for link in links.urls:
                        if urlsplit(link).path.endswith("/verify"):
                            return local_url(link)
        time.sleep(0.1)
    raise RuntimeError("Expected a verification email in the local capture.")


def page_for(browser, width):
    return browser.new_page(viewport={"width": width, "height": 844})


def signup(page, address, password):
    form = page.locator("#signup")
    form.get_by_label("Email", exact=True).fill(address)
    form.get_by_label("Password", exact=True).fill(password)
    form.get_by_role("button", name="Create account").click()
    expect(page.get_by_role("heading", name="Check your email")).to_be_visible()


def open_session(page, username, password):
    form = page.locator("#login")
    form.get_by_label("Username or email").fill(username)
    form.get_by_label("Password", exact=True).fill(password)
    form.get_by_role("button", name="Sign in", exact=True).click()


def check():
    base = local_url(os.environ["GROWER_TEST_URL"])
    mail = Path(os.environ["GROWER_TEST_MAIL_FILE"])
    handle = "grower" + secrets.token_hex(5)
    address = handle + "@example.test"
    password = secrets.token_urlsafe(24)
    browser_args = {"headless": True}
    if os.environ.get("CHROMIUM_BIN"):
        browser_args.update(executable_path=os.environ["CHROMIUM_BIN"],
                            args=["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote", "--single-process"])
    with sync_playwright() as pw:
        mobile = pw.chromium.launch(**browser_args)
        page = page_for(mobile, 390)
        page.goto(base)
        expect(page.get_by_role("heading", name="Sign in to your farm")).to_be_visible()
        page.get_by_role("navigation").get_by_role("button", name="Create account").click()
        signup(page, address, password)
        page.reload()
        expect(page.get_by_role("heading", name="Check your email")).to_be_visible()
        page.goto(email_link(mail, address))
        expect(page.get_by_role("heading", name="Create your farm")).to_be_visible()
        page.get_by_label("Username", exact=True).fill(handle)
        page.get_by_label("Farm name").fill("Test Orchard")
        page.get_by_label("An empty farm").check()
        page.get_by_role("button", name="Create my farm").click()
        editor = page.frame_locator("iframe[title='Farm planner']")
        expect(editor.locator("#wkFull")).to_be_visible()
        page.get_by_role("button", name="Add your first field").click()
        expect(page.get_by_role("heading", name="Test Orchard")).to_be_visible()
        expect(page.get_by_label("Field name")).to_be_focused()
        page.get_by_label("Field name").fill("West field")
        page.get_by_role("button", name="Save field and open planner").click()
        expect(editor.locator("text[data-garden]").filter(has_text="West field")).to_be_visible()
        expect(page.get_by_role("button", name="Farm settings")).to_be_visible()
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.get_by_role("button", name="Sign out").click()
        open_session(page, handle, password)
        expect(editor.locator("#wkFull")).to_be_visible()
        page.get_by_role("button", name="Farm settings").click()
        expect(page.get_by_text("West field · 4 spaces")).to_be_visible()
        mobile.close()

        desktop = pw.chromium.launch(**browser_args)
        page = page_for(desktop, 1280)
        page.goto(base)
        expect(page.get_by_role("heading", name="Sign in to your farm")).to_be_visible()
        open_session(page, handle, password)
        editor = page.frame_locator("iframe[title='Farm planner']")
        expect(editor.locator("#saveState")).to_have_text("Saved", timeout=15000)
        editor.get_by_role("button", name="Timeline", exact=True).click()
        expect(editor.locator("body")).to_have_attribute("data-view", "timeline")
        editor.get_by_role("button", name="Map", exact=True).click()
        editor.get_by_role("button", name="Edit layout", exact=True).click()
        editor.locator("text[data-garden]").filter(has_text="West field").click()
        garden = editor.locator("#leGarden")
        garden.fill("North field")
        garden.press("Tab")
        page.get_by_role("button", name="Sign out").click()
        expect(page.locator("iframe")).to_have_count(0)
        open_session(page, handle, password)
        expect(editor.locator("text[data-garden]").filter(has_text="North field")).to_be_visible()
        page.get_by_role("button", name="Farm settings").click()
        expect(page.get_by_text("North field · 4 spaces")).to_be_visible()
        with page.expect_download() as saved:
            page.get_by_role("button", name="Download planner backup").click()
        plan = json.loads(Path(saved.value.path()).read_text())
        assert len(plan["beds"]) == 4 and plan["settings"]["farm"] == "Test Orchard"
        page.get_by_role("button", name="Sign out").click()
        page.get_by_role("button", name="Forgot password?").click()
        mail.unlink(missing_ok=True)
        page.get_by_label("Account email").fill(address)
        page.get_by_role("button", name="Send recovery email").click()
        expect(page.get_by_role("heading", name="Check your email")).to_be_visible()
        page.goto(email_link(mail, address))
        expect(page.get_by_role("heading", name="Choose a new password")).to_be_visible()
        page.get_by_label("New password", exact=True).fill(secrets.token_urlsafe(24))
        page.get_by_role("button", name="Save new password").click()
        expect(editor.locator("text[data-garden]").filter(has_text="North field")).to_be_visible()
        desktop.close()


if __name__ == "__main__":
    check()
    print("Passed signup, confirmation, two independent browsers, saved farm, export and recovery.")

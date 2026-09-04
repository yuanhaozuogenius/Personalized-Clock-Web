"""Launch a disposable Chrome CDP instance and run one browser UI test safely.

Chrome receives its arguments as a process argument list. This avoids truncating
the project's spaced path into a sibling ``Personalized`` directory.
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path


TEST_SCRIPTS = {"ui_smoke": "ui_smoke.py", "audio_clip": "audio_clip_ui.py"}


def find_chrome():
    """Find Chrome without requiring a machine-specific configuration."""
    candidates = [
        os.environ.get("CHROME_PATH"),
        shutil.which("chrome"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    return next((item for item in candidates if item and Path(item).is_file()), None)


def wait_for_cdp(endpoint, timeout=10):
    """Wait for Chrome's debugging endpoint before starting the selected test."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{endpoint}/json/version", timeout=1):
                return
        except OSError:
            time.sleep(0.1)
    raise TimeoutError(f"Chrome CDP did not start at {endpoint}")


def main():
    parser = argparse.ArgumentParser(
        description="Run a browser test with a disposable, safely quoted Chrome profile."
    )
    parser.add_argument("test", choices=TEST_SCRIPTS, help="Browser test to run")
    parser.add_argument("--port", type=int, default=9223, help="Chrome CDP port")
    args, test_args = parser.parse_known_args()
    if "--endpoint" in test_args:
        parser.error("--endpoint is managed by this launcher; use --port instead")

    chrome = find_chrome()
    if not chrome:
        parser.error("Chrome was not found; set CHROME_PATH to chrome.exe")

    endpoint = f"http://127.0.0.1:{args.port}"
    test_path = Path(__file__).with_name(TEST_SCRIPTS[args.test])
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    # Keep browser storage and Crashpad data outside the project tree.
    with tempfile.TemporaryDirectory(prefix="personal-clock-cdp-", ignore_cleanup_errors=True) as profile:
        chrome_args = [
            chrome, "--headless=new", "--disable-gpu", "--no-first-run",
            "--disable-default-apps", f"--remote-debugging-port={args.port}",
            "--remote-allow-origins=*", f"--user-data-dir={profile}", "about:blank",
        ]
        browser = subprocess.Popen(chrome_args, creationflags=creation_flags)
        try:
            wait_for_cdp(endpoint)
            return subprocess.run(
                [sys.executable, str(test_path), "--endpoint", endpoint, *test_args],
                check=False,
            ).returncode
        finally:
            browser.terminate()
            try:
                browser.wait(timeout=5)
            except subprocess.TimeoutExpired:
                browser.kill()
                browser.wait()


if __name__ == "__main__":
    raise SystemExit(main())

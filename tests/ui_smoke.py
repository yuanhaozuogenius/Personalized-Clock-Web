import argparse
import base64
import json
import time
import urllib.request
from pathlib import Path

import websocket


class CDP:
    def __init__(self, endpoint):
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        deadline = time.time() + 8
        while True:
            try:
                pages = json.load(opener.open(f"{endpoint}/json/list", timeout=1))
                break
            except Exception:
                if time.time() >= deadline:
                    raise
                time.sleep(0.1)
        page = next(item for item in pages if item["type"] == "page")
        self.socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=10)
        self.counter = 0

    def call(self, method, params=None):
        self.counter += 1
        request_id = self.counter
        self.socket.send(json.dumps({"id": request_id, "method": method, "params": params or {}}))
        while True:
            message = json.loads(self.socket.recv())
            if message.get("id") != request_id:
                continue
            if "error" in message:
                raise RuntimeError(message["error"])
            return message.get("result", {})

    def evaluate(self, expression, await_promise=False):
        result = self.call("Runtime.evaluate", {
            "expression": expression,
            "awaitPromise": await_promise,
            "returnByValue": True
        })
        if "exceptionDetails" in result:
            raise RuntimeError(result["exceptionDetails"])
        return result.get("result", {}).get("value")


def wait_for(cdp, expression, timeout=8):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if cdp.evaluate(expression):
            return
        time.sleep(0.1)
    raise TimeoutError(expression)


def touch_drag(cdp, label, delta_x, delta_y):
    """Dispatches browser-level touch input so gesture behavior matches a phone."""
    point = cdp.evaluate(f"""
      (() => {{
        const row = [...document.querySelectorAll('.alarm-swipe-row')]
          .find(item => item.textContent.includes({json.dumps(label)}));
        const rect = row.querySelector('.alarm-card').getBoundingClientRect();
        return {{x: rect.left + 28, y: rect.top + rect.height / 2}};
      }})()
    """)
    cdp.call("Input.dispatchTouchEvent", {
        "type": "touchStart",
        "touchPoints": [{"x": point["x"], "y": point["y"]}]
    })
    for fraction in (0.35, 0.7, 1):
        cdp.call("Input.dispatchTouchEvent", {
            "type": "touchMove",
            "touchPoints": [{
                "x": point["x"] + delta_x * fraction,
                "y": point["y"] + delta_y * fraction
            }]
        })
    cdp.call("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    # Include the delayed click window used by iOS after a touch gesture.
    time.sleep(0.5)


def fill_alarm(cdp, label, repeat_type, extra=""):
    cdp.evaluate(f"""
      (() => {{
        document.querySelector('#add-alarm').click();
        const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
        const date = `${{tomorrow.getFullYear()}}-${{String(tomorrow.getMonth()+1).padStart(2,'0')}}-${{String(tomorrow.getDate()).padStart(2,'0')}}`;
        document.querySelector('#alarm-time').value = '07:30';
        document.querySelector('#start-date').value = date;
        document.querySelector('#alarm-label').value = {json.dumps(label)};
        const repeat = document.querySelector('#repeat-type');
        repeat.value = {json.dumps(repeat_type)};
        repeat.dispatchEvent(new Event('change', {{bubbles:true}}));
        {extra}
        document.querySelector('#alarm-form').requestSubmit();
      }})()
    """)
    wait_for(cdp, f"[...document.querySelectorAll('.alarm-details')].some(el => el.textContent.includes({json.dumps(label)}))")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default="http://127.0.0.1:9223")
    parser.add_argument("--url", default="http://127.0.0.1:4173/")
    parser.add_argument("--screenshot", required=True)
    parser.add_argument("--skip-service-worker", action="store_true")
    parser.add_argument("--block-runtime-assets", action="store_true")
    args = parser.parse_args()

    cdp = CDP(args.endpoint)
    cdp.call("Page.enable")
    cdp.call("Runtime.enable")
    if args.block_runtime_assets:
        cdp.call("Network.enable")
        cdp.call("Network.setBlockedURLs", {"urls": ["*styles.css*", "*app.bundle.js*"]})
    cdp.call("Page.bringToFront")
    cdp.call("Emulation.setDeviceMetricsOverride", {
        "width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True
    })
    cdp.call("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    cdp.call("Page.navigate", {"url": args.url})
    wait_for(cdp, "document.readyState === 'complete'")
    cdp.evaluate("localStorage.clear(); location.reload()")
    wait_for(cdp, "document.readyState === 'complete'")
    assert cdp.evaluate("document.querySelector('.next-overview').hidden === true")
    assert cdp.evaluate("document.querySelector('#next-alarm-time').textContent === ''")
    assert cdp.evaluate("document.querySelector('.overview-illustration svg') !== null")
    assert cdp.evaluate("document.querySelector('.notice') === null")
    assert cdp.evaluate("document.querySelector('.brand-lockup') === null")
    assert cdp.evaluate("document.querySelector('#install-app') === null")
    assert cdp.evaluate("(() => { const hour=new Date().getHours(); const expected=hour>=5&&hour<12?'早上好':hour>=12&&hour<18?'下午好':'晚上好'; return document.querySelector('#greeting-title').textContent===expected; })()")
    assert cdp.evaluate("(() => { const hour=new Date().getHours(); const expected=hour>=5&&hour<18?'day':'night'; return document.querySelector('#greeting-symbol').dataset.period===expected; })()")
    assert cdp.evaluate("document.querySelector('.reminder-card strong').textContent === '响铃设置'")
    assert cdp.evaluate("[...document.querySelector('.action-row').children].slice(-2).map(item=>item.textContent.trim()).join('|') === '使用说明|分享'")
    assert cdp.evaluate("document.querySelector('style[data-build=inline]') !== null && document.querySelector('script[data-build=inline]') !== null")
    assert cdp.evaluate("document.querySelector('meta[name=viewport]').content.includes('user-scalable=no')")
    initial_scale = cdp.evaluate("visualViewport.scale")
    for _ in range(2):
        cdp.call("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": 195, "y": 280}]})
        cdp.call("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        time.sleep(0.08)
    time.sleep(0.25)
    assert abs(cdp.evaluate("visualViewport.scale") - initial_scale) < 0.001
    cdp.evaluate("document.querySelector('#add-alarm').click()")
    wait_for(cdp, "document.querySelector('#alarm-editor').open")
    assert cdp.evaluate("document.activeElement.id === 'alarm-editor'")
    cdp.evaluate("document.querySelector('#alarm-time').focus()")
    assert cdp.evaluate("getComputedStyle(document.querySelector('#alarm-time')).outlineStyle === 'none'")
    assert cdp.evaluate("getComputedStyle(document.querySelector('#alarm-time')).boxShadow !== 'none'")
    cdp.evaluate("document.querySelector('#cancel-edit').click()")

    fill_alarm(cdp, "测试间隔", "intervalDays", "document.querySelector('#interval-days').value='3'; document.querySelector('#interval-days').dispatchEvent(new Event('input',{bubbles:true}));")
    assert cdp.evaluate("document.querySelector('.next-overview').hidden === false")
    cdp.evaluate("document.querySelector('.switch span').click()")
    wait_for(cdp, "JSON.parse(localStorage.getItem('personalized-clock.alarms.v1'))[0].isEnabled === false")
    assert cdp.evaluate("document.querySelector('#alarm-editor').open === false")
    cdp.evaluate("document.querySelector('.switch span').click()")
    wait_for(cdp, "JSON.parse(localStorage.getItem('personalized-clock.alarms.v1'))[0].isEnabled === true")
    assert cdp.evaluate("document.querySelector('.alarm-card').textContent.includes('每隔 3 天')")
    assert cdp.evaluate("(() => { const track=document.querySelector('.switch span'); const thumb=getComputedStyle(track,'::after'); return thumb.position==='absolute' && Math.abs(parseFloat(thumb.top)-track.clientHeight/2)<0.1 && thumb.marginTop==='0px' && thumb.transform.includes('-13.5'); })()")
    assert cdp.evaluate("document.querySelector('#enable-reminders').dataset.enabled === 'true'")
    cdp.evaluate("document.querySelector('#enable-reminders').click()")
    wait_for(cdp, "document.querySelector('#enable-reminders').dataset.enabled === 'false' && document.querySelector('#enable-reminders').textContent === '启用提醒'")
    assert cdp.evaluate("document.querySelector('#reminder-status').textContent === '提醒未启用'")
    cdp.evaluate("document.querySelector('#enable-reminders').click()")
    wait_for(cdp, "document.querySelector('#enable-reminders').dataset.enabled === 'true' && document.querySelector('#enable-reminders').textContent === '已启用'")

    cdp.evaluate("""
      (() => {
        document.querySelector('.alarm-card').click();
        const repeat=document.querySelector('#repeat-type'); repeat.value='specificDates'; repeat.dispatchEvent(new Event('change',{bubbles:true}));
        document.querySelector('#open-date-picker').click();
        document.querySelector('#next-month').click();
        const days=[...document.querySelectorAll('.calendar-day')].slice(0,3);
        const point=el=>{const r=el.getBoundingClientRect();return {clientX:r.left+r.width/2,clientY:r.top+r.height/2}};
        days[0].dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:71,...point(days[0])}));
        document.querySelector('#calendar-grid').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:71,...point(days[2])}));
        document.querySelector('#calendar-grid').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:71,...point(days[2])}));
        document.querySelector('#confirm-date-picker').click();
        document.querySelector('#alarm-form').requestSubmit();
      })()
    """)
    wait_for(cdp, "JSON.parse(localStorage.getItem('personalized-clock.alarms.v1'))[0].repeatRule.dates?.length === 3")
    assert cdp.evaluate("document.querySelector('.alarm-card').textContent.includes('指定 3 天')")

    cdp.evaluate("""
      (() => {
        document.querySelector('#open-personalization').click();
        const transfer=new DataTransfer();
        transfer.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="orange"/></svg>'],'background.svg',{type:'image/svg+xml'}));
        const input=document.querySelector('#background-file'); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));
      })()
    """)
    wait_for(cdp, "document.body.classList.contains('has-custom-background')")
    cdp.evaluate("const input=document.querySelector('#background-opacity'); input.value='30'; input.dispatchEvent(new Event('input',{bubbles:true}));")
    assert cdp.evaluate("JSON.parse(localStorage.getItem('personalized-clock.personalization.v1')).opacity === 30")
    cdp.evaluate("document.querySelector('#remove-background').click(); document.querySelector('#close-personalization').click()")
    wait_for(cdp, "!document.body.classList.contains('has-custom-background')")

    fill_alarm(cdp, "滑动删除", "daily")
    assert cdp.evaluate("document.querySelectorAll('.alarm-swipe-row').length === 2")
    touch_drag(cdp, "滑动删除", 8, 70)
    assert cdp.evaluate("![...document.querySelectorAll('.alarm-swipe-row')].find(item=>item.textContent.includes('滑动删除')).classList.contains('swiped')")
    touch_drag(cdp, "滑动删除", -22, 0)
    assert cdp.evaluate("![...document.querySelectorAll('.alarm-swipe-row')].find(item=>item.textContent.includes('滑动删除')).classList.contains('swiped')")
    touch_drag(cdp, "滑动删除", -78, 0)
    assert cdp.evaluate("[...document.querySelectorAll('.alarm-swipe-row')].find(item=>item.textContent.includes('滑动删除')).classList.contains('swiped')")
    swipe_screenshot = cdp.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
    screenshot_path = Path(args.screenshot)
    swipe_path = screenshot_path.with_name(f"{screenshot_path.stem}-swipe{screenshot_path.suffix}")
    swipe_path.write_bytes(base64.b64decode(swipe_screenshot["data"]))
    assert cdp.evaluate("(() => { const button=[...document.querySelectorAll('.alarm-swipe-row')].find(item=>item.textContent.includes('滑动删除')).querySelector('.swipe-delete'); const row=button.closest('.alarm-swipe-row'); const card=row.querySelector('.alarm-card'); return button.tabIndex===0 && button.getAttribute('aria-hidden')==='false' && Math.abs(button.getBoundingClientRect().right-row.getBoundingClientRect().right)<1 && card.getBoundingClientRect().right<row.getBoundingClientRect().right; })()")
    cdp.evaluate("window.__confirmCalled=false; window.confirm=()=>{window.__confirmCalled=true;return false}; [...document.querySelectorAll('.alarm-swipe-row')].find(item=>item.textContent.includes('滑动删除')).querySelector('.swipe-delete').click()")
    wait_for(cdp, "![...document.querySelectorAll('.alarm-details')].some(item=>item.textContent.includes('滑动删除'))")
    assert cdp.evaluate("window.__confirmCalled === false")
    assert cdp.evaluate("JSON.parse(localStorage.getItem('personalized-clock.alarms.v1')).length === 1")
    cdp.evaluate("""
      (() => {
        document.querySelector('.alarm-card').click();
        const sound=document.querySelector('#alarm-sound'); sound.value='custom'; sound.dispatchEvent(new Event('change',{bubbles:true}));
        const transfer=new DataTransfer(); transfer.items.add(new File([new Uint8Array(64)],'tone.wav',{type:'audio/wav'}));
        const input=document.querySelector('#custom-sound-file'); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));
      })()
    """)
    wait_for(cdp, "document.querySelector('#custom-sound-status').textContent.includes('tone.wav')")
    cdp.evaluate("document.querySelector('#alarm-form').requestSubmit()")
    wait_for(cdp, "JSON.parse(localStorage.getItem('personalized-clock.alarms.v1'))[0].sound === 'custom'")

    cdp.evaluate("document.querySelector('.alarm-card').click()")
    wait_for(cdp, "document.querySelector('#alarm-editor').open")
    cdp.evaluate("""
      (() => {
        document.querySelector('#alarm-label').value='测试轮班';
        const repeat=document.querySelector('#repeat-type'); repeat.value='workRest'; repeat.dispatchEvent(new Event('change',{bubbles:true}));
        document.querySelector('#work-days').value='2'; document.querySelector('#rest-days').value='2';
        document.querySelector('#alarm-form').requestSubmit();
      })()
    """)
    wait_for(cdp, "document.querySelector('.alarm-card').textContent.includes('连响 2 天，停 2 天')")

    cdp.evaluate("location.reload()")
    wait_for(cdp, "document.readyState === 'complete' && document.querySelector('.alarm-card')?.textContent.includes('测试轮班')")
    assert cdp.evaluate("JSON.parse(localStorage.getItem('personalized-clock.alarms.v1')).length === 1")

    cdp.evaluate("document.querySelector('.alarm-card').click(); window.confirm=()=>true; document.querySelector('#delete-alarm').click()")
    wait_for(cdp, "document.querySelectorAll('.alarm-card').length === 0")
    assert cdp.evaluate("document.querySelector('.next-overview').hidden === true")

    fill_alarm(cdp, "上二休二", "workRest", "document.querySelector('#work-days').value='2'; document.querySelector('#rest-days').value='2';")
    fill_alarm(cdp, "每三天提醒", "intervalDays", "document.querySelector('#interval-days').value='3'; document.querySelector('#interval-days').dispatchEvent(new Event('input',{bubbles:true}));")

    if not args.skip_service_worker:
        service_worker_ready = cdp.evaluate("navigator.serviceWorker.ready.then(() => true)", await_promise=True)
        assert service_worker_ready
    assert cdp.evaluate("document.querySelector('link[rel=manifest]').getAttribute('href') === 'manifest.webmanifest'")
    assert cdp.evaluate("document.querySelector('#next-alarm-time').textContent !== '--:--'")

    cdp.evaluate("""
      (() => {
        const now = new Date();
        const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        localStorage.setItem('personalized-clock.alarms.v1', JSON.stringify([{
          id:'timing-test', time, startDate:date, label:'Timing test',
          repeatRule:{type:'once'}, isEnabled:true, snoozeEnabled:true, snoozeMinutes:5
        }]));
        location.reload();
      })()
    """)
    wait_for(cdp, "document.readyState === 'complete' && document.querySelector('.alarm-card')?.textContent.includes('Timing test')")
    cdp.evaluate("document.querySelector('#enable-reminders').click()")
    wait_for(cdp, "document.querySelector('#ringing-overlay').hidden === false", timeout=15)
    cdp.evaluate("document.querySelector('#snooze-alarm').click()")
    wait_for(cdp, "document.querySelector('#ringing-overlay').hidden === true && JSON.parse(localStorage.getItem('personalized-clock.snoozes.v1')).length === 1")
    assert cdp.evaluate("(() => { const due=JSON.parse(localStorage.getItem('personalized-clock.snoozes.v1'))[0].dueAt-Date.now(); return due > 290000 && due <= 300000; })()")
    assert cdp.evaluate("document.querySelector('#snooze-summary').hidden === false")
    cdp.evaluate("""
      (() => {
        const pending=JSON.parse(localStorage.getItem('personalized-clock.snoozes.v1'));
        pending[0].dueAt=Date.now();
        localStorage.setItem('personalized-clock.snoozes.v1', JSON.stringify(pending));
        location.reload();
      })()
    """)
    wait_for(cdp, "document.readyState === 'complete' && document.querySelector('.alarm-card')?.textContent.includes('Timing test')")
    cdp.evaluate("document.querySelector('#enable-reminders').click()")
    wait_for(cdp, "document.querySelector('#ringing-overlay').hidden === false", timeout=8)
    cdp.evaluate("document.querySelector('#stop-alarm').click()")
    assert cdp.evaluate("document.querySelector('#ringing-overlay').hidden === true")
    screenshot = cdp.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
    with open(args.screenshot, "wb") as output:
        output.write(base64.b64decode(screenshot["data"]))
    cdp.evaluate("Object.defineProperty(navigator, 'share', {configurable:true, value:async data => { window.__sharedData=data; }}); document.querySelector('#share-app').click()")
    wait_for(cdp, "window.__sharedData?.url")
    assert cdp.evaluate("new URL(window.__sharedData.url).search === ''")
    cdp.evaluate("document.querySelector('.action-row a[href=\"help.html\"]').click()")
    wait_for(cdp, "document.readyState === 'complete' && location.pathname.endsWith('/help.html') && document.querySelector('h1')?.textContent.includes('使用说明')")
    assert cdp.evaluate("document.body.textContent.includes('添加到主屏幕')")
    assert cdp.evaluate("document.body.textContent.includes('iPhone 自带“时钟”')")
    assert cdp.evaluate("document.querySelector('a[href=\"index.html\"]') !== null")
    print("UI smoke test passed")


if __name__ == "__main__":
    main()

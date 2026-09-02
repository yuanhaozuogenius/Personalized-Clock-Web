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
        deadline = time.time() + 10
        while True:
            try:
                pages = json.load(opener.open(f"{endpoint}/json/list", timeout=1))
                break
            except Exception:
                if time.time() >= deadline:
                    raise
                time.sleep(0.1)
        page = next(item for item in pages if item["type"] == "page")
        self.socket = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=15)
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
            "returnByValue": True,
        })
        if "exceptionDetails" in result:
            raise RuntimeError(result["exceptionDetails"])
        return result.get("result", {}).get("value")


def wait_for(cdp, expression, timeout=12):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if cdp.evaluate(expression):
            return
        time.sleep(0.1)
    raise TimeoutError(expression)


def screenshot(cdp, path):
    image = cdp.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
    Path(path).write_bytes(base64.b64decode(image["data"]))


def tap(cdp, selector):
    point = cdp.evaluate(f"""
      (() => {{ const rect=document.querySelector({json.dumps(selector)}).getBoundingClientRect(); return {{x:rect.left+rect.width/2,y:rect.top+rect.height/2}}; }})()
    """)
    cdp.call("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [point]})
    cdp.call("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default="http://127.0.0.1:9223")
    parser.add_argument("--url", default="http://127.0.0.1:4173/index.html")
    parser.add_argument("--screenshot", required=True)
    args = parser.parse_args()
    base_url = args.url.rsplit("/", 1)[0]

    cdp = CDP(args.endpoint)
    cdp.call("Page.enable")
    cdp.call("Runtime.enable")
    cdp.call("Page.bringToFront")
    cdp.call("Emulation.setDeviceMetricsOverride", {
        "width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True,
    })
    cdp.call("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    cdp.call("Page.navigate", {"url": args.url})
    wait_for(cdp, "document.readyState === 'complete'")
    cdp.evaluate("localStorage.clear(); document.querySelector('#add-alarm').click()")
    wait_for(cdp, "document.querySelector('#alarm-editor').open")
    assert cdp.evaluate("document.querySelector('#custom-sound-file').accept.includes('.m4a')")
    cdp.evaluate("""
      (() => {
        const sound=document.querySelector('#alarm-sound'); sound.value='custom'; sound.dispatchEvent(new Event('change',{bubbles:true}));
        const transfer=new DataTransfer(); transfer.items.add(new File([new Uint8Array(32)],'broken.mp3',{type:'audio/mpeg'}));
        const input=document.querySelector('#custom-sound-file'); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));
      })()
    """)
    wait_for(cdp, "document.querySelector('#custom-sound-status').textContent.includes('无法读取该音频')")
    assert cdp.evaluate("document.querySelector('#sound-clip-editor').hidden")

    cdp.evaluate("""
      (() => {
        const sampleRate=8000, seconds=180, samples=sampleRate*seconds, buffer=new ArrayBuffer(44+samples*2), view=new DataView(buffer);
        const text=(offset,value)=>[...value].forEach((char,index)=>view.setUint8(offset+index,char.charCodeAt(0)));
        text(0,'RIFF'); view.setUint32(4,36+samples*2,true); text(8,'WAVE'); text(12,'fmt '); view.setUint32(16,16,true);
        view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true);
        view.setUint16(32,2,true); view.setUint16(34,16,true); text(36,'data'); view.setUint32(40,samples*2,true);
        const transfer=new DataTransfer(); transfer.items.add(new File([buffer],'three-minutes.wav',{type:'audio/wav'}));
        const input=document.querySelector('#custom-sound-file'); input.files=transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));
      })()
    """)
    wait_for(cdp, "!document.querySelector('#sound-clip-editor').hidden && document.querySelector('#sound-clip-summary').textContent.includes('00:00–00:30')", timeout=20)
    assert cdp.evaluate("document.querySelector('#sound-clip-duration').max === '60'")
    cdp.evaluate("""
      (() => {
        const start=document.querySelector('#sound-clip-start'); start.value='90'; start.dispatchEvent(new Event('input',{bubbles:true}));
        const duration=document.querySelector('#sound-clip-duration'); duration.value='20'; duration.dispatchEvent(new Event('input',{bubbles:true}));
        document.querySelector('#sound-clip-editor').scrollIntoView({block:'center'});
      })()
    """)
    wait_for(cdp, "document.querySelector('#sound-clip-summary').textContent === '01:30–01:50 · 20 秒'")
    assert cdp.evaluate("(() => { const item=document.querySelector('#sound-clip-selection'); return item.style.left==='50%' && Math.abs(parseFloat(item.style.width)-11.11111111111111)<.01; })()")
    screenshot(cdp, args.screenshot)

    tap(cdp, "#preview-sound")
    wait_for(cdp, "document.querySelector('#preview-sound').textContent.includes('01:30–01:50')")
    cdp.evaluate("document.querySelector('#alarm-form').requestSubmit()")
    wait_for(cdp, "JSON.parse(localStorage.getItem('personalized-clock.alarms.v1'))?.[0]?.soundEnd === 110")
    assert cdp.evaluate("(() => { const alarm=JSON.parse(localStorage.getItem('personalized-clock.alarms.v1'))[0]; return alarm.sound==='custom' && alarm.soundStart===90 && alarm.soundEnd===110; })()")
    cdp.evaluate("document.querySelector('.alarm-card').click()")
    wait_for(cdp, "document.querySelector('#alarm-editor').open && document.querySelector('#sound-clip-summary').textContent === '01:30–01:50 · 20 秒'", timeout=20)

    cdp.call("Page.navigate", {"url": f"{base_url}/help.html"})
    wait_for(cdp, "document.readyState === 'complete' && document.querySelector('a[href=\"sound-guide.html\"]') !== null")
    cdp.evaluate("document.querySelector('a[href=\"sound-guide.html\"]').click()")
    wait_for(cdp, "document.readyState === 'complete' && location.pathname.endsWith('/sound-guide.html')")
    assert cdp.evaluate("document.body.textContent.includes('语音备忘录') && document.body.textContent.includes('M4A/AAC、MP3 和 WAV')")
    guide_path = Path(args.screenshot).with_name(f"{Path(args.screenshot).stem}-guide{Path(args.screenshot).suffix}")
    screenshot(cdp, guide_path)
    print("Audio clip UI test passed")


if __name__ == "__main__":
    main()

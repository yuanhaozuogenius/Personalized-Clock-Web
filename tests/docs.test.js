import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("published app contains the essential iPhone workflow and interaction guards", async () => {
  const [index, help, guide, serviceWorker, app, styles] = await Promise.all([
    read("../index.html"),
    read("../help.html"),
    read("../USER_GUIDE.md"),
    read("../sw.js"),
    read("../app.js"),
    read("../styles.css")
  ]);

  assert.match(index, /href="help\.html"/);
  assert.match(index, /id="install-app"[^>]*>添加到主屏幕</);
  assert.match(index, /maximum-scale=1, user-scalable=no/);
  assert.match(index, /class="next-overview"[^>]*hidden/);
  assert.match(index, /class="overview-illustration"/);
  assert.match(index, /id="alarm-editor"[^>]*tabindex="-1"/);
  assert.doesNotMatch(index, /--:--/);
  assert.match(help, /id="add-to-home"/);
  assert.match(help, /maximum-scale=1, user-scalable=no/);
  assert.match(help, /右下角的<strong>三个点<\/strong>/);
  assert.match(help, /再点<strong>共享<\/strong>/);
  assert.match(help, /向下滑动/);
  assert.match(help, /启用提醒/);
  assert.match(help, /5 分钟后提醒/);
  assert.match(help, /iPhone 自带“时钟”/);
  assert.match(guide, /Safari/);
  assert.match(guide, /Web App/);
  assert.match(serviceWorker, /personalized-clock-v9/);
  assert.match(serviceWorker, /\.\/help\.html/);
  assert.match(app, /nextOverview\.hidden = true/);
  assert.match(app, /dialog\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /help\.html#add-to-home/);
  assert.match(app, /new URL\("\.\/", location\.href\)\.href/);
  assert.doesNotMatch(app, /beforeinstallprompt/);
  assert.match(styles, /touch-action:manipulation/);
  assert.match(styles, /\.form-row:focus-within/);
  assert.match(styles, /\.overview-illustration/);
});

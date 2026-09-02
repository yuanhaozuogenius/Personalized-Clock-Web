import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("published app contains the essential iPhone workflow and interaction guards", async () => {
  const [index, template, help, guide, serviceWorker, app, styles, readme, build] = await Promise.all([
    read("../index.html"),
    read("../index.template.html"),
    read("../help.html"),
    read("../USER_GUIDE.md"),
    read("../sw.js"),
    read("../app.js"),
    read("../styles.css"),
    read("../README.md"),
    read("../build.mjs")
  ]);

  assert.match(index, /href="help\.html"/);
  assert.match(index, /<style data-build="inline">/);
  assert.match(index, /<script data-build="inline">/);
  assert.doesNotMatch(index, /<link rel="stylesheet"/);
  assert.doesNotMatch(index, /src="app\.bundle\.js/);
  assert.match(template, /styles\.css\?v=16/);
  assert.match(template, /app\.bundle\.js\?v=16/);
  assert.match(template, /id="open-personalization"[^>]*>壁纸设置<\/button>/);
  assert.match(template, /id="background-opacity"[^>]*max="100"/);
  assert.match(template, /id="background-fit"/);
  assert.match(template, /使用说明<\/a>\s*<button id="share-app"/);
  assert.match(build, /Inline render-blocking assets/);
  assert.doesNotMatch(index, /id="install-app"/);
  assert.match(index, /maximum-scale=1, user-scalable=no/);
  assert.match(index, /class="next-overview"[^>]*hidden/);
  assert.match(index, /class="overview-illustration"/);
  assert.match(index, /id="alarm-editor"[^>]*tabindex="-1"/);
  assert.doesNotMatch(index, /brand-lockup|brand-name|时序/);
  assert.match(index, /id="greeting-title"/);
  assert.match(index, /class="greeting-sun"/);
  assert.match(index, /class="greeting-moon"/);
  assert.match(index, /<strong>响铃设置<\/strong>/);
  assert.doesNotMatch(index, /--:--/);
  assert.doesNotMatch(index, /PERSONAL CLOCK/);
  assert.doesNotMatch(index, /class="notice"/);
  assert.doesNotMatch(index, /周期与数据会完整保存/);
  assert.doesNotMatch(index, /页面内提醒/);

  assert.match(help, /id="add-to-home"/);
  assert.match(help, /maximum-scale=1, user-scalable=no/);
  assert.match(help, /class="inline-more-icon"[^>]*>•••<\/span>/);
  assert.doesNotMatch(help, /<strong>更多<\/strong>/);
  assert.match(help, /再轻点<strong>共享<\/strong>/);
  assert.doesNotMatch(help, /直接显示“共享”|作为 Web App 打开/);
  assert.match(help, /向下滑动/);
  assert.match(help, /启用提醒/);
  assert.match(help, /5 分钟后提醒/);
  assert.match(help, /再点一次可关闭提醒/);
  assert.match(help, /iPhone 自带“时钟”/);
  assert.match(guide, /Safari/);
  assert.match(guide, /Web App/);
  assert.match(guide, /向左滑动闹钟卡片/);
  assert.match(guide, /红色垃圾桶/);
  assert.match(guide, /再点一次“已启用”可关闭提醒/);

  assert.match(serviceWorker, /personalized-clock-v16/);
  assert.match(serviceWorker, /\.\/help\.html/);
  assert.match(app, /nextOverview\.hidden = true/);
  assert.match(app, /dialog\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /hour >= 5 && hour < 12 \? "早上好"/);
  assert.match(app, /hour >= 12 && hour < 18 \? "下午好"/);
  assert.match(app, /: "晚上好"/);
  assert.match(app, /data-action="swipe-delete"/);
  assert.match(app, /function removeAlarm\(alarmID\)/);
  assert.match(app, /alarmList\.addEventListener\("change"/);
  assert.match(app, /event\.target\.closest\("\.switch"\)/);
  assert.match(app, /function openDatePicker\(\)/);
  assert.match(app, /calendarGrid\.addEventListener\("pointermove"/);
  assert.match(app, /calendarGesture\.lastValue/);
  assert.match(app, /本地音频不可用 · 已改用晨光/);
  assert.match(app, /indexedDB\.open\(ASSET_DB_NAME, 1\)/);
  assert.match(app, /version: 2/);
  assert.match(app, /backgroundFitInput\.addEventListener\("change"/);
  assert.match(app, /SWIPE_REVEAL_PX \* \.55/);
  assert.match(app, /suppressCardClick = false; }, 400/);
  assert.match(app, /function disableReminders\(\)/);
  assert.match(app, /if \(remindersEnabled\)/);
  assert.match(app, /enableRemindersButton\.dataset\.enabled = "false"/);
  assert.doesNotMatch(app, /installButton|help\.html#add-to-home/);
  assert.match(app, /new URL\("\.\/", location\.href\)\.href/);
  assert.doesNotMatch(app, /beforeinstallprompt/);
  assert.match(styles, /touch-action:manipulation/);
  assert.match(styles, /\.switch span::after\{[^}]*position:absolute;top:50%;left:2px/);
  assert.match(styles, /transform:translate\(20px,-50%\)/);
  assert.match(styles, /\.form-row:focus-within/);
  assert.match(styles, /\.overview-illustration/);
  assert.match(styles, /\.alarm-swipe-row/);
  assert.match(styles, /\.swipe-delete/);
  assert.match(styles, /\.calendar-grid\{touch-action:none/);
  assert.match(styles, /\.custom-background/);
  assert.match(styles, /\.inline-more-icon/);
  assert.match(styles, /\.has-custom-background \.alarm-swipe-row \.alarm-card/);
  assert.match(readme, /向左滑动删除/);
  assert.match(readme, /本地照片壁纸/);
});

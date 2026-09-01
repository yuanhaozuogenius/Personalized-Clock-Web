# Web / PWA 开发说明

个性闹钟 Web 版是无框架静态 PWA，可直接部署到任意 HTTPS 静态托管。公开地址：

https://yuanhaozuogenius.github.io/Personalized-Clock-Web/

## 主要能力

- 完整的常规与自定义周期规则
- 本地闹钟增删改、开关和下一次日期计算
- 默认 5 分钟的可配置、持久化稍后提醒
- 晨光、清泉、微风、经典四套原创 Web Audio 铃声
- PWA 安装、离线缓存、分享和页面内通知
- 明暗主题及手机尺寸界面

## 本地运行

```powershell
python -m http.server 4173 --directory web
```

访问 `http://127.0.0.1:4173/`。直接双击 `index.html` 可以体验主要交互，但 Service Worker、安装和通知需要 HTTP/HTTPS。

## 开发与测试

```powershell
npm --prefix web test
npm --prefix web run build
node --check web/app.bundle.js
```

源码关系：

- `recurrence.js`：纯日期与周期计算，可由 Node.js 单元测试
- `app.js`：DOM、本地存储、声音、提醒和 PWA 交互
- `build.mjs`：合并源码生成 `app.bundle.js`
- `sw.js`：离线文件缓存
- `tests/ui_smoke.py`：Chrome DevTools Protocol 交互测试

不要直接编辑 `app.bundle.js`。修改源码后运行 `npm --prefix web run build` 并提交生成结果。

## 本地数据

| 键 | 内容 |
|---|---|
| `personalized-clock.alarms.v1` | 闹钟、周期、铃声和稍后提醒设置 |
| `personalized-clock.snoozes.v1` | 等待再次响铃的稍后提醒 |

没有账号和后端，数据不会跨设备同步。

## 铃声

铃声使用 Web Audio API 在运行时合成，音符、包络和节奏均为本项目原创配置。项目不分发或复制 Apple、Alarmy、Sleep Cycle 等产品的音频文件。

## 浏览器限制

静态网页不能调用 iOS AlarmKit 或苹果“时钟”App。页面关闭或被系统挂起后，本地计时不可靠。若要实现关闭页面后仍送达的提醒，需要增加后端、Push API 订阅与定时 Web Push 服务。

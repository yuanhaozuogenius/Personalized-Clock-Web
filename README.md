# 个性闹钟 Web / PWA

这是项目唯一维护和发布的仓库。个性闹钟是无框架静态 PWA，可直接部署到 HTTPS 静态托管。

- 在线地址：https://yuanhaozuogenius.github.io/Personalized-Clock-Web/
- iPhone 用户说明：[USER_GUIDE.md](USER_GUIDE.md)

## 主要能力

- 仅一次、每天、工作日、周末、指定星期
- “每隔 X 天”和“上 X 休 Y”自定义周期
- 本地闹钟增删改、向右滑动删除、开关和下一次日期计算
- 默认 5 分钟的可配置、持久化稍后提醒
- 晨光、清泉、微风、经典四套原创 Web Audio 铃声
- 添加到 iPhone 主屏幕、离线缓存、分享和页面内通知
- 随本地时间变化的问候、明暗主题及手机尺寸界面

## 本地运行

要求 Node.js 20 或更高版本。运行时没有第三方前端依赖。

```powershell
python -m http.server 4173
```

访问 `http://127.0.0.1:4173/`。Service Worker、添加到主屏幕和通知需要 HTTP/HTTPS。

## 开发与测试

```powershell
npm test
npm run build
node --check app.bundle.js
```

源码关系：

- `recurrence.js`：纯日期与周期计算
- `app.js`：DOM、本地存储、声音、提醒和 PWA 交互
- `build.mjs`：合并源码生成 `app.bundle.js`
- `sw.js`：离线文件缓存
- `tests/ui_smoke.py`：Chrome 手机尺寸交互测试

不要直接编辑 `app.bundle.js`。修改源码后运行 `npm run build` 并提交生成结果。

## 本地数据

| 键 | 内容 |
|---|---|
| `personalized-clock.alarms.v1` | 闹钟、周期、铃声和稍后提醒设置 |
| `personalized-clock.snoozes.v1` | 等待再次响铃的稍后提醒 |

没有账号和后端，数据不会跨设备同步。铃声由 Web Audio API 实时合成，不包含第三方商业音频。

## 部署

`main` 分支通过自动测试后由 GitHub Pages 发布。发布后必须检查线上首页、Service Worker 版本和手机尺寸主流程。

## 浏览器限制

静态网页不能调用 iOS AlarmKit 或苹果“时钟”App。页面关闭或被系统挂起后，本地计时不可靠。若要实现关闭页面后仍送达的提醒，需要后端、Push API 订阅与定时 Web Push 服务。

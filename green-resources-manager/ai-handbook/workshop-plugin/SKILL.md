---
name: workshop-plugin
description: 为 GreenResourcesManager 编写创意工坊插件。在 mods 目录、设置页贡献、资源编辑动作、侧边栏入口、便笺或日期管理示例时使用。
---

# 自定义插件

插件放在应用根目录的 `mods` 文件夹。每个插件是一个子文件夹，里面至少有 `manifest.json` 和入口脚本，默认是 `index.js`。放好后在创意工坊点「刷新」。新插件默认关闭，打开开关才加载。关掉开关会卸载插件，并拿掉它注册的侧边栏入口。

在线工坊安装的插件也进 `mods`，默认不启用。有新版本时在「已安装」里更新或卸载。

## 入口

`index.js` 使用 `export default`。加载时调用 `onLoad(api)`，卸载时调用 `onUnload(api)`。脚本里不要写 `import`。

- `api.storage.get`、`set`、`remove`：数据写在本机，键名会自动加上插件编号
- `api.navigation.register({ id, name, icon, onClick })`：加侧边栏入口。卸掉时调用 `api.navigation.unregister`
- `api.ui.showNotification(标题, 类型, { message })`：类型是 `success`、`info`、`warning` 或 `error`
- `api.ui.showCustomView({ title, content, onMount })`：`content` 是 HTML。`onMount` 拿到页面容器，用来给按钮绑定点击
- `api.ui.closeCustomView()`：关闭当前插件自定义视图
- `api.ui.showCustomModal({ title, content, size, onMount, onClose })`：打开通用弹窗，`size` 为 `sm` / `md` / `lg`
- `api.ui.closeCustomModal()`：关闭弹窗并触发 `onClose`
- `api.settings.registerPage({ id, name, description, icon, order, content, onMount, onUnmount })`：在设置页添加分类；`onMount` 收到内容容器，`onUnmount` 用来清理监听器
- `api.resources.registerEditAction({ id, label, icon, order, when, onClick })`：在资源编辑窗口添加动作。`when({ resourceName, formData, fields })` 返回 `false` 时隐藏；`onClick` 收到 `{ resourceName, formData, fields, apply }`，`apply(patch)` 只修改当前表单中存在的字段
- `api.settings.unregisterPage(id)`、`api.resources.unregisterEditAction(id)`：主动移除贡献。插件卸载时宿主也会自动清理
- `api.config.get/set/reset`：读取、保存和重置当前插件自己的配置；`api.secrets.has/set/remove`：通过 Electron 安全存储保存凭据，读取只返回是否存在
- `api.net.request({ url, method, headers, body, timeoutMs, credentialKey, credentialPrefix, allowLocal })`：受限网络请求。只允许 GET/POST、有限请求头/大小/超时；默认只允许 HTTPS，拒绝本机/私网地址，最多跟随 3 次重定向。跨域跳转不会转发凭据；带凭据请求必须与该插件配置的 `baseUrl` 同源。本地模型可传 `allowLocal: true` 放行回环 HTTP 地址
- `api.i18n.getLocale()`、`api.i18n.onChange(listener)`：读取语言和在语言切换时刷新插件文本

`fields` 是当前资源表单的字段描述：`{ key, label, type, required, options? }`。插件应只根据这些字段生成内容，不要把不存在的字段写入表单。

捆绑插件可在 `manifest.json` 设置 `enabledByDefault: true`，仅对用户尚未保存该插件开关的情况生效。AI 助手位于 `mods/ai-assistant`，可参考其多方案配置、服务商预设、联网搜索、字段勾选预览和资源信息填充实现。Electron 主进程只提供通用加密凭据存储和受限网络传输，不包含 AI 专用接口或提示词。

发布到公共工坊时，在插件自己的 GitHub 仓库发 Release，上传 `manifest.json`、入口脚本和可选的 `styles.css`，再把仓库写进 `workshop/community-mods.json`。

## 便笺

最少的例子是 `mods/hello-note`。`manifest.json` 写 `id`、`name`、`version`、`description`、`author`、`entry`、`icon`。`index.js` 在 `onLoad` 里注册侧边栏，点击后用 `showCustomView` 打开一段 HTML，`onUnload` 里取消注册。

## 日期管理

`mods/calendar-manager` 是带月历和本地记录的例子。`onLoad` 用 `api.storage.get` 读出日程，注册「日期管理」。点进去用 `showCustomView` 打开月历，在 `onMount` 里绑定上个月、下个月和添加。改完调用 `api.storage.set`。`onUnload` 再保存一次，并取消侧边栏入口。

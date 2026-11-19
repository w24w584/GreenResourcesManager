# 创意工坊插件目录

这个目录用于存放创意工坊插件（Mods）。内置的 `ai-assistant` 是一个完整示例：它在设置页注册 AI 配置页，在资源编辑窗口注册「AI 补全信息」按钮，并通过宿主提供的通用能力保存配置、保存密钥、发起受限网络请求。

## 目录结构

```
mods/
├── README.md                    # 本文件
├── ai-assistant/                # 内置：AI 设置与资源信息填充
│   ├── manifest.json
│   ├── index.js
│   └── styles.css
├── calendar-manager/            # 示例插件
│   ├── manifest.json
│   ├── index.js
│   └── README.md
└── [your-plugin-name]/          # 你的插件
    ├── manifest.json
    ├── index.js
    └── README.md
```

## 安装插件

1. 打开应用的「创意工坊 → 在线工坊」，搜索并安装公共目录里的插件；或把插件文件夹复制到 `mods` 目录
2. 在应用的「创意工坊」页面中启用插件
3. 重启应用使插件生效

## 开发插件

请参考 `calendar-manager` 和 `ai-assistant` 目录下的示例代码。`ai-assistant` 展示了配置页、资源编辑动作、通用弹窗、网络请求和多语言切换的完整用法。

### 必需文件

- `manifest.json`：插件元信息（必需）
- `index.js`：插件主脚本（必需）

### 可选文件

- `README.md`：插件说明文档
- `styles.css`：自定义样式，启用插件时自动注入
- `assets/`：资源文件目录

## 插件规范

### 命名规范

- 插件文件夹名称应该使用小写字母、数字和连字符（kebab-case）
- 插件 id 只能包含小写字母、数字和连字符，例如 `my-awesome-plugin`、`game-tag-manager`

### manifest.json 格式

```json
{
  "id": "plugin-id",
  "name": "插件名称",
  "version": "1.0.0",
  "description": "插件描述",
  "author": "作者名",
  "entry": "index.js",
  "icon": "🧩",
  "tags": ["示例"],
  "enabledByDefault": false
}
```

`enabledByDefault` 只对随应用捆绑的插件有意义：用户尚未手动设置过该插件开关时默认启用。从在线工坊安装的插件仍然默认关闭。

## 宿主 API

`index.js` 使用 `export default`，在 `onLoad(api)` 中注册能力，在 `onUnload(api)` 中清理。插件代码由宿主作为可信代码执行，不要加载不受信任的远程脚本。

### 界面

- `api.ui.showNotification(标题, 类型, { message })`：类型是 `success`、`info`、`warning` 或 `error`
- `api.ui.showCustomView({ title, content, onMount })`：打开整页插件视图，`content` 是 HTML
- `api.ui.closeCustomView()`：关闭整页视图
- `api.ui.showCustomModal({ title, content, size, onMount, onClose })`：打开弹窗。`size` 为 `sm` / `md` / `lg`，默认 `md`
- `api.ui.closeCustomModal()`：关闭弹窗，并触发 `onClose`

`onMount(container)` 收到已经写入 `content` 的容器，用来绑定按钮事件。弹窗关闭、插件卸载时会清空容器，记得把计时器和全局监听放在 `onUnmount` / `onClose` 里清理。

### 设置页

- `api.settings.registerPage({ id, name, description, icon, order, content, onMount, onUnmount })`
  - 在设置页添加一个分类，自动插入到「页面管理」之前
  - `order` 越小越靠前，默认 `100`
  - `onMount(container)` 在页面显示时调用
  - `onUnmount(container)` 在切换分类、语言变化或卸载插件时调用
- `api.settings.unregisterPage(id)`：主动移除

### 资源编辑动作

- `api.resources.registerEditAction({ id, label, icon, order, when, onClick })`
  - 在资源编辑窗口显示一个按钮
  - `when({ resourceName, formData, fields })` 返回 `false` 时不显示，可用于只在某些资源类型上出现
  - `onClick({ resourceName, formData, fields, apply })` 执行动作
  - `fields` 是当前表单的字段描述数组：`{ key, label, type, required, options? }`
  - `apply(patch)` 只写回当前表单中已经存在的字段，其它键会被忽略
- `api.resources.unregisterEditAction(id)`：主动移除

### 配置与密钥

- `api.config.get()`：返回 `{ config, credentials }`，`credentials` 里只包含 `{ 键名: true }`，不会返回密钥明文
- `api.config.set(config, credentials?)`：合并保存配置。凭据值传字符串表示保存/替换，传 `null` 或空字符串表示删除
- `api.config.reset()`：清空该插件的配置和全部密钥
- `api.secrets.has(key)`：查询密钥是否存在
- `api.secrets.set(key, value)` / `api.secrets.remove(key)`：保存或删除单个密钥

配置保存在 `userData/plugin-configs/<插件 id>.json`，密钥由 Electron `safeStorage` 加密。系统安全存储不可用时，宿主不会覆盖已有密钥。

### 网络请求

`api.net.request({ url, method, headers, body, timeoutMs, credentialKey, credentialPrefix, allowLocal })`

- 由主进程发起，只允许 `GET` / `POST`
- 默认只允许 HTTPS，拒绝带用户名密码的 URL
- 拒绝本机/私有网络地址，最多跟随 3 次经过校验的重定向
- 请求头白名单：`Accept`、`Content-Type`、`User-Agent`
- 请求体最多 1 MB，响应最多 2 MB，超时最长 60 秒
- 传入 `credentialKey` 时，密钥只会注入到与插件配置 `baseUrl` 同源的请求；跨域重定向不会转发密钥
- 本地模型可显式传 `allowLocal: true`，只放行 `http://127.0.0.1`、`http://localhost`、`http://[::1]`

典型流程：先用 `api.config.set({ baseUrl: 'https://api.example.com/v1' })` 保存服务地址，再发起带 `credentialKey` 的请求。

### 多语言

- `api.i18n.getLocale()`：当前界面语言，例如 `zh-CN`、`en`、`ja`
- `api.i18n.onChange(listener)`：语言变化时回调，返回取消监听的函数

插件可以监听 `app-language-changed` 事件并重新注册设置页/按钮文本，参考 `ai-assistant` 的实现。

## 发布到公共工坊

在插件自己的 GitHub 仓库发 Release，上传 `manifest.json`、入口脚本和可选的 `styles.css`，再把仓库写进 `workshop/community-mods.json`。

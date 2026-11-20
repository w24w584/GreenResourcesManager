# 同步上游更新指南

本仓库在 `GreenResourcesManager` 上游基础上增加了 AI 助手和通用插件宿主。为了在同步 `upstream/main` 时尽量少冲突，自有功能都放在新目录里，上游文件只保留很少的挂载点。

## 自有目录（可整体覆盖，不会冲突）

- `src/mod-host/`：插件宿主扩展层
  - `PluginHost.ts`：创建 / 销毁插件 API，桥接配置、密钥、网络、UI 贡献
  - `PluginContributions.ts`：资源编辑动作与设置页注册表
  - `settingsCategories.ts`：把插件设置页合并进内置设置分类
  - `components/PluginResourceActions.vue`：资源编辑窗的插件按钮条
  - `components/PluginModalHost.vue`：通用弹窗宿主
  - `components/PluginSettingsHost.vue`：插件设置页宿主
- `mods/ai-assistant/`：AI 助手插件本体（配置页、资源补全、联网搜索、多语言）
- `electron/ipc/plugin-capability-handlers.js`：主进程通用插件能力
- `mods/README.md`、`ai-handbook/workshop-plugin/SKILL.md`、`docs/UPSTREAM.md`：文档

这些文件上游没有，合并时直接保留本地版本即可。

## 上游文件里必须保留的挂载点

同步上游后，逐项确认以下改动还在。如果上游改动了同一段代码，冲突时保留下表中的本地逻辑。

### `src/utils/PluginManager.ts`

1. 顶部导入：
   ```ts
   import { createHostApi, destroyHostApi } from '../mod-host/PluginHost'
   ```
2. `PluginManifest` 增加 `enabledByDefault?: boolean`；扫描插件时把它传给启用状态判断，默认 `false`。
3. `loadPlugin` 使用 `const api = await createHostApi(pluginId)`。
4. 加载失败、`unloadPlugin` 时调用 `await destroyHostApi(pluginId)`。
5. `loadEnabledPlugins` 直接逐个 `await this.loadPlugin(plugin.id)`，失败只记录日志。

### `src/App.vue`

```ts
import PluginModalHost from './mod-host/components/PluginModalHost.vue'
```

模板中挂载一次：

```vue
<PluginModalHost />
```

并注册到 `components`。弹窗的显示、关闭、`onMount` / `onClose` 都由该组件处理，`App.vue` 不再需要内联弹窗。

### `src/components/ResourcesEditDialog.vue`

```ts
import PluginResourceActions from '../mod-host/components/PluginResourceActions.vue'
```

模板中放在表单顶部：

```vue
<PluginResourceActions
  :form-data="formData"
  :form-fields="formFields"
  :resource-name="resourceClass?.name || ''"
  @apply="applyPluginPatch"
/>
```

`methods` 中保留：

```ts
applyPluginPatch(patch: Record<string, unknown>) {
  for (const [key, value] of Object.entries(patch)) {
    if (Object.prototype.hasOwnProperty.call(this.formData, key) && this.formFields[key]) {
      (this.formData as Record<string, unknown>)[key] = value
    }
  }
}
```

### `src/pages/SettingsView.vue`

1. 导入：
   ```ts
   import pluginContributionManager, { type PluginSettingsPage } from '../mod-host/PluginContributions'
   import { findPluginSettingsPage, mergeSettingsCategories } from '../mod-host/settingsCategories'
   import PluginSettingsHost from '../mod-host/components/PluginSettingsHost.vue'
   ```
2. `data` 保留 `pluginSettingsPages`、`baseSettingsCategories`、`pluginContributionsListener`。
3. 模板中放置：
   ```vue
   <PluginSettingsHost :page="getPluginSettingsPage() || null" />
   ```
4. `mounted` 监听 `plugin-contributions-updated` 并调用 `refreshPluginSettingsPages()`；`beforeUnmount` 移除监听。
5. `methods` 保留 `getPluginSettingsPage` 与 `refreshPluginSettingsPages`，后者用 `mergeSettingsCategories` 合并分类。

### `electron/main.js`

```js
const pluginCapabilityHandlers = require('./ipc/plugin-capability-handlers')

pluginCapabilityHandlers.registerIpcHandlers(
  ipcMain,
  app,
  safeStorage,
  () => mainWindowModule.getMainWindow()?.webContents
)
```

### `electron/preload.js`

保留以下桥接：

```js
pluginCapabilityBind
pluginCapabilityRevoke
pluginConfigGet
pluginConfigSave
pluginConfigReset
pluginRequest
```

### `src/global.d.ts`

保留 `electronAPI` 中上述六个方法的类型声明（`pluginRequest` 需要包含 `allowLocal?: boolean`）。

### `src/locales/index.ts`

`setLanguage` 中保留：

```ts
if (typeof window !== 'undefined') {
  window.dispatchEvent(new CustomEvent('app-language-changed', { detail: { locale: lang } }))
}
```

插件靠这个事件刷新设置页和按钮文本。

### `package.json`

`build.extraFiles` 保留：

```json
{ "from": "mods", "to": "mods" }
```

否则打包后的应用不会带上内置插件。

### `src/components/MediaCard.vue`

`getDefaultImage()` 开头保留：

```ts
const detailDefault = this.item?.constructor?.detailPanelConfig?.defaultImage
if (typeof detailDefault === 'string' && detailDefault.trim()) {
  return detailDefault
}
```

让卡片缺图时使用资源类自己的默认图（例如视频的 `./default-video.png`），和详情面板保持一致。

## 本地待上游合并的补丁

以下改动是准备单独提给上游的 PR。合并前同步上游时要保留；上游合并后，`git rebase upstream/main` 会自动丢掉对应提交。

### `electron/ipc/system-handlers.js`

1. `extractLargeFileIcon` 的 `Add-Type` 必须带 `-ReferencedAssemblies System.Drawing`。Windows PowerShell 5.1 下缺少引用会编译失败，函数返回空，封面回退到 32px 图标。
2. `.lnk` 先用 `shell.readShortcutLink(filePath)` 解析目标程序，再调用 `extractLargeFileIcon`；解析失败时仍回退到快捷方式自身图标。

### `src/components/GenericResourceView.vue`

1. `onAdd` 开头用 `readItemPath` / `pageAlreadyHas` / `isSameResourcePath` 拦截同路径重复添加，命中时只提示，不写库。
2. 单张卡片右键“加入合集”：保留 `collectionPickerTargetId`、`openCollectionPicker(target)`、`confirmAddSelectionToCollection` 的单目标分支，以及 `contextMenuItems` 里插入的 `addToCollection` 项。

## 同步步骤

```bash
git fetch upstream
git merge upstream/main
```

解决冲突后：

```bash
cd green-resources-manager
npx vitest run
npm run build
```

重点回归：

1. 设置页出现「AI 设置」，可以保存服务商、模型、API 地址和密钥。
2. 资源编辑窗口出现「AI 补全信息」，可以联网检索、勾选字段并写回。
3. 关闭插件后，设置分类和编辑按钮一起消失。
4. 语言切换后，AI 设置页标题和按钮文本跟着变化。

## 注意

- `configs/resources/*.ts` 保持上游原样。AI 插件只根据当前表单里真实存在的字段生成内容，不要为了 AI 往资源类里加 `sourceInfo`、`publishDate` 之类的字段。
- 不要重新加入 `pnpm-lock.yaml`、`package.json` 的 `zip` 打包目标或 `.npmrc` 里的 `ELECTRON_BUILDER_BINARIES_MIRROR`。发布工作流已经统一用 `npm ci` 和 `Compress-Archive` 生成压缩包。
- 图标读取使用上游的 `get-file-icon`。`extractLargeFileIcon` 的 `Add-Type` 需要 `-ReferencedAssemblies System.Drawing`，`.lnk` 先解析目标程序；不要重新引入 PE 图标解析或 `.ico` 选择器改动。
- 插件代码由 `new Function` 执行，视为可信代码；不要把不受信任的第三方脚本直接放进 `mods`。
- 网络请求由主进程发起，默认拒绝本机和私网地址；本地模型必须显式传 `allowLocal: true`。

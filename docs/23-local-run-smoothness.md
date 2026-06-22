# 本地运行顺滑度

这一阶段优先保证 Web、API、数据库和小程序三端联调稳定，再继续推进新功能。

## Windows 终端约定

PowerShell 可能会因为执行策略拦截 `npm.ps1`，导致直接输入 `npm run ...` 失败。Windows 下优先使用项目提供的命令入口：

```powershell
.\jh.cmd check:api
.\jh.cmd dev:api
.\jh.cmd check:encoding
```

也可以显式调用 `npm.cmd`：

```powershell
npm.cmd run check:api
npm.cmd run dev:api
```

如果终端中文输出异常，先在当前 PowerShell 会话执行：

```powershell
.\scripts\windows-terminal-setup.cmd
```

该脚本只设置当前终端会话的 UTF-8 编码，不修改系统执行策略。`windows-terminal-setup.ps1` 也保留，但在执行策略严格的 PowerShell 里优先使用 `.cmd` 版本。

## 推荐启动顺序

1. 启动数据库：

```powershell
.\jh.cmd db:up
```

2. 启动 API：

```powershell
.\jh.cmd dev:api
```

3. 启动 Web：

```powershell
.\jh.cmd dev
```

4. 打开 Web：

```text
http://127.0.0.1:5173/
```

## 测试阶段 API 启动方式

当前项目还在功能测试和小程序迁移阶段，暂不建议立刻上云。现阶段默认手动启动 API，避免 Windows 登录后自动拉起后台服务造成误判。等核心流程稳定后再迁移到云服务器。

原因：

- 生成类、批改类、平板联动和小程序 UI 仍在高频调整；
- 现在上云会额外引入域名、HTTPS、备案、数据库迁移、文件存储和正式环境隔离成本；
- 手动启动更便于测试时确认 API 是否由当前 Codex/终端会话启动，避免残留后台进程影响判断。

手动启动 API：

```powershell
.\jh.cmd dev:api
```

如果只想用非 watch 模式启动：

```powershell
.\jh.cmd start:api
```

确认 API 状态：

```powershell
.\jh.cmd api:autostart:status
```

当前已关闭 API 开机自启。需要重新启用时，可以使用当前用户的 HKCU Run 注册表项，不需要管理员权限：

如果希望“打开 Codex 时自动启动 API”，使用项目创建的专用桌面入口：

```powershell
.\jh.cmd codex:launcher:install
```

该命令会在桌面生成：

```text
C:\Users\86188\Desktop\君航Codex启动API.cmd
```

以后用这个入口打开 Codex。它会先检查 `http://127.0.0.1:8787/api/status`，如果 API 不在线就启动后台 API，然后再打开 Codex。它不会写入 Windows 开机自启。

```powershell
.\jh.cmd api:user-run:install
```

立即启动后台 API：

```powershell
.\jh.cmd api:startup:start
```

查看任务和 API 状态：

```powershell
.\jh.cmd api:autostart:status
```

停止后台 API：

```powershell
.\jh.cmd api:autostart:stop
```

取消开机自启：

```powershell
.\jh.cmd api:user-run:uninstall
```

备用启动文件夹方案：

```powershell
.\jh.cmd api:startup:install
.\jh.cmd api:startup:uninstall
```

日志位置：

```text
storage/logs/api-autostart.log
```

默认方案会写入：

```text
HKCU\Software\Microsoft\Windows\CurrentVersion\Run\JunhangAITutorAPI
```

该注册表项会调用：

```text
C:\Users\86188\AppData\Local\JunhangAITutorAPI\launch-api.vbs
```

登录 Windows 后隐藏启动 `scripts/run-api-autostart.cmd`。脚本会调用 `.\jh.cmd start:api`，如果 API 异常退出，会等待 8 秒后自动重启。

启动文件夹备用方案会写入：

```text
C:\Users\86188\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\JunhangAITutorAPI.vbs
```

如果当前 Windows 账号允许创建任务计划，也可以使用任务计划程序版本：

```powershell
.\jh.cmd api:autostart:install
.\jh.cmd api:autostart:start
```

如果出现 `Access is denied`，说明当前用户没有创建计划任务权限，使用启动文件夹方案即可。

注意：

- 本地自启只适合开发测试，不适合正式小程序上线；
- 真机和平板如果不在同一台电脑上，不能使用 `127.0.0.1`，需要改成这台电脑的局域网 IP；
- 正式上线后仍应迁移到 `https://api.域名.com` 的云端 API。

## 一键检查

API 正在运行时执行：

```powershell
.\jh.cmd check:flow
```

如果只想快速检查接口和三端权限，不等待真实 AI 生成：

```powershell
$env:FLOW_SKIP_AI=1; .\jh.cmd check:flow
```

## 常用检查命令

```powershell
.\jh.cmd check:encoding
.\jh.cmd check:miniprogram-js
.\jh.cmd check:api
.\jh.cmd check:services
```

## 常用演示登录

教师端：

- 电话：`13800000001`
- 专属码：`T8JH21`

学生端：

- 姓名：`李子越`
- 家长电话：`13900005678`
- 专属码：`LZY6P9`

# 知识复习工作台

本版本将原来的嵌入式单页复习系统改为可扩展的多领域知识复习应用。内置 296 道原题，支持分类、专题筛选、搜索、间隔复习、AI 自测、资料提取和自定义题库导入。

## 使用

Windows 双击 `启动.cmd`。也可执行 `runtime\node.exe server.js 8000`，访问 `http://localhost:8000/review`。启动脚本在服务监听成功后打开浏览器，被占用的端口最多顺延 10 次。

主入口为 `index.html`；原来的 `嵌入式校招八股_总览.html` 是兼容入口。原题 ID 与 `eb-review-system-v1`、`eb-extract-v1` 存储名称保留。请使用原来的浏览器和相同的主机名、端口访问，以继续读取进度。`localhost`、`127.0.0.1` 与不同端口的浏览器存储彼此隔离。

默认仅监听本机 `127.0.0.1`。需要同 WiFi 手机访问时，可在 PowerShell 设置 `$env:REVIEW_HOST='0.0.0.0'` 再启动，按需放行防火墙。密钥、后端、运行时、备份文件禁止通过 HTTP 下载。

不启动服务时可直接打开 `index.html` 浏览和手动复习；AI 请求需要本地服务与 API Key。流程图及 PDF / DOCX / OCR / Excel 依赖 CDN，首次使用需联网。

## 开发

从 Git 获取的源码不包含 `runtime/node.exe` 或 API Key。先安装 Node.js 18+（推荐使用受支持的 LTS 版本），在工程目录执行 `node scripts/build.cjs`、`node --test tests/core.test.cjs`，再运行 `node server.js 8000`。Windows 的 `启动.cmd` 在没有包内运行时时会使用系统 Node。

需要 AI 功能时，将 `deepseek.key.example` 复制为 `deepseek.key` 并填写自己的 Key，或配置 `DEEPSEEK_API_KEY`。`.gitignore` 已排除密钥、运行时、服务器状态和本地测试截图，不应强制加入版本库。

在本目录执行：

```powershell
runtime\node.exe scripts\build.cjs
runtime\node.exe --test tests\core.test.cjs
```

修改 HTML 外壳或内置题库后运行 build；修改 CSS / JS 后刷新页面即可。无需 npm install。`assets/data/library.js` 及兼容 HTML 为生成文件，不应直接维护。

详见 `docs/开发与架构.md`。之前的使用说明、部署说明与测试用例描述的是旧版；涉及入口、分类、网络监听与毕业规则时，以本 README 和开发文档为准。

## 添加其他知识

主页点击“添加知识”，在统一弹窗中选择“题库文件 / 粘贴题库 / 资料提取”。模板为 `data/import-example.json`，包含英语语法示例。题库按“知识模块 → 专题 → 题目”组织；新增类型无需修改复习算法。自定义题目使用纯文本渲染，不执行导入文件中的 HTML。

标题下方只显示最近使用的最多五个模块（“全部知识”是总览入口）。通过“全部模块 / 管理”访问其他模块、新建模块或修改模块名称。模块选择、专题选择、题目交互、侧栏跳转和导入题库都会更新最近使用顺序，记录保存在当前浏览器中。重命名只改变显示名称，不改变模块 ID 或复习进度。

资料提取页面可选择所属知识模块。确认 AI 生成的题目后，“导出复习题库”生成可通过“添加知识”导入的格式。原文件在浏览器本地解析，生成知识点 / 题库时，提取文本会发送到配置的 AI 服务。

## 封装方向

目前保留模块化 HTML / CSS / JavaScript + Node 本地服务，便于调试、浏览器访问和将来复用。需要独立窗口、安装包、托盘或自动更新时，建议优先评估 Electron；现有 Node 后端更容易复用。若以后更关注安装包体积，并愿意增加 Rust 与平台 WebView 的适配工作，可以考虑 Tauri。本次没有安装桌面框架或生成桌面安装包。

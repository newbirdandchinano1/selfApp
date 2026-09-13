这个包是专注于前端 UI/UX 设计走查与细节打磨的 AI Agent 技能库（Impeccable），压缩包中已为你预置好了完整的 `.cursor` 配置。

**1.部署配置到项目根目录：**文件拷贝。

解压该压缩包，将其中的 `.cursor` 文件夹完整拷贝至你当前项目的根目录下。如果你的项目根目录已存在 `.cursor` 文件夹，请将压缩包内 `.cursor/` 下的 `skills`、`agents` 目录及 `hooks.json` 文件合并移入该目录中。

_验证方法_：在项目根目录终端执行 `ls .cursor/skills`（Windows 执行 `dir .cursor\skills`），能看到 `impeccable` 文件夹即表示目录结构正确。

**2.检查运行环境与脚本权限：**环境依赖。

该技能的测试走查与 DOM 捕获依赖 Node.js（推荐 v18+）。若使用的是 macOS 或 Linux，需要为 scripts 目录下的执行脚本赋予运行权限：

Bash

```
chmod +x .cursor/skills/impeccable/scripts/impeccable
```

_验证方法_：在终端执行 `node -v` 能正常返回版本号，且执行 `./.cursor/skills/impeccable/scripts/impeccable --version` 能正确输出版本号（如 `0.1.5`）。

**3.在 Cursor 中唤起与调用：**交互使用。

按 `Ctrl + I`（macOS 为 `Cmd + I`）打开 Cursor Composer，将底部的运行模式切换为 **Agent**。

在输入框中通过 `@` 符号引用对应的技能文件或参考规范来执行任务：

- **完整规范引导**：输入 `@.cursor/skills/impeccable/SKILL.md`，随后描述你的前端开发/优化需求。
    
- **专项任务直达**：在 `@` 菜单中直接选择对应参考手册：
    
    - `@audit.md`：对现有页面进行全面设计走查与缺陷审计。
        
    - `@polish.md`：精细化打磨视觉间距、微交互与组件层级。
        
    - `@colorize.md`：调整系统配色与 WCAG 对比度。
        
    - `@typeset.md`：优化排版、字重与文本层级。
        
    - `@critique.md`：针对当前 UI 给出客观的设计批评与重构建议。
        

_验证方法_：发送包含 `@SKILL.md` 的提示词后，观察 Agent 是否自动按照 Impeccable 的检查项维度（如层次、对比度、间距体系）分项给出审查与修改建议。

**常用调用提示词示例**

- 界面走查：`@.cursor/skills/impeccable/SKILL.md 参考 @audit.md，审查当前页面的视觉和交互缺陷并给出修复方案。`
    
- 视觉微调：`@polish.md 帮我优化这个卡片组件的边距、投影和动效细节。`
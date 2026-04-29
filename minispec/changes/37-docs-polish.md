---
id: 37-docs-polish
status: draft
owner: ivenlau
---

# Why

README 全是文字、Windows 安装有隐藏坑、specs 里找不到视觉 source of truth（Pencil 文件）。新人接触项目时摩擦大。

# Approach

三处文档改进，每处独立：
1. README 加截图（Dashboard / Blame / Revert modal 三张足够）
2. Install 章节补 Windows `.cmd` shim 步骤 + "如何手工修 settings.json" 兜底
3. specs/ui.md 加一节指向 `new.pen` 作为视觉 canonical ref

# Scope

- In:
  - 截图：用 `npx puppeteer` 或手工截 3 张放 `docs/screenshots/` 并在 README 引用
  - README "Install" 章节扩展：Windows 步骤 + troubleshooting
  - README 加 "Architecture" 章节链接到 specs/
  - specs/ui.md 开头加 Pencil 引用段
  - specs/README.md 加一个"设计 source of truth"表
- Out:
  - 视频演示（后续有需要再做）
  - 翻译（保持中英混合，面向自己 + 懂中文的开发者）

# Acceptance

- [ ] README 至少 3 张截图
- [ ] Windows install 章节覆盖：pnpm link、path 检查、settings.json 手工编辑示例
- [ ] specs/ui.md 明确说 Pencil 是视觉 source of truth
- [ ] 所有改动后 `markdownlint` 或肉眼 review clean

# Plan

- [ ] T1 截 3 张图放 docs/screenshots/
- [ ] T2 README install 扩展
- [ ] T3 specs 更新
- [ ] T4 close

# Risks and Rollback

- Risk: 纯文档，零风险。
- Rollback: git revert。

# Notes

- 最后一张卡，所有功能稳定后收尾。

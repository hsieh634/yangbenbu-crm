# 養本簿 Yangbenbu CRM

以中醫診療與長期健康管理為核心的診所 CRM 與健康管理系統。

定位為 **HIS 之上的 CRM／健康管理層**：健保卡、申報、處方交給既有 HIS；養本簿負責體質問卷、調理方案、療程堂數、今日看板、跨職務交接、診後追蹤與 LINE 互動。

## 文件

- [01 技術選型研究與架構建議](docs/01-技術選型研究.md)
- [02 功能規劃與系統架構](docs/02-功能規劃與系統架構.md)

## 技術棧（規劃）

- 前端：Next.js · React · Tailwind CSS · shadcn/ui · TanStack Query · LINE LIFF
- 後端：NestJS · Prisma · PostgreSQL · pg-boss · LINE Messaging API
- 標準：FHIR R4（TW Core IG）對應層
- 工具：pnpm + Turborepo monorepo · Docker Compose · GitHub Actions

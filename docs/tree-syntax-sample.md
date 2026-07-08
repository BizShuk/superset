# Markdown `tree` Syntax Sample

在 Markdown 中使用  tree  程式碼區塊，Superset 提供語法高亮與預覽渲染。

## 基本語法 (Basic Syntax)

```tree
root/
├── src/
│   ├── components/
│   │   ├── Button.tsx
│   │   └── Modal.tsx
│   ├── utils/
│   │   └── helpers.ts
│   └── index.ts
├── test/
│   └── app.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

## 巢狀結構 (Nested Structure)

```tree
project/
├── apps/
│   ├── web/
│   │   ├── pages/
│   │   │   ├── index.tsx
│   │   │   └── about.tsx
│   │   └── components/
│   │       ├── Header.tsx
│   │       └── Footer.tsx
│   └── server/
│       ├── handlers/
│       │   └── api.ts
│       └── main.go
└── packages/
    ├── shared/
    │   └── types.ts
    └── config/
        └── env.ts
```

## 註解 (Comments)

```tree
src/
├── auth/
│   ├── login.ts       # OAuth 登入邏輯
│   ├── logout.ts      # 清除 session
│   └── middleware.ts  # JWT 驗證中介層
├── db/
│   ├── schema.sql     # 資料表定義
│   └── migrate.ts     # 遷移腳本
└── api/
    ├── routes.ts      # REST API 路由
    └── validation.ts  # 請求驗證
```

## 純連接線 (Bare Connectors)

```tree
project/
│
├── docs/
│   │
│   ├── spec.md
│   │
│   └── design.md
│
└── README.md
```

## 混合類型 (Mixed Types)

```tree
workspace/
├── frontend/          # React SPA
│   ├── public/
│   │   └── index.html
│   └── src/
│       └── App.tsx
├── backend/           # Go API server
│   ├── cmd/
│   │   └── main.go
│   └── internal/
│       └── handler.go
├── docker-compose.yml # 本地開發環境
└── Makefile           # 建置與部署指令
```

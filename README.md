# 情儿的食谱 · 云存版

- 原图存 **Vercel Blob**，本地仅存**缩略图+文字**（更省空间、无限记录）。
- 支持：列表视图、月视图（小预览图）、放大查看、搜索、CSV 导出、JSON 备份/导入、清空。
- 单页前端 + Vercel Serverless（`/api/upload`）。

## 一步部署（Vercel）
1. 在 Vercel 新建项目，上传本仓库（或导入 ZIP）。
2. 在左侧 **Storage → Blob** 创建存储，并 **Connect to this project**（会自动注入 `BLOB_READ_WRITE_TOKEN`）。
3. 直接 `Deploy`。部署完成访问你的域名即可使用。

## 本地开发
```bash
npm i
npx vercel dev
```

## 使用说明
- 记录时会：
  - 压缩出一张约 360px 的缩略图（存本地 IndexedDB）；
  - 调用 `/api/upload` 把**原图**放到 Blob，返回一个公开 URL；
  - 每道菜单独成卡片，可无限新增。
- 删除仅删除**本地记录**（不会动云端原图）。需要删除原图，请到 Vercel Blob 控制台操作。

## 隐私
- 数据（缩略图与文字）仅存你的浏览器本地；
- 原图在你的 Vercel Blob 空间，访问权限是 `public`（方便分享），若需私有请按需修改 `/api/upload` 的 `access` 策略。

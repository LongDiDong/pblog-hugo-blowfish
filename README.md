# pblog-hugo-blowfish

Ming 的个人博客，基于 [Hugo](https://gohugo.io/) + [Blowfish](https://blowfish.page/)。

## 环境要求

- Hugo Extended `>= 0.162.0`
- Git（主题以 submodule 方式引入）

## 开始使用

```bash
git clone --recurse-submodules https://github.com/LongDiDong/pblog-hugo-blowfish.git
cd pblog-hugo-blowfish
hugo server -D
```

浏览器打开 <http://localhost:1313>。

## 更新主题

```bash
git submodule update --remote --merge
```

# Chain Market 毕设演示系统（预测市场 + 钱包 + 数据分析）

本仓库基于你的说明书，实现三个可独立运行的平台：

1. **预测市场平台**（`apps/prediction-platform`）
2. **钱包管理平台**（`apps/wallet-platform`）
3. **预测信息获取与分析平台**（`apps/analytics-platform`）

当前为毕业设计演示友好的可运行版本，包含完整后端接口流程与 JSON 文件持久化（`data/*.json`）。

## 功能覆盖清单

### 1) 预测市场平台

已实现：

- MetaMask 登录（钱包地址建档）
- 市场创建（AI 合理性检查标记）
- 管理员审核市场（通过/拒绝）
- 市场浏览与筛选
- 交易（Buy YES / Buy NO）
- 结果建议 + 用户投票 + 管理员最终确认
- 自动结算（按“用户正确持仓 / 总正确持仓 × 奖池”）
- 管理员用户管理（禁用用户）
- 管理员市场管理（查看/修改/删除）
- 管理员交易管理（查看/导出 CSV）
- AI API 配置管理（API Key/API 地址/模型/限流）
- 用户持仓查询

### 2) 钱包管理平台

已实现：

- MetaMask 登录
- 水龙头发币（默认每天 5 次、每次 100 Token）
- 发币账户配置管理
- 发放交易记录查询（支持按地址过滤）
- 用户禁用

### 3) 数据分析平台

已实现：

- Mock Polymarket 数据采集
- 采集器配置（开启/关闭、源地址、间隔）
- 手动触发采集任务
- 趋势分析（概率与成交量快照）
- 用户行为分析（交易次数、PnL）
- 预测准确率分析
- 简单量化因子（Momentum / Liquidity）


## 预测市场平台前端（已完成）

预测市场平台现已提供可直接访问的前端页面：

- 地址：`http://localhost:4000/`
- 功能：登录、创建市场、列表展示、交易、管理员审核、管理员结算、AI 配置修改
- 前后端：同服务部署（静态页面 + `/api/*` 接口）

## 运行方式

```bash
npm run dev:prediction
npm run dev:wallet
npm run dev:analytics
```

默认端口：

- 预测市场平台：`http://localhost:4000`
- 钱包管理平台：`http://localhost:4001`
- 数据分析平台：`http://localhost:4002`

## 一键检查

```bash
npm run check
npm run test:smoke
```

## Docker 启动

```bash
docker compose up --build
```

## 关于第三方依赖安装问题（重点）

你之前遇到的 `npm install 403` 本质是网络代理策略导致：

- 走代理：访问外部 registry 被 403 拒绝
- 不走代理：网络不可达（ENETUNREACH）

可按以下步骤在你的可联网环境修复：

1. 清理代理相关环境变量
2. 清理 npm proxy 配置
3. 指向可访问 registry（企业私服或官方）

示例：

```bash
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
unset npm_config_http_proxy npm_config_https_proxy
npm config delete proxy
npm config delete https-proxy
npm config set registry https://registry.npmjs.org/
npm install
```

> 若你的学校/公司网络限制外网，请改用内网 npm 私服地址。

### 当前环境诊断结论

可通过下述命令复现：

```bash
npm run deps:doctor
```

当前容器网络策略下：

- 代理访问外网 registry 会被 403 拒绝；
- 关闭代理后无外网路由（ENETUNREACH）。

因此本仓库已提前声明标准第三方依赖（express/cors/morgan/axios 等），在你可联网或可访问内网私服的环境下直接 `npm install` 即可正常安装使用。

## 目录结构

```text
apps/
  common/
  prediction-platform/
  wallet-platform/
  analytics-platform/
data/
scripts/
docker-compose.yml
package.json
```

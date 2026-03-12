const http = require('http');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');
const { randomUUID } = require('crypto');
const { readJson, writeJson } = require('../common/jsonStore');
const { send, sendText, parseBody } = require('../common/http');

const port = Number(process.env.PORT || 4000);
const dbPath = path.join(__dirname, '../../data/prediction.json');
const publicDir = path.join(__dirname, 'public');

const initData = {
  users: [],
  markets: [],
  trades: [],
  votes: [],
  aiApiConfig: {
    apiKey: 'demo-key',
    apiBaseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    rateLimitPerMin: 60
  }
};

function loadDb() {
  return readJson(dbPath, initData);
}

function saveDb(db) {
  writeJson(dbPath, db);
}

function findMarket(db, id) {
  return db.markets.find((m) => m.id === id);
}

function ensureUser(db, walletAddress) {
  let user = db.users.find((u) => u.walletAddress === walletAddress);
  if (!user) {
    user = { walletAddress, disabled: false, createdAt: new Date().toISOString() };
    db.users.push(user);
  }
  return user;
}

function userPositions(db, walletAddress) {
  const position = {};
  db.trades.filter((t) => t.walletAddress === walletAddress).forEach((t) => {
    position[t.marketId] = position[t.marketId] || {};
    position[t.marketId][t.direction] = position[t.marketId][t.direction] || 0;
    position[t.marketId][t.direction] += t.amount;
  });
  return position;
}

function withCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function serveStatic(req, res, pathname) {
  const resolvedPath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = path.join(publicDir, resolvedPath);
  if (!fullPath.startsWith(publicDir)) return false;
  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) return false;

  const ext = path.extname(fullPath);
  const typeMap = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  };

  res.writeHead(200, { 'Content-Type': typeMap[ext] || 'application/octet-stream' });
  fs.createReadStream(fullPath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathName = url.pathname;

  withCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && !pathName.startsWith('/api/')) {
    if (serveStatic(req, res, pathName)) return;
  }

  try {
    const db = loadDb();

    if (req.method === 'GET' && (pathName === '/api/health' || pathName === '/health')) {
      return send(res, 200, { service: 'prediction-platform', status: 'ok' });
    }

    if (req.method === 'POST' && pathName === '/api/auth/metamask') {
      const { walletAddress } = await parseBody(req);
      if (!walletAddress) return send(res, 400, { message: 'walletAddress is required' });
      const user = ensureUser(db, walletAddress);
      saveDb(db);
      return send(res, 200, { message: '登录成功', user });
    }

    if (req.method === 'GET' && pathName === '/api/markets') {
      const status = url.searchParams.get('status');
      const data = status ? db.markets.filter((m) => m.status === status) : db.markets;
      return send(res, 200, data);
    }

    const marketDetail = pathName.match(/^\/api\/markets\/([^/]+)$/);
    if (req.method === 'GET' && marketDetail) {
      const market = findMarket(db, marketDetail[1]);
      if (!market) return send(res, 404, { message: 'market not found' });
      return send(res, 200, market);
    }

    if (req.method === 'POST' && pathName === '/api/markets') {
      const { title, description, predictionType, endTime, creatorWallet, outcomes } = await parseBody(req);
      if (!title || !description || !predictionType || !endTime || !creatorWallet) {
        return send(res, 400, { message: 'missing required fields' });
      }
      ensureUser(db, creatorWallet);
      const normalizedType = String(predictionType).toUpperCase();
      const resolvedOutcomes = Array.isArray(outcomes) && outcomes.length
        ? outcomes
        : normalizedType === 'BINARY'
          ? ['YES', 'NO']
          : normalizedType === 'MULTI'
            ? ['A', 'B', 'C']
            : ['UP', 'DOWN'];

      const poolMap = Object.fromEntries(resolvedOutcomes.map((x) => [x, 0]));

      const market = {
        id: randomUUID(),
        title,
        description,
        predictionType: normalizedType,
        outcomes: resolvedOutcomes,
        endTime,
        creatorWallet,
        currentProbability: 0.5,
        totalVolume: 0,
        status: 'PENDING_ADMIN_REVIEW',
        aiCheck: title.length > 5 && description.length > 10,
        pools: poolMap,
        outcomeProbabilities: Object.fromEntries(resolvedOutcomes.map((x) => [x, Number((1 / resolvedOutcomes.length).toFixed(4))])),
        result: null,
        settledAt: null,
        createdAt: new Date().toISOString()
      };
      db.markets.push(market);
      saveDb(db);
      return send(res, 201, { message: '市场创建成功，待管理员审核', market });
    }

    const marketMatch = pathName.match(/^\/api\/markets\/([^/]+)$/);
    if (req.method === 'PUT' && marketMatch) {
      const market = findMarket(db, marketMatch[1]);
      if (!market) return send(res, 404, { message: 'market not found' });
      const patch = await parseBody(req);
      Object.assign(market, patch, { id: market.id });
      saveDb(db);
      return send(res, 200, { message: '市场信息修改成功', market });
    }

    if (req.method === 'DELETE' && marketMatch) {
      const idx = db.markets.findIndex((m) => m.id === marketMatch[1]);
      if (idx === -1) return send(res, 404, { message: 'market not found' });
      db.markets.splice(idx, 1);
      saveDb(db);
      return send(res, 200, { message: '市场删除成功' });
    }

    const reviewMatch = pathName.match(/^\/api\/markets\/([^/]+)\/admin-review$/);
    if (req.method === 'POST' && reviewMatch) {
      const market = findMarket(db, reviewMatch[1]);
      if (!market) return send(res, 404, { message: 'market not found' });
      const { approve } = await parseBody(req);
      market.status = approve ? 'OPEN' : 'REJECTED';
      saveDb(db);
      return send(res, 200, { message: '审核完成', market });
    }

    const tradeMatch = pathName.match(/^\/api\/markets\/([^/]+)\/trades$/);
    if (req.method === 'POST' && tradeMatch) {
      const market = findMarket(db, tradeMatch[1]);
      if (!market) return send(res, 404, { message: 'market not found' });
      if (market.status !== 'OPEN') return send(res, 400, { message: 'market is not open for trading' });

      const { walletAddress, amount, direction } = await parseBody(req);
      const user = ensureUser(db, walletAddress);
      if (user.disabled) return send(res, 403, { message: 'user is disabled' });
      if (!walletAddress || Number(amount) <= 0 || !market.outcomes.includes(direction)) {
        return send(res, 400, { message: 'invalid trade payload' });
      }

      const trade = {
        id: randomUUID(),
        marketId: market.id,
        walletAddress,
        amount: Number(amount),
        direction,
        tradedAt: new Date().toISOString()
      };
      db.trades.push(trade);
      market.pools[direction] += trade.amount;
      market.totalVolume += trade.amount;
      const denominator = Object.values(market.pools).reduce((sum, x) => sum + x, 0);
      if (denominator) {
        market.outcomeProbabilities = Object.fromEntries(
          market.outcomes.map((x) => [x, Number((market.pools[x] / denominator).toFixed(4))])
        );
      }
      if (market.outcomes.includes('YES')) {
        market.currentProbability = denominator ? Number((market.pools.YES / denominator).toFixed(4)) : 0.5;
      }
      saveDb(db);
      return send(res, 201, { message: '交易成功', trade, market });
    }

    const proposalMatch = pathName.match(/^\/api\/markets\/([^/]+)\/result-proposal$/);
    if (req.method === 'POST' && proposalMatch) {
      const market = findMarket(db, proposalMatch[1]);
      if (!market) return send(res, 404, { message: 'market not found' });
      const { aiSuggestedResult, externalSource } = await parseBody(req);
      market.aiSuggestedResult = aiSuggestedResult;
      market.externalSource = externalSource;
      market.status = 'VOTING';
      saveDb(db);
      return send(res, 200, { message: '已进入投票确认阶段', market });
    }

    const voteMatch = pathName.match(/^\/api\/markets\/([^/]+)\/votes$/);
    if (req.method === 'POST' && voteMatch) {
      const market = findMarket(db, voteMatch[1]);
      if (!market) return send(res, 404, { message: 'market not found' });
      const { walletAddress, vote } = await parseBody(req);
      if (!walletAddress || !market.outcomes.includes(vote)) return send(res, 400, { message: 'invalid vote payload' });
      db.votes.push({ id: randomUUID(), marketId: market.id, walletAddress, vote, votedAt: new Date().toISOString() });
      saveDb(db);
      return send(res, 201, { message: '投票成功' });
    }

    const finalMatch = pathName.match(/^\/api\/markets\/([^/]+)\/finalize$/);
    if (req.method === 'POST' && finalMatch) {
      const market = findMarket(db, finalMatch[1]);
      if (!market) return send(res, 404, { message: 'market not found' });
      const { finalResult } = await parseBody(req);
      if (!market.outcomes.includes(finalResult)) return send(res, 400, { message: 'finalResult not in outcomes' });

      const marketTrades = db.trades.filter((t) => t.marketId === market.id);
      const totalPool = marketTrades.reduce((sum, t) => sum + t.amount, 0);
      const winnerPool = marketTrades.filter((t) => t.direction === finalResult).reduce((sum, t) => sum + t.amount, 0);
      const payouts = marketTrades
        .filter((t) => t.direction === finalResult)
        .map((t) => ({ walletAddress: t.walletAddress, reward: winnerPool ? Number(((t.amount / winnerPool) * totalPool).toFixed(4)) : 0 }));

      market.status = 'SETTLED';
      market.result = finalResult;
      market.settledAt = new Date().toISOString();
      saveDb(db);
      return send(res, 200, { message: '市场结算完成', marketId: market.id, finalResult, totalPool, winnerPool, payouts });
    }

    if (req.method === 'GET' && pathName === '/api/admin/users') return send(res, 200, db.users);
    if (req.method === 'GET' && pathName === '/api/admin/markets') return send(res, 200, db.markets);

    if (req.method === 'GET' && pathName === '/api/admin/ai-config') {
      const { apiKey, ...safe } = db.aiApiConfig || initData.aiApiConfig;
      return send(res, 200, { ...safe, apiKeyMasked: `${String(apiKey).slice(0, 4)}***` });
    }

    if (req.method === 'PUT' && pathName === '/api/admin/ai-config') {
      const patch = await parseBody(req);
      db.aiApiConfig = { ...(db.aiApiConfig || initData.aiApiConfig), ...patch };
      saveDb(db);
      return send(res, 200, { message: 'AI API 配置更新成功' });
    }

    const disableMatch = pathName.match(/^\/api\/admin\/users\/([^/]+)\/disable$/);
    if (req.method === 'POST' && disableMatch) {
      const user = db.users.find((u) => u.walletAddress === disableMatch[1]);
      if (!user) return send(res, 404, { message: 'user not found' });
      user.disabled = true;
      saveDb(db);
      return send(res, 200, { message: '用户已禁用', user });
    }

    if (req.method === 'GET' && pathName === '/api/admin/trades') return send(res, 200, db.trades);

    if (req.method === 'GET' && pathName === '/api/admin/trades/export.csv') {
      const head = 'tradeId,marketId,walletAddress,amount,direction,tradedAt';
      const body = db.trades.map((t) => [t.id, t.marketId, t.walletAddress, t.amount, t.direction, t.tradedAt].join(','));
      return sendText(res, 200, [head, ...body].join('\n'));
    }

    const posMatch = pathName.match(/^\/api\/users\/([^/]+)\/positions$/);
    if (req.method === 'GET' && posMatch) {
      return send(res, 200, { walletAddress: posMatch[1], positions: userPositions(db, posMatch[1]) });
    }

    return send(res, 404, { message: 'not found' });
  } catch (error) {
    return send(res, 500, { message: 'server error', detail: error.message });
  }
});

server.listen(port, () => {
  console.log(`prediction-platform listening on ${port}`);
});

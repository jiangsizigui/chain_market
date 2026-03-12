const http = require('http');
const path = require('path');
const https = require('https');
const { URL } = require('url');
const { readJson, writeJson } = require('../common/jsonStore');
const { send, parseBody } = require('../common/http');

const port = Number(process.env.PORT || 4002);
const dbPath = path.join(__dirname, '../../data/analytics.json');
const initData = {
  snapshots: [],
  collectorConfig: {
    enabled: false,
    sourceUrl: 'https://gamma-api.polymarket.com/markets',
    intervalMs: 1800000
  }
};

function loadDb() {
  return readJson(dbPath, initData);
}

function saveDb(db) {
  writeJson(dbPath, db);
}

function appendSnapshots(db, markets) {
  const now = new Date().toISOString();
  markets.forEach((market) => {
    db.snapshots.push({
      marketId: market.marketId,
      title: market.title,
      probability: Number(market.probability || 0),
      volume: Number(market.volume || 0),
      result: market.result || null,
      timestamp: now,
      traders: Array.isArray(market.traders) ? market.traders : []
    });
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (resp) => {
      let data = '';
      resp.on('data', (chunk) => {
        data += chunk;
      });
      resp.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

let collectorTimer = null;

function runCollectorOnce() {
  const db = loadDb();
  return fetchJson(db.collectorConfig.sourceUrl)
    .then((result) => {
      const markets = Array.isArray(result)
        ? result.slice(0, 20).map((m) => ({
            marketId: String(m.id || m.conditionId || m.slug || Date.now()),
            title: m.question || m.title || 'Unknown',
            probability: Number(m.probability || m.lastTradePrice || 0),
            volume: Number(m.volume || 0),
            result: null,
            traders: []
          }))
        : [];
      appendSnapshots(db, markets);
      saveDb(db);
      return { collected: markets.length };
    })
    .catch((error) => ({ collected: 0, error: error.message }));
}

function resetTimer() {
  if (collectorTimer) clearInterval(collectorTimer);
  const db = loadDb();
  if (db.collectorConfig.enabled) {
    collectorTimer = setInterval(() => {
      runCollectorOnce();
    }, Number(db.collectorConfig.intervalMs || 1800000));
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathname = url.pathname;

  try {
    const db = loadDb();

    if (req.method === 'GET' && pathname === '/health') return send(res, 200, { service: 'analytics-platform', status: 'ok' });

    if (req.method === 'POST' && pathname === '/collector/polymarket/mock') {
      const { markets } = await parseBody(req);
      if (!Array.isArray(markets)) return send(res, 400, { message: 'markets must be an array' });
      appendSnapshots(db, markets);
      saveDb(db);
      return send(res, 201, { message: '采集成功', count: markets.length });
    }

    if (req.method === 'PUT' && pathname === '/collector/config') {
      const patch = await parseBody(req);
      db.collectorConfig = { ...db.collectorConfig, ...patch };
      saveDb(db);
      resetTimer();
      return send(res, 200, { message: '配置更新成功', collectorConfig: db.collectorConfig });
    }

    if (req.method === 'POST' && pathname === '/collector/run') {
      const result = await runCollectorOnce();
      return send(res, 200, { message: '采集任务执行完成', result });
    }

    if (req.method === 'GET' && pathname === '/analysis/trends') {
      const marketId = url.searchParams.get('marketId');
      const data = db.snapshots.filter((s) => (!marketId ? true : s.marketId === marketId));
      return send(res, 200, { count: data.length, data });
    }

    if (req.method === 'GET' && pathname === '/analysis/users') {
      const userStats = new Map();
      db.snapshots.forEach((snap) => {
        snap.traders.forEach((trader) => {
          const current = userStats.get(trader.walletAddress) || { walletAddress: trader.walletAddress, trades: 0, pnl: 0 };
          current.trades += Number(trader.trades || 0);
          current.pnl += Number(trader.pnl || 0);
          userStats.set(trader.walletAddress, current);
        });
      });
      const ranking = Array.from(userStats.values()).sort((a, b) => b.trades - a.trades);
      return send(res, 200, { activeUsersRanking: ranking });
    }

    if (req.method === 'GET' && pathname === '/analysis/accuracy') {
      const settled = db.snapshots.filter((s) => s.result === 'YES' || s.result === 'NO');
      if (!settled.length) return send(res, 200, { marketAccuracy: null, message: '暂无已结算样本' });
      const hit = settled.filter((s) => (s.probability >= 0.5 ? 'YES' : 'NO') === s.result).length;
      return send(res, 200, { sampleSize: settled.length, hit, marketAccuracy: Number((hit / settled.length).toFixed(4)) });
    }

    if (req.method === 'GET' && pathname === '/analysis/factors') {
      const grouped = new Map();
      db.snapshots.forEach((s) => {
        const arr = grouped.get(s.marketId) || [];
        arr.push(s);
        grouped.set(s.marketId, arr);
      });
      const factors = Array.from(grouped.entries()).map(([marketId, arr]) => {
        const sorted = arr.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const momentum = Number((last.probability - first.probability).toFixed(4));
        const liquidity = sorted.reduce((sum, x) => sum + x.volume, 0);
        return { marketId, title: last.title, momentum, liquidity };
      });
      return send(res, 200, { factors });
    }

    return send(res, 404, { message: 'not found' });
  } catch (error) {
    return send(res, 500, { message: 'server error', detail: error.message });
  }
});

resetTimer();
server.listen(port, () => {
  console.log(`analytics-platform listening on ${port}`);
});

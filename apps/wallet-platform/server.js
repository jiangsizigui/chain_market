const http = require('http');
const path = require('path');
const { URL } = require('url');
const { randomUUID } = require('crypto');
const { readJson, writeJson } = require('../common/jsonStore');
const { send, parseBody } = require('../common/http');

const port = Number(process.env.PORT || 4001);
const dbPath = path.join(__dirname, '../../data/wallet.json');

const initData = {
  users: [],
  faucetLogs: [],
  faucetCounter: {},
  config: {
    distributorPrivateKey: 'demo-private-key',
    tokenContractAddress: '0xDemoTokenContract',
    rpcEndpoint: 'http://localhost:8545',
    amountPerClaim: 100,
    maxClaimsPerDay: 5
  }
};

function loadDb() {
  return readJson(dbPath, initData);
}

function saveDb(db) {
  writeJson(dbPath, db);
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function ensureUser(db, walletAddress) {
  let user = db.users.find((u) => u.walletAddress === walletAddress);
  if (!user) {
    user = { walletAddress, disabled: false, createdAt: new Date().toISOString() };
    db.users.push(user);
  }
  return user;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  try {
    const db = loadDb();

    if (req.method === 'GET' && pathname === '/health') return send(res, 200, { service: 'wallet-platform', status: 'ok' });

    if (req.method === 'POST' && pathname === '/auth/metamask') {
      const { walletAddress } = await parseBody(req);
      if (!walletAddress) return send(res, 400, { message: 'walletAddress is required' });
      const user = ensureUser(db, walletAddress);
      saveDb(db);
      return send(res, 200, { message: '登录成功', user });
    }

    if (req.method === 'POST' && pathname === '/faucet/claim') {
      const { walletAddress } = await parseBody(req);
      if (!walletAddress) return send(res, 400, { message: 'walletAddress is required' });

      const user = ensureUser(db, walletAddress);
      if (user.disabled) return send(res, 403, { message: '账户已禁用' });

      const key = `${walletAddress}_${dayKey()}`;
      const count = db.faucetCounter[key] || 0;
      if (count >= db.config.maxClaimsPerDay) return send(res, 429, { message: '今日领取次数已达上限' });

      db.faucetCounter[key] = count + 1;
      const record = {
        id: randomUUID(),
        walletAddress,
        amount: db.config.amountPerClaim,
        txHash: `0xmock${Date.now().toString(16)}`,
        createdAt: new Date().toISOString()
      };
      db.faucetLogs.push(record);
      saveDb(db);
      return send(res, 201, { message: '领取成功', record, todayClaims: db.faucetCounter[key] });
    }

    if (req.method === 'GET' && pathname === '/faucet/config') {
      const { distributorPrivateKey, ...safe } = db.config;
      return send(res, 200, { ...safe, distributorPrivateKeyMasked: `${distributorPrivateKey.slice(0, 4)}***` });
    }

    if (req.method === 'PUT' && pathname === '/admin/faucet/config') {
      const patch = await parseBody(req);
      db.config = { ...db.config, ...patch };
      saveDb(db);
      return send(res, 200, { message: '发币配置更新成功', config: db.config });
    }

    if (req.method === 'GET' && pathname === '/admin/faucet/logs') {
      const wallet = url.searchParams.get('walletAddress');
      const data = wallet ? db.faucetLogs.filter((x) => x.walletAddress === wallet) : db.faucetLogs;
      return send(res, 200, data);
    }

    if (req.method === 'GET' && pathname === '/admin/users') return send(res, 200, db.users);

    const disableMatch = pathname.match(/^\/admin\/users\/([^/]+)\/disable$/);
    if (req.method === 'POST' && disableMatch) {
      const user = db.users.find((u) => u.walletAddress === disableMatch[1]);
      if (!user) return send(res, 404, { message: 'user not found' });
      user.disabled = true;
      saveDb(db);
      return send(res, 200, { message: '用户已禁用', user });
    }

    return send(res, 404, { message: 'not found' });
  } catch (error) {
    return send(res, 500, { message: 'server error', detail: error.message });
  }
});

server.listen(port, () => {
  console.log(`wallet-platform listening on ${port}`);
});

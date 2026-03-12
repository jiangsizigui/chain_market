const state = {
  wallet: null,
  markets: []
};

const logEl = document.getElementById('log');
const marketListEl = document.getElementById('marketList');
const loginStateEl = document.getElementById('loginState');

function log(message, payload) {
  const line = payload ? `${message}\n${JSON.stringify(payload, null, 2)}` : message;
  logEl.textContent = `${line}\n\n${logEl.textContent}`;
}

async function api(path, options = {}) {
  const resp = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.message || 'request failed');
  return data;
}

async function refreshMarkets() {
  state.markets = await api('/markets');
  marketListEl.innerHTML = '';
  state.markets.forEach((m) => {
    const wrap = document.createElement('div');
    wrap.className = 'market';
    wrap.innerHTML = `
      <div><b>${m.title}</b> <span class="small">(${m.id})</span></div>
      <div>${m.description}</div>
      <div class="small">状态: ${m.status} | 类型: ${m.predictionType} | 交易量: ${m.totalVolume}</div>
      <div class="small">结果选项: ${m.outcomes.join(', ')}</div>
      <div class="small">概率: ${JSON.stringify(m.outcomeProbabilities || {})}</div>
      <div class="row">
        <input placeholder="交易金额" id="amount-${m.id}" />
        <input placeholder="方向（${m.outcomes.join('/')}）" id="dir-${m.id}" />
        <button data-id="${m.id}" class="tradeBtn">交易</button>
      </div>
    `;
    marketListEl.appendChild(wrap);
  });

  document.querySelectorAll('.tradeBtn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        if (!state.wallet) throw new Error('请先登录');
        const id = btn.dataset.id;
        const amount = document.getElementById(`amount-${id}`).value;
        const direction = document.getElementById(`dir-${id}`).value;
        const result = await api(`/markets/${id}/trades`, {
          method: 'POST',
          body: JSON.stringify({ walletAddress: state.wallet, amount: Number(amount), direction })
        });
        log('交易成功', result);
        await refreshMarkets();
      } catch (err) {
        log(`交易失败: ${err.message}`);
      }
    });
  });
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  try {
    const walletAddress = document.getElementById('walletInput').value.trim();
    const result = await api('/auth/metamask', { method: 'POST', body: JSON.stringify({ walletAddress }) });
    state.wallet = result.user.walletAddress;
    loginStateEl.textContent = `已登录：${state.wallet}`;
    log('登录成功', result);
  } catch (err) {
    log(`登录失败: ${err.message}`);
  }
});

document.getElementById('createBtn').addEventListener('click', async () => {
  try {
    if (!state.wallet) throw new Error('请先登录');
    const title = document.getElementById('title').value;
    const description = document.getElementById('description').value;
    const predictionType = document.getElementById('predictionType').value;
    const endTime = document.getElementById('endTime').value;
    const outcomesRaw = document.getElementById('outcomes').value.trim();
    const outcomes = outcomesRaw ? outcomesRaw.split(',').map((x) => x.trim()).filter(Boolean) : undefined;

    const result = await api('/markets', {
      method: 'POST',
      body: JSON.stringify({ title, description, predictionType, endTime, creatorWallet: state.wallet, outcomes })
    });
    log('创建成功', result);
    await refreshMarkets();
  } catch (err) {
    log(`创建失败: ${err.message}`);
  }
});

document.getElementById('approveBtn').addEventListener('click', async () => {
  const id = document.getElementById('adminMarketId').value.trim();
  try {
    const result = await api(`/markets/${id}/admin-review`, { method: 'POST', body: JSON.stringify({ approve: true }) });
    log('审核通过', result);
    await refreshMarkets();
  } catch (err) {
    log(`审核失败: ${err.message}`);
  }
});

document.getElementById('rejectBtn').addEventListener('click', async () => {
  const id = document.getElementById('adminMarketId').value.trim();
  try {
    const result = await api(`/markets/${id}/admin-review`, { method: 'POST', body: JSON.stringify({ approve: false }) });
    log('审核拒绝', result);
    await refreshMarkets();
  } catch (err) {
    log(`审核失败: ${err.message}`);
  }
});

document.getElementById('finalizeBtn').addEventListener('click', async () => {
  const id = document.getElementById('finalMarketId').value.trim();
  const finalResult = document.getElementById('finalResult').value.trim();
  try {
    const result = await api(`/markets/${id}/finalize`, { method: 'POST', body: JSON.stringify({ finalResult }) });
    log('结算完成', result);
    await refreshMarkets();
  } catch (err) {
    log(`结算失败: ${err.message}`);
  }
});

document.getElementById('saveAiBtn').addEventListener('click', async () => {
  const apiBaseUrl = document.getElementById('aiBaseUrl').value.trim();
  const model = document.getElementById('aiModel').value.trim();
  try {
    const result = await api('/admin/ai-config', { method: 'PUT', body: JSON.stringify({ apiBaseUrl, model }) });
    log('AI配置已更新', result);
  } catch (err) {
    log(`AI配置更新失败: ${err.message}`);
  }
});

document.getElementById('refreshBtn').addEventListener('click', refreshMarkets);
refreshMarkets().catch((e) => log(`初始化失败: ${e.message}`));

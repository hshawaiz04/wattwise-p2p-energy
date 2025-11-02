// frontend/script.js — stable final version
const SOCKET_URL = 'http://localhost:4000';
let socket;

// UI element refs
let flatsDiv, tradesDiv, ledgerDiv, controlsDiv, chainDiv, leaderboardDiv;
let elTotalGen, elTotalDem, elTotalEC, elPrice;

// Chart reference
let energyChart;
let flats = {};
let cumulativeEC = 0;

// Wait for DOM ready
window.addEventListener('DOMContentLoaded', () => {
  try {
    // Cache DOM elements
    flatsDiv = document.getElementById('flats');
    tradesDiv = document.getElementById('trades');
    ledgerDiv = document.getElementById('ledger');
    controlsDiv = document.getElementById('controls');
    chainDiv = document.getElementById('chainViz');
    leaderboardDiv = document.getElementById('leaderboard');
    elTotalGen = document.getElementById('totalGen');
    elTotalDem = document.getElementById('totalDem');
    elTotalEC = document.getElementById('totalEC');
    elPrice = document.getElementById('price');

    // Initialize Chart
    const canvas = document.getElementById('energyChart');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      energyChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            { label: 'Energy Generated (kWh)', borderColor: '#c084fc', borderWidth: 2, fill: false, data: [] },
            { label: 'Energy Consumed (kWh)', borderColor: '#facc15', borderWidth: 2, fill: false, data: [] },
            { label: 'EC Traded', borderColor: '#38bdf8', borderWidth: 2, borderDash: [4, 3], fill: false, data: [] }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#fff' } } },
          scales: { x: { ticks: { color: '#aaa' } }, y: { ticks: { color: '#facc15' } } }
        }
      });
    } else {
      console.warn('energyChart canvas not found.');
    }

    // Initialize socket
    if (typeof io === 'undefined') {
      console.error('Socket.io client not loaded!');
      return;
    }

    socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });

    socket.on('connect', () => console.log('Socket connected:', socket.id));
    socket.on('disconnect', () => console.log('Socket disconnected'));

    socket.on('init', (data) => {
      flats = data.flats || {};
      updateFlats(flats);
      updateLedger(data.ledgerHead);
      buildControls();
      refreshChain();
      updateLeaderboard(flats);
      updateHeaderTotals(flats, data.trades || []);
    });

    socket.on('state', (data) => {
      flats = data.flats || {};
      const trades = Array.isArray(data.trades) ? data.trades : [];
      updateFlats(flats);
      updateLedger(data.ledgerHead);
      if (trades.length) trades.forEach(addTrade);
      refreshChain();
      updateLeaderboard(flats);
      updateHeaderTotals(flats, trades);
      updateChart({ flats, trades });
    });
  } catch (err) {
    console.error('INIT ERROR:', err);
  }
});

function makeEl(tag, cls = '', html = '') {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"'`=\/]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    "'": '&#39;', '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;'
  }[c]));
}

function updateFlats(flatsObj) {
  if (!flatsDiv) return;
  flatsDiv.innerHTML = '';
  Object.values(flatsObj).forEach(f => {
    const socPercent = Math.max(0, Math.min(100, (f.soc_kwh / f.battery_capacity_kwh) * 100 || 0));
    const card = makeEl('div', 'p-3 rounded-lg border border-gray-700 bg-black hover:border-lilac transition text-sm');
    card.innerHTML = `
      <div class='flex justify-between mb-1'>
        <div class='font-semibold text-yellowish'>${escapeHtml(f.id)}</div>
        <div class='text-xs text-gray-400'>${(Number(f.credits) || 0).toFixed(2)} EC</div>
      </div>
      <div>Generated: <b class='text-lilac'>${Number(f.generation_kw).toFixed(3)}</b> kWh</div>
      <div>Consumed: <b class='text-yellowish'>${Number(f.demand_kw).toFixed(3)}</b> kWh</div>
      <div>Battery SoC: ${(f.soc_kwh || 0).toFixed(3)} / ${f.battery_capacity_kwh} kWh</div>
      <div class="w-full bg-gray-800 rounded-full h-2 mt-2">
        <div class="bg-lilac h-2 rounded-full transition-all duration-700" style="width:${socPercent}%"></div>
      </div>`;
    flatsDiv.appendChild(card);
  });
}

function addTrade(t) {
  if (!tradesDiv) return;
  const ecVal = parseFloat(t.energy_credits ?? t.energyCredits ?? 0) || 0;
  const amt = Number(t.amount_kwh ?? t.amount ?? 0) || 0;
  const div = makeEl('div', 'p-2 border border-gray-700 rounded bg-black hover:border-yellowish transition');
  div.innerHTML = `
    <div class="font-medium text-lilac">${escapeHtml(t.seller)} → ${escapeHtml(t.buyer)}</div>
    <div class="text-xs text-gray-400">${amt.toFixed(3)} kWh • ${ecVal.toFixed(3)} EC • ${new Date(t.timestamp).toLocaleTimeString()}</div>
  `;
  tradesDiv.prepend(div);
  while (tradesDiv.children.length > 20) tradesDiv.removeChild(tradesDiv.lastChild);
}

function updateLedger(head) {
  if (!ledgerDiv) return;
  if (!head) { ledgerDiv.textContent = 'No ledger yet'; return; }
  ledgerDiv.innerHTML = `
    <div>Timestamp: <span class="text-yellowish">${new Date(head.timestamp).toLocaleString()}</span></div>
    <div>Hash: <code class="text-gray-400 break-all">${escapeHtml(head.hash)}</code></div>
    <div>Trades in block: <span class="text-lilac">${head.trades?.length || 0}</span></div>`;
}

function buildControls() {
  if (!controlsDiv) return;
  controlsDiv.innerHTML = '';
  const btnValidate = makeEl('button', 'px-3 py-1 rounded bg-transparent border border-gray-600 text-xs text-gray-300 mr-2', 'Validate Ledger');
  btnValidate.onclick = async () => {
    const res = await fetch(`${SOCKET_URL}/api/ledger`);
    const chain = await res.json();
    const valid = await validateChain(chain);
    alert(valid ? 'Ledger OK ✅' : 'Ledger INVALID ❌');
  };
  controlsDiv.appendChild(btnValidate);

  Object.keys(flats).forEach(id => {
    const b1 = makeEl('button', 'px-3 py-1 rounded bg-yellowish text-black text-xs font-semibold hover:bg-lilac hover:text-white transition mr-2', `Boost ${id}`);
    b1.onclick = () => triggerScript('spike', id);
    const b2 = makeEl('button', 'px-3 py-1 rounded bg-lilac text-black text-xs font-semibold hover:bg-yellowish hover:text-black transition mr-2', `Load ${id}`);
    b2.onclick = () => triggerScript('drain', id);
    controlsDiv.appendChild(b1);
    controlsDiv.appendChild(b2);
  });
}

async function refreshChain() {
  if (!chainDiv) return;
  const res = await fetch(`${SOCKET_URL}/api/ledger`);
  const chain = await res.json();
  chainDiv.innerHTML = '';
  chain.forEach(block => {
    const box = makeEl('div', 'px-3 py-2 bg-gray-900 border border-lilac rounded-lg text-xs text-gray-300 hover:bg-lilac hover:text-black transition');
    box.innerHTML = `<div class="font-bold text-yellowish">#${block.index}</div>
      <div>${String(block.hash).slice(0, 8)}...</div>
      <div class="text-gray-500">Tx: ${block.trades.length}</div>`;
    chainDiv.appendChild(box);
  });
}

function updateLeaderboard(flatsObj) {
  if (!leaderboardDiv) return;
  leaderboardDiv.innerHTML = '';
  const sorted = Object.values(flatsObj).sort((a, b) => (b.credits || 0) - (a.credits || 0)).slice(0, 5);
  sorted.forEach((f, i) => {
    const entry = makeEl('div', 'flex justify-between items-center py-1 border-b border-gray-800');
    entry.innerHTML = `<span class="text-lilac font-medium">#${i + 1} ${escapeHtml(f.id)}</span>
      <span class="text-yellowish font-semibold">${(Number(f.credits) || 0).toFixed(2)} EC</span>`;
    leaderboardDiv.appendChild(entry);
  });
}

function updateHeaderTotals(flatsObj, tradesArray) {
  const totalGen = Object.values(flatsObj).reduce((s, f) => s + (f.generation_kw || 0), 0);
  const totalDem = Object.values(flatsObj).reduce((s, f) => s + (f.demand_kw || 0), 0);
  const tickEC = (tradesArray || []).reduce((s, t) => s + (parseFloat(t.energy_credits ?? t.energyCredits ?? 0) || 0), 0);
  cumulativeEC += tickEC;
  if (elTotalGen) elTotalGen.textContent = totalGen.toFixed(2);
  if (elTotalDem) elTotalDem.textContent = totalDem.toFixed(2);
  if (elTotalEC) elTotalEC.textContent = cumulativeEC.toFixed(2);
  if (elPrice) elPrice.textContent = `${totalGen.toFixed(2)} EC`;
}

function updateChart(data) {
  if (!energyChart) return;
  const time = new Date().toLocaleTimeString();
  const totalGen = Object.values(data.flats || {}).reduce((s, f) => s + (f.generation_kw || 0), 0);
  const totalDem = Object.values(data.flats || {}).reduce((s, f) => s + (f.demand_kw || 0), 0);
  const tickEC = (data.trades || []).reduce((s, t) => s + (parseFloat(t.energy_credits ?? t.energyCredits ?? 0) || 0), 0);

  const chartData = energyChart.data;
  chartData.labels.push(time);
  chartData.datasets[0].data.push(totalGen);
  chartData.datasets[1].data.push(totalDem);
  chartData.datasets[2].data.push(tickEC);

  if (chartData.labels.length > 15) {
    chartData.labels.shift();
    chartData.datasets.forEach(ds => ds.data.shift());
  }
  energyChart.update();
}

async function triggerScript(action, flatId) {
  await fetch(`${SOCKET_URL}/api/script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, flatId, value: action === 'spike' ? 6 : 3.5 })
  });
}

async function computeSha256Hex(str) {
  const enc = new TextEncoder();
  const data = enc.encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function validateChain(chain) {
  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1];
    const cur = chain[i];
    if (cur.prevHash !== prev.hash) return false;
    const concat = cur.prevHash + JSON.stringify(cur.trades) + cur.timestamp + cur.nonce;
    const recomputed = await computeSha256Hex(concat);
    if (recomputed !== cur.hash) return false;
  }
  return true;
}

// backend/server.js
// Stable demo backend for WattWise IEM (CommonJS)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---------- state ----------
const numFlats = 8;
let flats = {};
for (let i = 1; i <= numFlats; i++) {
  flats[`F${i}`] = {
    id: `F${i}`,
    generation_kw: Number((Math.random() * 3).toFixed(6)),
    demand_kw: Number((Math.random() * 3).toFixed(6)),
    battery_capacity_kwh: 5,
    soc_kwh: Number((2 + Math.random() * 2).toFixed(6)),
    credits: Number((10 + Math.random() * 90).toFixed(6)),
  };
}

let ledger = [
  { index: 0, prevHash: '0', timestamp: Date.now(), trades: [], nonce: 0, hash: 'genesis' }
];

function sha256(str) { return crypto.createHash('sha256').update(String(str)).digest('hex'); }
function addBlock(trades) {
  const prev = ledger[ledger.length - 1];
  const nonce = Math.floor(Math.random() * 1e6);
  const timestamp = Date.now();
  const concat = prev.hash + JSON.stringify(trades) + timestamp + nonce;
  const hash = sha256(concat);
  const block = { index: ledger.length, prevHash: prev.hash, timestamp, trades, nonce, hash };
  ledger.push(block);
  console.log(`ADDBLOCK #${block.index} tx:${trades.length} hash:${block.hash.slice(0,8)}...`);
}

function pickSellerBuyer() {
  const keys = Object.keys(flats);
  if (keys.length < 2) return null;
  let s = keys[Math.floor(Math.random() * keys.length)];
  let b = keys[Math.floor(Math.random() * keys.length)];
  let tries = 0;
  while (s === b && tries < 10) {
    b = keys[Math.floor(Math.random() * keys.length)];
    tries++;
  }
  if (s === b) return null;
  return { seller: flats[s], buyer: flats[b] };
}

function forceTrade(tradesCollector) {
  const pair = pickSellerBuyer();
  if (!pair) return;
  const { seller, buyer } = pair;
  const amount = Number((0.05 + Math.random() * 0.45).toFixed(6)); // kWh
  const ec = Number(amount); // 1 EC = 1 kWh

  if ((buyer.credits || 0) < ec) {
    // demo top-up
    Object.values(flats).forEach(f => f.credits = Number((Number(f.credits || 0) + 20).toFixed(6)));
  }

  if ((buyer.credits || 0) < ec) return;

  seller.credits = Number((Number(seller.credits || 0) + ec).toFixed(6));
  buyer.credits = Number((Number(buyer.credits || 0) - ec).toFixed(6));

  tradesCollector.push({
    tradeId: `T${Date.now()}-${Math.floor(Math.random()*1000)}`,
    seller: seller.id,
    buyer: buyer.id,
    amount_kwh: Number(amount.toFixed(6)),
    energy_credits: Number(ec.toFixed(6)),
    timestamp: Date.now()
  });
}

function simulateMarketTick() {
  Object.values(flats).forEach(f => {
    f.generation_kw = Number(Math.max(0, f.generation_kw + (Math.random() - 0.5) * 0.5).toFixed(6));
    f.demand_kw = Number(Math.max(0, f.demand_kw + (Math.random() - 0.5) * 0.5).toFixed(6));
    const net = f.generation_kw - f.demand_kw;
    f.soc_kwh = Number(Math.max(0, Math.min(f.battery_capacity_kwh, f.soc_kwh + net * 0.02)).toFixed(6));
  });

  const trades = [];
  let attempts = 0;
  while (attempts < 6 && trades.length < 1) { forceTrade(trades); attempts++; }
  for (let i = 0; i < 2; i++) forceTrade(trades);

  if (trades.length > 0) addBlock(trades);
  try { io.emit('state', { flats, trades, ledgerHead: ledger[ledger.length - 1] }); }
  catch (e) { console.error('emit error', e); }
}

app.post('/api/script', (req, res) => {
  const { action, flatId, value } = req.body || {};
  const flat = flats[flatId];
  if (!flat) return res.status(404).json({ error: 'Flat not found' });
  if (action === 'spike') flat.generation_kw = Number((flat.generation_kw + Number(value || 0)).toFixed(6));
  else if (action === 'drain') flat.demand_kw = Number((flat.demand_kw + Number(value || 0)).toFixed(6));
  else return res.status(400).json({ error: 'unknown action' });
  return res.json({ success: true, flat });
});

app.post('/api/trade', (req, res) => {
  const { seller: sId, buyer: bId, amount } = req.body || {};
  if (!sId || !bId || typeof amount !== 'number') return res.status(400).json({ error: 'missing seller/buyer/amount (number)'});
  const seller = flats[sId];
  const buyer = flats[bId];
  if (!seller || !buyer) return res.status(404).json({ error: 'seller or buyer not found' });
  const ec = Number(amount);
  if ((buyer.credits || 0) < ec) return res.status(400).json({ error: 'buyer has insufficient credits' });

  seller.credits = Number((Number(seller.credits || 0) + ec).toFixed(6));
  buyer.credits = Number((Number(buyer.credits || 0) - ec).toFixed(6));
  const trade = {
    tradeId: `M${Date.now()}`,
    seller: sId,
    buyer: bId,
    amount_kwh: Number(ec.toFixed(6)),
    energy_credits: Number(ec.toFixed(6)),
    timestamp: Date.now()
  };
  addBlock([trade]);
  io.emit('state', { flats, trades: [trade], ledgerHead: ledger[ledger.length - 1] });
  return res.json({ success: true, trade });
});

app.get('/api/ledger', (req, res) => res.json(ledger));
app.get('/api/flats', (req, res) => res.json(flats));

io.on('connection', socket => {
  console.log('CLIENT CONNECTED', socket.id);
  socket.emit('init', { flats, trades: [], ledgerHead: ledger[ledger.length - 1] });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`⚡ IEM backend running on ${PORT}`));
setInterval(simulateMarketTick, 2000);

const state = { broker: [], allBroker: [], ohlc: new Map(), symbols: new Map(), commodities: [] };
const el = {
  body: document.querySelector('#differenceBody'), empty: document.querySelector('#emptyState'), count: document.querySelector('#rowCount'), note: document.querySelector('#coverageNote'), brokerFilter: document.querySelector('#brokerFilter'),
  summarySentence: document.querySelector('#summarySentence'), strategyWinShare: document.querySelector('#strategyWinShare'), brokerWinShare: document.querySelector('#brokerWinShare'), concentrationNote: document.querySelector('#concentrationNote'),
  strategyWins: document.querySelector('#strategyWins'), brokerWins: document.querySelector('#brokerWins'), tieCount: document.querySelector('#tieCount'), strategyAverage: document.querySelector('#strategyAverage'), brokerAverage: document.querySelector('#brokerAverage'), excessReturn: document.querySelector('#excessReturn'), updated: document.querySelector('#updatedAt'), winnerFilter: document.querySelector('#winnerFilter'), commodityBody: document.querySelector('#commodityBody'), commodityEmpty: document.querySelector('#commodityEmpty')
};

function parseCsv(text) {
  const rows = []; let row = []; let value = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && text[index + 1] === '"' && quoted) { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { row.push(value.trim()); value = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) { if (character === '\r' && text[index + 1] === '\n') index += 1; row.push(value.trim()); if (row.some(cell => cell)) rows.push(row); row = []; value = ''; }
    else value += character;
  }
  if (value || row.length) { row.push(value.trim()); rows.push(row); }
  return rows;
}

function number(value) { const parsed = Number.parseFloat(String(value).replace('%', '')); return Number.isFinite(parsed) ? parsed : null; }
function dateValue(value) {
  const text = String(value || '').trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const dmy = text.match(/^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/);
  if (dmy) {
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(dmy[2].toLowerCase());
    if (month >= 0) return new Date(Number(dmy[3]), month, Number(dmy[1]));
  }
  const parsed = new Date(text); return Number.isNaN(parsed.valueOf()) ? null : parsed;
}
function normaliseBroker(rows) { return rows.slice(1).filter(row => row[2] && row[2] !== 'Company').map(row => ({ recommendation: row[0] || 'Unrated', date: row[1], company: row[2], broker: row[3] || 'ICICI Direct', upside: number(row[7]) })).filter(row => row.company); }

function calculateStrategyReturn(rows, startDate, period) {
  const ordered = rows.slice().sort((a, b) => dateValue(a.date) - dateValue(b.date));
  const startIndex = ordered.findIndex(row => dateValue(row.date) >= startDate);
  if (startIndex < 0 || ordered.length - startIndex < 2) return null;
  let cash = 100; let shares = 0; let inPosition = false;
  ordered.slice(Math.max(0, startIndex - period), ordered.length).forEach((row, index, simulationRows) => {
    const absoluteIndex = Math.max(0, startIndex - period) + index;
    const prior = ordered.slice(Math.max(0, absoluteIndex - period), absoluteIndex).map(item => item.close).filter(value => Number.isFinite(value));
    if (prior.length < period || absoluteIndex < startIndex) return;
    const average = prior.reduce((sum, value) => sum + value, 0) / prior.length;
    if (!inPosition && row.close > average) { shares = cash / row.close; cash = 0; inPosition = true; }
    else if (inPosition && row.close < average) { cash = shares * row.close; shares = 0; inPosition = false; }
  });
  const finalClose = ordered[ordered.length - 1].close; const finalValue = inPosition ? shares * finalClose : cash;
  return ((finalValue - 100) / 100) * 100;
}

function buyAndHoldReturn(rows, startDate) {
  const ordered = rows.slice().sort((a, b) => dateValue(a.date) - dateValue(b.date));
  const startIndex = ordered.findIndex(row => dateValue(row.date) >= startDate);
  if (startIndex < 0 || ordered.length - startIndex < 2) return null;
  return ((ordered[ordered.length - 1].close / ordered[startIndex].close) - 1) * 100;
}

function crossoverReturn(rows, startDate, fast, slow) {
  const ordered = rows.slice().sort((a, b) => dateValue(a.date) - dateValue(b.date));
  const startIndex = ordered.findIndex(row => dateValue(row.date) >= startDate);
  if (startIndex < 0 || ordered.length - startIndex < 2) return null;
  let cash = 100; let shares = 0; let inPosition = false;
  ordered.slice(startIndex).forEach((row, index) => {
    const absoluteIndex = startIndex + index;
    const fastValues = ordered.slice(Math.max(0, absoluteIndex - fast), absoluteIndex).map(item => item.close);
    const slowValues = ordered.slice(Math.max(0, absoluteIndex - slow), absoluteIndex).map(item => item.close);
    if (fastValues.length < fast || slowValues.length < slow) return;
    const fastAverage = fastValues.reduce((sum, value) => sum + value, 0) / fast;
    const slowAverage = slowValues.reduce((sum, value) => sum + value, 0) / slow;
    if (!inPosition && fastAverage > slowAverage) { shares = cash / row.close; cash = 0; inPosition = true; }
    else if (inPosition && fastAverage < slowAverage) { cash = shares * row.close; shares = 0; inPosition = false; }
  });
  const finalClose = ordered[ordered.length - 1].close; const finalValue = inPosition ? shares * finalClose : cash;
  return ((finalValue - 100) / 100) * 100;
}

function momentumReturn(rows, startDate, lookback, threshold) {
  const ordered = rows.slice().sort((a, b) => dateValue(a.date) - dateValue(b.date));
  const startIndex = ordered.findIndex(row => dateValue(row.date) >= startDate);
  if (startIndex < 0 || ordered.length - startIndex < 2) return null;
  let cash = 100; let shares = 0; let inPosition = false;
  ordered.slice(startIndex).forEach((row, index) => {
    const absoluteIndex = startIndex + index; const previous = ordered[absoluteIndex - lookback];
    if (!previous) return;
    const momentum = ((row.close / previous.close) - 1) * 100;
    if (!inPosition && momentum > threshold) { shares = cash / row.close; cash = 0; inPosition = true; }
    else if (inPosition && momentum < 0) { cash = shares * row.close; shares = 0; inPosition = false; }
  });
  const finalClose = ordered[ordered.length - 1].close; const finalValue = inPosition ? shares * finalClose : cash;
  return ((finalValue - 100) / 100) * 100;
}

function rsiReturn(rows, startDate, period, buyBelow, sellAbove) {
  const ordered = rows.slice().sort((a, b) => dateValue(a.date) - dateValue(b.date));
  const startIndex = ordered.findIndex(row => dateValue(row.date) >= startDate);
  if (startIndex < 0 || ordered.length - startIndex < 2) return null;
  let cash = 100; let shares = 0; let inPosition = false;
  ordered.slice(startIndex).forEach((row, index) => {
    const absoluteIndex = startIndex + index; const changes = ordered.slice(Math.max(1, absoluteIndex - period + 1), absoluteIndex + 1).map((item, changeIndex, values) => item.close - ordered[Math.max(0, absoluteIndex - period + changeIndex)].close);
    if (changes.length < period) return;
    const gains = changes.filter(change => change > 0).reduce((sum, change) => sum + change, 0) / period;
    const losses = changes.filter(change => change < 0).reduce((sum, change) => sum - change, 0) / period;
    const rsi = losses === 0 ? 100 : 100 - (100 / (1 + (gains / losses)));
    if (!inPosition && rsi < buyBelow) { shares = cash / row.close; cash = 0; inPosition = true; }
    else if (inPosition && rsi > sellAbove) { cash = shares * row.close; shares = 0; inPosition = false; }
  });
  const finalClose = ordered[ordered.length - 1].close; const finalValue = inPosition ? shares * finalClose : cash;
  return ((finalValue - 100) / 100) * 100;
}

function bollingerReturn(rows, startDate, period, deviation) {
  const ordered = rows.slice().sort((a, b) => dateValue(a.date) - dateValue(b.date));
  const startIndex = ordered.findIndex(row => dateValue(row.date) >= startDate);
  if (startIndex < 0 || ordered.length - startIndex < 2) return null;
  let cash = 100; let shares = 0; let inPosition = false;
  ordered.slice(startIndex).forEach((row, index) => {
    const absoluteIndex = startIndex + index; const values = ordered.slice(Math.max(0, absoluteIndex - period), absoluteIndex).map(item => item.close);
    if (values.length < period) return;
    const average = values.reduce((sum, value) => sum + value, 0) / period; const standardDeviation = Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / period); const lower = average - deviation * standardDeviation; const upper = average + deviation * standardDeviation;
    if (!inPosition && row.close < lower) { shares = cash / row.close; cash = 0; inPosition = true; }
    else if (inPosition && row.close > upper) { cash = shares * row.close; shares = 0; inPosition = false; }
  });
  const finalClose = ordered[ordered.length - 1].close; const finalValue = inPosition ? shares * finalClose : cash;
  return ((finalValue - 100) / 100) * 100;
}

function fibonacciReturn(rows, startDate, lookback, retracement) {
  const ordered = rows.slice().sort((a, b) => dateValue(a.date) - dateValue(b.date));
  const startIndex = ordered.findIndex(row => dateValue(row.date) >= startDate);
  if (startIndex < 0 || ordered.length - startIndex < 2) return null;
  let cash = 100; let shares = 0; let inPosition = false;
  ordered.slice(startIndex).forEach((row, index) => {
    const absoluteIndex = startIndex + index; const history = ordered.slice(Math.max(0, absoluteIndex - lookback), absoluteIndex).map(item => item.close);
    if (history.length < lookback) return;
    const high = Math.max(...history); const low = Math.min(...history); const level = high - (high - low) * retracement;
    if (!inPosition && row.close <= level) { shares = cash / row.close; cash = 0; inPosition = true; }
    else if (inPosition && row.close >= high) { cash = shares * row.close; shares = 0; inPosition = false; }
  });
  const finalClose = ordered[ordered.length - 1].close; const finalValue = inPosition ? shares * finalClose : cash;
  return ((finalValue - 100) / 100) * 100;
}

function bestStrategy(rows, startDate) {
  const smaPeriods = Array.from({ length: 199 }, (_, index) => index + 2);
  const candidates = [
    ...smaPeriods.map(period => ({ label: `SMA ${period}`, profit: calculateStrategyReturn(rows, startDate, period) })),
    { label: 'Buy & hold', profit: buyAndHoldReturn(rows, startDate) },
    ...[[5, 20], [10, 30], [20, 50]].map(([fast, slow]) => ({ label: `${fast}/${slow} crossover`, profit: crossoverReturn(rows, startDate, fast, slow) })),
    ...[5, 10, 20, 60].flatMap(lookback => [0, 2, 5].map(threshold => ({ label: `${lookback}D momentum > ${threshold}%`, profit: momentumReturn(rows, startDate, lookback, threshold) }))),
    ...[7, 14, 21].flatMap(period => [[30, 70], [35, 65], [40, 60]].map(([buyBelow, sellAbove]) => ({ label: `RSI ${period} (${buyBelow}/${sellAbove})`, profit: rsiReturn(rows, startDate, period, buyBelow, sellAbove) }))),
    ...[10, 20, 50].flatMap(period => [1.5, 2].map(deviation => ({ label: `Bollinger ${period} (${deviation}σ)`, profit: bollingerReturn(rows, startDate, period, deviation) }))),
    ...[20, 50, 100].flatMap(lookback => [0.382, 0.5, 0.618].map(retracement => ({ label: `Fibonacci ${lookback}D (${(retracement * 100).toFixed(1)}%)`, profit: fibonacciReturn(rows, startDate, lookback, retracement) })))
  ];
  return candidates.filter(result => result.profit !== null).sort((a, b) => b.profit - a.profit)[0] || null;
}

function isBrokerBuy(row) { return /^(buy|strong buy|accumulate|add|outperform)$/i.test(row.recommendation.trim()); }

function selectOutOfSampleRule(calls) {
  const dates = [...new Set(calls.map(row => row.dayKey))].sort();
  if (dates.length < 8) return null;
  const splitDay = dates[Math.floor(dates.length * 0.7)];
  const earlierCalls = calls.filter(row => row.dayKey < splitDay);
  const holdout = calls.filter(row => row.dayKey >= splitDay);
  if (earlierCalls.length < 10 || holdout.length < 5) return null;
  const validationDates = [...new Set(earlierCalls.map(row => row.dayKey))].sort();
  const validationStart = validationDates[Math.floor(validationDates.length * 0.65)];
  const validation = earlierCalls.filter(row => row.dayKey >= validationStart);
  if (validation.length < 5) return null;
  const runRule = (rule, call) => {
    if (Number.isFinite(rule.minimumUpside) && (!Number.isFinite(call.upside) || call.upside < rule.minimumUpside)) return 0;
    const eligiblePrices = call.prices.filter(price => dateValue(price.date) <= call.horizonEnd);
    return rule.run(eligiblePrices, call.callDate);
  };
  const candidates = comparisonStrategies().map(rule => {
    const returns = validation.map(call => runRule(rule, call)).filter(Number.isFinite);
    return { ...rule, score: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null, trainingCount: returns.length };
  }).filter(rule => rule.score !== null && rule.trainingCount >= 5).sort((a, b) => b.score - a.score);
  if (!candidates.length) return null;
  const rule = candidates[0];
  const rows = holdout.map(call => {
    const strategyProfit = runRule(rule, call);
    const brokerProfit = buyAndHoldReturn(call.prices.filter(price => dateValue(price.date) <= call.horizonEnd), call.callDate);
    if (!Number.isFinite(strategyProfit) || !Number.isFinite(brokerProfit)) return null;
    return { ...call, strategyProfit, brokerProfit, strategyLabel: rule.label };
  }).filter(Boolean);
  return { rows, splitDay, trainingCount: rule.trainingCount, holdoutCount: rows.length, rule: rule.label, horizon: 60 };
}

function renderCommodities(rows) {
  const grouped = new Map();
  rows.slice(1).forEach(row => { if (!row[0] || !row[2]) return; const list = grouped.get(row[0]) || []; list.push({ date: row[2], close: number(row[6]) }); grouped.set(row[0], list); });
  state.commodities = [...grouped.entries()].map(([commodity, prices]) => { const ordered = prices.sort((a, b) => dateValue(a.date) - dateValue(b.date)); const start = dateValue(ordered[Math.floor(ordered.length / 2)].date); const best = bestStrategy(ordered, start); return { commodity, symbol: rows.find(row => row[0] === commodity)?.[1] || '—', close: ordered[ordered.length - 1].close, best }; }).filter(result => result.best);
  renderCommodityRows();
}

function renderCommodityRows() {
  const investment = 100000; const allocation = state.commodities.length ? investment / state.commodities.length : 0; const money = value => `₹${Math.round(value).toLocaleString('en-IN')}`;
  el.commodityBody.innerHTML = state.commodities.map(result => { const value = allocation * (1 + result.best.profit / 100); const profitLoss = value - allocation; return `<tr><td class="company">${result.commodity}</td><td class="mono">${result.symbol}</td><td class="mono">No recommendation</td><td class="mono">${result.close.toFixed(2)}</td><td class="profit ${result.best.profit >= 0 ? 'positive' : 'negative'}">${result.best.profit >= 0 ? '+' : ''}${result.best.profit.toFixed(1)}%</td><td class="mono">${money(value)}</td><td class="profit ${profitLoss >= 0 ? 'positive' : 'negative'}">${profitLoss >= 0 ? '+' : ''}${money(profitLoss)}</td><td><span class="difference-pill neutral">Strategy only</span></td><td class="mono">${result.best.label}</td></tr>`; }).join(''); el.commodityEmpty.classList.toggle('hidden', state.commodities.length > 0);
}

function formatDay(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function adjusted(price) { return Number.isFinite(price.adjustedClose) ? price.adjustedClose : price.close; }
function exponentialAverage(values, period) {
  const multiplier = 2 / (period + 1); const result = [];
  values.forEach((value, index) => { result.push(index === 0 ? value : value * multiplier + result[index - 1] * (1 - multiplier)); });
  return result;
}
function addTechnicalIndicators(prices) {
  const closes = prices.map(adjusted); const fast = exponentialAverage(closes, 12); const slow = exponentialAverage(closes, 26);
  const macd = closes.map((_, index) => fast[index] - slow[index]); const signal = exponentialAverage(macd, 9);
  const trueRanges = Array(prices.length).fill(0); const positiveMoves = Array(prices.length).fill(0); const negativeMoves = Array(prices.length).fill(0);
  for (let index = 1; index < prices.length; index += 1) {
    const current = prices[index]; const previous = prices[index - 1]; const previousClose = adjusted(previous);
    trueRanges[index] = Math.max(current.high - current.low, Math.abs(current.high - previousClose), Math.abs(current.low - previousClose));
    const up = current.high - previous.high; const down = previous.low - current.low;
    positiveMoves[index] = up > down && up > 0 ? up : 0;
    negativeMoves[index] = down > up && down > 0 ? down : 0;
  }
  const adx = Array(prices.length).fill(null); const period = 14;
  if (prices.length > period * 2) {
    let smoothedRange = trueRanges.slice(1, period + 1).reduce((sum, value) => sum + value, 0);
    let smoothedPositive = positiveMoves.slice(1, period + 1).reduce((sum, value) => sum + value, 0);
    let smoothedNegative = negativeMoves.slice(1, period + 1).reduce((sum, value) => sum + value, 0);
    let initialDx = 0; let dxCount = 0;
    for (let index = period; index < prices.length; index += 1) {
      if (index > period) {
        smoothedRange += trueRanges[index] - smoothedRange / period;
        smoothedPositive += positiveMoves[index] - smoothedPositive / period;
        smoothedNegative += negativeMoves[index] - smoothedNegative / period;
      }
      const plusDi = smoothedRange > 0 ? 100 * smoothedPositive / smoothedRange : 0;
      const minusDi = smoothedRange > 0 ? 100 * smoothedNegative / smoothedRange : 0;
      const diTotal = plusDi + minusDi; const dx = diTotal > 0 ? 100 * Math.abs(plusDi - minusDi) / diTotal : 0;
      if (dxCount < period) {
        initialDx += dx; dxCount += 1;
        if (dxCount === period) adx[index] = initialDx / period;
      } else {
        adx[index] = (adx[index - 1] * (period - 1) + dx) / period;
      }
    }
  }
  prices.forEach((price, index) => { price.macdBullish = macd[index] > signal[index]; price.adx14 = adx[index]; });
}
function firstIndexAfter(prices, date) {
  let low = 0; let high = prices.length;
  while (low < high) { const mid = (low + high) >> 1; if (dateValue(prices[mid].date) <= date) low = mid + 1; else high = mid; }
  return low < prices.length ? low : -1;
}
function strategySignal(prices, entryIndex) {
  const signalIndex = entryIndex - 1;
  if (signalIndex < 199) return null;
  const closes = prices.slice(0, signalIndex + 1).map(adjusted);
  const price = closes[signalIndex];
  const sma50 = closes.slice(signalIndex - 49, signalIndex + 1).reduce((sum, value) => sum + value, 0) / 50;
  const sma200 = closes.slice(signalIndex - 199, signalIndex + 1).reduce((sum, value) => sum + value, 0) / 200;
  const momentum = price / closes[signalIndex - 126] - 1;
  const signal = prices[signalIndex];
  if (!(price > sma50 && sma50 > sma200 && momentum > 0 && signal.macdBullish && signal.adx14 >= 20)) return null;
  return momentum;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function comparisonRows() {
  const chosenBroker = el.brokerFilter.value;
  const sourceRows = chosenBroker === 'all' ? state.allBroker : state.allBroker.filter(row => row.broker === chosenBroker);
  const byDate = new Map();
  sourceRows.filter(isBrokerBuy).forEach(row => {
    const callDate = dateValue(row.date); const symbol = state.symbols.get(row.company);
    if (!callDate || !symbol) return;
    const dayKey = formatDay(callDate); const group = byDate.get(dayKey) || { date: callDate, dayKey, calls: new Map() };
    const existing = group.calls.get(symbol) || { company: row.company, symbol, brokers: new Set() };
    existing.brokers.add(row.broker); group.calls.set(symbol, existing); byDate.set(dayKey, group);
  });

  const rows = [];
  byDate.forEach(group => {
    const brokerBasket = [];
    group.calls.forEach(call => {
      const prices = state.ohlc.get(call.symbol) || []; const entryIndex = firstIndexAfter(prices, group.date);
      if (entryIndex < 0 || entryIndex + 60 >= prices.length) return;
      const start = adjusted(prices[entryIndex]); const end = adjusted(prices[entryIndex + 60]);
      if (!(start > 0) || !(end > 0)) return;
      brokerBasket.push({ ...call, profit: ((end / start) - 1) * 100 - 0.2 });
    });
    if (!brokerBasket.length) return;

    const candidates = [];
    state.ohlc.forEach((prices, symbol) => {
      const entryIndex = firstIndexAfter(prices, group.date);
      if (entryIndex < 0 || entryIndex + 60 >= prices.length) return;
      const momentum = strategySignal(prices, entryIndex);
      if (!Number.isFinite(momentum)) return;
      const start = adjusted(prices[entryIndex]); const end = adjusted(prices[entryIndex + 60]);
      if (!(start > 0) || !(end > 0)) return;
      candidates.push({ symbol, company: prices[0]?.company || symbol, momentum, profit: ((end / start) - 1) * 100 - 0.2 });
    });
    candidates.sort((a, b) => b.momentum - a.momentum);
    const picked = candidates.slice(0, brokerBasket.length);
    if (picked.length !== brokerBasket.length) return;
    const strategyProfit = picked.reduce((sum, item) => sum + item.profit, 0) / brokerBasket.length;
    const brokerProfit = brokerBasket.reduce((sum, item) => sum + item.profit, 0) / brokerBasket.length;
    rows.push({ ...group, brokerBasket, picked, strategyProfit, brokerProfit, candidates: candidates.length, unfilled: 0 });
  });
  return rows.sort((a, b) => a.date - b.date);
}

function render() {
  const allRows = comparisonRows();
  const strategyWins = allRows.filter(row => row.strategyProfit - row.brokerProfit > 0.05).length;
  const brokerWins = allRows.filter(row => row.brokerProfit - row.strategyProfit > 0.05).length;
  const tiedDates = allRows.length - strategyWins - brokerWins;
  const rows = el.winnerFilter.value === 'strategy' ? allRows.filter(row => row.strategyProfit - row.brokerProfit > 0.05) : el.winnerFilter.value === 'broker' ? allRows.filter(row => row.brokerProfit - row.strategyProfit > 0.05) : el.winnerFilter.value === 'tie' ? allRows.filter(row => Math.abs(row.strategyProfit - row.brokerProfit) <= 0.05) : allRows;
  const average = key => allRows.length ? allRows.reduce((sum, row) => sum + row[key], 0) / allRows.length : null;
  const strategyAverage = average('strategyProfit'); const brokerAverage = average('brokerProfit');
  const excess = Number.isFinite(strategyAverage) && Number.isFinite(brokerAverage) ? strategyAverage - brokerAverage : null;
  const brokerCount = new Set(state.allBroker.map(row => row.broker)).size;
  const symbolsCount = state.ohlc.size;
  const firstDate = allRows[0]?.dayKey || '—'; const lastDate = allRows[allRows.length - 1]?.dayKey || '—';
  el.strategyWins.textContent = strategyWins; el.brokerWins.textContent = brokerWins; el.tieCount.textContent = tiedDates;
  el.strategyWinShare.textContent = allRows.length ? `${(100 * strategyWins / allRows.length).toFixed(1)}%` : '—';
  el.brokerWinShare.textContent = allRows.length ? `${(100 * brokerWins / allRows.length).toFixed(1)}%` : '—';
  el.strategyAverage.textContent = Number.isFinite(strategyAverage) ? `${strategyAverage.toFixed(1)}%` : '—';
  el.brokerAverage.textContent = Number.isFinite(brokerAverage) ? `${brokerAverage.toFixed(1)}%` : '—';
  el.excessReturn.textContent = Number.isFinite(excess) ? `${excess >= 0 ? '+' : ''}${excess.toFixed(1)} pp` : '—';
  el.summarySentence.textContent = allRows.length && Number.isFinite(strategyAverage) && Number.isFinite(brokerAverage) ? `Across ${allRows.length} matched dates, the strategy had the higher return on ${strategyWins} (${(100 * strategyWins / allRows.length).toFixed(1)}%). Its mean 60-session return was ${strategyAverage.toFixed(1)}%, compared with ${brokerAverage.toFixed(1)}% for the broker baskets.` : 'No matched report dates currently have enough price history for this comparison.';
  el.count.textContent = `${rows.length} report dates`;
  const selectionCounts = new Map(); allRows.forEach(row => row.picked.forEach(item => selectionCounts.set(item.symbol, (selectionCounts.get(item.symbol) || 0) + 1)));
  const topPick = [...selectionCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  el.concentrationNote.textContent = topPick ? `The most repeatedly selected stock is ${topPick[0]}, appearing in ${topPick[1]} of ${allRows.length} date baskets. Those repeated outcomes can have a large effect on the averages.` : 'No strategy picks are available for the current filter.';
  el.note.textContent = allRows.length ? `${allRows.length} matched report dates (${firstDate} to ${lastDate}); ${state.allBroker.length.toLocaleString('en-IN')} recommendation records from ${brokerCount} broker feeds; adjusted OHLC history for ${symbolsCount.toLocaleString('en-IN')} symbols.` : 'No matched Buy calls currently have the required history and complete 60-session return window.';
  el.body.innerHTML = rows.slice(0, 250).map(row => {
    const difference = row.strategyProfit - row.brokerProfit; const tie = Math.abs(difference) <= 0.05;
    const winner = tie ? 'Tie' : difference > 0 ? 'Strategy' : 'Broker';
    const pillClass = tie ? 'neutral' : difference > 0 ? '' : 'negative';
    const brokerNames = row.brokerBasket.map(item => `${escapeHtml(item.company)} (${escapeHtml([...item.brokers].join(', '))})`).join('<br>');
    const strategyNames = row.picked.map(item => `${escapeHtml(String(item.company).replace(/\s+/g, ' ').trim())} <span class="mono">${escapeHtml(item.symbol)}</span>`).join('<br>') || 'Cash';
    return `<tr><td class="mono">${row.dayKey}</td><td class="mono">${row.brokerBasket.length}</td><td class="company">${brokerNames}</td><td class="company">${strategyNames}${row.unfilled ? `<br>Cash × ${row.unfilled}` : ''}</td><td class="profit ${row.strategyProfit >= 0 ? 'positive' : 'negative'}">${row.strategyProfit.toFixed(1)}%</td><td class="profit ${row.brokerProfit >= 0 ? 'positive' : 'negative'}">${row.brokerProfit.toFixed(1)}%</td><td class="profit ${difference >= 0 ? 'positive' : 'negative'}">${difference >= 0 ? '+' : ''}${difference.toFixed(1)} pp</td><td><span class="difference-pill ${pillClass}">${winner}</span></td></tr>`;
  }).join('');
  el.empty.classList.toggle('hidden', rows.length > 0);
  el.empty.textContent = rows.length ? '' : 'No report dates match these filters and have a complete 60-session price window.';
  el.updated.textContent = `Updated ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`;
}
Promise.all([fetch('brokerage_reports.csv').then(response => response.text()), fetch('ohlc_data.csv').then(response => response.text()), fetch('ticker_resolution.csv').then(response => response.text()), fetch('commodities_ohlc.csv').then(response => response.text())]).then(([brokerText, ohlcText, resolutionText, commodityText]) => {
  state.broker = normaliseBroker(parseCsv(brokerText)); state.allBroker = state.broker;
  [...new Set(state.allBroker.map(row => row.broker))].sort().forEach(broker => { const option = document.createElement('option'); option.value = broker; option.textContent = broker; el.brokerFilter.append(option); });
  parseCsv(resolutionText).slice(1).forEach(row => { if (row[0] && row[1] && row[3] && row[3].startsWith('ok')) state.symbols.set(row[0], row[1]); });
  parseCsv(ohlcText).slice(1).forEach(row => { if (!row[1] || !row[2]) return; const list = state.ohlc.get(row[1]) || []; const close = number(row[6]); const adjustedClose = number(row[7]) ?? close; const adjustment = close > 0 ? adjustedClose / close : 1; list.push({ company: row[0], symbol: row[1], date: row[2], close, adjustedClose, high: number(row[4]) * adjustment, low: number(row[5]) * adjustment }); state.ohlc.set(row[1], list); });
  state.ohlc.forEach(prices => { prices.sort((a, b) => dateValue(a.date) - dateValue(b.date)); addTechnicalIndicators(prices); });
  renderCommodities(parseCsv(commodityText)); el.winnerFilter.addEventListener('change', render); el.brokerFilter.addEventListener('change', render); render();
}).catch(error => { el.empty.textContent = `Could not load comparison data: ${error.message}`; });

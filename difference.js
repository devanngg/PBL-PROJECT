const state = { broker: [], ohlc: new Map(), symbols: new Map(), commodities: [] };
const el = {
  body: document.querySelector('#differenceBody'), empty: document.querySelector('#emptyState'), count: document.querySelector('#rowCount'), note: document.querySelector('#coverageNote'),
  strategyWins: document.querySelector('#strategyWins'), brokerWins: document.querySelector('#brokerWins'), strategyAverage: document.querySelector('#strategyAverage'), brokerAverage: document.querySelector('#brokerAverage'), updated: document.querySelector('#updatedAt'), winnerFilter: document.querySelector('#winnerFilter'), investment: document.querySelector('#investmentAmount'), portfolioMode: document.querySelector('#portfolioMode'), investmentHelp: document.querySelector('#investmentHelp'), strategyCapital: document.querySelector('#strategyCapital'), brokerCapital: document.querySelector('#brokerCapital'), roiComparison: document.querySelector('#roiComparison'), capitalDifference: document.querySelector('#capitalDifference'), strategyCapitalProfit: document.querySelector('#strategyCapitalProfit'), brokerCapitalProfit: document.querySelector('#brokerCapitalProfit'), capitalHeading: document.querySelector('#capitalHeading'), commodityBody: document.querySelector('#commodityBody'), commodityEmpty: document.querySelector('#commodityEmpty')
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
function dateValue(value) { const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? null : parsed; }
function normaliseBroker(rows) { return rows.slice(1).filter(row => row[2] && row[2] !== 'Company').map(row => ({ recommendation: row[0] || 'Unrated', date: row[1], company: row[2], upside: number(row[6]) })).filter(row => row.company); }

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

function renderCommodities(rows) {
  const grouped = new Map();
  rows.slice(1).forEach(row => { if (!row[0] || !row[2]) return; const list = grouped.get(row[0]) || []; list.push({ date: row[2], close: number(row[6]) }); grouped.set(row[0], list); });
  state.commodities = [...grouped.entries()].map(([commodity, prices]) => { const ordered = prices.sort((a, b) => dateValue(a.date) - dateValue(b.date)); const start = dateValue(ordered[Math.floor(ordered.length / 2)].date); const best = bestStrategy(ordered, start); return { commodity, symbol: rows.find(row => row[0] === commodity)?.[1] || '—', close: ordered[ordered.length - 1].close, best }; }).filter(result => result.best);
  renderCommodityRows();
}

function renderCommodityRows() {
  const investment = Math.max(1000, Number(el.investment.value) || 100000); const allocation = state.commodities.length ? investment / state.commodities.length : 0; const money = value => `₹${Math.round(value).toLocaleString('en-IN')}`;
  el.commodityBody.innerHTML = state.commodities.map(result => { const value = allocation * (1 + result.best.profit / 100); const profitLoss = value - allocation; return `<tr><td class="company">${result.commodity}</td><td class="mono">${result.symbol}</td><td class="mono">No recommendation</td><td class="mono">${result.close.toFixed(2)}</td><td class="profit ${result.best.profit >= 0 ? 'positive' : 'negative'}">${result.best.profit >= 0 ? '+' : ''}${result.best.profit.toFixed(1)}%</td><td class="mono">${money(value)}</td><td class="profit ${profitLoss >= 0 ? 'positive' : 'negative'}">${profitLoss >= 0 ? '+' : ''}${money(profitLoss)}</td><td><span class="difference-pill neutral">Strategy only</span></td><td class="mono">${result.best.label}</td></tr>`; }).join(''); el.commodityEmpty.classList.toggle('hidden', state.commodities.length > 0);
}

function comparisonRows() {
  return state.broker.map(row => {
    const symbol = state.symbols.get(row.company); const prices = state.ohlc.get(symbol) || [];
    const strategy = symbol && row.upside !== null ? bestStrategy(prices, dateValue(row.date)) : null;
    return { ...row, symbol, strategyProfit: strategy ? strategy.profit : null, strategyLabel: strategy ? strategy.label : null, brokerProfit: row.upside };
  }).filter(row => row.strategyProfit !== null && row.brokerProfit !== null).sort((a, b) => (b.strategyProfit - b.brokerProfit) - (a.strategyProfit - a.brokerProfit));
}

function render() {
  const allRows = comparisonRows(); const strategyWins = allRows.filter(row => row.strategyProfit > row.brokerProfit).length; const brokerWins = allRows.filter(row => row.brokerProfit > row.strategyProfit).length;
  const rows = el.winnerFilter.value === 'strategy' ? allRows.filter(row => row.strategyProfit > row.brokerProfit) : el.winnerFilter.value === 'broker' ? allRows.filter(row => row.brokerProfit > row.strategyProfit) : allRows;
  const investment = Math.max(1000, Number(el.investment.value) || 100000); const perStockMode = el.portfolioMode.value === 'per-stock'; const strategyPortfolioRows = perStockMode ? allRows.filter(row => row.strategyProfit > row.brokerProfit) : allRows; const brokerPortfolioRows = allRows; const allocation = allRows.length ? investment / allRows.length : 0; const strategyCapital = strategyPortfolioRows.reduce((sum, row) => sum + (perStockMode ? investment : allocation) * (1 + row.strategyProfit / 100), 0); const brokerCapital = brokerPortfolioRows.reduce((sum, row) => sum + (perStockMode ? investment : allocation) * (1 + row.brokerProfit / 100), 0); const strategyInvested = perStockMode ? strategyPortfolioRows.length * investment : investment; const brokerInvested = perStockMode ? brokerPortfolioRows.length * investment : investment; const difference = strategyCapital - brokerCapital; const money = value => `₹${Math.round(value).toLocaleString('en-IN')}`;
  const average = key => allRows.length ? `${(allRows.reduce((sum, row) => sum + row[key], 0) / allRows.length).toFixed(1)}%` : '—';
  el.strategyWins.textContent = strategyWins; el.brokerWins.textContent = brokerWins; el.strategyAverage.textContent = average('strategyProfit'); el.brokerAverage.textContent = average('brokerProfit'); el.count.textContent = `${rows.length} matched calls`; el.note.textContent = `${rows.length} recommendations matched to daily OHLC data; sorted by strategy advantage.`;
  const strategyRoi = strategyInvested ? ((strategyCapital - strategyInvested) / strategyInvested) * 100 : 0; const brokerRoi = brokerInvested ? ((brokerCapital - brokerInvested) / brokerInvested) * 100 : 0;
  el.capitalHeading.textContent = perStockMode ? `${money(investment)} per qualifying stock` : `${money(investment)} total portfolio capital`; el.investmentHelp.textContent = perStockMode ? `${strategyPortfolioRows.length} strategy-qualified stocks vs ${brokerPortfolioRows.length} broker recommendations.` : `${money(investment)} total, split equally across matched recommendations.`; el.strategyCapital.textContent = money(strategyCapital); el.brokerCapital.textContent = money(brokerCapital); el.roiComparison.textContent = `${strategyRoi.toFixed(1)}% vs ${brokerRoi.toFixed(1)}%`; el.capitalDifference.textContent = `${difference >= 0 ? '+' : '-'}${money(Math.abs(difference))}`; el.strategyCapitalProfit.textContent = `${money(strategyCapital - strategyInvested)} profit on ${money(strategyInvested)} invested`; el.brokerCapitalProfit.textContent = `${money(brokerCapital - brokerInvested)} profit on ${money(brokerInvested)} invested`;
  el.body.innerHTML = rows.slice(0, 250).map(row => { const percentageDifference = row.strategyProfit - row.brokerProfit; const strategyValue = allocation * (1 + row.strategyProfit / 100); const brokerValue = allocation * (1 + row.brokerProfit / 100); const strategyWon = percentageDifference > 0; const tie = Math.abs(percentageDifference) < .05; const winner = tie ? 'Tie' : strategyWon ? 'Your strategy' : 'ICICI broker'; const pillClass = tie ? 'neutral' : strategyWon ? '' : 'negative'; return `<tr><td class="company" title="${row.company}">${row.company}</td><td class="view ${row.recommendation.toLowerCase()}">${row.recommendation}</td><td class="mono">${row.date}</td><td class="profit ${row.brokerProfit >= 0 ? 'positive' : 'negative'}">${row.brokerProfit.toFixed(1)}%</td><td class="profit ${row.strategyProfit >= 0 ? 'positive' : 'negative'}">${row.strategyProfit.toFixed(1)}%</td><td class="mono">${money(brokerValue)}</td><td class="mono">${money(strategyValue)}</td><td class="profit ${percentageDifference >= 0 ? 'positive' : 'negative'}">${percentageDifference >= 0 ? '+' : ''}${percentageDifference.toFixed(1)}%</td><td><span class="difference-pill ${pillClass}">${winner}</span></td></tr>`; }).join('');
  el.empty.classList.toggle('hidden', rows.length > 0); el.empty.textContent = rows.length ? '' : 'No strategy wins were found in the matched data.'; el.updated.textContent = `Updated ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`;
}

Promise.all([fetch('icicidirect.csv').then(response => response.text()), fetch('ohlc_data.csv').then(response => response.text()), fetch('ticker_resolution.csv').then(response => response.text()), fetch('commodities_ohlc.csv').then(response => response.text())]).then(([brokerText, ohlcText, resolutionText, commodityText]) => {
  state.broker = normaliseBroker(parseCsv(brokerText));
  parseCsv(resolutionText).slice(1).forEach(row => { if (row[0] && row[1] && row[3] && row[3].startsWith('ok')) state.symbols.set(row[0], row[1]); });
  parseCsv(ohlcText).slice(1).forEach(row => { if (!row[1] || !row[2]) return; const list = state.ohlc.get(row[1]) || []; list.push({ date: row[2], close: number(row[6]) }); state.ohlc.set(row[1], list); });
  renderCommodities(parseCsv(commodityText)); el.winnerFilter.addEventListener('change', render); el.portfolioMode.addEventListener('change', render); el.investment.addEventListener('input', () => { render(); renderCommodityRows(); }); render();
}).catch(error => { el.empty.textContent = `Could not load comparison data: ${error.message}`; });
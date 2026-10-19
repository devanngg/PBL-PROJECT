const state = { rows: [], allRows: [] };
const fallbackCsv = `"Recommendation","Date","Company","Research Link","Current Price","Target Price","Upside"
${""}`;

const els = {
  file: document.querySelector('#fileInput'), source: document.querySelector('#sourceName'), count: document.querySelector('#rowCount'),
  strategy: document.querySelector('#strategySelect'), threshold: document.querySelector('#threshold'), brokerSelect: document.querySelector('#brokerSelect'), run: document.querySelector('#runButton'),
  body: document.querySelector('#resultsBody'), empty: document.querySelector('#emptyState'), rule: document.querySelector('#ruleSummary'),
  agreement: document.querySelector('#agreementMetric'), agreementFoot: document.querySelector('#agreementFoot'), strategyMetric: document.querySelector('#strategyMetric'),
  broker: document.querySelector('#brokerMetric'), upside: document.querySelector('#upsideMetric'), updated: document.querySelector('#updatedAt'),
  both: document.querySelector('#bothMetric'), strategyOnly: document.querySelector('#strategyOnlyMetric'), brokerOnly: document.querySelector('#brokerOnlyMetric'), neither: document.querySelector('#neitherMetric')
};

function parseCsv(text) {
  return text.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const cells = []; let current = ''; let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && line[index + 1] === '"' && quoted) { current += '"'; index += 1; }
      else if (character === '"') quoted = !quoted;
      else if (character === ',' && !quoted) { cells.push(current.trim()); current = ''; }
      else current += character;
    }
    cells.push(current.trim()); return cells;
  });
}

function normalise(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(cell => String(cell).trim().toLowerCase());
  const findColumn = pattern => headers.findIndex(header => pattern.test(header));
  const isCrossBroker = headers.includes('broker') && headers.includes('research link');
  const columns = isCrossBroker ? {
    recommendation: findColumn(/^recommendation$/), date: findColumn(/^date$/), company: findColumn(/^company$/),
    broker: findColumn(/^broker$/), current: findColumn(/current price/), target: findColumn(/target price/), upside: findColumn(/^upside$/)
  } : { recommendation: 0, date: 1, company: 2, broker: -1, current: 4, target: 5, upside: 6 };
  const value = (cells, key) => columns[key] < 0 ? '' : cells[columns[key]] || '';
  return rows.slice(1).filter(cells => value(cells, 'company') && value(cells, 'company') !== 'Company').map(cells => ({
    recommendation: value(cells, 'recommendation') || 'Unrated', date: value(cells, 'date') || '—', company: value(cells, 'company') || 'Unnamed company', broker: value(cells, 'broker') || 'ICICI Direct',
    current: value(cells, 'current') || '—', target: value(cells, 'target') || '—', upside: value(cells, 'upside') || '—'
  }));
}

function upsideValue(row) { const value = Number.parseFloat(String(row.upside).replace('%', '')); return Number.isFinite(value) ? value : null; }
function cleanPrice(value) { return value === '-' ? '—' : value; }
function isBuy(row) { return /^buy$/i.test(row.recommendation.trim()); }

function strategySignal(row) {
  const threshold = Number(els.threshold.value) || 0; const upside = upsideValue(row);
  if (els.strategy.value === 'buy') return isBuy(row);
  if (els.strategy.value === 'upside') return upside !== null && upside >= threshold;
  return isBuy(row) && upside !== null && upside >= threshold;
}

function render() {
  const selectedBroker = els.brokerSelect.value;
  state.rows = selectedBroker === 'all' ? state.allRows : state.allRows.filter(row => row.broker === selectedBroker);
  const threshold = Number(els.threshold.value) || 0; const rows = state.rows;
  const signals = rows.filter(strategySignal); const brokerBuys = rows.filter(isBuy); const statedUpsides = rows.map(upsideValue).filter(value => value !== null);
  const both = rows.filter(row => strategySignal(row) && isBuy(row)).length;
  const strategyOnly = rows.filter(row => strategySignal(row) && !isBuy(row)).length;
  const brokerOnly = rows.filter(row => !strategySignal(row) && isBuy(row)).length;
  const neither = rows.length - both - strategyOnly - brokerOnly;
  const agreement = rows.length ? Math.round(((both + neither) / rows.length) * 100) : 0;
  els.agreement.textContent = rows.length ? `${agreement}%` : '—'; els.agreementFoot.textContent = rows.length ? `${both + neither} of ${rows.length} rows agree` : 'Run a comparison to calculate';
  els.strategyMetric.textContent = signals.length; els.broker.textContent = brokerBuys.length; els.upside.textContent = statedUpsides.length ? `${Math.round(statedUpsides.reduce((a, b) => a + b, 0) / statedUpsides.length)}%` : '—';
  els.both.textContent = both; els.strategyOnly.textContent = strategyOnly; els.brokerOnly.textContent = brokerOnly; els.neither.textContent = neither;
  els.rule.innerHTML = els.strategy.value === 'buy' ? 'Broker recommendation is Buy' : `${els.strategy.value === 'upside' ? 'Target upside' : 'Broker Buy + upside'} &ge; ${threshold}%`;
  els.body.innerHTML = rows.map(row => { const mine = strategySignal(row); const broker = isBuy(row); const result = mine && broker ? ['Both agree', ''] : mine ? ['Strategy only', 'review'] : broker ? ['Broker only', 'review'] : ['Neither', 'none']; return `<tr><td class="company" title="${row.company}">${row.company}</td><td class="mono">${row.date}</td><td>${row.broker}</td><td class="view ${row.recommendation.toLowerCase()}">${row.recommendation || 'Unrated'}</td><td class="mono">${cleanPrice(row.current)}</td><td class="mono">${cleanPrice(row.target)}</td><td class="mono">${row.upside === '-' ? '—' : row.upside}</td><td><span class="signal-pill ${mine ? '' : 'none'}">${mine ? 'Entry signal' : 'No entry'}</span></td><td><span class="read"><i class="${result[1]}"></i>${result[0]}</span></td></tr>`; }).join('');
  els.empty.classList.toggle('hidden', rows.length > 0); els.empty.textContent = rows.length ? '' : 'No rows found. Import a CSV or XLSX file to begin.';
  els.updated.textContent = `Updated ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`;
}

async function importFile(file) {
  if (!file) return;
  if (/\.xlsx?$/i.test(file.name) && window.XLSX) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    state.allRows = normalise(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' }));
  } else state.allRows = normalise(parseCsv(await file.text()));
  els.brokerSelect.innerHTML = '<option value="all">All brokerages</option>';
  [...new Set(state.allRows.map(row => row.broker))].sort().forEach(broker => { const option = document.createElement('option'); option.value = broker; option.textContent = broker; els.brokerSelect.append(option); });
  els.source.textContent = file.name; els.count.textContent = `${state.rows.length} rows`; render();
}

els.file.addEventListener('change', event => importFile(event.target.files[0]));
els.run.addEventListener('click', render); els.strategy.addEventListener('change', render);
els.threshold.addEventListener('input', render);
els.brokerSelect.addEventListener('change', render);
fetch('brokerage_reports.csv').then(response => { if (!response.ok) throw new Error(`Could not load brokerage_reports.csv (${response.status})`); return response.text(); }).then(text => {
  state.allRows = normalise(parseCsv(text));
  const brokers = [...new Set(state.allRows.map(row => row.broker))].sort();
  brokers.forEach(broker => { const option = document.createElement('option'); option.value = broker; option.textContent = broker; els.brokerSelect.append(option); });
  els.source.textContent = 'brokerage_reports.csv'; els.count.textContent = `${state.allRows.length} rows`; render();
}).catch(error => { els.count.textContent = 'Data unavailable'; els.empty.textContent = `${error.message}. Open this project through a local web server.`; render(); });

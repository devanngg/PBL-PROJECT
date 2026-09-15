const state = { rows: [] };
const fallbackCsv = `"Recommendation","Date","Company","Research Link","Current Price","Target Price","Upside"
${""}`;

const els = {
  file: document.querySelector('#fileInput'), source: document.querySelector('#sourceName'), count: document.querySelector('#rowCount'),
  strategy: document.querySelector('#strategySelect'), threshold: document.querySelector('#threshold'), run: document.querySelector('#runButton'),
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
  const headerLike = rows[0].some(cell => /recommend|company|date|target|upside/i.test(cell));
  const start = headerLike ? 1 : 1;
  return rows.slice(start).filter(cells => cells[2] && cells[2] !== 'Company').map(cells => ({
    recommendation: cells[0] || 'Unrated', date: cells[1] || '—', company: cells[2] || 'Unnamed company',
    current: cells[4] || '—', target: cells[5] || '—', upside: cells[6] || '—'
  })).filter(row => row.company && row.company !== 'Unnamed company');
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
  els.body.innerHTML = rows.slice(0, 100).map(row => { const mine = strategySignal(row); const broker = isBuy(row); const result = mine && broker ? ['Both agree', ''] : mine ? ['Strategy only', 'review'] : broker ? ['Broker only', 'review'] : ['Neither', 'none']; return `<tr><td class="company" title="${row.company}">${row.company}</td><td class="mono">${row.date}</td><td class="view ${row.recommendation.toLowerCase()}">${row.recommendation || 'Unrated'}</td><td class="mono">${cleanPrice(row.current)}</td><td class="mono">${cleanPrice(row.target)}</td><td class="mono">${row.upside === '-' ? '—' : row.upside}</td><td><span class="signal-pill ${mine ? '' : 'none'}">${mine ? 'Entry signal' : 'No entry'}</span></td><td><span class="read"><i class="${result[1]}"></i>${result[0]}</span></td></tr>`; }).join('');
  els.empty.classList.toggle('hidden', rows.length > 0); els.empty.textContent = rows.length ? '' : 'No rows found. Import a CSV or XLSX file to begin.';
  els.updated.textContent = `Updated ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`;
}

async function importFile(file) {
  if (!file) return;
  if (/\.xlsx?$/i.test(file.name) && window.XLSX) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    state.rows = normalise(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: '' }));
  } else state.rows = normalise(parseCsv(await file.text()));
  els.source.textContent = file.name; els.count.textContent = `${state.rows.length} rows`; render();
}

els.file.addEventListener('change', event => importFile(event.target.files[0]));
els.run.addEventListener('click', render); els.strategy.addEventListener('change', render);
els.threshold.addEventListener('input', render);
fetch('icicidirect.csv').then(response => response.text()).then(text => { state.rows = normalise(parseCsv(text)); els.count.textContent = `${state.rows.length} rows`; render(); }).catch(() => render());
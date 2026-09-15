import csv
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "commodities_ohlc.csv"
COMMODITIES = {"Gold": "GC=F", "Silver": "SI=F", "Crude Oil": "CL=F"}


def get_json(url):
    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def download(label, symbol):
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=730)
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?period1={int(start.timestamp())}&period2={int(end.timestamp())}&interval=1d&events=history"
    result = get_json(url)["chart"]["result"][0]
    quote = result["indicators"]["quote"][0]
    rows = []
    for index, timestamp in enumerate(result.get("timestamp", [])):
        close = quote.get("close", [None])[index]
        if close is None:
            continue
        rows.append({"commodity": label, "symbol": symbol, "date": datetime.fromtimestamp(timestamp, timezone.utc).date().isoformat(), "open": quote["open"][index], "high": quote["high"][index], "low": quote["low"][index], "close": close, "volume": quote.get("volume", [None])[index]})
    return rows


with OUTPUT.open("w", newline="", encoding="utf-8") as target:
    fields = ["commodity", "symbol", "date", "open", "high", "low", "close", "volume"]
    writer = csv.DictWriter(target, fieldnames=fields)
    writer.writeheader()
    for label, symbol in COMMODITIES.items():
        rows = download(label, symbol)
        writer.writerows(rows)
        print(f"{label}: {len(rows)} rows")
print(f"Saved commodity data to {OUTPUT.name}")
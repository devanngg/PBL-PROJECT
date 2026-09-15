import csv
import json
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
INPUT = ROOT / "icicidirect.csv"
OHLC_OUTPUT = ROOT / "ohlc_data.csv"
RESOLUTION_OUTPUT = ROOT / "ticker_resolution.csv"
SEARCH_URL = "https://query1.finance.yahoo.com/v1/finance/search?q={}&quotesCount=10&newsCount=0"
CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{}?period1={}&period2={}&interval=1d&events=history"


def request_json(url):
    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(request, timeout=20) as response:
        return json.load(response)


def read_company_names():
    names = set()
    with INPUT.open(newline="", encoding="utf-8-sig") as source:
        for row in csv.reader(source):
            if len(row) > 2 and row[2].strip() and row[2].strip() != "Company":
                names.add(row[2].strip())
    return sorted(names)


def search_symbol(company):
    search_name = re.sub(r":\s*IPO$", "", company, flags=re.IGNORECASE)
    data = request_json(SEARCH_URL.format(quote(search_name)))
    quotes = data.get("quotes", [])
    nse = [quote_data for quote_data in quotes if quote_data.get("symbol", "").endswith(".NS")]
    if nse:
        return nse[0].get("symbol"), nse[0].get("shortname", "")
    return None, ""


def fetch_ohlc(symbol, company, start, end):
    data = request_json(CHART_URL.format(symbol, int(start.timestamp()), int(end.timestamp())))
    result = data["chart"]["result"][0]
    timestamps = result.get("timestamp", [])
    quote_data = result["indicators"]["quote"][0]
    adjusted = result.get("indicators", {}).get("adjclose", [{}])[0].get("adjclose", [])
    rows = []
    for index, timestamp in enumerate(timestamps):
        values = {key: quote_data.get(key, [None] * len(timestamps))[index] for key in ("open", "high", "low", "close", "volume")}
        if values["close"] is None:
            continue
        rows.append({"company": company, "symbol": symbol, "date": datetime.fromtimestamp(timestamp, timezone.utc).date().isoformat(), **values, "adj_close": adjusted[index] if index < len(adjusted) else values["close"]})
    return rows


def main():
    if not INPUT.exists():
        raise SystemExit(f"Missing input file: {INPUT}")
    companies = read_company_names()
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=730)
    resolutions = []
    resolution_by_company = {}
    if RESOLUTION_OUTPUT.exists():
        with RESOLUTION_OUTPUT.open(newline="", encoding="utf-8") as source:
            for row in csv.DictReader(source):
                resolution_by_company[row["company"]] = row
        resolutions = list(resolution_by_company.values())
    downloaded_symbols = set()
    if OHLC_OUTPUT.exists():
        with OHLC_OUTPUT.open(newline="", encoding="utf-8") as source:
            downloaded_symbols = {row["symbol"] for row in csv.DictReader(source)}
    ohlc_fields = ["company", "symbol", "date", "open", "high", "low", "close", "adj_close", "volume"]
    ohlc_mode = "a" if OHLC_OUTPUT.exists() else "w"
    ohlc_file = OHLC_OUTPUT.open("a", newline="", encoding="utf-8")
    ohlc_writer = csv.DictWriter(ohlc_file, fieldnames=ohlc_fields)
    if ohlc_mode == "w":
        ohlc_writer.writeheader()
    print(f"Resolving {len(companies)} company names and downloading daily OHLC data...")
    for position, company in enumerate(companies, 1):
        cached = resolution_by_company.get(company)
        if cached and (cached["status"].startswith("ok") or cached["status"] == "unresolved"):
            print(f"[{position}/{len(companies)}] cached: {company}")
            continue
        try:
            symbol, matched_name = search_symbol(company)
            if not symbol:
                resolution_by_company[company] = {"company": company, "symbol": "", "matched_name": "", "status": "unresolved"}
                print(f"[{position}/{len(companies)}] unresolved: {company}")
            elif symbol in downloaded_symbols:
                resolution_by_company[company] = {"company": company, "symbol": symbol, "matched_name": matched_name, "status": "ok (cached OHLC)"}
                print(f"[{position}/{len(companies)}] cached OHLC: {company} -> {symbol}")
            else:
                rows = fetch_ohlc(symbol, company, start, end)
                ohlc_writer.writerows(rows)
                ohlc_file.flush()
                downloaded_symbols.add(symbol)
                resolution_by_company[company] = {"company": company, "symbol": symbol, "matched_name": matched_name, "status": f"ok ({len(rows)} rows)"}
                print(f"[{position}/{len(companies)}] {company} -> {symbol} ({len(rows)} rows)")
        except Exception as error:
            resolution_by_company[company] = {"company": company, "symbol": "", "matched_name": "", "status": f"error: {error}"}
            print(f"[{position}/{len(companies)}] error: {company}: {error}")
        with RESOLUTION_OUTPUT.open("w", newline="", encoding="utf-8") as target:
            writer = csv.DictWriter(target, fieldnames=["company", "symbol", "matched_name", "status"])
            writer.writeheader()
            writer.writerows(resolution_by_company.values())
        time.sleep(0.15)
    ohlc_file.close()
    resolutions = list(resolution_by_company.values())
    row_count = sum(1 for _ in OHLC_OUTPUT.open(encoding="utf-8")) - 1
    print(f"Saved {row_count} OHLC rows to {OHLC_OUTPUT.name}")
    print(f"Saved ticker review to {RESOLUTION_OUTPUT.name}")


if __name__ == "__main__":
    main()
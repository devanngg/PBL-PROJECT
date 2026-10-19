#!/usr/bin/env python3
"""Refresh a public cross-broker recommendation snapshot from Trendlyne."""
import csv
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
import html
import os
import re
import tempfile
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "brokerage_reports.csv"
BASE = "https://trendlyne.com/research-reports/broker/{}/"
INDEX_URL = "https://trendlyne.com/research-reports/"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; SignalLedger/1.0; research comparison)"
}

class ReportParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], None, None
        self.in_body = False
        self.saw_report_body = False
        self.in_cell = False
        self.cells = []
        self.symbol = ""

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "tbody" and attrs.get("id") == "allreportsbody":
            self.in_body = True
            self.saw_report_body = True
        elif self.in_body and tag == "tr":
            self.cells = []
            self.symbol = ""
        elif self.in_body and tag == "td":
            self.in_cell = True
            self.cell = []
        elif self.in_body and self.in_cell and tag == "a" and len(self.cells) == 2:
            match = re.search(r"/research-reports/stock/\d+/([^/]+)/", attrs.get("href", ""))
            if match:
                self.symbol = match.group(1)
        elif self.in_body and self.in_cell and tag == "br":
            self.cell.append(" ")

    def handle_data(self, data):
        if self.in_body and self.in_cell:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if self.in_body and tag == "td" and self.in_cell:
            value = re.sub(r"\s+", " ", html.unescape(" ".join(self.cell))).strip()
            self.cells.append(value)
            self.in_cell = False
        elif self.in_body and tag == "tr":
            # The data table columns: summary, date, stock, broker, LTP,
            # target, price-at-recommendation, upside, recommendation, report.
            if len(self.cells) >= 9:
                self.cells.append(self.symbol)
                self.rows.append(self.cells)
        elif tag == "tbody" and self.in_body:
            self.in_body = False


def fetch(broker, cutoff):
    records = []
    for page_no in range(1, 101):
        url = BASE.format(urllib.parse.quote(broker, safe="")) + (f"?page={page_no}" if page_no > 1 else "")
        page = None
        for attempt in range(4):
            try:
                request = urllib.request.Request(url, headers=HEADERS)
                with urllib.request.urlopen(request, timeout=30) as response:
                    page = response.read().decode("utf-8", "replace")
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(1.5 * (attempt + 1))
        parser = ReportParser()
        parser.feed(page)
        if not parser.saw_report_body:
            raise RuntimeError("Broker report table was missing; source may be blocked or changed")
        if not parser.rows:
            break
        page_dates = []
        for cells in parser.rows:
            date_text, company, author = cells[1], cells[2], cells[3]
            try:
                page_dates.append(datetime.strptime(date_text, "%d %b %Y").date())
            except ValueError:
                pass
            ltp, target, at_reco, upside, recommendation = cells[4:9]
            symbol = cells[-1] if len(cells) > 12 else ""
            if not company or not author:
                continue
            author = re.sub(r"\s+(?:Reco\s+Target|Target|Reco)$", "", author).strip()
            # Trendlyne appends price-change text to the price-at-recommendation cell.
            price_match = re.match(r"\s*([\d,]+(?:\.\d+)?)", at_reco)
            records.append({
                "Recommendation": recommendation or "Unrated",
                "Date": date_text,
                "Company": company,
                "Broker": author,
                "Research Link": url,
                "Current Price": price_match.group(1).replace(",", "") if price_match else ltp,
                "Target Price": target,
                "Upside": f"{upside}%" if upside and re.fullmatch(r"-?\d+(?:\.\d+)?", upside) else upside,
                "Symbol": symbol,
            })
        if page_dates and min(page_dates) < cutoff:
            break
        time.sleep(0.15)
    else:
        raise RuntimeError("Reached the 100-page safety limit before the feed ended")
    return records


def discover_brokers():
    request = urllib.request.Request(INDEX_URL, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=30) as response:
        page = response.read().decode("utf-8", "replace")
    selector = re.search(r'id="JS_BrokerSelector"[^>]*>(.*?)</select>', page, re.S)
    if not selector:
        raise RuntimeError("Could not find Trendlyne's broker directory")
    return [html.unescape(name).strip() for name in re.findall(r'<option value="([^"]+)"', selector.group(1))]


def main():
    parser = argparse.ArgumentParser(description="Fetch historical broker recommendation data from Trendlyne.")
    parser.add_argument("--years", type=int, default=2, help="How many years of report history to fetch (default: 2).")
    args = parser.parse_args()
    by_key = {}
    errors = []
    cutoff = date.today() - timedelta(days=365 * max(1, min(args.years, 5)))
    try:
        brokers = discover_brokers()
    except Exception as exc:
        print(f"Could not refresh Trendlyne's broker directory: {exc}")
        print(f"The existing snapshot in {OUT.name} was preserved.")
        return
    print(f"Found {len(brokers)} broker pages in the public directory.")
    successful = []
    with ThreadPoolExecutor(max_workers=2) as executor:
        requests = {executor.submit(fetch, broker, cutoff): broker for broker in brokers}
        for future in as_completed(requests):
            broker = requests[future]
            try:
                for row in future.result():
                    try:
                        report_date = datetime.strptime(row["Date"], "%d %b %Y").date()
                    except ValueError:
                        continue
                    if not cutoff <= report_date <= date.today():
                        continue
                    if row["Recommendation"].strip().casefold() not in {
                        "buy", "strong buy", "sell", "strong sell", "hold", "add", "reduce",
                        "accumulate", "neutral", "outperform", "underperform", "market perform",
                    }:
                        continue
                    key = (row["Broker"].casefold(), row["Date"], row["Company"].casefold())
                    by_key[key] = row
                print(f"{broker}: fetched")
                successful.append(broker)
            except Exception as exc:  # record the failure; incomplete refreshes never replace the snapshot
                errors.append(f"{broker}: {exc}")
                print(f"{broker}: unavailable ({exc})")

    if errors or len(successful) != len(brokers):
        print(f"Refusing to replace {OUT.name}: only {len(successful)} of {len(brokers)} broker feeds completed cleanly.")
        print("The existing snapshot was preserved. Retry after Trendlyne is available again.")
        return

    fields = ["Recommendation", "Date", "Company", "Broker", "Research Link", "Current Price", "Target Price", "Upside", "Symbol"]
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile("w", newline="", encoding="utf-8", dir=ROOT, delete=False) as handle:
            temp_path = handle.name
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(sorted(by_key.values(), key=lambda r: (r["Date"], r["Broker"], r["Company"]), reverse=True))
        os.replace(temp_path, OUT)
    finally:
        if temp_path and os.path.exists(temp_path):
            os.unlink(temp_path)
    print(f"Wrote {len(by_key)} unique recommendations to {OUT.name}.")
    if errors:
        print("Some broker pages could not be refreshed; see messages above.")


if __name__ == "__main__":
    main()

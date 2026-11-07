"""Produce reviewable exact-building OneMap evidence; never writes to the DB.

Input: JSON rows with project_name, building, postal_code, n from the bounded
recovery audit. Output preserves raw responses for independent verification.
Only exact block/street matches with a matching source postal code, one
coordinate pair, and Singapore bounds are accepted. No project centroids.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import time
import urllib.parse
import urllib.request
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.transaction_integrity import core


def resolve(building, postal, results, project=None):
    chosen = core.onemap_result_coordinate(building, results)
    if not chosen and project:
        # POIs may share an address. An exact project/building name can
        # disambiguate them, while the block/street and postal checks still apply.
        named = [r for r in results if core.normalize_name(r.get('BUILDING')) == core.normalize_name(project)]
        chosen = core.onemap_result_coordinate(building, named)
    if not chosen or chosen['postal_code'] != postal:
        return None
    if not (1.15 < chosen['latitude'] < 1.5 and 103.55 < chosen['longitude'] < 104.15):
        return None
    return chosen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input')
    parser.add_argument('output')
    args = parser.parse_args()
    rows = json.loads(Path(args.input).read_text())
    saved = json.loads(Path(args.output).read_text()) if Path(args.output).exists() else []
    cached = {}
    for e in saved:
        raw = e.get('response', {})
        if 'error' in e or (raw.get('error') and not raw.get('results')):
            continue
        e['coordinate'] = resolve(e['building'], e['postal_code'], raw.get('results', []), e['project_name']) if raw.get('totalNumPages', 0) <= 1 else None
        cached[(e['project_name'], e['building'], e['postal_code'])] = e
    evidence = list(cached.values())
    for i, row in enumerate(rows):
        if (row['project_name'], row['building'], row['postal_code']) in cached:
            continue
        params = urllib.parse.urlencode(dict(searchVal=row['building'], returnGeom='Y', getAddrDetails='Y', pageNum=1))
        headers = {'User-Agent': 'HomeValue recovery audit'}
        if os.getenv('ONEMAP_TOKEN'):
            headers['Authorization'] = os.environ['ONEMAP_TOKEN']
        try:
            req = urllib.request.Request('https://www.onemap.gov.sg/api/common/elastic/search?' + params, headers=headers)
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(req, timeout=25) as response:
                        raw = json.load(response)
                    break
                except urllib.error.HTTPError as exc:
                    if exc.code != 429 or attempt == 3:
                        raise
                    time.sleep(max(float(exc.headers.get('Retry-After', 0)), 5 * (2 ** attempt)))
            # Refuse incomplete result sets rather than guessing uniqueness.
            coordinate = resolve(row['building'], row['postal_code'], raw.get('results', []), row['project_name']) if raw.get('totalNumPages', 0) <= 1 else None
            evidence.append(dict(row, coordinate=coordinate, response=raw))
        except Exception as exc:
            evidence.append(dict(row, coordinate=None, error=str(exc)))
        Path(args.output).write_text(json.dumps(evidence, indent=2))
        if (i + 1) % 20 == 0:
            print(f'{i + 1}/{len(rows)} buildings checked', flush=True)
        time.sleep(2)
    print(json.dumps(dict(buildings=len(rows), accepted=sum(bool(e.get('coordinate')) for e in evidence), transactions=sum(e['n'] for e in evidence if e.get('coordinate')))))


if __name__ == '__main__':
    main()

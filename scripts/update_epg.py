#!/usr/bin/env python3
"""Download compressed TNT XMLTV, and publish lightweight data + freshness marker."""
import datetime as dt
import gzip
import json
import os
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET

SOURCE = 'https://xmltvfr.fr/xmltv/xmltv_tnt.xml.gz'
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data'
OUT.mkdir(exist_ok=True)
HEADERS = {'User-Agent': 'MonGuideTV/0.4 (+personal TV schedule guide)'}

def request(url, method='GET'):
    return urllib.request.Request(url, method=method, headers=HEADERS)

def find_text(elem, tag):
    el = elem.find(tag)
    return (el.text or '').strip() if el is not None else ''

def parse_date(raw):
    # 20261020150000 +0200 -> timestamp milliseconds
    from datetime import datetime
    value = datetime.strptime(raw[:20], '%Y%m%d%H%M%S %z')
    return int(value.timestamp() * 1000)

def main():
    with urllib.request.urlopen(request(SOURCE), timeout=90) as response:
        compressed = response.read()
        source_last_modified = response.headers.get('Last-Modified', '')
    xml = gzip.decompress(compressed)
    tv = ET.fromstring(xml)
    channels = {}
    for channel in tv.findall('channel'):
        channels[channel.get('id', '')] = {
            'name': find_text(channel, 'display-name'),
            'logo': (channel.find('icon').get('src', '') if channel.find('icon') is not None else '')
        }
    now = dt.datetime.now(dt.timezone.utc)
    low = int((now - dt.timedelta(days=2)).timestamp()*1000)
    high = int((now + dt.timedelta(days=6)).timestamp()*1000)
    programmes = []
    for p in tv.findall('programme'):
        try:
            start = parse_date(p.attrib['start'])
            stop = parse_date(p.attrib['stop'])
        except (KeyError, ValueError):
            continue
        if stop < low or start > high:
            continue
        ep=p.find('episode-num')
        episode = ''
        if ep is not None and ep.text:
            episode=ep.text.strip()
            if ep.get('system') == 'xmltv_ns':
                try:
                    parts=episode.split('.')
                    episode='S%02dE%02d' % (int(parts[0])+1, int(parts[1])+1)
                except (ValueError,IndexError):
                    pass
        programmes.append({
            'channel':p.attrib.get('channel', ''),
            'start':start,'stop':stop,
            'title':find_text(p,'title'),
            'subtitle':find_text(p,'sub-title'),
            'description':find_text(p,'desc'),
            'category':find_text(p,'category'),
            'episode':episode,
            'image': p.find('icon').get('src','') if p.find('icon') is not None else ''
        })
    output={'generatedAt':now.isoformat(),'sourceLastModified':source_last_modified,'channels':channels,'programmes':programmes}
    (OUT/'epg.json').write_text(json.dumps(output,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    meta={'generatedAt':output['generatedAt'],'sourceLastModified':source_last_modified, 'programmeCount':len(programmes)}
    (OUT/'meta.json').write_text(json.dumps(meta,ensure_ascii=False),encoding='utf8')
    print('Saved',len(programmes),'programmes from',len(channels),'channels')

if __name__=='__main__':
    main()

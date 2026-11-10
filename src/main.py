"""Scrape Finn.no homes-for-sale listings from the React Router search payload."""

from __future__ import annotations

import asyncio
import json
import logging
import math
import re
import time
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

from apify import Actor
from scrapling.fetchers import AsyncStealthySession

logging.getLogger('scrapling').setLevel(logging.CRITICAL)

BASE_URL = 'https://www.finn.no'
DEFAULT_START_URL = f'{BASE_URL}/realestate/homes/search.html'
MAX_RETRIES = 5
FETCH_RETRIES = 2
EMPTY_STRING_LITERALS = {'null', 'undefined', 'nan'}
PAGE_TIMEOUT_MS = 60000
FETCH_TIMEOUT_MS = 40000
LISTING_SELECTOR = 'article.sf-search-ad'
DATA_ACCEPT = 'text/x-script; charset=utf-8, */*;q=0.1'
CHALLENGE_PATTERN = re.compile(r'captcha-delivery|ddjskey|datadome|please enable js', re.IGNORECASE)
# Requests are counted where they happen: inside the page fetch helper.
stats = {'requests': 0, 'challenges': 0}


def normalize_whitespace(value) -> str:
    text = '' if not value else str(value)
    return re.sub(r'\s+', ' ', text.replace('\u00a0', ' ')).strip()


def to_absolute_url(value, base: str = BASE_URL):
    if not value:
        return None
    try:
        return urljoin(base, str(value))
    except ValueError:
        return None


def sanitize_url(value):
    url = to_absolute_url(value)
    if not url or re.search(r'undefined|null', url, re.IGNORECASE):
        return None
    return url


def unique_strings(values) -> list:
    return list(dict.fromkeys(normalize_whitespace(value) for value in values if value))


def unique_values(values) -> list:
    deduped = []
    seen = set()

    for value in values:
        if value is None:
            continue

        key = normalize_whitespace(value) if isinstance(value, str) else json.dumps(
            value, ensure_ascii=False, default=str
        )

        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(value)

    return deduped


def prune_record(value):
    if isinstance(value, list):
        cleaned = unique_values([entry for entry in (prune_record(item) for item in value) if entry is not None])
        return cleaned or None

    if isinstance(value, dict):
        cleaned_entries = {
            key: cleaned for key, item in value.items() if (cleaned := prune_record(item)) is not None
        }
        return cleaned_entries or None

    if value is None:
        return None
    if isinstance(value, str):
        normalized = normalize_whitespace(value)
        if normalized.lower() in EMPTY_STRING_LITERALS:
            return None
        return normalized or None

    return value


def count_empty_values(value) -> int:
    if isinstance(value, list):
        return sum(count_empty_values(item) for item in value)
    if isinstance(value, dict):
        return sum(count_empty_values(item) for item in value.values())
    return 1 if value is None or value == '' else 0


def first_number(*values):
    return next(
        (value for value in values if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)),
        None,
    )


def format_money(amount, currency='NOK'):
    if not isinstance(amount, (int, float)) or isinstance(amount, bool) or not math.isfinite(amount):
        return None
    formatted = f'{amount:,.0f}'.replace(',', '\u00a0')
    if currency in (None, '', 'NOK'):
        return f'{formatted} kr'
    return f'{formatted} {currency}'


def js_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def format_date(value):
    if not value:
        return None
    try:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            parsed = datetime.fromtimestamp(value / 1000, tz=timezone.utc)
        else:
            parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
        return js_iso(parsed)
    except (ValueError, OSError, OverflowError):
        return normalize_whitespace(value) or None


def safe_json_parse(value):
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


def rehydrate_references(references):
    if not isinstance(references, list):
        raise RuntimeError('Page payload was not a reference array')

    cache = {}

    def resolve(index, depth=0):
        if depth > 100 or isinstance(index, bool) or not isinstance(index, int) or index < 0 or index >= len(references):
            return None
        if index in cache:
            return cache[index]

        value = references[index]

        if value is None or not isinstance(value, (dict, list)):
            return value

        if isinstance(value, list):
            resolved = []
            cache[index] = resolved
            for entry in value:
                if isinstance(entry, int) and not isinstance(entry, bool):
                    resolved.append(resolve(entry, depth + 1))
                else:
                    resolved.append(entry)
        else:
            resolved = {}
            cache[index] = resolved
            for encoded_key, child_index in value.items():
                try:
                    key_index = int(str(encoded_key)[1:])
                except ValueError:
                    continue
                if key_index < 0 or key_index >= len(references):
                    continue
                key = references[key_index]
                if not isinstance(key, str):
                    continue
                resolved[key] = resolve(child_index, depth + 1)

        cache[index] = resolved
        return resolved

    return resolve(0)


# React Router inlines the same single-fetch stream the legacy .data route
# returns. Each enqueue() argument is a JSON string chunk of one flat array.
def extract_stream_references(html):
    chunks = []
    pattern = re.compile(r'streamController\.enqueue\(("(?:[^"\\]|\\.)*")\)', re.DOTALL)

    for match in pattern.finditer(html):
        chunk = safe_json_parse(match.group(1))
        if isinstance(chunk, str):
            chunks.append(chunk)

    if not chunks:
        return None
    return safe_json_parse(''.join(chunks))


def find_object(root, predicate):
    visited = set()
    found = None

    def walk(value):
        nonlocal found
        if found is not None or not isinstance(value, (dict, list)) or id(value) in visited:
            return
        visited.add(id(value))

        if isinstance(value, dict) and predicate(value):
            found = value
            return

        for child in value.values() if isinstance(value, dict) else value:
            walk(child)

    walk(root)
    return found


def get_search_results(payload):
    results = find_object(
        payload,
        lambda value: isinstance(value.get('docs'), list) and isinstance(value.get('metadata'), dict),
    )
    if results is None:
        raise RuntimeError('Search payload did not contain docs plus metadata')
    return results


def decode_payload(body: str):
    trimmed = body.lstrip()
    references = safe_json_parse(body) if trimmed.startswith('[') else extract_stream_references(body)

    if not isinstance(references, list):
        raise RuntimeError(f'No React Router payload found (body starts with: {trimmed[:60]})')

    return rehydrate_references(references)


def is_challenge(status: int, body: str) -> bool:
    return status == 403 and (bool(CHALLENGE_PATTERN.search(body)) or len(body) < 5000)


def get_subvertical(url: str) -> str:
    path = urlsplit(urljoin(BASE_URL, url)).path
    match = re.match(r'^/realestate/([^/]+)/(?:search|ad)\.html(?:\.data)?$', path, re.IGNORECASE)
    return match.group(1) if match else 'homes'


def to_search_page_url(value, page) -> str:
    parts = urlsplit(urljoin(BASE_URL, value or DEFAULT_START_URL))
    match = re.match(r'^/realestate/([^/]+)/search\.html(?:\.data)?$', parts.path, re.IGNORECASE)

    if not match:
        raise RuntimeError('startUrl must be a Finn.no real-estate search URL ending in search.html')

    query = [(key, item) for key, item in parse_qsl(parts.query, keep_blank_values=True) if key != 'page']
    query.append(('page', str(page)))
    return urlunsplit((parts.scheme, parts.netloc, f'/realestate/{match.group(1)}/search.html', urlencode(query), parts.fragment))


def to_legacy_url(value) -> str:
    parts = urlsplit(urljoin(BASE_URL, value))
    if re.search(r'\.html\.data$', parts.path, re.IGNORECASE):
        return urlunsplit(parts)
    path = re.sub(r'\.html$', '.html.data', parts.path, flags=re.IGNORECASE)
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))


def to_page_referer(value) -> str:
    parts = urlsplit(urljoin(BASE_URL, value or DEFAULT_START_URL))
    path = re.sub(r'\.data$', '', parts.path, flags=re.IGNORECASE)
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))


def format_viewing_entry(entry):
    if isinstance(entry, str):
        return entry
    if not isinstance(entry, dict):
        return None

    date = entry.get('date') or entry.get('dateIso')
    time_text = (
        f"{entry.get('from')}-{entry.get('to')}" if entry.get('from') and entry.get('to') else entry.get('from') or entry.get('to')
    )
    return ' '.join(normalize_whitespace(item) for item in (date, time_text, entry.get('note')) if item)


def normalize_viewing_entries(viewings) -> list:
    values = viewings if isinstance(viewings, list) else []
    return unique_values([entry for entry in (format_viewing_entry(item) for item in values) if entry])


def map_search_document(document, subvertical: str):
    document = document if isinstance(document, dict) else {}
    finnkode = str(document.get('finnkode') or document.get('ad_id') or document.get('id') or '')
    coordinates = document.get('coordinates') or {}
    viewing_times = normalize_viewing_entries(document.get('viewing_times'))
    canonical_url = sanitize_url(document.get('canonical_url')) or sanitize_url(
        f'/realestate/{subvertical}/ad.html?finnkode={finnkode}'
    )
    timestamp = document.get('timestamp')
    suggestion = document.get('price_suggestion') or {}
    suggestion_range = document.get('price_range_suggestion') or {}
    total = document.get('price_total') or {}
    total_range = document.get('price_range_total') or {}
    shared_cost = document.get('price_shared_cost') or {}
    bedrooms_range = document.get('bedrooms_range') or {}
    area_range = document.get('area_range') or {}
    plot_area = document.get('area_plot') or {}
    image = document.get('image') or {}
    logo = document.get('logo') or {}
    features = document.get('features') if isinstance(document.get('features'), list) else []
    image_urls = document.get('image_urls') if isinstance(document.get('image_urls'), list) else []
    labels = document.get('labels')

    # Every key the search payload offers is mapped here, so a run needs one
    # request per page and never loads a listing page.
    return prune_record(
        {
            'finnkode': finnkode or None,
            'url': canonical_url,
            'listing_type': subvertical,
            'status': 'Til salgs',
            'title': document.get('heading'),
            'address': document.get('location'),
            'local_area_name': document.get('local_area_name'),
            'price_currency': suggestion.get('currency_code') or total.get('currency_code'),
            'asking_price': format_money(suggestion.get('amount'), suggestion.get('currency_code')),
            'asking_price_nok': suggestion.get('amount'),
            'asking_price_unit': suggestion.get('price_unit'),
            'asking_price_from': format_money(suggestion_range.get('amount_from'), suggestion_range.get('currency_code')),
            'asking_price_to': format_money(suggestion_range.get('amount_to'), suggestion_range.get('currency_code')),
            'asking_price_from_nok': suggestion_range.get('amount_from'),
            'asking_price_to_nok': suggestion_range.get('amount_to'),
            'total_price': format_money(total.get('amount'), total.get('currency_code')),
            'total_price_nok': total.get('amount'),
            'total_price_unit': total.get('price_unit'),
            'total_price_from': format_money(total_range.get('amount_from'), total_range.get('currency_code')),
            'total_price_to': format_money(total_range.get('amount_to'), total_range.get('currency_code')),
            'total_price_from_nok': total_range.get('amount_from'),
            'total_price_to_nok': total_range.get('amount_to'),
            'shared_costs_month': format_money(shared_cost.get('amount'), shared_cost.get('currency_code')),
            'shared_costs_month_nok': shared_cost.get('amount'),
            'shared_costs_unit': shared_cost.get('price_unit'),
            'property_type': document.get('property_type_description'),
            'ownership_type': document.get('owner_type_description'),
            'bedrooms': document.get('number_of_bedrooms'),
            'bedrooms_from': bedrooms_range.get('start'),
            'bedrooms_to': bedrooms_range.get('end'),
            'usable_area_sqm': first_number(area_range.get('size_from'), area_range.get('size_to')),
            'usable_area_sqm_from': area_range.get('size_from'),
            'usable_area_sqm_to': area_range.get('size_to'),
            'area_unit': area_range.get('unit'),
            'area_description': area_range.get('description'),
            'lot_area_sqm': plot_area.get('size'),
            'lot_area_unit': plot_area.get('unit'),
            'lot_area_description': plot_area.get('description'),
            'latitude': coordinates.get('lat'),
            'longitude': coordinates.get('lon'),
            'coordinate_accuracy': coordinates.get('accuracy'),
            'broker_company': document.get('organisation_name'),
            'broker_logo_url': sanitize_url(logo.get('url')),
            'broker_logo_path': logo.get('path'),
            'image_url': sanitize_url(image.get('url')),
            'image_path': image.get('path'),
            'image_width': image.get('width'),
            'image_height': image.get('height'),
            'image_aspect_ratio': image.get('aspect_ratio'),
            'image_urls': unique_strings([sanitize_url(url) for url in [image.get('url'), *image_urls]]),
            'viewing_times': viewing_times,
            'next_viewing': viewing_times[0] if viewing_times else None,
            'published_at': format_date(timestamp),
            'published_epoch_ms': timestamp,
            'ad_type': document.get('ad_type'),
            'search_id': document.get('main_search_key'),
            'document_type': document.get('type'),
            'labels': labels,
            'listing_flags': document.get('flags'),
            'features': features,
            'features_text': ', '.join(str(feature) for feature in features) if features else None,
            'styling': document.get('styling'),
            'extras': document.get('extras'),
            'is_private_broker': (
                any(
                    isinstance(label, dict) and str(label.get('id') or label.get('key') or '') == 'private'
                    for label in labels
                )
                if isinstance(labels, list)
                else None
            ),
            'scraped_at': js_iso(datetime.now(timezone.utc)),
        }
    )


def js_number(value) -> float:
    if value is None:
        return math.nan
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).strip()) if str(value).strip() else 0.0
    except ValueError:
        return math.nan


def js_parse_int(value, default: int = 1) -> int:
    match = re.match(r'^[+-]?\d+', normalize_whitespace(value))
    return int(match.group(0)) if match else default


class BrowserEngine:
    """One stealth browser session for the whole run.

    DataDome binds its cookie to this window and this proxy address, so pages
    are fetched through the same session and the same proxy URL.
    """

    def __init__(self, proxy_url):
        self.proxy_url = proxy_url
        self.session = None
        self.search_referer = None

    async def _new_session(self):
        # Headful real Chrome is the least detectable; the Apify image runs
        # xvfb, so headful works without a display. Bundled Chromium and headless are fallbacks.
        modes = ((True, False), (False, False), (False, True))
        for index, (real_chrome, headless) in enumerate(modes):
            session = AsyncStealthySession(
                headless=headless,
                real_chrome=real_chrome,
                solve_cloudflare=True,
                hide_canvas=True,
                block_webrtc=True,
                # Ad blocking also blocks the DataDome script, leaving the challenge unsolved.
                block_ads=False,
                locale='nb-NO',
                timezone_id='Europe/Oslo',
                timeout=PAGE_TIMEOUT_MS,
                retries=1,
                max_pages=1,
                proxy=self.proxy_url,
            )
            try:
                await session.start()
                return session
            except Exception as exc:
                try:
                    await session.close()
                except Exception:
                    pass
                if index == len(modes) - 1:
                    raise
                Actor.log.debug(f'Browser mode real_chrome={real_chrome} headless={headless} failed: {exc}')

        raise RuntimeError('No browser mode could start')

    async def _restart(self):
        if self.session is not None:
            try:
                await self.session.close()
            except Exception:
                pass
        self.session = await self._new_session()

    async def start(self, search_url: str):
        self.search_referer = search_url
        await self._restart()

    async def close(self):
        if self.session is not None:
            try:
                await self.session.close()
            except Exception:
                pass
            self.session = None

    async def _wait_for_listings(self, page):
        deadline = time.monotonic() + PAGE_TIMEOUT_MS / 1000
        while time.monotonic() < deadline:
            try:
                if await page.locator(LISTING_SELECTOR).count():
                    return
            except Exception:
                pass
            await page.wait_for_timeout(2000)

    async def solve_challenge(self):
        for attempt in range(1, MAX_RETRIES + 1):
            # A blocked attempt leaves a datadome cookie behind, so every retry
            # starts from a clean session instead of reloading the blocked one.
            if attempt > 1:
                await self._restart()

            passed = False
            try:
                response = await self.session.fetch(
                    self.search_referer,
                    page_action=self._wait_for_listings,
                    solve_cloudflare=True,
                    timeout=PAGE_TIMEOUT_MS + 5000,
                )
                passed = response.status == 200 and bool(response.css(LISTING_SELECTOR))
            except Exception as exc:
                Actor.log.warning(f'Challenge check failed: {exc}')

            if passed:
                return

            Actor.log.warning(f'Challenge did not clear (attempt {attempt}/{MAX_RETRIES})')
            if attempt < MAX_RETRIES:
                await asyncio.sleep(8 * attempt)

        raise RuntimeError(f'DataDome challenge did not clear at {self.search_referer}')

    async def fetch_text(self, url: str, label: str) -> str:
        for attempt in range(1, FETCH_RETRIES + 1):
            result = {}

            # Fetch from inside the solved search page: the datadome cookie and
            # browser fingerprint are used as-is, and .data returns the payload without rendering.
            async def fetch_in_page(page):
                result.update(
                    await page.evaluate(
                        """
                        async ({path, accept, timeout}) => {
                            const response = await fetch(path, {
                                headers: {accept},
                                signal: AbortSignal.timeout(timeout),
                            });
                            return {status: response.status, text: await response.text()};
                        }
                        """,
                        {'path': url, 'accept': DATA_ACCEPT, 'timeout': FETCH_TIMEOUT_MS},
                    )
                )

            await self.session.fetch(
                self.search_referer,
                page_action=fetch_in_page,
                solve_cloudflare=False,
                timeout=PAGE_TIMEOUT_MS,
            )

            if not result:
                stats['challenges'] += 1
                Actor.log.warning(f'{label} hit a browser challenge (no payload)')
            else:
                stats['requests'] += 1
                status = result.get('status')
                body = result.get('text') or ''
                if status == 200:
                    return body
                if not is_challenge(status, body):
                    raise RuntimeError(f'{label} returned HTTP {status}')

                stats['challenges'] += 1
                Actor.log.warning(f'{label} hit a browser challenge (HTTP {status})')

            if attempt == FETCH_RETRIES:
                break

            await asyncio.sleep(4 * attempt)
            await self.solve_challenge()

        raise RuntimeError(f'{label} stayed behind the challenge')

    async def fetch_decoded_page(self, url: str, label: str):
        last_error = None

        # The .data route is the cheap path; the rendered HTML carries the same
        # payload when the data route is unavailable.
        for candidate in (to_legacy_url(url), url):
            try:
                return decode_payload(await self.fetch_text(candidate, label))
            except Exception as error:
                last_error = error

        raise last_error


async def main() -> None:
    async with Actor:
        raw_input = await Actor.get_input() or {}

        raw_results_wanted = js_number(raw_input.get('results_wanted'))
        raw_max_pages = js_number(raw_input.get('max_pages'))
        actor_input = {
            **raw_input,
            'results_wanted': max(1, raw_results_wanted) if math.isfinite(raw_results_wanted) else 20,
            'max_pages': max(1, raw_max_pages) if math.isfinite(raw_max_pages) else 5,
        }

        proxy_input = raw_input.get('proxyConfiguration')
        custom_proxy_urls = proxy_input.get('proxyUrls') if isinstance(proxy_input, dict) else None
        has_custom_proxy_urls = isinstance(custom_proxy_urls, list) and bool(custom_proxy_urls)
        should_use_proxy = bool(isinstance(proxy_input, dict) and proxy_input.get('useApifyProxy')) or has_custom_proxy_urls
        proxy_configuration = None

        if should_use_proxy:
            if Actor.is_at_home() or has_custom_proxy_urls:
                proxy_configuration = await Actor.create_proxy_configuration(actor_proxy_input=proxy_input)
            else:
                Actor.log.warning('Apify Proxy is only available on the Apify platform; continuing without it')

        proxy_url = await proxy_configuration.new_url('finnno') if proxy_configuration else None
        start_candidates = unique_strings([raw_input.get('startUrl')])
        start_url = start_candidates[0] if start_candidates else DEFAULT_START_URL
        subvertical = get_subvertical(start_url)
        start_parts = urlsplit(urljoin(BASE_URL, start_url))
        initial_page = js_parse_int(dict(parse_qsl(start_parts.query)).get('page') or '1') or 1

        engine = BrowserEngine(proxy_url)
        await engine.start(to_page_referer(to_search_page_url(start_url, initial_page)))

        counters = {
            'pagesProcessed': 0,
            'searchFailures': 0,
            'duplicateRecords': 0,
            'emptyValuesRemoved': 0,
            'savedRecords': 0,
        }
        saved_record_keys = set()
        dataset_buffer = []
        field_counts = {}

        async def flush_dataset_buffer(force: bool = False):
            if not dataset_buffer or (not force and len(dataset_buffer) < 25):
                return
            items = dataset_buffer[:]
            dataset_buffer.clear()
            await Actor.push_data(items)

        async def push_record(record: dict):
            counters['emptyValuesRemoved'] += count_empty_values(record)
            cleaned_record = prune_record(record)
            if not cleaned_record:
                return False

            key = normalize_whitespace(str(cleaned_record.get('finnkode') or cleaned_record.get('url') or ''))
            if not key:
                return False
            if key in saved_record_keys:
                counters['duplicateRecords'] += 1
                return False

            saved_record_keys.add(key)
            for field in cleaned_record:
                field_counts[field] = field_counts.get(field, 0) + 1
            dataset_buffer.append(cleaned_record)
            counters['savedRecords'] += 1
            await flush_dataset_buffer(False)
            return True

        try:
            Actor.log.info(
                f'Start run | results_wanted={actor_input["results_wanted"]:g} | max_pages={actor_input["max_pages"]:g} '
                f'| browser=chrome{(" | proxy=on" if proxy_url else "")}'
            )

            page = initial_page
            while page < initial_page + actor_input['max_pages']:
                if counters['savedRecords'] >= actor_input['results_wanted']:
                    break

                search_url = to_search_page_url(start_url, page)

                try:
                    search_results = get_search_results(
                        await engine.fetch_decoded_page(search_url, f'search page {page}')
                    )
                except Exception as error:
                    counters['searchFailures'] += 1
                    if not counters['pagesProcessed']:
                        raise
                    Actor.log.warning(f'Search page {page} failed: {error}')
                    break

                counters['pagesProcessed'] += 1
                documents = search_results.get('docs') if isinstance(search_results.get('docs'), list) else []
                if not documents:
                    break

                for document in documents:
                    if counters['savedRecords'] >= actor_input['results_wanted']:
                        break

                    await push_record(map_search_document(document, subvertical))

                Actor.log.info(
                    f'Saved page {page} | total={counters["savedRecords"]}/{actor_input["results_wanted"]:g}'
                )

                last_page = js_number(((search_results.get('metadata') or {}).get('paging') or {}).get('last'))
                if (math.isfinite(last_page) and last_page.is_integer() and page >= last_page) or len(documents) < 50:
                    break

                page += 1

            await flush_dataset_buffer(True)
            common_fields = ', '.join(
                f'{field}={count}'
                for field, count in sorted(field_counts.items(), key=lambda item: -item[1])[:12]
            )

            Actor.log.info(
                f'Done | saved={counters["savedRecords"]} | pages={counters["pagesProcessed"]} '
                f'| requests={stats["requests"]} | challenges={stats["challenges"]} '
                f'| duplicates={counters["duplicateRecords"]} | empty_values_removed={counters["emptyValuesRemoved"]} '
                f'| common_fields={common_fields}'
            )

            if not counters['pagesProcessed']:
                raise RuntimeError(
                    'No search page could be fetched. Retry, and check API_DISCOVERY.md if the block persists.'
                )
        except Exception:
            Actor.log.exception('Actor failed')
            raise
        finally:
            await engine.close()

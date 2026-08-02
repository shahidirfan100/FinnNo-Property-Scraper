import { Actor, log } from 'apify';
import { Dataset } from 'crawlee';
import { Impit } from 'impit';

const BASE_URL = 'https://www.finn.no';
const DEFAULT_START_URL = `${BASE_URL}/realestate/homes/search.html`;
const MAX_RETRIES = 4;
const DETAIL_BATCH_SIZE = 5;
const EMPTY_STRING_LITERALS = new Set(['null', 'undefined', 'nan']);
const BROWSER_PROFILES = ['chrome136', 'chrome142', 'firefox133'];
const PROXY_SESSION_COUNT = 5;
const REQUEST_TIMEOUT_MS = 35000;

log.setLevel(log.LEVELS.WARNING);
await Actor.init();

function normalizeWhitespace(value) {
    return String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function toAbsoluteUrl(value, base = BASE_URL) {
    if (!value) return undefined;

    try {
        return new URL(value, base).href;
    } catch {
        return undefined;
    }
}

function sanitizeUrl(value) {
    const url = toAbsoluteUrl(value);
    if (!url || /undefined|null/i.test(url)) return undefined;
    return url;
}

function uniqueStrings(values) {
    return [...new Set(values.filter(Boolean).map((value) => normalizeWhitespace(value)))];
}

function uniqueValues(values) {
    const deduped = [];
    const seen = new Set();

    for (const value of values) {
        if (value === undefined) continue;

        const key = typeof value === 'string' ? normalizeWhitespace(value) : JSON.stringify(value);

        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(value);
    }

    return deduped;
}

function pruneRecord(value) {
    if (Array.isArray(value)) {
        const cleaned = uniqueValues(value.map(pruneRecord).filter((entry) => entry !== undefined));
        return cleaned.length ? cleaned : undefined;
    }

    if (value && typeof value === 'object') {
        const cleanedEntries = Object.entries(value)
            .map(([key, entryValue]) => [key, pruneRecord(entryValue)])
            .filter(([, entryValue]) => entryValue !== undefined);

        return cleanedEntries.length ? Object.fromEntries(cleanedEntries) : undefined;
    }

    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') {
        const normalized = normalizeWhitespace(value);
        if (EMPTY_STRING_LITERALS.has(normalized.toLowerCase())) return undefined;
        return normalized || undefined;
    }

    return value;
}

function countEmptyValues(value) {
    if (Array.isArray(value)) return value.reduce((count, item) => count + countEmptyValues(item), 0);
    if (value && typeof value === 'object') {
        return Object.values(value).reduce((count, item) => count + countEmptyValues(item), 0);
    }

    return value === null || value === undefined || value === '' ? 1 : 0;
}

function extractFinnCode(value) {
    const normalized = String(value || '');
    return (
        normalized.match(/finnkode=(\d+)/i)?.[1] ||
        normalized.match(/FINN-kode\s*(\d+)/i)?.[1] ||
        normalized.match(/\/([0-9]{6,})$/)?.[1] ||
        undefined
    );
}

function firstNumber(...values) {
    return values.find((value) => typeof value === 'number' && Number.isFinite(value));
}

function formatMoney(amount, currency = 'NOK') {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return undefined;
    const formatted = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(amount);
    return currency === 'NOK' ? `${formatted} kr` : `${formatted} ${currency}`;
}

function formatDate(value) {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? normalizeWhitespace(value) : date.toISOString();
}

function stripMarkup(value) {
    if (!value) return undefined;

    return normalizeWhitespace(
        String(value)
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'"),
    );
}

function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    } catch {
        return undefined;
    }
}

function rehydrateSingleFetch(body) {
    const references = safeJsonParse(body);
    if (!Array.isArray(references)) throw new Error('Single-fetch response was not a JSON array');

    const cache = new Map();

    function resolve(index, depth = 0) {
        if (depth > 100 || typeof index !== 'number' || index < 0 || index >= references.length) return undefined;
        if (cache.has(index)) return cache.get(index);

        const value = references[index];
        let resolved;

        if (value === null || typeof value !== 'object') {
            resolved = value;
        } else if (Array.isArray(value)) {
            resolved = [];
            cache.set(index, resolved);
            for (const entry of value) {
                resolved.push(typeof entry === 'number' ? resolve(entry, depth + 1) : entry);
            }
        } else {
            resolved = {};
            cache.set(index, resolved);
            for (const [encodedKey, childIndex] of Object.entries(value)) {
                const keyIndex = Number(encodedKey.slice(1));
                const key = references[keyIndex];
                if (typeof key !== 'string') continue;
                resolved[key] = resolve(childIndex, depth + 1);
            }
        }

        cache.set(index, resolved);
        return resolved;
    }

    return resolve(0);
}

function findObject(root, predicate) {
    const visited = new Set();
    let found;

    function walk(value) {
        if (found || !value || typeof value !== 'object' || visited.has(value)) return;
        visited.add(value);

        if (!Array.isArray(value) && predicate(value)) {
            found = value;
            return;
        }

        for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child);
    }

    walk(root);
    return found;
}

function getSubvertical(url) {
    const { pathname } = new URL(url, BASE_URL);
    return pathname.match(/^\/realestate\/([^/]+)\/(?:search|ad)\.html(?:\.data)?$/i)?.[1] || 'homes';
}

function toSearchPageUrl(value, page) {
    const url = new URL(value || DEFAULT_START_URL, BASE_URL);
    const match = url.pathname.match(/^\/realestate\/([^/]+)\/search\.html(?:\.data)?$/i);

    if (!match) {
        throw new Error('startUrl must be a Finn.no real-estate search URL ending in search.html');
    }

    url.pathname = `/realestate/${match[1]}/search.html.data`;
    url.searchParams.set('page', String(page));
    return url.href;
}

function toPageReferer(value) {
    const url = new URL(value || DEFAULT_START_URL, BASE_URL);
    url.pathname = url.pathname.replace(/\.data$/i, '');
    return url.href;
}

function toDetailDataUrl(value) {
    const url = new URL(value, BASE_URL);
    const match = url.pathname.match(/^\/realestate\/([^/]+)\/ad\.html(?:\.data)?$/i);

    if (!match) return undefined;
    url.pathname = `/realestate/${match[1]}/ad.html.data`;
    return url.href;
}

function toDetailReferer(value) {
    const url = new URL(value, BASE_URL);
    url.pathname = url.pathname.replace(/\.data$/i, '');
    return url.href;
}

function getSearchResults(payload) {
    const results = findObject(
        payload,
        (value) => Array.isArray(value.docs) && value.metadata && typeof value.metadata === 'object',
    );
    if (!results) throw new Error('Could not locate search results in the rehydrated response');
    return results;
}

function getDetailData(payload) {
    const detail = findObject(payload, (value) => value.objectData?.ad && typeof value.objectData.ad === 'object');
    if (!detail) throw new Error('Could not locate property details in the rehydrated response');
    return detail;
}

function formatViewingEntry(entry) {
    if (typeof entry === 'string') return entry;
    if (!entry || typeof entry !== 'object') return undefined;

    const date = entry.date || entry.dateIso;
    const time = entry.from && entry.to ? `${entry.from}-${entry.to}` : entry.from || entry.to;
    return [date, time, entry.note].filter(Boolean).join(' ');
}

function normalizeViewingEntries(viewings) {
    return uniqueValues((Array.isArray(viewings) ? viewings : []).map(formatViewingEntry).filter(Boolean));
}

function normalizeLinks(links) {
    return (Array.isArray(links) ? links : [])
        .map((link) =>
            pruneRecord({
                url: sanitizeUrl(link?.uri || link?.url || link?.href),
                title: link?.title || link?.text,
            }),
        )
        .filter(Boolean);
}

function normalizeMedia(items) {
    return (Array.isArray(items) ? items : [])
        .map((item) =>
            pruneRecord({
                url: sanitizeUrl(item?.uri || item?.url || item?.value),
                width: item?.width,
                height: item?.height,
                description: stripMarkup(item?.description),
            }),
        )
        .filter(Boolean);
}

function parseCompanyProfile(profileModule) {
    const content = profileModule?.content;
    if (!content) return undefined;

    const match = String(content).match(/<script[^>]*data-company-profile-data[^>]*>([\s\S]*?)<\/script>/i);
    const parsed = match ? safeJsonParse(match[1].trim()) : undefined;
    return parsed?.companyProfile || parsed?.extendedProfileRealEstate;
}

function findHomepage(profile) {
    const link = profile?.customLinks?.find((item) => /hjemmeside|homepage/i.test(item?.text || ''));
    return sanitizeUrl(link?.url);
}

function mapSearchDocument(document, subvertical) {
    const finnkode = String(document?.finnkode || document?.ad_id || document?.id || '');
    const coordinates = document?.coordinates || {};
    const viewingTimes = normalizeViewingEntries(document?.viewing_times);
    const canonicalUrl =
        sanitizeUrl(document?.canonical_url) || sanitizeUrl(`/realestate/${subvertical}/ad.html?finnkode=${finnkode}`);
    const timestamp = document?.timestamp;
    const suggestion = document?.price_suggestion || {};
    const total = document?.price_total || {};
    const sharedCost = document?.price_shared_cost || {};
    const image = document?.image || {};
    const logo = document?.logo || {};

    return pruneRecord({
        finnkode: finnkode || undefined,
        url: canonicalUrl,
        listing_type: subvertical,
        status: 'Til salgs',
        title: document?.heading,
        address: document?.location,
        local_area_name: document?.local_area_name,
        asking_price: formatMoney(suggestion.amount, suggestion.currency_code),
        asking_price_nok: suggestion.amount,
        asking_price_unit: suggestion.price_unit,
        total_price: formatMoney(total.amount, total.currency_code),
        total_price_nok: total.amount,
        total_price_unit: total.price_unit,
        shared_costs_month: formatMoney(sharedCost.amount, sharedCost.currency_code),
        shared_costs_month_nok: sharedCost.amount,
        shared_costs_unit: sharedCost.price_unit,
        property_type: document?.property_type_description,
        ownership_type: document?.owner_type_description,
        bedrooms: document?.number_of_bedrooms,
        usable_area_sqm: firstNumber(document?.area_range?.size_from, document?.area_range?.size_to),
        usable_area_sqm_from: document?.area_range?.size_from,
        usable_area_sqm_to: document?.area_range?.size_to,
        area_unit: document?.area_range?.unit,
        lot_area_sqm: document?.area_plot?.size,
        lot_area_unit: document?.area_plot?.unit,
        latitude: coordinates.lat,
        longitude: coordinates.lon,
        coordinate_accuracy: coordinates.accuracy,
        broker_company: document?.organisation_name,
        broker_logo_url: sanitizeUrl(logo.url),
        image_url: sanitizeUrl(image.url),
        image_width: image.width,
        image_height: image.height,
        image_aspect_ratio: image.aspect_ratio,
        image_urls: uniqueStrings([image.url, ...(document?.image_urls || [])].map(sanitizeUrl)),
        viewing_times: viewingTimes,
        next_viewing: viewingTimes[0],
        published_at: formatDate(timestamp),
        published_epoch_ms: timestamp,
        ad_type: document?.ad_type,
        search_id: document?.main_search_key,
        document_type: document?.type,
        labels: document?.labels,
        listing_flags: document?.flags,
        styling: document?.styling,
        extras: document?.extras,
        is_private_broker: Array.isArray(document?.labels)
            ? document.labels.some((label) => String(label?.id || label?.key || '') === 'private')
            : undefined,
        scraped_at: new Date().toISOString(),
        searchText: [
            document?.heading,
            document?.location,
            document?.local_area_name,
            document?.property_type_description,
            document?.owner_type_description,
        ]
            .filter(Boolean)
            .join(' '),
    });
}

function mapDetailData(detailData, summary, requestUrl) {
    const ad = detailData?.objectData?.ad || {};
    const meta = detailData?.objectData?.meta || {};
    const location = ad.location || {};
    const position = location.position || {};
    const price = ad.price || {};
    const size = ad.size || {};
    const profile = parseCompanyProfile(detailData.companyProfile) || {};
    const contact = profile.contacts?.[0] || ad.contact?.[0] || {};
    const images = normalizeMedia(ad.images);
    const floorplans = normalizeMedia(
        ad.floorplans || detailData.floorPlanImages || detailData.interactiveFloorPlansImages,
    );
    const documents = normalizeLinks(ad.documents);
    const moreInfoLinks = normalizeLinks(ad.moreInfoLinks);
    const viewings = normalizeViewingEntries(ad.viewings);
    const descriptionSections = uniqueValues(
        [
            ...(Array.isArray(ad.propertyInfo)
                ? ad.propertyInfo.map((section) =>
                      [section?.title, stripMarkup(section?.content)].filter(Boolean).join(': '),
                  )
                : []),
            ...(Array.isArray(ad.generalText)
                ? ad.generalText.map((section) =>
                      [section?.heading, stripMarkup(section?.textUnsafe)].filter(Boolean).join(': '),
                  )
                : []),
        ].filter(Boolean),
    );
    const firstDescription =
        descriptionSections.find((section) => /om boligen|om eiendommen|kort om/i.test(section)) ||
        descriptionSections[0];
    const homepageUrl = findHomepage(profile);
    const disposed = Boolean(meta.disposed?.value);
    const linkByTitle = (pattern) => moreInfoLinks.find((link) => pattern.test(link.title || ''))?.url;
    const address = [location.streetAddress, [location.postalCode, location.postalName].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', ');
    const dataUrl = toAbsoluteUrl(requestUrl);
    const companyLogo = sanitizeUrl(profile.logo || profile.resultLogo);
    const agentPhone = contact.phone?.[0]?.phoneFormatted || contact.phonesWithLabels?.[0]?.phone || contact.mobile;

    return pruneRecord({
        ...summary,
        finnkode: String(detailData.adId || summary.finnkode || extractFinnCode(requestUrl)),
        url: sanitizeUrl(dataUrl?.replace(/\.data(?=\?|$)/i, '')) || summary.url,
        listing_type: summary.listing_type || getSubvertical(requestUrl),
        status: disposed ? meta.disposed?.label || 'Solgt' : summary.status || 'Til salgs',
        title: ad.title || summary.title,
        address: address || summary.address,
        local_area_name: ad.localAreaName || summary.local_area_name,
        asking_price: formatMoney(price.suggestion, price.currency) || summary.asking_price,
        asking_price_nok: price.suggestion ?? summary.asking_price_nok,
        total_price: formatMoney(price.total, price.currency) || summary.total_price,
        total_price_nok: price.total ?? summary.total_price_nok,
        shared_costs_month:
            formatMoney(ad.sharedCost?.amount || price.commonMonthlyCost, price.currency) || summary.shared_costs_month,
        shared_costs_month_nok: ad.sharedCost?.amount ?? price.commonMonthlyCost ?? summary.shared_costs_month_nok,
        municipal_fees_year: formatMoney(price.municipalFees, price.currency),
        municipal_fees_year_nok: price.municipalFees,
        property_tax_year: formatMoney(price.estateTax, price.currency),
        property_tax_year_nok: price.estateTax,
        tax_value: formatMoney(price.taxValue, price.currency),
        tax_value_nok: price.taxValue,
        sales_cost_sum: formatMoney(price.salesCostSum, price.currency),
        sales_cost_sum_nok: price.salesCostSum,
        collective_assets: formatMoney(price.collectiveAssets, price.currency),
        collective_assets_nok: price.collectiveAssets,
        collective_debt_nok: price.collectiveDebt,
        property_type: ad.propertyType || summary.property_type,
        ownership_type: ad.ownershipType || summary.ownership_type,
        bedrooms: ad.bedrooms ?? summary.bedrooms,
        rooms: ad.rooms,
        living_area_sqm: firstNumber(size.usableAreaI, size.livingArea, summary.living_area_sqm),
        usable_area_sqm: firstNumber(size.usable, summary.usable_area_sqm),
        external_area_sqm: firstNumber(size.usableAreaE, summary.external_area_sqm),
        internal_area_sqm: size.usableAreaI,
        open_area_sqm: size.openArea,
        balcony_area_sqm: size.openArea,
        lot_area_sqm: ad.plot?.area ?? summary.lot_area_sqm,
        plot_owned: ad.plot?.owned,
        plot_leasehold_point: ad.plot?.leaseholdPoint,
        floor: ad.floor,
        build_year: ad.constructionYear,
        energy_label:
            typeof ad.energyLabel === 'object' ? ad.energyLabel.class || ad.energyLabel.value : ad.energyLabel,
        latitude: position.lat ?? summary.latitude,
        longitude: position.lng ?? summary.longitude,
        coordinate_accuracy: position.accuracy ?? summary.coordinate_accuracy,
        postal_code: location.postalCode,
        postal_name: location.postalName,
        country_code: location.countryCode,
        country_name: location.countryName,
        broker_company: profile.orgName || summary.broker_company,
        broker_org_id: profile.orgId,
        broker_homepage_url: homepageUrl || summary.broker_homepage_url,
        broker_logo_url: companyLogo || summary.broker_logo_url,
        agent_name: contact.name || summary.agent_name,
        agent_title: contact.title || summary.agent_title,
        agent_phone: agentPhone || summary.agent_phone,
        agent_email: contact.email || summary.agent_email,
        agent_image_url: sanitizeUrl(contact.image),
        next_viewing: viewings[0] || summary.next_viewing,
        viewing_times: ad.viewings,
        viewing_notes: ad.viewings?.filter((viewing) => viewing?.note).map((viewing) => viewing.note),
        facilities: Array.isArray(ad.facilities) ? ad.facilities.join(', ') : ad.facilities,
        facilities_list: ad.facilities,
        description: firstDescription || stripMarkup(ad.summaryUnsafe) || summary.description,
        description_sections: descriptionSections.join('\n\n'),
        image_urls: images.length ? images.map((image) => image.url) : summary.image_urls,
        initial_image_url: sanitizeUrl(
            typeof detailData.initialImage === 'string'
                ? detailData.initialImage
                : detailData.initialImage?.url || detailData.initialImage?.uri,
        ),
        interior_image_urls: normalizeMedia(detailData.interiorImages).map((image) => image.url),
        neighborhood_addresses: detailData.neighborhoodAddresses,
        floorplan_urls: floorplans.map((image) => image.url),
        floorplan_metadata: floorplans,
        document_urls: documents,
        more_info_links: moreInfoLinks,
        ownership_history_url: linkByTitle(/eier|ownership/i),
        price_statistics_url:
            sanitizeUrl(detailData.priceStatistics?.url || detailData.priceStatistics?.href) ||
            linkByTitle(/prisstatistikk|price/i),
        area_profile_url: summary.area_profile_url,
        reference: ad.advertiserRef || summary.reference,
        external_ad_id: ad.externalAdId,
        advertiser_org_id: profile.orgId,
        cadastres: ad.cadastres,
        housing_cooperative: ad.housingCooperative?.name,
        housing_cooperative_org: ad.housingCooperative?.organisationNumber,
        shared_cost_includes: stripMarkup(ad.sharedCost?.includesUnsafe),
        sales_cost_includes: stripMarkup(price.salesCostIncludesUnsafe),
        prospectus_url: sanitizeUrl(ad.prospectusView || ad.prospectusOrder),
        electronic_bid_url: sanitizeUrl(ad.electronicBid?.bidUrl),
        electronic_bid_info_url: sanitizeUrl(ad.electronicBid?.infoUrl),
        map_image_url: sanitizeUrl(position.mapImage),
        preemption: ad.preemption,
        letting_unit: ad.lettingUnit,
        anonymous: ad.anonymous,
        ad_view_type_label: ad.adViewTypeLabel,
        change_of_ownership_insurance: ad.changeOfOwnershipInsurance,
        seller_emails: uniqueValues(
            (Array.isArray(ad.sellerEmails) ? ad.sellerEmails : [])
                .map((entry) => {
                    if (typeof entry === 'string') return entry;
                    return entry?.email || entry?.address || entry?.value;
                })
                .filter(Boolean),
        ),
        last_modified: meta.edited || summary.last_modified,
        updated_at: meta.edited,
        published_at: summary.published_at,
        ad_schema_name: meta.schemaName,
        ad_schema_version: meta.schemaVersion,
        meta_mode: meta.mode,
        meta_version: meta.version,
        meta_owner_id: meta.ownerId,
        is_disposed: disposed,
        is_third_party_advertiser: ad.thirdPartyAdvertiser,
        searchText: [
            summary.searchText,
            address,
            ad.localAreaName,
            ad.propertyType,
            ad.ownershipType,
            firstDescription?.text,
        ]
            .filter(Boolean)
            .join(' '),
        scraped_at: new Date().toISOString(),
    });
}

async function wait(milliseconds) {
    await new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

class RequestGate {
    constructor({ rate = 0.6, burst = 1, maxConcurrency = 3, maxRate = 0.9, minRate = 0.1 } = {}) {
        this.tokens = burst;
        this.rate = rate;
        this.burst = burst;
        this.maxRate = maxRate;
        this.minRate = minRate;
        this.maxConcurrency = maxConcurrency;
        this.inFlight = 0;
        this.lastRefillAt = Date.now();
        this.successStreak = 0;
        this.throttled = 0;
        this.waiters = [];
        this.chain = Promise.resolve();
    }

    _refill(now) {
        const elapsed = Math.max(0, (now - this.lastRefillAt) / 1000);
        this.tokens = Math.min(this.burst, this.tokens + elapsed * this.rate);
        this.lastRefillAt = now;
    }

    async _acquireToken() {
        let now = Date.now();
        this._refill(now);
        if (this.tokens < 1) {
            const needMs = ((1 - this.tokens) / this.rate) * 1000;
            await wait(needMs + Math.random() * 150);
            now = Date.now();
            this._refill(now);
        }
        this.tokens -= 1;
    }

    async _acquireSlot() {
        while (this.inFlight >= this.maxConcurrency) {
            await new Promise((resolve) => {
                this.waiters.push(resolve);
            });
        }
        this.inFlight++;
    }

    async acquire() {
        const run = this.chain.then(async () => {
            await this._acquireToken();
            await this._acquireSlot();
            let released = false;
            return () => {
                if (released) return;
                released = true;
                this.inFlight--;
                const next = this.waiters.shift();
                if (next) next();
            };
        });
        this.chain = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }

    reportSuccess() {
        this.successStreak++;
        if (this.successStreak >= 5 && this.rate < this.maxRate) {
            this.rate = Math.min(this.maxRate, this.rate * 1.1);
            this.burst = Math.min(2, this.burst + 1);
            this.successStreak = 0;
        }
    }

    reportThrottled(status) {
        this.successStreak = 0;
        this.throttled++;
        if (status === 429) {
            this.rate = Math.max(this.minRate, this.rate * 0.5);
            this.burst = 1;
        } else if (status === 403 || status >= 500) {
            this.rate = Math.max(this.minRate, this.rate * 0.75);
        }
    }

    describe() {
        return `rate=${this.rate.toFixed(2)}/s burst=${this.burst} inFlight=${this.inFlight} throttled=${this.throttled}`;
    }
}

function buildHeaders(referer) {
    return {
        accept: 'text/x-script; charset=utf-8, */*;q=0.1',
        'accept-language': 'nb-NO,nb;q=0.9,no;q=0.8,en;q=0.6,en-US;q=0.5',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        referer,
    };
}

function createClient(browser, proxyUrl) {
    return new Impit({
        browser,
        ignoreTlsErrors: true,
        timeout: REQUEST_TIMEOUT_MS,
        ...(proxyUrl && { proxyUrl }),
    });
}

async function buildClients(proxyConfiguration) {
    if (!proxyConfiguration) {
        const sharedGate = new RequestGate();
        return BROWSER_PROFILES.map((browser) => ({ client: createClient(browser), gate: sharedGate }));
    }

    const sessions = [];
    if (Array.isArray(proxyConfiguration.proxyUrls) && proxyConfiguration.proxyUrls.length) {
        sessions.push(...proxyConfiguration.proxyUrls);
    }

    for (let i = sessions.length; i < PROXY_SESSION_COUNT; i++) {
        try {
            sessions.push(await proxyConfiguration.newUrl(`finnno_session_${i}`));
        } catch {
            sessions.push(await proxyConfiguration.newUrl());
        }
    }

    return sessions.map((proxyUrl, index) => ({
        client: createClient(BROWSER_PROFILES[index % BROWSER_PROFILES.length], proxyUrl),
        gate: new RequestGate(),
    }));
}

let entryIndex = 0;

function nextEntry(entries) {
    const entry = entries[entryIndex % entries.length];
    entryIndex = (entryIndex + 1) % entries.length;
    return entry;
}

function computeBackoff(response, status, attempt) {
    const exponent = attempt - 1;

    if (status === 429) {
        const retryAfter = Number(response.headers.get('retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000 + Math.random() * 500;
        return Math.min(4000 * 2 ** exponent, 20000) + Math.random() * 1000;
    }

    if (status === 403 || status === 408 || status === 425) {
        return Math.min(3500 * 2 ** exponent, 20000) + Math.random() * 1000;
    }

    return Math.min(1500 * 2 ** exponent, 10000) + Math.random() * 500;
}

async function fetchWithRetry(entries, url, options = {}, label = 'request') {
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const { client, gate } = nextEntry(entries);
        const release = await gate.acquire();

        try {
            const response = await client.fetch(url, {
                ...options,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            const { status } = response;

            if (status === 200) {
                gate.reportSuccess();
                return response;
            }

            lastError = new Error(`${label} returned HTTP ${status}`);
            if (attempt >= MAX_RETRIES) return response;

            const retryable = status === 429 || status === 403 || status === 408 || status === 425 || status >= 500;
            if (!retryable) return response;

            gate.reportThrottled(status);
            const delayMs = computeBackoff(response, status, attempt);
            log.warning(
                `${label} retry ${attempt}/${MAX_RETRIES} after HTTP ${status}; backoff=${Math.round(delayMs)}ms; ${gate.describe()}`,
            );
            await wait(delayMs);
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES) {
                log.warning(`${label} retry ${attempt}/${MAX_RETRIES}: ${error.message}`);
                await wait(600 * 2 ** (attempt - 1) + Math.random() * 400);
            }
        } finally {
            release();
        }
    }

    throw lastError || new Error(`${label} failed`);
}

async function fetchStructuredPayload(entries, url, referer, label) {
    const response = await fetchWithRetry(entries, url, { headers: buildHeaders(referer) }, label);

    if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
    const body = await response.text();
    return rehydrateSingleFetch(body);
}

function matchesFilters(record, input) {
    const searchableText = normalizeWhitespace(
        [
            record.title,
            record.address,
            record.local_area_name,
            record.property_type,
            record.ownership_type,
            record.status,
            record.description,
            record.searchText,
        ]
            .filter(Boolean)
            .join(' '),
    ).toLowerCase();

    if (input.keyword && !searchableText.includes(normalizeWhitespace(input.keyword).toLowerCase())) return false;
    if (input.location && !searchableText.includes(normalizeWhitespace(input.location).toLowerCase())) return false;
    if (input.propertyType && !searchableText.includes(normalizeWhitespace(input.propertyType).toLowerCase()))
        return false;

    if (Number.isInteger(input.minBedrooms) && input.minBedrooms > 0) {
        if (!Number.isInteger(record.bedrooms) || record.bedrooms < input.minBedrooms) return false;
    }

    return true;
}

function collectStartUrls(rawInput) {
    const urls = [];
    if (Array.isArray(rawInput.startUrls)) urls.push(...rawInput.startUrls);
    if (rawInput.startUrl) urls.push(rawInput.startUrl);
    if (rawInput.url) urls.push(rawInput.url);
    return uniqueStrings(urls.length ? urls : [DEFAULT_START_URL]);
}

async function main() {
    const rawInput = (await Actor.getInput()) || {};
    const requestedLogLevel = normalizeWhitespace(
        rawInput.logLevel || process.env.APIFY_LOG_LEVEL || 'WARNING',
    ).toUpperCase();
    if (log.LEVELS?.[requestedLogLevel]) log.setLevel(log.LEVELS[requestedLogLevel]);

    const input = {
        ...rawInput,
        keyword: normalizeWhitespace(rawInput.keyword || ''),
        location: normalizeWhitespace(rawInput.location || ''),
        minBedrooms: Number.isFinite(Number(rawInput.minBedrooms))
            ? Math.max(0, Number(rawInput.minBedrooms))
            : undefined,
        propertyType: normalizeWhitespace(rawInput.propertyType || ''),
        results_wanted: Number.isFinite(Number(rawInput.results_wanted))
            ? Math.max(1, Number(rawInput.results_wanted))
            : 20,
        max_pages: Number.isFinite(Number(rawInput.max_pages)) ? Math.max(1, Number(rawInput.max_pages)) : 5,
        fetch_details: rawInput.fetch_details === true,
    };

    const proxyInput = rawInput.proxyConfiguration;
    const hasCustomProxyUrls = Array.isArray(proxyInput?.proxyUrls) && proxyInput.proxyUrls.length > 0;
    const shouldUseProxy = Boolean(proxyInput?.useApifyProxy) || hasCustomProxyUrls;
    const proxyConfiguration =
        shouldUseProxy && Actor.isAtHome() ? await Actor.createProxyConfiguration({ ...proxyInput }) : undefined;
    const entries = await buildClients(proxyConfiguration);

    const counters = {
        pagesProcessed: 0,
        searchFailures: 0,
        detailFailures: 0,
        detailFallbacks: 0,
        detailRequests: 0,
        cacheHits: 0,
        duplicateRecords: 0,
        emptyValuesRemoved: 0,
        savedRecords: 0,
    };
    const savedRecordKeys = new Set();
    const enrichedCache = new Map();
    const datasetBuffer = [];
    const fieldCounts = new Map();
    let flushChain = Promise.resolve();

    async function flushDatasetBuffer(force = false) {
        flushChain = flushChain.then(async () => {
            if (!datasetBuffer.length || (!force && datasetBuffer.length < 25)) return;
            const items = datasetBuffer.splice(0, datasetBuffer.length);
            await Dataset.pushData(items);
        });
        await flushChain;
    }

    async function pushRecord(record) {
        counters.emptyValuesRemoved += countEmptyValues(record);
        const cleanedRecord = pruneRecord(record);
        if (!cleanedRecord) return false;

        delete cleanedRecord.searchText;
        const key = normalizeWhitespace(String(cleanedRecord.finnkode || cleanedRecord.url || ''));
        if (!key) return false;
        if (savedRecordKeys.has(key)) {
            counters.duplicateRecords++;
            return false;
        }

        savedRecordKeys.add(key);
        for (const field of Object.keys(cleanedRecord)) fieldCounts.set(field, (fieldCounts.get(field) || 0) + 1);
        datasetBuffer.push(cleanedRecord);
        counters.savedRecords++;
        await flushDatasetBuffer(false);
        return true;
    }

    log.info(
        `Start run | results_wanted=${input.results_wanted} | max_pages=${input.max_pages} | fetch_details=${
            input.fetch_details
        } | clients=${entries.length}${proxyConfiguration ? ' | proxy=on' : ''}`,
    );

    for (const startUrl of collectStartUrls(rawInput)) {
        if (counters.savedRecords >= input.results_wanted) break;

        const subvertical = getSubvertical(startUrl);
        const cleanReferer = toPageReferer(startUrl);
        const initialPage = Number.parseInt(new URL(startUrl, BASE_URL).searchParams.get('page') || '1', 10) || 1;

        for (let page = initialPage; page < initialPage + input.max_pages; page++) {
            if (counters.savedRecords >= input.results_wanted) break;

            let searchResults;
            try {
                const searchUrl = toSearchPageUrl(startUrl, page);
                const payload = await fetchStructuredPayload(entries, searchUrl, cleanReferer, `search page ${page}`);
                searchResults = getSearchResults(payload);
            } catch (error) {
                counters.searchFailures++;
                log.warning(`Search page ${page} failed: ${error.message}`);
                break;
            }

            counters.pagesProcessed++;
            const documents = Array.isArray(searchResults.docs) ? searchResults.docs : [];
            if (!documents.length) break;

            const summaries = documents
                .map((document) => mapSearchDocument(document, subvertical))
                .filter((summary) => matchesFilters(summary, input));

            for (
                let offset = 0;
                offset < summaries.length && counters.savedRecords < input.results_wanted;
                offset += DETAIL_BATCH_SIZE
            ) {
                const remaining = input.results_wanted - counters.savedRecords;
                const batch = summaries.slice(offset, offset + Math.min(DETAIL_BATCH_SIZE, remaining));
                const enriched = await Promise.all(
                    batch.map(async (summary) => {
                        if (!input.fetch_details) return { record: summary, fallback: false };

                        try {
                            const summaryKey = String(summary.finnkode || summary.url || '');
                            if (enrichedCache.has(summaryKey)) {
                                counters.cacheHits++;
                                return { record: enrichedCache.get(summaryKey), fallback: false };
                            }

                            const detailUrl = toDetailDataUrl(summary.url);
                            if (!detailUrl) throw new Error('listing URL is not a supported Finn.no ad URL');

                            counters.detailRequests++;
                            const detailPayload = await fetchStructuredPayload(
                                entries,
                                detailUrl,
                                toDetailReferer(summary.url),
                                `listing ${summary.finnkode}`,
                            );
                            const detailData = getDetailData(detailPayload);
                            const record = mapDetailData(detailData, summary, detailUrl);
                            enrichedCache.set(summaryKey, record);
                            return { record, fallback: false };
                        } catch (error) {
                            counters.detailFailures++;
                            counters.detailFallbacks++;
                            log.warning(
                                `Listing ${summary.finnkode} detail failed; saving search data: ${error.message}`,
                            );
                            return { record: summary, fallback: true };
                        }
                    }),
                );

                for (const result of enriched) {
                    if (counters.savedRecords >= input.results_wanted) break;
                    if (result.record && matchesFilters(result.record, input)) await pushRecord(result.record);
                }

                log.info(`Saved batch | total=${counters.savedRecords}/${input.results_wanted}`);
            }

            const lastPage = Number(searchResults.metadata?.paging?.last);
            if ((Number.isInteger(lastPage) && page >= lastPage) || documents.length < 50) break;
        }
    }

    await flushDatasetBuffer(true);
    const commonFields = [...fieldCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 12)
        .map(([field, count]) => `${field}=${count}`)
        .join(', ');

    const totalThrottled = entries.reduce((sum, entry) => sum + entry.gate.throttled, 0);
    const peakRate = entries.reduce((max, entry) => Math.max(max, entry.gate.rate), 0);

    log.info(
        `Done | saved=${counters.savedRecords} | pages=${counters.pagesProcessed} | cache_hits=${
            counters.cacheHits
        } | duplicates=${counters.duplicateRecords} | empty_values_removed=${
            counters.emptyValuesRemoved
        } | detail_requests=${counters.detailRequests} | detail_failures=${
            counters.detailFailures
        } | throttled=${totalThrottled} | peak_rate=${peakRate.toFixed(2)}/s | common_fields=${commonFields}`,
    );
}

main()
    .catch((error) => {
        log.exception(error, 'Actor failed');
        process.exitCode = 1;
    })
    .finally(async () => {
        await Actor.exit();
    });

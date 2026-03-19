import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { load } from 'cheerio';
import { gotScraping } from 'got-scraping';

const BASE_URL = 'https://www.finn.no';
const DEFAULT_START_URL = `${BASE_URL}/realestate/homes/search.html`;
const NEIGHBORHOOD_API_URL = `${BASE_URL}/realestate/neighborhood-api-alt.json`;
const PROPERTY_TYPES = ['Leilighet', 'Enebolig', 'Rekkehus', 'Tomannsbolig', 'Gardsbruk/Smabruk', 'Garasje/Parkering', 'Andre'];
const OWNERSHIP_TYPES = ['Eier (Selveier)', 'Selveier', 'Andel', 'Aksje', 'Obligasjon', 'Annet'];
const LISTING_STATUSES = ['Til salgs', 'Kommer for salg', 'Solgt'];
const SECTION_STOPS = ['Nyttige lenker', 'Visning', 'Naeromradet', 'Nabolaget', 'Om nabolaget', 'Annonseinformasjon', 'Cookieinnstillinger'];
const EMPTY_STRING_LITERALS = new Set(['null', 'undefined', 'nan']);
const REQUEST_HEADERS = {
    'accept-language': 'en-US,en;q=0.9',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
};

log.setLevel(log.LEVELS.WARNING);
await Actor.init();

function normalizeWhitespace(value) {
    return String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toAbsoluteUrl(href, base = BASE_URL) {
    try {
        return new URL(href, base).href;
    } catch {
        return undefined;
    }
}

function sanitizeUrl(url) {
    if (!url || /undefined/i.test(url)) return undefined;
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

        const key = typeof value === 'string'
            ? normalizeWhitespace(value)
            : JSON.stringify(value);

        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(value);
    }

    return deduped;
}

function extractFinnCode(value) {
    const normalized = String(value || '');
    return normalized.match(/finnkode=(\d+)/i)?.[1]
        || normalized.match(/FINN-kode\s*(\d+)/i)?.[1]
        || normalized.match(/\/([0-9]{6,})$/)?.[1]
        || undefined;
}

function pickValue(text, pattern) {
    const match = text.match(pattern);
    return match ? normalizeWhitespace(match[1]) : undefined;
}

function pickInteger(text, pattern) {
    const value = pickValue(text, pattern);
    if (!value) return undefined;

    const digits = value.replace(/[^0-9]/g, '');
    if (!digits) return undefined;

    return Number.parseInt(digits, 10);
}

function findEnum(text, candidates) {
    const normalized = normalizeWhitespace(text).toLowerCase();
    return candidates.find((candidate) => normalized.includes(candidate.toLowerCase()));
}

function normalizeListingStatus(text) {
    return findEnum(text, LISTING_STATUSES) || 'Til salgs';
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

function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    } catch {
        return undefined;
    }
}

function extractCompanyProfileData($) {
    const payloads = $('script[data-company-profile-data][type="application/json"]').map((_, element) => {
        const json = $(element).html() || '';
        return safeJsonParse(json);
    }).get();

    return payloads.find((payload) => payload?.companyProfile)?.companyProfile;
}

function buildCompanyProfileRecord(companyProfile, fallbackCompanyName) {
    const primaryContact = Array.isArray(companyProfile?.contacts) ? companyProfile.contacts[0] : undefined;

    return pruneRecord({
        broker_company: companyProfile?.name || companyProfile?.displayName || fallbackCompanyName,
        agent_name: primaryContact?.name,
        agent_title: primaryContact?.title,
        agent_phone: primaryContact?.phone?.[0]?.phoneFormatted
            || primaryContact?.phonesWithLabels?.[0]?.phone,
        agent_email: primaryContact?.email,
        broker_homepage_url: sanitizeUrl(companyProfile?.homepageUrl),
        broker_logo_url: sanitizeUrl(companyProfile?.logo),
    });
}

function formatPoiEntries(card) {
    return uniqueStrings((card?.data?.pois || []).map((poi) => [poi.name, poi.distance].filter(Boolean).join(': ')));
}

function extractNeighborhoodApiRecord(payload) {
    const cards = Array.isArray(payload?.cards) ? payload.cards : [];
    const transportCard = cards.find((card) => /transport/i.test(normalizeWhitespace(card?.data?.title)));
    const shoppingCard = cards.find((card) => /butikk|handel/i.test(normalizeWhitespace(card?.data?.title)));
    const schoolCard = cards.find((card) => /skole/i.test(normalizeWhitespace(card?.data?.title)));
    const recommendedCard = cards.find((card) => /anbefalt/i.test(normalizeWhitespace(card?.data?.title)));

    return pruneRecord({
        area_profile_url: sanitizeUrl(payload?.readMoreLink),
        nearby_public_transport: formatPoiEntries(transportCard),
        nearby_shopping: formatPoiEntries(shoppingCard),
        nearby_schools: formatPoiEntries(schoolCard),
        neighborhood_recommended_for: uniqueStrings(recommendedCard?.data?.content || []),
    });
}

async function fetchNeighborhoodApiRecord(finnkode, proxyConfiguration) {
    if (!finnkode) return undefined;

    const requestOptions = {
        url: `${NEIGHBORHOOD_API_URL}?finnkode=${encodeURIComponent(finnkode)}`,
        headers: {
            accept: 'application/json,text/plain,*/*',
            ...REQUEST_HEADERS,
        },
        responseType: 'json',
        timeout: { request: 30000 },
        retry: { limit: 0 },
        throwHttpErrors: false,
    };

    if (proxyConfiguration) {
        requestOptions.proxyUrl = await proxyConfiguration.newUrl();
    }

    try {
        const response = await gotScraping(requestOptions);
        if (response.statusCode >= 400 || !response.body || typeof response.body !== 'object') return undefined;
        return extractNeighborhoodApiRecord(response.body);
    } catch {
        return undefined;
    }
}

function stripHtmlTags(value) {
    return normalizeWhitespace(String(value || '').replace(/<[^>]+>/g, ' '));
}

function normalizeViewingText(value) {
    return normalizeWhitespace(String(value || ''))
        .replace(/Legg til i kalender.*$/i, '')
        .replace(/Visningspamelding.*$/i, '')
        .replace(/Visningspåmelding.*$/i, '')
        .replace(/Kalender.*$/i, '')
        .replace(/Legg til som favoritt.*$/i, '')
        .trim();
}

function findHeading($, headingNames) {
    const wanted = headingNames.map((name) => normalizeWhitespace(name).toLowerCase());
    return $('h1, h2, h3').filter((_, element) => wanted.includes(normalizeWhitespace($(element).text()).toLowerCase())).first();
}

function collectSectionTextAfterHeading($, headingNames, stopNames = SECTION_STOPS) {
    const heading = findHeading($, Array.isArray(headingNames) ? headingNames : [headingNames]);
    if (!heading.length) return '';

    const normalizedStops = stopNames.map((name) => normalizeWhitespace(name).toLowerCase());
    const parts = [];
    let sibling = heading.next();

    while (sibling.length) {
        const tagName = sibling[0]?.tagName?.toLowerCase();
        const siblingText = normalizeWhitespace(sibling.text());

        if (/^h[1-6]$/.test(tagName) && normalizedStops.includes(siblingText.toLowerCase())) {
            break;
        }

        if (siblingText) parts.push(siblingText);
        sibling = sibling.next();
    }

    return normalizeWhitespace(parts.join(' '));
}

function collectSectionTextFromBody(bodyText, headingNames, stopNames = SECTION_STOPS) {
    const headings = Array.isArray(headingNames) ? headingNames : [headingNames];

    for (const headingName of headings) {
        const stops = stopNames.map((name) => escapeRegex(name)).join('|');
        const pattern = new RegExp(`${escapeRegex(headingName)}\\s+([\\s\\S]+?)(?=\\s+(?:${stops})\\b|$)`, 'i');
        const value = pickValue(bodyText, pattern);
        if (value) return value;
    }

    return '';
}

function collectSectionText($, bodyText, headingNames, stopNames = SECTION_STOPS) {
    return collectSectionTextAfterHeading($, headingNames, stopNames)
        || collectSectionTextFromBody(bodyText, headingNames, stopNames);
}

function locateListingCard($, element, title) {
    let current = $(element).parent();
    let bestMatch = $(element).parent();

    for (let depth = 0; depth < 7 && current.length; depth++) {
        const text = normalizeWhitespace(current.text());
        if (!text) {
            current = current.parent();
            continue;
        }

        bestMatch = current;

        if (
            text.includes(title)
            && text.length > title.length + 20
            && text.length < 2000
            && (/kr|m2|m²|soverom|Selveier|Andel|Visning|Til salgs|Solgt|Kommer for salg/i.test(text) || current.find('img').length)
        ) {
            return current;
        }

        current = current.parent();
    }

    return bestMatch;
}

function extractSearchResults($, pageUrl) {
    const results = [];
    const seenCodes = new Set();

    $('a[href*="finnkode="]').each((_, element) => {
        const href = $(element).attr('href');
        const absoluteUrl = toAbsoluteUrl(href, pageUrl);
        if (!absoluteUrl || !/\/realestate\/(homes|project|planned)\//i.test(absoluteUrl)) return;

        const finnkode = extractFinnCode(absoluteUrl);
        const title = normalizeWhitespace($(element).text());

        if (!finnkode || !title || title.length < 10 || seenCodes.has(finnkode)) return;

        const card = locateListingCard($, element, title);
        const cardText = normalizeWhitespace(card.text());
        const imageUrls = uniqueStrings(
            card.find('img[src]').map((__, image) => toAbsoluteUrl($(image).attr('src'), pageUrl)).get().filter((src) => /finncdn\.no/i.test(src || '')),
        );

        const summary = pruneRecord({
            finnkode,
            url: absoluteUrl,
            listing_type: absoluteUrl.match(/\/realestate\/(homes|project|planned)\//i)?.[1],
            title,
            status: normalizeListingStatus(cardText),
            property_type: findEnum(cardText, PROPERTY_TYPES),
            ownership_type: findEnum(cardText, OWNERSHIP_TYPES),
            bedrooms: pickInteger(cardText, /(\d+)\s+soverom/i),
            usable_area_sqm: pickInteger(cardText, /(\d[\d\s]*)\s*m(?:2|²)/i),
            asking_price: pickValue(cardText, /(?:^|\s)([0-9\s]+\s*kr)(?=\s|$)/i),
            total_price: pickValue(cardText, /Totalpris\s*:?\s*([0-9\s]+\s*kr(?:\s*-\s*[0-9\s]+\s*kr)?)/i),
            shared_costs_month: pickValue(cardText, /Fellesutg\.?\s*:?\s*([0-9\s]+\s*kr)/i),
            image_urls: imageUrls.filter((src) => !/\/logo\//i.test(src || '')),
        });

        results.push({
            ...summary,
            _summaryText: cardText,
        });
        seenCodes.add(finnkode);
    });

    return results;
}

function findNextPage($, baseUrl, currentPage) {
    const relNext = $('a[rel="next"]').first().attr('href');
    if (relNext) return toAbsoluteUrl(relNext, baseUrl);

    const currentPageNumber = Number.parseInt(currentPage, 10);
    const nextLink = $('a[href*="page="]').filter((_, element) => {
        const text = normalizeWhitespace($(element).text());
        const ariaLabel = normalizeWhitespace($(element).attr('aria-label'));

        if (/neste/i.test(text) || /neste/i.test(ariaLabel)) return true;
        if (Number.isInteger(currentPageNumber) && text === String(currentPageNumber + 1)) return true;

        return false;
    }).first().attr('href');

    return nextLink ? toAbsoluteUrl(nextLink, baseUrl) : undefined;
}

function matchesFilters(record, input) {
    const searchableText = normalizeWhitespace([
        record.title,
        record.address,
        record.property_type,
        record.ownership_type,
        record.status,
        record.description,
        record._summaryText,
    ].filter(Boolean).join(' ')).toLowerCase();

    if (input.keyword && !searchableText.includes(normalizeWhitespace(input.keyword).toLowerCase())) return false;
    if (input.location && !searchableText.includes(normalizeWhitespace(input.location).toLowerCase())) return false;
    if (input.propertyType && !searchableText.includes(normalizeWhitespace(input.propertyType).toLowerCase())) return false;

    if (Number.isInteger(input.minBedrooms) && input.minBedrooms > 0) {
        if (!Number.isInteger(record.bedrooms) || record.bedrooms < input.minBedrooms) return false;
    }

    return true;
}

function extractDetailRecord($, requestUrl, summary) {
    const bodyText = normalizeWhitespace($('body').text());
    const keyInfoText = collectSectionText($, bodyText, ['Nokkelinfo', 'Nøkkelinfo'], ['Fasiliteter', 'Om boligen', ...SECTION_STOPS]);
    const facilitiesText = collectSectionText($, bodyText, 'Fasiliteter', ['Om boligen', ...SECTION_STOPS]);
    const descriptionText = collectSectionText($, bodyText, 'Om boligen', SECTION_STOPS);
    const viewingText = collectSectionText($, bodyText, 'Visning', SECTION_STOPS);
    const adInfoText = collectSectionText($, bodyText, ['Annonseinformasjon', 'Annonseinformasjon'], ['Cookieinnstillinger']);
    const propertyTypeText = pickValue(keyInfoText, /Boligtype\s*(.+?)(?=\s+Eieform|\s+Soverom|\s+Internt bruksareal|\s+Bruksareal|\s+Eksternt bruksareal|\s+Bygge[åa]r|\s+Rom|\s+Tomteareal|$)/i);
    const ownershipTypeText = pickValue(keyInfoText, /Eieform\s*(.+?)(?=\s+Soverom|\s+Internt bruksareal|\s+Bruksareal|\s+Eksternt bruksareal|\s+Bygge[åa]r|\s+Rom|\s+Tomteareal|$)/i);
    const summaryViewing = normalizeViewingText(
        pickValue(summary._summaryText, /Visning\s*-\s*(.+)$/i)
        || (summary._summaryText?.includes('Visning etter avtale') ? 'Visning etter avtale' : ''),
    );

    const brokerLogoAlt = normalizeWhitespace($('img[alt*="Logo for"]').first().attr('alt') || '');
    const companyProfile = extractCompanyProfileData($);
    const companyProfileRecord = buildCompanyProfileRecord(
        companyProfile,
        brokerLogoAlt.replace(/^Logo for\s+/i, '').replace(/\.$/, ''),
    );
    const phoneLink = $('a[href^="tel:"]').first();
    const phoneContainer = phoneLink.closest('section, article, div');
    const imageUrls = uniqueStrings(
        $('img[src]').map((_, image) => toAbsoluteUrl($(image).attr('src'), requestUrl)).get().filter((src) => /finncdn\.no/i.test(src || '') && !/\/logo\//i.test(src || '')),
    );

    const record = pruneRecord({
        finnkode: extractFinnCode(requestUrl) || extractFinnCode(adInfoText) || summary.finnkode,
        url: requestUrl,
        listing_type: summary.listing_type || requestUrl.match(/\/realestate\/(homes|project|planned)\//i)?.[1],
        status: summary.status,
        title: normalizeWhitespace($('h1').first().text()) || summary.title,
        address: pickValue(bodyText, /Apne kart for\s+(.+?)(?=\s+Prisantydning|\s+Nokkelinfo|\s+Nøkkelinfo)/i),
        asking_price: pickValue(bodyText, /Prisantydning\s*([0-9\s]+\s*kr(?:\s*-\s*[0-9\s]+\s*kr)?)/i) || summary.asking_price,
        total_price: pickValue(bodyText, /Totalpris\s*([0-9\s]+\s*kr(?:\s*-\s*[0-9\s]+\s*kr)?)/i) || summary.total_price,
        shared_costs_month: pickValue(bodyText, /Felles(?:kost\/mnd\.|utg\.?)(?:\s*:?\s*)([0-9\s]+\s*kr)/i) || summary.shared_costs_month,
        municipal_fees_year: pickValue(bodyText, /Kommunale avg\.\s*([0-9\s]+\s*kr)/i),
        property_tax_year: pickValue(bodyText, /Eiendomsskatt\s*([0-9\s]+\s*kr)/i),
        property_type: findEnum(propertyTypeText || '', PROPERTY_TYPES)
            || summary.property_type
            || findEnum(bodyText, PROPERTY_TYPES),
        ownership_type: findEnum(ownershipTypeText || '', OWNERSHIP_TYPES)
            || summary.ownership_type
            || findEnum(bodyText, OWNERSHIP_TYPES),
        bedrooms: pickInteger(keyInfoText || bodyText, /Soverom\s*(\d+)/i) || summary.bedrooms,
        rooms: pickInteger(keyInfoText || bodyText, /Rom\s*(\d+)/i),
        living_area_sqm: pickInteger(keyInfoText || bodyText, /Internt bruksareal\s*([0-9\s]+)\s*m(?:2|²)/i),
        usable_area_sqm: pickInteger(keyInfoText || bodyText, /Bruksareal\s*([0-9\s]+)\s*m(?:2|²)/i) || summary.usable_area_sqm,
        external_area_sqm: pickInteger(keyInfoText || bodyText, /Eksternt bruksareal\s*([0-9\s]+)\s*m(?:2|²)/i),
        balcony_area_sqm: pickInteger(keyInfoText || bodyText, /Balkong\/Terrasse\s*([0-9\s]+)\s*m(?:2|²)/i),
        lot_area_sqm: pickInteger(keyInfoText || bodyText, /Tomteareal\s*([0-9\s]+)\s*m(?:2|²)/i),
        build_year: pickInteger(keyInfoText || bodyText, /Bygge[åa]r\s*(\d{4})/i),
        energy_label: pickValue(keyInfoText || bodyText, /Energimerking\s*([A-G])/i),
        broker_company: companyProfileRecord?.broker_company || brokerLogoAlt.replace(/^Logo for\s+/i, '').replace(/\.$/, ''),
        agent_name: companyProfileRecord?.agent_name || normalizeWhitespace(phoneContainer.find('h3').first().text()),
        agent_title: companyProfileRecord?.agent_title,
        agent_phone: companyProfileRecord?.agent_phone || normalizeWhitespace(phoneLink.text()) || normalizeWhitespace((phoneLink.attr('href') || '').replace(/^tel:\+?47/i, '')),
        agent_email: companyProfileRecord?.agent_email,
        broker_homepage_url: companyProfileRecord?.broker_homepage_url,
        broker_logo_url: companyProfileRecord?.broker_logo_url,
        next_viewing: summaryViewing
            || normalizeViewingText(pickValue(bodyText, /Neste visning\s*-\s*(.+?)(?=\s+Legg til|\s+Prisantydning|\s+Nokkelinfo|\s+Nøkkelinfo)/i))
            || normalizeViewingText(viewingText),
        facilities: facilitiesText,
        description: stripHtmlTags(descriptionText),
        image_urls: imageUrls.length ? imageUrls : summary.image_urls,
        ownership_history_url: sanitizeUrl(toAbsoluteUrl($('a[href*="ownershiphistory.html"]').first().attr('href'), requestUrl)),
        price_statistics_url: sanitizeUrl(toAbsoluteUrl($('a[href*="prisstatistikk"]').first().attr('href'), requestUrl)),
        area_profile_url: sanitizeUrl(toAbsoluteUrl($('a[href*="/areaprofile/"]').first().attr('href'), requestUrl)),
        reference: pickValue(adInfoText || bodyText, /Referanse\s*([A-Za-z0-9-]+)/i),
        last_modified: pickValue(adInfoText || bodyText, /Sist endret\s*(.+?)(?=\s*Referanse|$)/i),
    });

    return record;
}

async function main() {
    const rawInput = (await Actor.getInput()) || {};
    const requestedLogLevel = normalizeWhitespace(rawInput.logLevel || process.env.APIFY_LOG_LEVEL || 'WARNING').toUpperCase();
    if (log.LEVELS?.[requestedLogLevel]) {
        log.setLevel(log.LEVELS[requestedLogLevel]);
    }

    const input = {
        ...rawInput,
        keyword: normalizeWhitespace(rawInput.keyword || ''),
        location: normalizeWhitespace(rawInput.location || ''),
        minBedrooms: Number.isFinite(Number(rawInput.minBedrooms)) ? Math.max(0, Number(rawInput.minBedrooms)) : undefined,
        propertyType: normalizeWhitespace(rawInput.propertyType || ''),
        results_wanted: Number.isFinite(Number(rawInput.results_wanted)) ? Math.max(1, Number(rawInput.results_wanted)) : 20,
        max_pages: Number.isFinite(Number(rawInput.max_pages)) ? Math.max(1, Number(rawInput.max_pages)) : 5,
        collectDetails: rawInput.collectDetails !== false && process.env.FINN_COLLECT_DETAILS !== 'false',
        outputBatchSize: Number.isFinite(Number(rawInput.outputBatchSize ?? rawInput.batchSize))
            ? Math.max(1, Math.min(100, Number(rawInput.outputBatchSize ?? rawInput.batchSize)))
            : 25,
    };

    const startUrls = [];
    if (Array.isArray(rawInput.startUrls)) startUrls.push(...rawInput.startUrls);
    if (rawInput.startUrl) startUrls.push(rawInput.startUrl);
    if (rawInput.url) startUrls.push(rawInput.url);
    if (!startUrls.length) startUrls.push(DEFAULT_START_URL);

    const initialRequests = uniqueStrings(startUrls)
        .map((requestUrl) => toAbsoluteUrl(requestUrl, BASE_URL))
        .filter(Boolean)
        .map((requestUrl) => ({
            url: requestUrl,
            userData: {
                label: 'LIST',
                pageNo: 1,
            },
        }));

    const proxyConfiguration = rawInput.proxyConfiguration
        ? await Actor.createProxyConfiguration({ ...rawInput.proxyConfiguration })
        : undefined;

    const queuedDetailIds = new Set();
    const savedRecordKeys = new Set();
    const datasetBuffer = [];
    let savedCount = 0;
    let flushChain = Promise.resolve();

    async function flushDatasetBuffer(force = false) {
        flushChain = flushChain.then(async () => {
            if (!datasetBuffer.length) return;
            if (!force && datasetBuffer.length < input.outputBatchSize) return;

            const items = datasetBuffer.splice(0, datasetBuffer.length);
            await Dataset.pushData(items);
        });

        await flushChain;
    }

    async function pushRecord(record) {
        const cleanedRecord = pruneRecord(record);
        if (!cleanedRecord) return false;

        delete cleanedRecord._summaryText;

        const dedupeKey = normalizeWhitespace(
            cleanedRecord.finnkode
            || cleanedRecord.url
            || [cleanedRecord.title, cleanedRecord.address].filter(Boolean).join(' | '),
        );

        if (!dedupeKey || savedRecordKeys.has(dedupeKey)) return false;

        savedRecordKeys.add(dedupeKey);
        datasetBuffer.push(cleanedRecord);
        savedCount++;
        await flushDatasetBuffer(false);
        return true;
    }

    async function fetchSearchPageHtml(url) {
        const requestOptions = {
            url,
            headers: {
                accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                ...REQUEST_HEADERS,
            },
            timeout: { request: 30000 },
            retry: { limit: 1 },
            throwHttpErrors: false,
        };

        if (proxyConfiguration) {
            requestOptions.proxyUrl = await proxyConfiguration.newUrl();
        }

        try {
            const response = await gotScraping(requestOptions);
            if (response.statusCode >= 400) return '';
            return typeof response.body === 'string' ? response.body : String(response.body || '');
        } catch {
            return '';
        }
    }

    // Fast mode: extract directly from search pages only (no detail page visits).
    if (!input.collectDetails) {
        const pageQueue = initialRequests.map((request) => ({
            url: request.url,
            pageNo: request.userData?.pageNo || 1,
        }));
        const visitedPages = new Set();

        while (pageQueue.length && savedCount < input.results_wanted) {
            const current = pageQueue.shift();
            if (!current?.url) continue;

            const pageKey = `${current.pageNo}:${current.url}`;
            if (visitedPages.has(pageKey)) continue;
            visitedPages.add(pageKey);

            const html = await fetchSearchPageHtml(current.url);
            if (!html) continue;

            const $ = load(html);
            const listings = extractSearchResults($, current.url)
                .filter((listing) => matchesFilters(listing, input));

            for (const listing of listings) {
                if (savedCount >= input.results_wanted) break;

                const item = pruneRecord({
                    ...listing,
                    scraped_at: new Date().toISOString(),
                });

                if (!item) continue;
                await pushRecord(item);
            }

            if (current.pageNo < input.max_pages && savedCount < input.results_wanted) {
                const nextPageUrl = findNextPage($, current.url, current.pageNo);
                if (nextPageUrl) {
                    pageQueue.push({
                        url: nextPageUrl,
                        pageNo: current.pageNo + 1,
                    });
                }
            }
        }

        await flushDatasetBuffer(true);
        log.info(`Finished fast mode. Saved ${savedCount} listings.`);
        return;
    }

    const crawler = new CheerioCrawler({
        proxyConfiguration,
        useSessionPool: true,
        maxConcurrency: 8,
        maxRequestRetries: 3,
        requestHandlerTimeoutSecs: 60,
        async requestHandler({ request, $, enqueueLinks }) {
            const label = request.userData?.label || 'LIST';

            if (label === 'LIST') {
                if (savedCount >= input.results_wanted) return;

                const listings = extractSearchResults($, request.url)
                    .filter((listing) => matchesFilters(listing, input));
                const remaining = Math.max(0, input.results_wanted - savedCount);
                const detailRequests = [];

                for (const listing of listings) {
                    if (detailRequests.length >= remaining) break;
                    if (!listing.finnkode || queuedDetailIds.has(listing.finnkode)) continue;

                    queuedDetailIds.add(listing.finnkode);
                    detailRequests.push({
                        url: listing.url,
                        userData: {
                            label: 'DETAIL',
                            summary: listing,
                        },
                    });
                }

                if (detailRequests.length) {
                    await enqueueLinks({
                        urls: detailRequests.map((entry) => entry.url),
                        transformRequestFunction: (requestOptions) => {
                            const summary = detailRequests.find((entry) => entry.url === requestOptions.url)?.userData.summary;
                            return {
                                ...requestOptions,
                                userData: {
                                    label: 'DETAIL',
                                    summary,
                                },
                            };
                        },
                    });
                }

                if (request.userData.pageNo < input.max_pages && savedCount < input.results_wanted) {
                    const nextPageUrl = findNextPage($, request.url, request.userData.pageNo);
                    if (nextPageUrl) {
                        await enqueueLinks({
                            urls: [nextPageUrl],
                            userData: {
                                label: 'LIST',
                                pageNo: request.userData.pageNo + 1,
                            },
                        });
                    }
                }

                return;
            }

            if (label === 'DETAIL') {
                if (savedCount >= input.results_wanted) return;

                const summary = request.userData?.summary || {};
                const finnkode = summary.finnkode || extractFinnCode(request.url);
                const neighborhoodRecord = await fetchNeighborhoodApiRecord(finnkode, proxyConfiguration);
                const record = pruneRecord({
                    ...summary,
                    ...extractDetailRecord($, request.url, summary),
                    ...neighborhoodRecord,
                    scraped_at: new Date().toISOString(),
                });

                if (!record || !matchesFilters(record, input)) return;
                await pushRecord(record);
            }
        },
        failedRequestHandler({ request, log: crawlerLog }, error) {
            crawlerLog.warning(`Request failed permanently: ${request.url}`, {
                error: error.message,
            });
        },
    });

    await crawler.run(initialRequests);
    await flushDatasetBuffer(true);
    log.info(`Finished detail mode. Saved ${savedCount} listings.`);
}

main()
    .catch((error) => {
        log.exception(error, 'Actor failed');
        process.exitCode = 1;
    })
    .finally(async () => {
        await Actor.exit();
    });

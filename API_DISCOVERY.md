## Selected API

- Search endpoint: https://www.finn.no/realestate/{subvertical}/search.html.data
- Detail endpoint: https://www.finn.no/realestate/{subvertical}/ad.html.data?finnkode={finnkode}
- Method: GET
- Authentication: None observed for public homes-for-sale search and detail data
- Search pagination: page query parameter, 1-based, with the response metadata providing the final page
- Search response: JSON array using React Router single-fetch reference encoding; it must be rehydrated before reading the results object
- Detail response: JSON array using the same reference encoding; the rehydrated route data contains objectData.ad
- Response markers: Content-Type text/x-script; charset=utf-8, a JSON-array body, search docs plus metadata, or detail objectData.ad
- Proxy requirement: None observed during discovery; the actor accepts optional Apify Proxy configuration for larger or repeated runs

## Discovery Results

The existing actor made HTML requests for search pages and individual ad pages. The supplied run log showed 53 total requests, 16 successful responses, 37 HTTP 429 failures, and only 15 saved listings. The API route avoids the failed HTML detail requests and exposes structured data directly.

The search endpoint was tested with:

https://www.finn.no/realestate/homes/search.html.data?location=0.20061&sort=PUBLISHED_DESC&page=1

Observed response:

- HTTP 200
- text/x-script; charset=utf-8
- 238,218-byte body
- 50 listing documents
- Pagination metadata with current page, last page, result counts, selected filters, and search title
- More than 50 useful nested fields across the search documents

The detail endpoint was tested with:

https://www.finn.no/realestate/homes/ad.html.data?finnkode=470017293

Observed response:

- HTTP 200
- text/x-script; charset=utf-8
- 166,243-byte body
- Rehydrated route data with objectData.ad, companyProfile, priceStatistics, prospectus data, floor-plan data, and other listing modules
- Rich property data including structured prices, areas, coordinates, contact details, images, facilities, descriptions, viewings, cadastral numbers, documents, ownership, construction year, and advertiser references

## Candidate Matrix

| Candidate                              | Header profile                                   | Status/body                                                                | Fields                                            | Pagination              | Decision                                                         |
| -------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------- | ---------------------------------------------------------------- |
| Search search.html.data                | Direct HTTP with browser referer                 | 200, 238 KB, JSON-array single-fetch payload                               | 50+ useful nested fields                          | page, response metadata | Selected for search and pagination                               |
| Detail ad.html.data                    | Direct HTTP with listing referer                 | 200, 166 KB, JSON-array single-fetch payload                               | 50+ useful nested fields plus rich nested ad data | One listing per request | Selected for detail enrichment                                   |
| neighborhood-api-alt.json              | Direct HTTP                                      | 200, 4.5 KB JSON                                                           | Neighborhood cards and profile link only          | No listing pagination   | Not used; removed from the fast path                             |
| searchContext/api                      | Direct HTTP                                      | 200, 6.7 KB JSON                                                           | Price statistics and context data                 | No listing pagination   | Rejected as primary source, kept as a possible supporting source |
| JSON-LD on search HTML                 | iOS Safari, Android-style, and desktop probes    | 200 HTML, breadcrumb data only                                             | Breadcrumb metadata, not listings                 | None                    | Rejected                                                         |
| NEXT_DATA and common hydration globals | iOS Safari, Android-style, and desktop probes    | No expected marker found                                                   | None confirmed                                    | None                    | Rejected                                                         |
| Legacy /api/search-qf                  | Official API documentation and live route checks | Requires FINN API access; legacy public route is not usable for this actor | Potentially rich but authenticated                | API-defined             | Rejected because public actor input has no API key               |
| URLScan existing scans                 | URLScan domain search                            | Existing Finn scans were found, but result retrieval returned 403          | Not inspectable                                   | Unknown                 | Not used as evidence                                             |
| URLScan public submission              | Public scan request                              | Current URLScan endpoint returned 401 because an API key was required      | Not available                                     | Unknown                 | Discovery continued with direct HTTP probes                      |
| HTML parsing                           | Existing Cheerio flow                            | 429-heavy run, 15 saved items                                              | Existing fields only                              | Search-page pagination  | Replaced                                                         |

## Field Coverage

The existing actor exposed roughly 40 named output fields. The selected route adds reliable structured values for:

- Numeric asking, total, shared-cost, tax, collective-asset, and sales-cost values
- Local area, postal address components, latitude, longitude, and coordinate accuracy
- Floor, construction year, internal/external/open areas, plot ownership, and cadastral references
- Image URLs without a separate image-metadata object
- Facilities as both a readable string and an array
- Sectioned descriptions and full property information
- Viewing dates, start/end times, calendar values, and notes
- Broker organization, contact, logo, homepage, and profile links
- Floor plans, documents, prospectus links, electronic-bid links, and other public listing links
- Publication and last-edited timestamps from the search and detail payloads

The rewrite preserves the existing output field names and adds API-derived fields where they improve analysis. Empty and null-like values are removed before dataset writes, and records are deduplicated by Finn code or canonical listing URL.

## Request Notes

- Discovery requests succeeded without an Apify Proxy.
- Direct requests used a coherent browser referer for the corresponding public page and an `Accept: text/x-script; charset=utf-8` value compatible with the single-fetch payload.
- The production actor uses a small pool of impit clients (desktop Chrome and Firefox fingerprints) for connection reuse and consistent TLS/header behavior. It adds only request-specific headers (referer, accept-language, sec-fetch-*) on top of the browser fingerprint generated by impit.
- Search pages are fetched sequentially up to the user-provided max_pages cap. Listing requests are paced by an adaptive token-bucket gate: it starts near the observed sustainable rate, ramps up after clean streaks, and halves the rate on HTTP 429/403/5xx so bursts no longer trip the source limit. Without a proxy all clients share one gate (same IP, one pacing budget); with Apify Proxy each session gets its own gate and its own IP, so enriched runs scale with the number of sessions.
- Retries respect the `Retry-After` header, add jittered exponential backoff, and treat 429/403/408/425/5xx as retryable. A listing whose detail fetch still fails is saved from its search API data instead of being lost.
- The `fetch_details` input toggles listing enrichment on and off; it is disabled by default. Disabled runs only read the search API, which already exposes prices, areas, coordinates, broker company, logo, image dimensions, viewings, and listing flags.
- The actor stops on empty pages, the API-reported last page, the configured page limit, or the requested result count. Duplicate listings are skipped before a listing request is made, and enriched records are cached per run.

## Implementation Decision

Use the structured .html.data route as the primary extraction source. Rehydrate the indexed JSON array generically, locate the search result node by its docs and metadata shape, locate detail data by its objectData.ad shape, map all useful public fields from both payloads, omit the slow neighborhood side request and raw diagnostic object from dataset records, and remove the old HTML parsing and old HTTP client.

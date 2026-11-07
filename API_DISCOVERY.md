# Finn.no API discovery

Evidence behind the request flow in `src/main.js`. Read this first when a run fails.

Checked: 2026-11-07, against the live site from a Norwegian residential IP and an
Apify-style cloud run.

## 1. What Finn.no serves

| Route                                               | Response                   | Notes                                                        |
| --------------------------------------------------- | -------------------------- | ------------------------------------------------------------ |
| `/realestate/{vertical}/search.html`                | HTML (SSR)                 | Full search payload inlined in `window.__reactRouterContext` |
| `/realestate/{vertical}/search.html.data`           | `text/x-script` JSON array | Same payload, React Router single-fetch format               |
| `/realestate/{vertical}/ad.html?finnkode={id}`      | HTML (SSR)                 | Full listing payload inlined                                 |
| `/realestate/{vertical}/ad.html.data?finnkode={id}` | `text/x-script` JSON array | Same payload                                                 |

`{vertical}` is `homes`, `homes/newly-built`, `plots`, `holidays`, and similar.

The actor uses the `.data` route first and the rendered HTML only as a fallback.
Both are produced by the same loader, so either one carries the full payload.

Endpoints that do **not** exist (404): `search.json`, `search.jsonld`,
`search.rss`, `www.finn.no/api/search`, `api.finn.no/mobile/api/*`. There is no
public listings API, so the page payload remains the only data source.

## 2. Payload format

`search.html.data` returns a flat array of values. Objects store keys as
`"_<index>"` and reference other entries by numeric index. `src/main.js`
(`rehydrateReferences`) resolves those references into a normal object.

```
[ {"_1":2,"_3":-5}, "loaderData", {"_5":6}, ... ]
```

Negative numbers are serialization markers, not references, and must be skipped.

The SSR HTML embeds the identical stream as escaped JavaScript strings:

```js
window.__reactRouterContext.streamController.enqueue('[{"_1":2,...}]');
```

`extractStreamReferences` reads every `enqueue("...")` argument, joins the
chunks, and parses the result. This is why the HTML route works as a fallback.

Payload locators, both searched structurally rather than by fixed path:

| Data           | Locator                                              |
| -------------- | ---------------------------------------------------- |
| Search results | object containing `docs` array and `metadata` object |
| Listing detail | object containing `objectData.ad`                    |

Key search fields: `docs[].finnkode`, `heading`, `location`, `canonical_url`,
`price_suggestion.amount`, `price_total.amount`, `price_shared_cost.amount`,
`area_range`, `area_plot`, `coordinates`, `image_urls`, `viewing_times`,
`organisation_name`, `timestamp`.

Key detail fields: `objectData.ad` (`price`, `size`, `plot`, `viewings`,
`propertyInfo`, `generalText`, `facilities`, `energyLabel`, `constructionYear`,
`images`, `documents`, `contact`) and `companyProfile.content`, which holds the
broker profile as an escaped `<script data-company-profile-data>` blob.

Paging: `metadata.paging.{current,last,param}`, 50 documents per page, page
parameter `page`. `metadata.result_size` carries `group_count` and
`match_count`.

## 3. DataDome

Every content route (search, detail, HTML and `.data`) sits behind DataDome.
`robots.txt`, `/api/` and `sitemap.xml` are open.

What the block looks like: HTTP 403, ~770 bytes,
`<script data-cfasync="false" src="https://ct.captcha-delivery.com/i.js">`,
`geo.captcha-delivery.com`, text "Please enable JS and disable any ad blocker".

### Evidence matrix, no cookie present

| Client                                                      | Result                                      |
| ----------------------------------------------------------- | ------------------------------------------- |
| impit `chrome151`, `chrome142`, `chrome136`, `chrome131`    | 403                                         |
| impit `firefox158`, `firefox144`, `firefox133`              | 403                                         |
| impit `okhttp5`, `okhttp4`, `ios18`                         | 403                                         |
| impit with no browser profile                               | 403                                         |
| impit + browser-generated `sec-fetch-*` headers             | 403                                         |
| Patchright, bundled Chromium, `headless: true`              | 403                                         |
| Patchright, bundled Chromium, `headless: true` + desktop UA | 403                                         |
| Patchright, `channel: 'chrome'`, `headless: true`           | 403                                         |
| Patchright, `channel: 'chrome'`, `headless: false`          | 200, 51 listings, in-page `.data` fetch 200 |
| Playwright Chromium, `headless: false` (earlier run)        | 200, challenge solved                       |

So the block is decided by the browser fingerprint, not by the IP alone: the
same address passes once a real browser window has run the challenge. Headless
mode never passes, including with a spoofed desktop user agent.

### IP reputation matters

Repeatedly hitting the challenge with a headless or already-rejected browser
lowers the address score. After a burst of failed probes, even headed Chrome was
served 403 for a while. Two consequences for the actor:

- Never retry a blocked page in a loop without pausing. `solveChallenge` backs
  off 8 s, 16 s, 24 s, 32 s.
- Enable Apify Proxy (residential) for production runs. A fresh address per run
  sidesteps a lowered IP score.

The `datadome` cookie is refreshed by Finn on each response, so one browser
session holds a valid cookie for the whole run.

### Cloud runs

Apify's datacenter proxy passed on the first attempt with headed Chrome and the
in-page fetch flow:

| Run | Input                    | Result                                        |
| --- | ------------------------ | --------------------------------------------- |
| 1   | 5 listings, 1 page       | 5 saved, 1 request, 0 challenges              |
| 2   | 60 listings, 2 pages     | 60 saved, 2 requests, 0 challenges, 64 fields |
| 3   | Detail URL as `startUrl` | exit code 1 with a clear message              |

Every listing came from the search payload. No listing page was loaded, and the
request count matched the page count.

## 4. Request flow in the actor

1. `openSession` launches Patchright with `channel: 'chrome'` and
   `headless: false`. The Playwright base image ships Google Chrome and wraps the
   start command in xvfb, which is what makes a visible window possible in
   Docker.
2. `solveChallenge` navigates once to the search page and waits for
   `article.sf-search-ad`. A retry closes the context and opens a clean one, so
   the rejected `datadome` cookie is dropped.
3. Every search page is fetched with `fetch()` **inside that page**,
   same-origin, against the `.data` route. No navigation happens after step 2,
   so a 20-listing run still costs one request per search page.
4. If an in-page fetch gets 403, `solveChallenge` runs again and the fetch is
   retried once. The HTML route is tried when the `.data` route fails.

One proxy address is used for the whole run (`newUrl('finnno')`). The cookie is
bound to that address, so rotating proxy sessions mid-run invalidates it.

## 5. Failure playbook

| Symptom                            | Check                                               | Action                                                                 |
| ---------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- |
| `DataDome challenge did not clear` | Is the window running headed on a display?          | Check `channel` and the xvfb wrapper; headless never passes            |
| 403 after the challenge cleared    | `challenges=` counter in the `Done` line            | Raise `MAX_RETRIES`, or move to residential proxy                      |
| 200 but no docs                    | `docs` array empty, or payload shape changed        | Log the payload keys; the loader route changed                         |
| `No React Router payload found`    | Body is HTML but no `streamController.enqueue`      | Search for `__reactRouterContext` and adjust `extractStreamReferences` |
| Cookie works then expires mid-run  | `challenges=` above zero near the end of a long run | Expected; the session re-solves and continues                          |

## 6. Re-checking the site

```bash
npm start
```

With `storage/key_value_stores/default/INPUT.json` set to a small search. Any
regression in the endpoint, the payload encoding, or the challenge shows up in
the first page request. Verify the challenge path before touching the parsers.

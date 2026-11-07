## What does Finn.no Property Scraper do?

Finn.no Property Scraper collects homes for sale from Finn.no, Norway's largest
property marketplace, and saves them as a clean dataset. Give it a search URL
from Finn.no and it returns the listings on that page: address, asking price,
total price, monthly shared costs, property type, ownership type, bedrooms,
living area, coordinates, broker, photos, and viewing times.

By default it reads the search results only, which is the fastest mode. Turn on
`fetch_details` and each listing is opened as well, adding build year, energy
label, floor, facilities, room count, full description, floor plans, documents,
broker contact details, and prospectus links.

The output is ready for spreadsheets, dashboards, price monitoring, or a
property database. No Finn.no account and no API key are needed.

## Why use Finn.no Property Scraper?

- **Structured property data** - One row per listing with consistent field names, not copied page text.
- **Filters that stay on Finn.no** - Area, price range, ownership type, and listing status are applied by Finn.no itself when you pass the search URL.
- **Full or light runs** - Search-only runs are quick and cheap; detail runs give a deep record per property.
- **Scheduled runs** - Run daily or hourly to track new listings and price changes, export to CSV, Excel, or JSON, or call the dataset from your own system.

Typical uses: tracking asking prices in a city, watching new listings in a
neighbourhood, feeding a valuation model, building a broker lead list, or
collecting market data for analysis.

## What data can you extract from Finn.no?

| Field | Description |
|-------|-------------|
| `finnkode` | Finn.no listing identifier |
| `url` | Direct link to the listing |
| `title` | Listing headline |
| `address` | Street address, postal code, and city |
| `local_area_name` | Neighbourhood name |
| `asking_price` | Asking price as text, for example `4 500 000 kr` |
| `asking_price_nok` | Asking price as a number |
| `total_price` | Total price including shared debt |
| `shared_costs_month` | Monthly shared costs (felleskostnader) |
| `property_type` | Apartment, house, townhouse, and so on |
| `ownership_type` | Owner, housing cooperative, or share |
| `bedrooms` | Number of bedrooms |
| `rooms` | Total rooms, from the listing page |
| `usable_area_sqm` | Usable area in square metres |
| `lot_area_sqm` | Plot size for houses |
| `build_year` | Construction year, from the listing page |
| `energy_label` | Energy class, from the listing page |
| `floor` | Floor, from the listing page |
| `latitude`, `longitude` | GPS coordinates when published |
| `broker_company` | Estate agency name |
| `agent_name`, `agent_phone`, `agent_email` | Contact person, from the listing page |
| `image_url` | Main photo |
| `image_urls` | All listing photos |
| `viewing_times` | Published viewing times |
| `facilities_list` | Balcony, elevator, garage, and similar |
| `description` | Property description text |
| `floorplan_urls`, `document_urls` | Floor plans and documents, from the listing page |
| `published_at` | Listing date |
| `scraped_at` | When the record was collected |

## How to use Finn.no Property Scraper

1. Open Finn.no and set the filters you want: area, price, ownership type, or listing status.
2. Copy the search URL from the address bar.
3. Paste it into `startUrl`.
4. Set `results_wanted` and `max_pages`.
5. Leave `fetch_details` off for a quick run, or turn it on for full property records.
6. Run the Actor and download the dataset.

If you leave `startUrl` empty, the Actor uses the general homes-for-sale search
in Oslo and the rest of Norway.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | `https://www.finn.no/realestate/homes/search.html` | Finn.no property search URL, including any filters |
| `keyword` | String | No | - | Text filter applied to titles, addresses, and descriptions |
| `location` | String | No | - | Text filter applied to the location or address |
| `results_wanted` | Integer | No | `20` | Maximum number of listings to save |
| `max_pages` | Integer | No | `5` | Maximum number of search pages to read |
| `fetch_details` | Boolean | No | `false` | Open each listing for build year, energy label, facilities, description, floor plans, and contacts |
| `proxyConfiguration` | Object | No | Apify Proxy | Proxy settings for the run |

`startUrl` accepts any Finn.no real-estate search page, for example
`https://www.finn.no/realestate/homes/search.html?price_from=3000000&price_to=6000000`.
Filters in the URL are kept as they are, so the results match what you see on
Finn.no.

## Output Data

| Field | Type | Description |
|-------|------|-------------|
| `finnkode` | String | Listing identifier |
| `url` | String | Listing URL |
| `listing_type` | String | Real-estate section, for example `homes` |
| `status` | String | Listing status, `Til salgs` for active listings |
| `title` | String | Listing headline |
| `address` | String | Full address |
| `asking_price` | String | Asking price as text |
| `asking_price_nok` | Number | Asking price as a number |
| `total_price` | String | Total price as text |
| `total_price_nok` | Number | Total price as a number |
| `shared_costs_month_nok` | Number | Monthly shared costs |
| `property_type` | String | Property type |
| `ownership_type` | String | Ownership form |
| `bedrooms` | Integer | Bedroom count |
| `rooms` | Integer | Room count, detail runs |
| `usable_area_sqm` | Number | Usable area |
| `lot_area_sqm` | Number | Plot area |
| `build_year` | Integer | Construction year, detail runs |
| `energy_label` | String | Energy class, detail runs |
| `latitude` | Number | GPS latitude |
| `longitude` | Number | GPS longitude |
| `broker_company` | String | Estate agency |
| `agent_name` | String | Contact person, detail runs |
| `agent_phone` | String | Contact phone, detail runs |
| `image_urls` | Array | Photo URLs |
| `viewing_times` | Array | Viewing times |
| `facilities_list` | Array | Property facilities, detail runs |
| `description` | String | Description text, detail runs |
| `scraped_at` | String | ISO timestamp |

Fields from the listing page are filled only when `fetch_details` is on. Missing
values mean Finn.no does not publish that detail for the listing.

## Usage Examples

### Basic run

Collect the first 20 homes for sale:

```json
{
  "startUrl": "https://www.finn.no/realestate/homes/search.html",
  "results_wanted": 20
}
```

### Filtered search with full details

Read a filtered Oslo search and open every listing:

```json
{
  "startUrl": "https://www.finn.no/realestate/homes/search.html?location=0.20061&price_to=6000000",
  "results_wanted": 50,
  "max_pages": 3,
  "fetch_details": true
}
```

### Keyword filter across several pages

Keep listings whose address or title mentions a neighbourhood:

```json
{
  "startUrl": "https://www.finn.no/realestate/homes/search.html",
  "keyword": "Grünerløkka",
  "location": "Oslo",
  "results_wanted": 100,
  "max_pages": 5
}
```

## Sample Output

```json
{
  "finnkode": "480441498",
  "url": "https://www.finn.no/realestate/homes/ad.html?finnkode=480441498",
  "listing_type": "homes",
  "status": "Til salgs",
  "title": "Lys og attraktiv 2-roms fra 2024! Lave FK, heis og solfylt balkong",
  "address": "Vollebekkveien 2 G, 0598 Oslo",
  "local_area_name": "Vollebekk",
  "asking_price": "4 500 000 kr",
  "asking_price_nok": 4500000,
  "total_price": "4 638 898 kr",
  "total_price_nok": 4638898,
  "shared_costs_month_nok": 3200,
  "property_type": "Leilighet",
  "ownership_type": "Eier (Selveier)",
  "bedrooms": 1,
  "rooms": 2,
  "usable_area_sqm": 39,
  "build_year": 2024,
  "energy_label": "B",
  "latitude": 59.9471,
  "longitude": 10.8752,
  "broker_company": "Nordvik",
  "agent_name": "Caroline Wang Langer",
  "image_url": "https://images.finncdn.no/dynamic/default/2026/8/vertical-2/example.jpg",
  "viewing_times": ["22. mars 2026, 12:00"],
  "scraped_at": "2026-11-07T09:12:44.115Z"
}
```

## Tips for Best Results

- Copy the search URL after applying filters on Finn.no, so the Actor reads exactly what you see.
- Start with `results_wanted` around 20 to check the output before scheduling a large run.
- Keep `max_pages` low for new-listing monitoring; use higher values for a full market snapshot.
- Turn on `fetch_details` only when you need build year, energy label, facilities, or broker contacts, since it opens every listing.
- Long runs can hit rate limits near the end; the Actor refreshes its session automatically, but a smaller batch per run is more stable.
- Apify residential proxies give the most consistent results because Finn.no applies stricter checks to datacenter traffic.
- When a field is empty, check the listing on Finn.no before assuming the run failed.

## Integrations

- **Google Sheets** - Send each run to a spreadsheet for filtering and charts.
- **Webhooks** - Trigger your own system when a run finishes.
- **Make or Zapier** - Route new listings to email, Slack, or a CRM.
- **API** - Read the dataset from your own application or data warehouse.
- **Schedules** - Run daily or hourly to track new listings and price changes.

## Frequently Asked Questions

### Can I export Finn.no property data to CSV or Excel?

Yes. Apify datasets download as CSV, Excel, JSON, XML, and other formats from the Console or from the dataset API.

### Can I run this Actor on a schedule?

Yes. Create a schedule in Apify Console with your search URL and filters. The Actor saves new listings into a dataset on each run.

### Can I scrape other property types, such as plots or holiday homes?

Yes, if Finn.no publishes that search as a real-estate page. Use the matching search URL, for example a plots or holiday-home search page.

### Can I use my own filters from Finn.no?

Yes. Filters in the `startUrl` are kept, so price range, area, ownership type, and listing status apply exactly as they do on Finn.no.

### Why are some fields empty?

Fields such as `build_year`, `energy_label`, and `agent_phone` come from the listing page and appear only when `fetch_details` is on and Finn.no publishes them.

### Does this Actor require a Finn.no login?

No. It reads public listing pages. No account, cookie, or API key is needed.

### Is it legal to collect data from Finn.no?

Collecting public web data can be legal, but you are responsible for following Finn.no's terms, Norwegian law, and privacy rules. Use the data for legitimate purposes and do not republish personal contact details without a legal basis.

## Support

Report a problem or request a field through the Issues tab on the Actor page. Include the search URL, the input you used, and the run log so the issue can be reproduced.

## Legal Notice

This Actor collects publicly available property listings from Finn.no. The
developer is not affiliated with Finn.no. Users are responsible for how the data
is used and for complying with applicable law and the website's terms.

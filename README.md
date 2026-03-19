# Finn.no Property Scraper

Extract comprehensive Finn.no property listings with rich market details, broker contacts, viewing information, and neighborhood signals. Collect clean real-estate data for research, monitoring, lead generation, and relocation planning with a workflow built for fast, reliable runs.

## Features

- **Rich listing data** - Collect pricing, area, ownership, bedroom, and status information from Finn.no property ads.
- **Broker contact details** - Save company names, agent names, phone numbers, emails, and homepage links when available.
- **Neighborhood insights** - Capture nearby transport, shopping, school, and recommendation data for each listing.
- **Flexible search inputs** - Start from a Finn search URL and refine results with keyword, location, and page limits.
- **Clean output** - Remove duplicates and empty values before saving records to the dataset.

---

## Use Cases

### Market Research
Track asking prices, total prices, area sizes, and listing types across neighborhoods or cities. Use the dataset to compare inventory and identify pricing patterns.

### Lead Generation
Build lists of active broker contacts, agency names, and listing URLs for outreach or sales research. The output is structured for easy export into business tools.

### Relocation Planning
Compare homes by bedrooms, area, ownership type, viewing availability, and neighborhood context before moving. This helps narrow down the most suitable properties faster.

### Portfolio Monitoring
Re-run the same Finn search regularly to monitor new listings, planned homes, and changes in available inventory. This is useful for investors and analysts who want recurring snapshots.

---

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | `https://www.finn.no/realestate/homes/search.html` | Finn homes-for-sale search URL. Use this to apply site-side filters before running the actor. |
| `keyword` | String | No | `""` | Optional text filter matched against listing titles, addresses, and ad text. |
| `location` | String | No | `""` | Optional text filter matched against listing location and address text. |
| `results_wanted` | Integer | No | `20` | Maximum number of dataset items to save. |
| `max_pages` | Integer | No | `5` | Safety cap for paginated search result pages. |
| `proxyConfiguration` | Object | No | `{"useApifyProxy": false}` | Optional proxy settings for larger or repeated runs. |

---

## Output Data

Each dataset item can include the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `finnkode` | String | Finn listing identifier. |
| `url` | String | Property ad URL. |
| `listing_type` | String | Listing type such as `homes`, `project`, or `planned`. |
| `status` | String | Listing status when visible. |
| `title` | String | Listing title. |
| `address` | String | Property address or map label. |
| `asking_price` | String | Advertised asking price. |
| `total_price` | String | Advertised total price. |
| `shared_costs_month` | String | Shared monthly costs when available. |
| `municipal_fees_year` | String | Municipal fees per year. |
| `property_tax_year` | String | Property tax per year. |
| `property_type` | String | Property category. |
| `ownership_type` | String | Ownership type. |
| `bedrooms` | Integer | Bedroom count. |
| `rooms` | Integer | Room count. |
| `living_area_sqm` | Integer | Internal living area in square meters. |
| `usable_area_sqm` | Integer | Usable area in square meters. |
| `external_area_sqm` | Integer | External area in square meters. |
| `balcony_area_sqm` | Integer | Balcony or terrace area in square meters. |
| `lot_area_sqm` | Integer | Plot size in square meters. |
| `build_year` | Integer | Construction year. |
| `energy_label` | String | Energy label. |
| `broker_company` | String | Broker company name. |
| `broker_homepage_url` | String | Broker website. |
| `broker_logo_url` | String | Broker logo URL. |
| `agent_name` | String | Agent name. |
| `agent_title` | String | Agent role or title. |
| `agent_phone` | String | Agent phone number. |
| `agent_email` | String | Agent email address. |
| `next_viewing` | String | Upcoming viewing text. |
| `facilities` | String | Facilities summary. |
| `description` | String | Main property description. |
| `image_urls` | Array | Listing image URLs. |
| `ownership_history_url` | String | Ownership-history link. |
| `price_statistics_url` | String | Price-statistics link. |
| `area_profile_url` | String | Neighborhood profile link. |
| `nearby_public_transport` | Array | Nearby transport options. |
| `nearby_shopping` | Array | Nearby shopping options. |
| `nearby_schools` | Array | Nearby school options. |
| `neighborhood_recommended_for` | Array | Neighborhood profile tags. |
| `reference` | String | Broker reference value. |
| `last_modified` | String | Last modified timestamp on the ad. |
| `scraped_at` | String | ISO timestamp for dataset write time. |

---

## Usage Examples

### Default Run

Use the standard Finn homes-for-sale search page:

```json
{
  "startUrl": "https://www.finn.no/realestate/homes/search.html",
  "results_wanted": 20,
  "max_pages": 2
}
```

### City-Focused Search

Use a finished Finn search URL for a specific area or filter combination:

```json
{
  "startUrl": "https://www.finn.no/realestate/homes/search.html?location=1.20061",
  "results_wanted": 50,
  "max_pages": 4
}
```

### Keyword And Location Filter

Combine built-in filters with your own search URL:

```json
{
  "startUrl": "https://www.finn.no/realestate/homes/search.html",
  "keyword": "garasje",
  "location": "Trondheim",
  "results_wanted": 30,
  "max_pages": 5
}
```

---

## Sample Output

```json
{
  "finnkode": "454908221",
  "url": "https://www.finn.no/realestate/homes/ad.html?finnkode=454908221",
  "listing_type": "homes",
  "status": "Til salgs",
  "title": "Stilfull og oppgradert vertikaldelt halvpart med 3 soverom og 2 bad. Stor terrasse og garasje.",
  "address": "Amalienlyst 1A, 7047 Trondheim",
  "asking_price": "5 850 000 kr",
  "total_price": "5 997 340 kr",
  "shared_costs_month": "400 kr",
  "property_type": "Tomannsbolig",
  "ownership_type": "Eier (Selveier)",
  "bedrooms": 3,
  "rooms": 5,
  "living_area_sqm": 127,
  "usable_area_sqm": 153,
  "external_area_sqm": 26,
  "balcony_area_sqm": 33,
  "lot_area_sqm": 1489,
  "build_year": 1958,
  "broker_company": "DNB Eiendom AS",
  "broker_homepage_url": "https://dnbeiendom.no",
  "agent_name": "Islam Zelimkhanovich Gerikhanov",
  "agent_title": "Daglig leder / Senior Eiendomsmegler",
  "agent_phone": "46 21 50 58",
  "agent_email": "islam.zelimkhanovich.Gerikhanov@dnbeiendom.no",
  "next_viewing": "Mandag, 23. mars 18:30-19:30",
  "area_profile_url": "https://www.finn.no/areaprofile/454908221",
  "nearby_public_transport": [
    "Buss: 5 min",
    "Jernbanestasjon: 13 min"
  ],
  "nearby_shopping": [
    "Dagligvare: 14 min",
    "Kjøpesenter: 15 min"
  ],
  "nearby_schools": [
    "Barneskole: 15 min",
    "Kombinertskole: 16 min"
  ],
  "neighborhood_recommended_for": [
    "Familier med barn",
    "Etablerere",
    "Godt voksne"
  ],
  "reference": "823260099",
  "scraped_at": "2026-03-19T00:00:00.000Z"
}
```

---

## Tips for Best Results

### Use A Finished Finn Search URL
- Configure area, property type, bedroom count, price range, or ownership filters directly on Finn.no.
- Paste the final Finn URL into `startUrl` to keep the run precise and stable.

### Keep Validation Runs Small
- Use `results_wanted: 20` for quick testing.
- Keep `max_pages` low unless you need a wider inventory sample.

### Use Proxies For Larger Runs
- The default flow works without a proxy for standard runs.
- Add proxy settings if you plan to run frequent or high-volume jobs.

### Expect Missing Fields Occasionally
- Some listings expose more detail than others.
- The actor keeps only populated values, so output stays clean even when source pages vary.

---

## Integrations

Connect the dataset to:

- **Google Sheets** - Export listings for reporting and collaboration.
- **Airtable** - Build searchable property databases.
- **Make** - Trigger workflows from new listings.
- **Zapier** - Automate follow-up actions.
- **Webhooks** - Send output to custom endpoints.

### Export Formats

- **JSON** - Best for APIs and structured processing.
- **CSV** - Best for spreadsheets and quick analysis.
- **Excel** - Best for business reporting.
- **XML** - Best for system integrations.

---

## Frequently Asked Questions

### Can I scrape a specific city or area?
Yes. The recommended workflow is to configure the search directly on Finn.no and pass the finished URL in `startUrl`.

### Does the actor collect rich property details?
Yes. The output includes pricing, area, ownership, broker contacts, viewing details, and neighborhood information when Finn exposes it.

### Are duplicate or empty values kept?
No. The actor removes duplicate, empty, and null-like values before saving each item.

### Can I collect project and planned listings?
Yes. If those listings appear in the Finn search results you provide, the actor saves the available fields for them too.

### How many listings can I collect?
You can collect as many as the search returns, subject to `results_wanted` and `max_pages`.

### What should I use for testing?
Start with `results_wanted: 20` and a small `max_pages` value to validate the search before running larger jobs.

---

## Support

For issues or feature requests, use the Apify Console for the actor.

### Resources

- [Apify Documentation](https://docs.apify.com/)
- [Apify API Reference](https://docs.apify.com/api/v2)
- [Scheduling Runs](https://docs.apify.com/schedules)

---

## Legal Notice

This actor is designed for legitimate data collection purposes. Users are responsible for ensuring compliance with website terms of service and applicable laws. Use collected data responsibly and respect rate limits.

## What does Finn.no Property Scraper do?

Finn.no Property Scraper collects structured property listings from Finn.no, Norway's major marketplace for homes, projects, and planned developments. Give it a Finn.no search URL, optionally add text or property filters, and receive listing records with prices, measurements, ownership details, broker contacts, viewing information, images, and neighborhood signals.

Use the dataset for Norwegian real-estate market research, price comparisons, property monitoring, investment analysis, relocation planning, lead generation, or property search products. Results can be downloaded from Apify in JSON, CSV, Excel, XML, and other supported formats, or connected to an API, webhook, spreadsheet, or automation workflow.

## Why use Finn.no Property Scraper?

- **Collect a market-ready property dataset** - Gather listing URLs, Finn codes, titles, addresses, prices, property categories, ownership types, and listing statuses in one dataset.
- **Compare property economics** - Analyze asking prices, total prices, shared monthly costs, municipal fees, property tax, living area, usable area, lot size, and construction year.
- **Find broker and agent contacts** - Capture agency names, agent names, job titles, phone numbers, email addresses, homepage links, and listing references when published on the source page.
- **Add neighborhood context** - Include nearby public transport, shopping, schools, recommended-for tags, and neighborhood profile links when available.
- **Automate repeat collection** - Run on demand or schedule recurring searches in Apify to track new listings and changes in a selected market.
- **Control the collection** - Start with a small result limit, use Finn.no's own search filters, and apply optional keyword, location, property type, and minimum-bedroom filters.

## What data can you extract from Finn.no?

Each saved dataset item represents one property listing. Fields are included when the public listing provides them, so some records may contain more detail than others.

| Field | Type | Description |
|-------|------|-------------|
| `finnkode` | String | Unique Finn.no listing identifier. |
| `url` | String | Direct property listing URL. |
| `listing_type` | String | Listing category such as `homes`, `project`, or `planned`. |
| `status` | String | Listing status, such as `Til salgs`, `Kommer for salg`, or `Solgt`. |
| `title` | String | Property listing title. |
| `address` | String | Property address or map label. |
| `asking_price` | String | Advertised asking price. |
| `total_price` | String | Advertised total price. |
| `shared_costs_month` | String | Shared monthly costs when available. |
| `municipal_fees_year` | String | Annual municipal fees when available. |
| `property_tax_year` | String | Annual property tax when available. |
| `property_type` | String | Property category, such as apartment, detached house, or semi-detached house. |
| `ownership_type` | String | Ownership form published in the listing. |
| `bedrooms` | Integer | Number of bedrooms. |
| `rooms` | Integer | Number of rooms. |
| `living_area_sqm` | Integer | Internal living area in square meters. |
| `usable_area_sqm` | Integer | Usable area in square meters. |
| `external_area_sqm` | Integer | External usable area in square meters. |
| `balcony_area_sqm` | Integer | Balcony or terrace area in square meters. |
| `lot_area_sqm` | Integer | Plot area in square meters. |
| `build_year` | Integer | Construction year. |
| `energy_label` | String | Energy label when shown. |
| `broker_company` | String | Broker or agency name. |
| `broker_homepage_url` | String | Broker website URL. |
| `broker_logo_url` | String | Broker logo URL when available. |
| `agent_name` | String | Responsible agent name. |
| `agent_title` | String | Agent role or title. |
| `agent_phone` | String | Agent phone number. |
| `agent_email` | String | Agent email address. |
| `next_viewing` | String | Next advertised viewing or viewing-by-agreement text. |
| `facilities` | String | Facilities summary. |
| `description` | String | Main property description. |
| `image_urls` | Array | Property image URLs. |
| `ownership_history_url` | String | Link to ownership history when available. |
| `price_statistics_url` | String | Link to price statistics when available. |
| `area_profile_url` | String | Link to the Finn.no neighborhood profile. |
| `nearby_public_transport` | Array | Nearby transport options and distances. |
| `nearby_shopping` | Array | Nearby shops or shopping locations and distances. |
| `nearby_schools` | Array | Nearby schools and distances. |
| `neighborhood_recommended_for` | Array | Neighborhood profile recommendations or tags. |
| `reference` | String | Broker reference value from the listing. |
| `last_modified` | String | Last modified text or timestamp shown on the ad. |
| `scraped_at` | String | ISO timestamp for when the dataset item was saved. |

## How to scrape Finn.no property listings

1. Open Finn.no and configure a homes, project, or planned-property search.
2. Copy the complete search URL, including any Finn.no filters you want to use.
3. Open this Actor on Apify and add the URL to `startUrl`.
4. Set `results_wanted` and `max_pages`, then add optional filters if needed.
5. Run the Actor and review the dataset preview.
6. Download the results or connect the dataset to your application, schedule, webhook, or automation platform.

The default mode collects details from individual property ads. Set `collectDetails` to `false` when you only need the information visible in search-result cards and want a faster, lighter run.

## Input Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `startUrl` | String | No | `https://www.finn.no/realestate/homes/search.html` | One Finn.no search URL. A finished URL is recommended because it preserves Finn.no's area, price, property-type, and other search settings. |
| `startUrls` | Array of Strings | No | `[]` | Multiple Finn.no search URLs to process in one run. |
| `url` | String | No | - | Compatibility alias for one starting URL. Use `startUrl` for new runs. |
| `keyword` | String | No | `` | Text filter matched against listing titles, addresses, descriptions, property details, and search-card text. |
| `location` | String | No | `` | Text filter matched against location and property text. |
| `propertyType` | String | No | `` | Text filter for a property type, such as `Leilighet` or `Enebolig`. |
| `minBedrooms` | Integer | No | - | Minimum number of bedrooms to keep. |
| `results_wanted` | Integer | No | `20` | Maximum number of listings to save. |
| `max_pages` | Integer | No | `5` | Maximum number of result pages to visit per starting URL. |
| `collectDetails` | Boolean | No | `true` | Collect full property-ad details when `true`; set to `false` for search-card data only. |
| `outputBatchSize` | Integer | No | `25` | Number of records buffered before writing a dataset batch. Values are limited to 1-100. |
| `logLevel` | String | No | `WARNING` | Run log level, such as `WARNING`, `INFO`, or another supported Apify log level. |
| `proxyConfiguration` | Object | No | - | Optional Apify proxy settings for larger or repeated runs. |

## Output Data

The Actor removes empty values and duplicate listings before saving results. Numeric fields are returned as integers, while prices and source-formatted financial values remain strings so the original display can be preserved.

| Output group | Fields |
|--------------|--------|
| Identification | `finnkode`, `url`, `listing_type`, `status`, `title`, `address` |
| Financial details | `asking_price`, `total_price`, `shared_costs_month`, `municipal_fees_year`, `property_tax_year` |
| Property details | `property_type`, `ownership_type`, `bedrooms`, `rooms`, `living_area_sqm`, `usable_area_sqm`, `external_area_sqm`, `balcony_area_sqm`, `lot_area_sqm`, `build_year`, `energy_label` |
| Broker details | `broker_company`, `broker_homepage_url`, `broker_logo_url`, `agent_name`, `agent_title`, `agent_phone`, `agent_email`, `reference` |
| Listing content | `next_viewing`, `facilities`, `description`, `image_urls`, `last_modified` |
| Neighborhood data | `area_profile_url`, `nearby_public_transport`, `nearby_shopping`, `nearby_schools`, `neighborhood_recommended_for` |
| Collection metadata | `scraped_at` |

## Usage Examples

### Basic Finn.no property search

Collect up to 20 listings from the default Finn.no homes-for-sale search, visiting two result pages.

```json
{
  "startUrl": "https://www.finn.no/realestate/homes/search.html",
  "results_wanted": 20,
  "max_pages": 2
}
```

### Multiple search URLs

Combine separate Finn.no searches, for example one URL for Oslo and another for Trondheim.

```json
{
  "startUrls": [
    "https://www.finn.no/realestate/homes/search.html?location=2.20001",
    "https://www.finn.no/realestate/homes/search.html?location=1.20061"
  ],
  "results_wanted": 100,
  "max_pages": 4
}
```

### Filtered property collection

Use a Finn.no search URL together with keyword, location, property-type, and minimum-bedroom filters.

```json
{
  "startUrl": "https://www.finn.no/realestate/homes/search.html",
  "keyword": "garasje",
  "location": "Trondheim",
  "propertyType": "Enebolig",
  "minBedrooms": 3,
  "results_wanted": 50,
  "max_pages": 5
}
```

### Fast search-card collection

Set `collectDetails` to `false` when search-result information is sufficient and you want to reduce the amount of page detail collected.

```json
{
  "startUrl": "https://www.finn.no/realestate/homes/search.html",
  "collectDetails": false,
  "results_wanted": 100,
  "max_pages": 3
}
```

## Sample Output

This is one example of a detailed dataset item. Fields not published by a particular Finn.no listing are omitted from that item.

```json
{
  "finnkode": "454908221",
  "url": "https://www.finn.no/realestate/homes/ad.html?finnkode=454908221",
  "listing_type": "homes",
  "status": "Til salgs",
  "title": "Stilfull og oppgradert vertikaldelt bolig med 3 soverom",
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
  "balcony_area_sqm": 33,
  "lot_area_sqm": 1489,
  "build_year": 1958,
  "energy_label": "F",
  "broker_company": "DNB Eiendom AS",
  "broker_homepage_url": "https://dnbeiendom.no",
  "agent_name": "Example Property Agent",
  "agent_title": "Senior Eiendomsmegler",
  "agent_phone": "46 21 50 58",
  "agent_email": "agent@example.com",
  "next_viewing": "Mandag, 23. mars 18:30-19:30",
  "facilities": "Garasje, terrasse, peis",
  "description": "Oppgradert bolig med god planløsning og nærhet til servicetilbud.",
  "image_urls": [
    "https://images.finncdn.no/sample/property-image.jpg"
  ],
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
    "Etablerere"
  ],
  "reference": "823260099",
  "last_modified": "19.03.2026 10:12",
  "scraped_at": "2026-03-19T10:30:00.000Z"
}
```

## Tips for best results

- **Use a finished Finn.no URL** - Configure city, area, property type, bedroom count, price range, and ownership filters on Finn.no before copying the URL.
- **Start with a small run** - Test with 10-20 results and one or two pages before collecting a larger market sample.
- **Use `startUrls` for comparisons** - Submit several saved searches when you need to compare cities, neighborhoods, or property categories in one run.
- **Use filters carefully** - `keyword`, `location`, `propertyType`, and `minBedrooms` are applied to the collected listing text, so source wording can affect matches.
- **Expect optional fields** - Broker contacts, fees, viewing times, neighborhood signals, and measurements can be absent when Finn.no does not publish them.
- **Schedule for monitoring** - A recurring Apify schedule can create periodic snapshots of a market or saved search.

## Integrations and export formats

- **Google Sheets** - Export listings for comparison, reporting, and collaboration.
- **Airtable** - Build a searchable property database with broker and neighborhood fields.
- **Webhooks** - Send a notification or downstream request after a run finishes.
- **Make or Zapier** - Trigger alerts, enrichment, CRM updates, or other no-code workflows.
- **Apify API** - Read dataset items and start runs from your own application.

| Format | Useful for |
|--------|------------|
| JSON | APIs, data processing, and AI or RAG pipelines. |
| CSV | Spreadsheet analysis and simple imports. |
| Excel | Reports and business analysis. |
| XML | Systems that require XML data exchange. |

## Frequently Asked Questions

### Can I collect properties from a specific Norwegian city or neighborhood?

Yes. Configure the location on Finn.no, copy the resulting search URL, and provide it through `startUrl`. You can also use `location` for an additional text match.

### Does the Actor collect broker and agent contact details?

Yes. It collects published broker and agent names, titles, phone numbers, email addresses, agency websites, and references when those values are available on the listing.

### Can I collect project and planned properties?

Yes. The Actor supports Finn.no property result links for homes, projects, and planned listings, although the available fields depend on each listing type.

### Can I run the Actor without collecting full detail pages?

Yes. Set `collectDetails` to `false` to save information found in search-result cards only. The default `true` setting is better when you need measurements, descriptions, broker details, and neighborhood data.

### Why is a field missing from a result?

A field is omitted when the public Finn.no listing does not provide a usable value or when that listing type does not include it. Compare several listings before treating a missing field as a collection problem.

### Can I export Finn.no data to CSV or Excel?

Yes. Apify datasets can be downloaded as CSV, Excel, JSON, XML, and other supported formats, or consumed through the Apify API.

### Is collecting Finn.no data legal?

Public-data collection may be subject to laws, privacy rules, and Finn.no's terms. You are responsible for using the data lawfully, respecting applicable restrictions, and checking the current rules for your intended use.

## Related Actors

- [iProperty Scraper](https://apify.com/shahidirfan/iproperty-scraper) - Collect Malaysian property listings, prices, locations, and agent details.
- [Housing.com Property Scraper](https://apify.com/shahidirfan/housing-com-property-scraper) - Collect Indian real-estate listings for market and investment research.
- [Propertyfinder Scraper](https://apify.com/shahidirfan/propertyfinder-scraper) - Collect UAE property listings with pricing, location, agent, and property details.

## Support

For an issue, unexpected output, or feature request, use the Issues tab on the Actor page in Apify Console. Include the input URL, relevant settings, and an example listing URL when possible. Public listing layouts and available fields can change over time.

## Legal Notice

This Actor is intended for legitimate collection of publicly available property information. Users are responsible for complying with Finn.no's terms, applicable laws, privacy obligations, and any restrictions on storing, sharing, or contacting people using collected data.

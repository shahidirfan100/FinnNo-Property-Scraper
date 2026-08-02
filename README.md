## What does Finn.no Property Scraper do?

Finn.no Property Scraper collects structured property listings from Finn.no, Norway's major marketplace for homes, projects, and planned developments. Provide a Finn.no search URL and receive records with listing identity, prices, property measurements, ownership, broker contacts, viewing details, images, descriptions, and location data.

Use the dataset for Norwegian real-estate research, price comparisons, property monitoring, investment analysis, relocation planning, lead generation, or property search products. The Actor preserves numeric price values alongside readable Norwegian price strings, removes empty values, and prevents the same Finn listing from being saved twice.

## Why use Finn.no Property Scraper?

- **Collect structured property records** - Save Finn codes, canonical listing URLs, titles, addresses, listing types, prices, areas, property categories, and ownership forms.
- **Compare property economics** - Analyze asking price, total price, shared monthly costs, municipal fees, tax value, sales costs, plot size, and usable areas.
- **Enrich listings with broker details** - Capture agency names, organization IDs, agent names, titles, phone numbers, email addresses, logos, and public homepages when published.
- **Understand the location** - Keep postal information, local area names, coordinates, and cadastral references.
- **Review listing content** - Collect descriptions, facilities, image URLs, floor-plan links, public documents, viewing times, prospectus links, and electronic-bid links.
- **Run repeat monitoring** - Use Apify schedules, dataset exports, webhooks, spreadsheets, and programmatic access for recurring workflows.

## What data can you extract from Finn.no?

Fields are saved when the public listing provides them. Project, planned, parking, and other special listing types can legitimately contain fewer property or broker fields than ordinary home listings.

| Field group         | Fields                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listing identity    | finnkode, url, listing_type, status, title, address, local_area_name, external_ad_id, reference, ad_type, search_id, document_type                                                                                                                                                                                                                                                    |
| Price values        | asking_price, asking_price_nok, asking_price_unit, total_price, total_price_nok, total_price_unit, shared_costs_month, shared_costs_month_nok, shared_costs_unit, municipal_fees_year, municipal_fees_year_nok, property_tax_year, property_tax_year_nok, tax_value, tax_value_nok, sales_cost_sum, sales_cost_sum_nok, collective_assets, collective_assets_nok, collective_debt_nok |
| Property details    | property_type, ownership_type, bedrooms, rooms, living_area_sqm, usable_area_sqm, usable_area_sqm_from, usable_area_sqm_to, area_unit, internal_area_sqm, external_area_sqm, open_area_sqm, balcony_area_sqm, lot_area_sqm, lot_area_unit, plot_owned, plot_leasehold_point, floor, build_year, energy_label, housing_cooperative, housing_cooperative_org                            |
| Location            | postal_code, postal_name, country_code, country_name, latitude, longitude, coordinate_accuracy, cadastres, map_image_url                                                                                                                                                                                                                                                              |
| Broker and agent    | broker_company, broker_org_id, broker_homepage_url, broker_logo_url, agent_name, agent_title, agent_phone, agent_email, agent_image_url, advertiser_org_id, seller_emails                                                                                                                                                                                                             |
| Listing content     | description, description_sections, facilities, facilities_list, shared_cost_includes, sales_cost_includes, preemption                                                                                                                                                                                                                                                                 |
| Media and documents | image_url, image_width, image_height, image_aspect_ratio, image_urls, initial_image_url, interior_image_urls, floorplan_urls, floorplan_metadata, document_urls, more_info_links, prospectus_url, electronic_bid_url, electronic_bid_info_url, neighborhood_addresses                                                                                                                 |
| Viewings            | next_viewing, viewing_times, viewing_notes, area_profile_url                                                                                                                                                                                                                                                                                                                          |
| Collection metadata | published_at, published_epoch_ms, last_modified, updated_at, ad_schema_name, ad_schema_version, meta_mode, meta_version, meta_owner_id, listing_flags, styling, labels, is_disposed, is_third_party_advertiser, letting_unit, anonymous, ad_view_type_label, change_of_ownership_insurance, scraped_at                                                                                |

## How to scrape Finn.no property listings

1. Open Finn.no and configure a homes-for-sale, project, or planned-property search.
2. Copy the complete search URL, including Finn.no filters for area, price, property type, ownership, or listing status.
3. Open this Actor on Apify and enter the URL in startUrl.
4. Set results_wanted and max_pages. Add optional keyword or location filters when needed. Enable `fetch_details` to enrich each listing from the listing API; by default the Actor runs purely on search API data, which is very fast and makes no listing requests. For large runs with `fetch_details` enabled, turn on Apify Proxy so listing requests spread across rotating IPs and complete faster.
5. Run the Actor and review the dataset preview.
6. Download the results or connect the dataset to your reporting, monitoring, or data workflow.

The Actor reads the public Finn.no search API (`search.html.data`) and, when enabled, the listing API (`ad.html.data`) instead of parsing HTML pages. This exposes structured data directly and avoids the HTML detail-page requests that previously triggered HTTP 429 rate limits. Search pages are processed up to the configured page limit, and listing requests run through an adaptive throttle that self-heals: it keeps throughput high while Finn.no allows it and smoothly backs off when the source rate-limits the IP, so runs stay stable without hard failures.

## Input Parameters

| Parameter          | Type    | Required | Runtime default                                  | Description                                                                                                                      |
| ------------------ | ------- | -------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| startUrl           | String  | No       | https://www.finn.no/realestate/homes/search.html | Finn.no homes-for-sale search URL. Use a finished URL so Finn.no's own filters are preserved.                                    |
| keyword            | String  | No       | Empty                                            | Optional text match against listing titles, addresses, property details, descriptions, and local area names.                     |
| location           | String  | No       | Empty                                            | Optional text match against listing location and address text.                                                                   |
| results_wanted     | Integer | No       | 20                                               | Maximum number of unique listing records to save.                                                                                |
| max_pages          | Integer | No       | 5                                                | Maximum number of search result pages to process.                                                                                |
| fetch_details      | Boolean | No       | false                                            | Enrich each listing from the listing API. Disabled by default so only search API data is fetched (fastest, no extra requests).   |
| proxyConfiguration | Object  | No       | Disabled (no proxy)                              | Optional Apify Proxy configuration. Leave it disabled to run without a proxy, or enable Apify Proxy for larger or repeated runs. |

## Output Data

The output keeps numeric measurements and prices as numbers where available, while formatted financial fields such as asking_price retain the source-style Norwegian currency display. Every record is cleaned before saving, so null, empty, and duplicate values are not written to the dataset.

| Field                  | Example          | Description                                                                  |
| ---------------------- | ---------------- | ---------------------------------------------------------------------------- |
| finnkode               | 471526900        | Finn.no listing identifier.                                                  |
| asking_price_nok       | 8890000          | Numeric asking price in NOK.                                                 |
| total_price_nok        | 9224075          | Numeric total price in NOK.                                                  |
| usable_area_sqm        | 105              | Usable property area in square meters.                                       |
| latitude and longitude | 59.9137, 10.7245 | Public listing coordinates when available.                                   |
| description_sections   | String           | Flattened, cleaned sections with headings and text separated by blank lines. |
| image_urls             | Array            | Public property image URLs from the listing.                                 |
| more_info_links        | Array            | Public links such as viewing registration or sales documents.                |
| scraped_at             | ISO timestamp    | Time when the record was saved.                                              |

## Usage Examples

### Basic property search

Collect up to 20 listings from the default Finn.no homes-for-sale search.

```json
{
    "startUrl": "https://www.finn.no/realestate/homes/search.html",
    "results_wanted": 20,
    "max_pages": 2
}
```

### Area-filtered search

Use a completed Finn.no search URL for an area and keep the run within two result pages.

```json
{
    "startUrl": "https://www.finn.no/realestate/homes/search.html?location=0.20061",
    "results_wanted": 50,
    "max_pages": 2
}
```

### Keyword and location filtering

Apply additional text filters to retain listings that mention a garage in Trondheim.

```json
{
    "startUrl": "https://www.finn.no/realestate/homes/search.html",
    "keyword": "garasje",
    "location": "Trondheim",
    "results_wanted": 30,
    "max_pages": 5
}
```

## Sample Output

This sample shows the shape of a detailed property record. Fields not published by a particular listing are omitted.

```json
{
    "finnkode": "471526900",
    "url": "https://www.finn.no/realestate/homes/ad.html?finnkode=471526900",
    "listing_type": "homes",
    "status": "Til salgs",
    "title": "Pen og klassisk 4-roms leilighet i attraktive Vika",
    "address": "Huitfeldts gate 14D, 0253 Oslo",
    "local_area_name": "VIKA",
    "asking_price": "8 890 000 kr",
    "asking_price_nok": 8890000,
    "total_price": "9 224 075 kr",
    "total_price_nok": 9224075,
    "shared_costs_month": "6 140 kr",
    "shared_costs_month_nok": 6140,
    "property_type": "Leilighet",
    "ownership_type": "Andel",
    "bedrooms": 2,
    "rooms": 3,
    "living_area_sqm": 95,
    "usable_area_sqm": 95,
    "external_area_sqm": 10,
    "lot_area_sqm": 323,
    "floor": 1,
    "build_year": 1892,
    "energy_label": "G",
    "postal_code": "0253",
    "postal_name": "Oslo",
    "latitude": 59.9137,
    "longitude": 10.7245,
    "broker_company": "Nordvik Frogner",
    "agent_name": "Example Property Agent",
    "agent_title": "Eiendomsmegler",
    "agent_phone": "46 00 00 00",
    "agent_email": "agent@example.com",
    "next_viewing": "09.08.2026 15:00-16:00",
    "facilities": "Bredbåndstilknytning, Hage, Sentralt",
    "description": "Gjennomgående leilighet med sentral beliggenhet og klassiske detaljer.",
    "image_urls": ["https://images.finncdn.no/sample/property-image.jpg"],
    "viewing_times": [
        {
            "date": "09.08.2026",
            "from": "15:00",
            "to": "16:00",
            "dateIso": "2026-08-09"
        }
    ],
    "published_at": "2026-08-02T14:50:57.000Z",
    "scraped_at": "2026-08-02T14:52:55.416Z"
}
```

## Tips for best results

- **Use a finished Finn.no URL** - Configure area, property type, price range, bedrooms, ownership, and sorting on Finn.no before copying the URL.
- **Start with a small run** - Test with 10-20 results and one or two pages before collecting a larger market sample.
- **Control listing detail requests** - `fetch_details` is disabled by default so the Actor saves rich search API data without any listing requests. Enable it for rooms, build year, energy label, descriptions, facilities, and broker contacts. Use Apify Proxy for large enriched runs so listing requests spread across rotating IPs and finish faster.
- **Use source filters first** - Finn.no's own location and price filters are more precise than a broad text match.
- **Expect type-specific fields** - New developments, projects, parking spaces, and planned listings can omit prices, bedrooms, build years, broker contacts, or viewing times.
- **Review the dataset preview** - Check a few listing types before relying on one field as a required value.
- **Schedule recurring runs** - Use Apify schedules to create periodic market snapshots and compare newly published listings.
- **Respect source rules** - Collect only data you are allowed to use and keep run volume appropriate for the intended workflow.

## Integrations and export formats

- **Google Sheets** - Export listings for comparison, reporting, and collaboration.
- **Airtable** - Build a searchable property database with broker, location, and price fields.
- **Webhooks** - Notify downstream systems after a run completes.
- **Make or Zapier** - Trigger alerts, enrichment, CRM updates, or other no-code workflows.
- **Programmatic access** - Read dataset items and start runs from your own application.

| Format | Useful for                                       |
| ------ | ------------------------------------------------ |
| JSON   | Structured processing and application workflows. |
| CSV    | Spreadsheet analysis and simple imports.         |
| Excel  | Business reporting and comparison workbooks.     |
| XML    | Systems that require XML data exchange.          |

## Frequently Asked Questions

### Can I collect properties from a specific Norwegian city or neighborhood?

Yes. Configure the area on Finn.no, copy the resulting search URL, and provide it through startUrl. You can also use location for an additional text match.

### Does the Actor collect detailed property information?

Yes. The dataset can include prices, areas, ownership, coordinates, descriptions, facilities, images, documents, broker contacts, and viewing data.

### Can I collect project and planned properties?

Yes. The Actor processes Finn.no homes, project, and planned listing URLs found in the search results. The available fields depend on the listing type.

### Why is a field missing from a record?

A field is omitted when the public listing does not provide a usable value or when that listing type does not use the field. Project and planned listings commonly have different price, area, broker, and viewing coverage than ordinary homes.

### Does the Actor save duplicate listings?

No. Records are deduplicated by Finn code or canonical listing URL before dataset writes. Empty and null-like values are also removed.

### Can I export Finn.no data to CSV or Excel?

Yes. Apify datasets can be downloaded as CSV, Excel, JSON, XML, and other supported formats.

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

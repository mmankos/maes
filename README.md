# fes - Facebook Event Scraper
A Facebook event scraper that is AWS Lambda compatible and extracts events via both HTML-embedded data and the GraphQL API to capture all the events.

## ⚠️ Important Notice
When using this package to scrape Facebook events:
- Always respect the [robots.txt](https://en.wikipedia.org/wiki/Robots.txt) rules of the [target website](https://www.facebook.com/robots.txt).
- Only scrape data you are authorized to access.
- Excessive or unauthorized scraping may violate Facebook's terms of service.
- Use the `concurrency` option responsibly to avoid overloading servers.

## Instalation
```
npm install @mmankos/fes
```

## Usage
```
import { scrapeEvents } from "@mmankos/fes";

const sources = {
	eventID: ["1234567890", "0987654321"], // scrape specific events
	group: ["group1", "group2"], // scrape events from these Facebook groups
	page: ["page1", "page2", "page3"], // scrape events from these Facebook pages
	search_query: ["keyword1_1 keyword1_2", "keyword2"], // scrape events by keywords
};

// Optional scraping options (defaults provided)
const options = {
	concurrency: 10, // max parallel requests
	httpReqRetries: 5, // retry failed requests
	httpReqRetryDelay: 1000, // wait 1s between retries
	httpReqTimeout: 5000, // timeout each HTTP request after 5s
	isAWS: true, // if true abide by the rules set by AWS Lambda (max one puppeteer browser instance at a time)
	outputFile: "events.json", // optionally save results to file
};

const scrapedEvents = await scrapeEvents(sources, options);
console.dir(scrapedEvents, { depth: null });
```

## TODO
- [X] Make AWS Lambda compatible
- [ ] Proxy support (only GraphQL API requests seem to be affected by rate limits)
- [ ] Recurrent events
- [ ] Improve GraphQL API call response success consistency

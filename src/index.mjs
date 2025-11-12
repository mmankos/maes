import fs from "node:fs";
import pLimit from "p-limit";
import { graphQLScrapeEvents } from "./scrapers/graphQLScraper.mjs";
import {
	htmlScrapeEventByID,
	htmlScrapeEvents,
} from "./scrapers/htmlScraper.mjs";
import { SourceTypes } from "./utils/constants.mjs";
import {
	constructUrl,
	disableCursor,
	enableCursor,
	logError,
	Spinner,
} from "./utils/utils.mjs";

/**
 * Scrape Facebook events from multiple optional input sources.
 *
 * @param {Object} sourceTypes - Defines which types of sources to scrape.
 * @param {string[]} [sourceTypes.eventID=[]] - Array of specific Facebook event IDs to scrape directly.
 * @param {string[]} [sourceTypes.group=[]] - Array of Facebook group IDs to scrape events from.
 * @param {string[]} [sourceTypes.page=[]] - Array of Facebook page IDs to scrape events from.
 * @param {string[]} [sourceTypes.search_query=[]] - Array of search query strings to find events by keyword.
 *
 * @param {Object} [options] - Optional scraping configuration.
 * @param {number} [options.concurrency=10] - Maximum number of async tasks to run in parallel.
 * @param {boolean} [options.derestrict=false] - If true, bypasses scraping restrictions (use responsibly).
 * @param {number} [options.httpReqRetries=5] - Maximum number of retry attempts per request.
 * @param {number} [options.httpReqRetryDelay=1000] - Delay (in milliseconds) between retry attempts after a failed request.
 * @param {number} [options.httpReqTimeout=5000] - Timeout (in milliseconds) for each HTTP request before it is aborted.
 * @param {boolean} [options.isAWS=true] - If true, only one puppeteer-core launch can be invoked concurrently, due to AWS Lambda limitations.
 * @param {string} [options.outputFile] - Optional file path to save the scraped events as JSON.
 *
 * @returns {Promise<Array>} Resolves to an array of scraped event objects.
 */
export const scrapeEvents = async (
	sourceTypes = { eventID: [], group: [], page: [], search_query: [] },
	options = {
		concurrency: 10,
		derestrict: false,
		httpReqRetries: 5,
		httpReqRetryDelay: 1000,
		httpReqTimeout: 5000,
		isAWS: true,
		outputFile: undefined,
	},
) => {
	try {
		disableCursor();

		Object.assign(options, {
			concurrency: options.concurrency ?? 10,
			derestrict: options.derestrict ?? false,
			httpReqRetries: options.httpReqRetries ?? 5,
			httpReqRetryDelay: options.httpReqRetryDelay ?? 1000,
			httpReqTimeout: options.httpReqTimeout ?? 5000,
			isAWS: options.isAWS ?? true,
			outputFile: options.outputFile ?? undefined,
		});

		const events = [];
		const eventIDs = new Set();
		const standaloneEventIDs = new Set();
		const sourceLimit = pLimit(options.concurrency);
		// only one puppeteer-core browser launch at a time on AWS Lambda is allowed
		const graphQLLimit = pLimit(options.isAWS ? 1 : 10);
		const spinner = new Spinner();

		const tasks = Object.entries(sourceTypes).flatMap(
			([sourceType, sources]) => {
				if (sourceType === SourceTypes.EventID) {
					sources.forEach((id) => {
						standaloneEventIDs.add(id);
					});
					return htmlScrapeEventByID(
						{ standaloneEventIDs },
						events,
						eventIDs,
						options,
						spinner,
					);
				}
				return sources.map((source) =>
					sourceLimit(async () => {
						const url = constructUrl(sourceType, source);
						const hasNextPage = await htmlScrapeEvents(
							url,
							sourceType,
							events,
							eventIDs,
							options,
							spinner,
						);

						if (sourceType !== SourceTypes.EventID && hasNextPage) {
							await graphQLLimit(() =>
								graphQLScrapeEvents(
									url,
									sourceType,
									events,
									eventIDs,
									options,
									spinner,
								),
							);
						}
					}),
				);
			},
		);

		await Promise.all(tasks);

		if (options.outputFile) {
			try {
				await fs.promises.writeFile(
					options.outputFile,
					JSON.stringify(events, null, 2),
					"utf8",
				);
			} catch (err) {
				logError(err);
			}
		}

		spinner.finish();
		enableCursor();

		return events;
	} catch (err) {
		enableCursor();
		logError(err);

		throw err;
	}
};

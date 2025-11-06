import chromium from "@sparticuz/chromium";
import axios from "axios";
import puppeteer from "puppeteer-core";
import { PageElements, SourceTypes } from "../utils/constants.mjs";
import { logError, replaceParamValue } from "../utils/utils.mjs";
import { htmlScrapeEventByID } from "./htmlScraper.mjs";

const launchBrowser = async (url) => {
	const browser = await puppeteer.launch({
		args: chromium.args,
		defaultViewport: chromium.defaultViewport,
		executablePath: await chromium.executablePath(),
		headless: chromium.headless,
	});
	const page = await browser.newPage();

	await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
	await page.goto(url, { waitUntil: "networkidle0" });
	return { browser, page };
};

const handleDialogWindows = async (page, delayMs) => {
	(await page.$(PageElements.DeclineCookies))?.click();
	await new Promise((resolve) => setTimeout(resolve, delayMs));
	await page.click("body", { force: true });
	await new Promise((resolve) => setTimeout(resolve, delayMs));
	await page.keyboard.press("Escape");
};

const waitForGraphQLRequest = (page) => {
	return new Promise((resolve) => {
		page.on("request", (request) => {
			const url = request.url();
			if (url.includes("/api/graphql") || url.includes("graphql?")) {
				resolve(request);
			}
		});
	});
};

const scrollUntilGraphQL = async (
	page,
	graphqlPromise,
	delayMs,
	maxScrolls,
) => {
	let lastScrollHeight = 0;
	for (let i = 0; i < maxScrolls; i++) {
		const currentScrollHeight = await page.evaluate(() => {
			window.scrollBy(0, 1000);
			return document.body.scrollHeight;
		});

		await new Promise((resolve) => setTimeout(resolve, delayMs));

		if (currentScrollHeight === lastScrollHeight) {
			return null;
		}

		lastScrollHeight = currentScrollHeight;

		// Check if GraphQL request occurred
		const race = await Promise.race([
			graphqlPromise,
			new Promise((resolve) => setTimeout(() => resolve(null), delayMs)),
		]);

		if (race) return race;
	}

	return null;
};

const getCookies = async (page) => {
	const cookies = await page.cookies();
	return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
};

export const graphQLPostRequest = async (postData, cookies, options) => {
	for (let attempt = 1; attempt <= options.httpReqRetries; attempt++) {
		try {
			const response = await axios.post(
				"https://www.facebook.com/api/graphql/",
				postData,
				{
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
						"User-Agent": "Mozilla/5.0",
						Cookie: cookies,
					},
					timeout: options.httpReqTimeout,
				},
			);

			const edges = response.data?.data?.serpResponse?.results?.edges;
			if (edges && edges.length === 0) {
				return undefined;
			}

			return response.data.data;
		} catch (_err) {
			if (attempt < options.httpReqRetries) {
				await new Promise((resolve) =>
					setTimeout(resolve, options.httpReqRetryDelay),
				);
			} else {
				logError(
					`\ngraphQLPostRequest failed with response:\n ${_err}\n`,
				);
				return undefined;
			}
		}
	}
};

export const captureGraphQL = async (url, sourceType) => {
	const delayMs = 100;
	const maxScrolls = 20;

	const { browser, page } = await launchBrowser(url);
	await handleDialogWindows(page, delayMs);

	const graphqlPromise = waitForGraphQLRequest(page);

	if (sourceType === SourceTypes.Group) {
		await page.click(PageElements.GroupSeeMoreEvents);
	}

	const graphqlRequest = await scrollUntilGraphQL(
		page,
		graphqlPromise,
		delayMs,
		maxScrolls,
	);

	let postData = null;
	let cookies = null;

	if (graphqlRequest) {
		postData = graphqlRequest.postData();
		cookies = await getCookies(page);
	}

	await browser.close();

	return { postData, cookies };
};

export const graphQLScrapeEvents = async (
	url,
	sourceType,
	events,
	eventIDs,
	options,
	spinner,
) => {
	const promises = [];

	let hasNextPage = true;
	let idExtractor;
	let { postData, cookies } = await captureGraphQL(url, sourceType);

	while (hasNextPage) {
		let nodes = [];
		let endCursor = "";
		const data = await graphQLPostRequest(postData, cookies, options);

		if (sourceType === SourceTypes.Group) {
			nodes = data?.node?.upcoming_events?.edges || [];
			hasNextPage =
				data?.node?.upcoming_events?.page_info?.has_next_page || false;
			endCursor =
				data?.node?.upcoming_events?.page_info?.end_cursor || "";
			idExtractor = (node) => node.node.id;
		} else if (sourceType === SourceTypes.Page) {
			nodes = data?.node?.pageItems?.edges || [];
			hasNextPage =
				data?.node?.pageItems?.page_info?.has_next_page || false;
			endCursor = data?.node?.pageItems?.page_info?.end_cursor || "";
			idExtractor = (node) => node.node.node.id;
		} else if (sourceType === SourceTypes.SearchQuery) {
			nodes = data?.serpResponse?.results?.edges || [];
			hasNextPage =
				data?.serpResponse?.results?.page_info?.has_next_page || false;
			endCursor =
				data?.serpResponse?.results?.page_info?.end_cursor || "";
			idExtractor = (node) =>
				node.rendering_strategy.view_model.profile.id;
		}

		const promise = htmlScrapeEventByID(
			{ nodes, idExtractor },
			events,
			eventIDs,
			options,
			spinner,
		);

		promises.push(options.derestrict ? promise : await promise);

		postData = replaceParamValue(postData, "cursor", endCursor);
	}

	await Promise.all(promises);
};

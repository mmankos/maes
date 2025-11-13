import axios from "axios";
import pLimit from "p-limit";
import { SourceTypes } from "../utils/constants.mjs";
import { constructUrl, extractJson, logError } from "../utils/utils.mjs";

export const htmlGetRequest = async (url, options) => {
	for (let attempt = 1; attempt <= options.httpReqRetries; attempt++) {
		try {
			const response = await axios.get(url, {
				headers: {
					accept: "text/html",
					"sec-fetch-mode": "navigate",
					"user-agent": "Mozilla/5.0",
				},
				timeout: options.httpReqTimeout,
			});
			return response.data;
		} catch (_err) {
			if (attempt < options.httpReqRetries) {
				await new Promise((resolve) =>
					setTimeout(resolve, options.httpReqRetryDelay),
				);
			} else {
				logError(`\nhtmlGetRequest failed with response:\n ${_err}\n`);
				return undefined;
			}
		}
	}
};

export const htmlScrapeEventByID = async (
	{ nodes, idExtractor, standaloneEventIDs },
	events,
	eventIDs,
	options,
	spinner,
) => {
	const limit = pLimit(options.concurrency);
	let tasks;

	if (nodes && idExtractor) {
		tasks = nodes.map((node) =>
			limit(async () => {
				const id = idExtractor(node);
				if (!eventIDs.has(id)) {
					eventIDs.add(id);
					const event = await htmlScrapeEventDetails(id, options);
					events.push(event);
					spinner.step();
				}
			}),
		);
	} else if (standaloneEventIDs) {
		tasks = [...standaloneEventIDs].map((id) =>
			limit(async () => {
				if (!eventIDs.has(id)) {
					eventIDs.add(id);
					const event = await htmlScrapeEventDetails(id, options);
					events.push(event);
					spinner.step();
				}
			}),
		);
	}

	await Promise.all(tasks);
};

export const htmlScrapeEvents = async (
	url,
	sourceType,
	events,
	eventIDs,
	options,
	spinner,
) => {
	let hasNextPage = false;

	const html = await htmlGetRequest(url, options);
	if (!html) {
		return hasNextPage;
	}

	let data = {};
	let nodes = [];
	let idExtractor;

	if (sourceType === SourceTypes.Group) {
		data = extractJson(html, "upcoming_events");
		nodes = data?.edges || [];
		hasNextPage = data?.page_info?.has_next_page || false;
		idExtractor = (node) => node.node.id;
	} else if (sourceType === SourceTypes.Page) {
		data = extractJson(html, "collection");
		nodes = data?.pageItems?.edges || [];
		hasNextPage = data?.pageItems?.page_info?.has_next_page || false;
		idExtractor = (node) => node.node.node.id;
	} else if (sourceType === SourceTypes.SearchQuery) {
		data = extractJson(html, "results");
		nodes = data?.edges || [];
		hasNextPage = data?.page_info?.has_next_page || false;
		idExtractor = (node) => node.rendering_strategy.view_model.profile.id;
	}

	await htmlScrapeEventByID(
		{ nodes, idExtractor },
		events,
		eventIDs,
		options,
		spinner,
	);

	return hasNextPage;
};

const parseEventData = (
	event,
	eventCoverPhoto,
	eventCoverMedia,
	eventDataDetailed,
	eventDataGeneral,
	eventDescription,
	eventHosts,
	eventLocation,
	eventTimestamp,
	eventUsersinterested,
) => {
	event.name = eventDataGeneral?.name;
	event.description = eventDescription?.text;

	event.cover_photo = {};
	event.cover_photo.image_url =
		eventCoverPhoto?.photo?.full_image?.uri ??
		eventCoverMedia?.full_image?.uri;
	event.cover_photo.accessibility_caption =
		eventCoverPhoto?.photo?.accessibility_caption ??
		eventCoverMedia?.accessibility_caption;

	event.timestamp = {};
	event.timestamp.timezone = eventTimestamp?.tz_display_name;
	event.timestamp.start_timestamp = eventTimestamp?.start_timestamp;
	event.timestamp.end_timestamp = eventTimestamp?.end_timestamp;

	event.location = {};
	event.location.name = eventLocation?.name;
	event.location.address = eventDataDetailed?.one_line_address;
	event.location.coordinates = eventLocation?.location;

	event.hosts = [];
	for (const eventHost of eventHosts) {
		const host = {};

		host.name = eventHost?.name;
		host.url = eventHost?.url;
		host.image_url = eventHost?.profile_picture?.uri;

		event.hosts.push(host);
	}

	event.event_buy_ticket_url = eventDataDetailed?.event_buy_ticket_url;
	event.users_interested_count = eventUsersinterested?.count;

	event.is_online = eventDataGeneral?.is_online;
	event.is_past = eventDataGeneral?.is_past;
	event.is_canceled = eventDataGeneral?.is_canceled;
};

export const htmlScrapeEventDetails = async (id, options) => {
	const event = {};

	const url = constructUrl(SourceTypes.EventID, id);
	const html = await htmlGetRequest(url, options);

	if (!html) {
		return undefined;
	}

	const eventCoverPhoto = extractJson(html, "cover_photo");
	const eventCoverMedia = extractJson(html, "cover_media")?.[0];
	const eventDataDetailed = extractJson(html, "event", "one_line_address");
	const eventDataGeneral = extractJson(html, "event", "name");
	const eventDescription = extractJson(html, "event_description");
	const eventHosts = extractJson(html, "event_hosts_that_can_view_guestlist");
	const eventLocation = extractJson(html, "event_place", "location");
	const eventTimestamp = extractJson(html, "data", "start_timestamp");
	const eventUsersinterested = extractJson(
		html,
		"event_connected_users_public_responded",
	);

	parseEventData(
		event,
		eventCoverPhoto,
		eventCoverMedia,
		eventDataDetailed,
		eventDataGeneral,
		eventDescription,
		eventHosts,
		eventLocation,
		eventTimestamp,
		eventUsersinterested,
	);

	event.event_id = id;
	event.event_url = url;

	return event.is_past ? null : event;
};

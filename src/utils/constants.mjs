export const SourceTypes = Object.freeze({
	EventID: "eventID",
	Group: "group",
	Page: "page",
	SearchQuery: "search_query",
});

export const UrlModifiers = Object.freeze({
	SearchQueryPrefix: "https://www.facebook.com/events/search/?q=",
	GroupPrefix: "https://www.facebook.com/groups/",
	GroupPostfix: "/events",
	PagePrefix: "https://www.facebook.com/",
	PagePostfix: "/upcoming_hosted_events",
	EventPrefix: "https://www.facebook.com/events/",
});

export const PageElements = Object.freeze({
	DeclineCookies: '[role="button"][aria-label="Decline optional cookies"]',
	GroupSeeMoreEvents: '[role="button"][aria-label="See more"]',
});

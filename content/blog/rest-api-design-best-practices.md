---
title: "REST API design best practices: naming, errors and versioning"
description: "Design an HTTP API that clients can rely on: resource naming, correct methods and status codes, a standard error format, pagination and safe versioning."
date: 2026-11-15
tags: [web]
art:
  kind: flow
  caption: "The design decisions an HTTP API has to get right, in the order clients meet them."
  items: ["Resource names", "Methods and status codes", "Error format", "Pagination", "Versioning"]
---

An API is easy to publish and hard to change: once another team or a customer has written code against it, every inconsistency becomes permanent. Most of the pain comes from a small set of decisions about names, status codes, errors and versioning that are cheap to get right at the start. This guide gives a concrete convention for each, with the reasoning, so you can design an HTTP API whose behaviour clients can predict without reading every page of the documentation.

The examples use a small order system with customers and orders. The conventions follow the HTTP specification, [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html), wherever it has something to say.

## Name resources, not actions

In a REST-style API, the URL identifies a thing (a resource) and the HTTP method says what to do with it. The most common design error is putting the verb into the URL, which produces an endpoint list that has to be memorised:

| Avoid | Prefer | Why |
| --- | --- | --- |
| `POST /createOrder` | `POST /orders` | The method already says "create" |
| `GET /getOrderById?id=42` | `GET /orders/42` | The identifier is part of the resource's address |
| `POST /orders/42/delete` | `DELETE /orders/42` | Intermediaries and tools understand `DELETE` |
| `GET /order_list` | `GET /orders` | One naming pattern for every collection |

A few rules cover nearly every case:

- **Use plural nouns for collections.** `/orders` is the collection and `/orders/42` is one member. Mixing `/order/42` and `/orders` forces clients to remember which form each endpoint uses.
- **Use lowercase words separated by hyphens in paths**, such as `/shipping-addresses`. Paths can be case-sensitive, and hyphens are easier to read than underscores in a link.
- **Pick one style for JSON field names and never mix.** `camelCase` and `snake_case` are both fine. A response with `createdAt` next to `customer_id` is not.
- **Nest only to express ownership, and only one level.** `/customers/7/orders` reads naturally as "the orders of customer 7". Deeper paths such as `/customers/7/orders/42/items/3/notes` are brittle and add nothing, because order 42 can be addressed directly as `/orders/42`.
- **Keep internal identifiers out.** Sequential database ids reveal how many records you have and make guessing other records trivial. Opaque ids such as UUIDs avoid both. Either way, the server must still check on every request that the caller is allowed to see that record.

Some operations do not fit the create, read, update and delete pattern: cancelling an order, resending an invoice. Two approaches work. Model the outcome as a resource of its own, such as `POST /orders/42/cancellation`, which can later be read back to see who cancelled and when. Or accept an explicit action sub-resource, `POST /orders/42/cancel`, as a documented exception. What matters is choosing one approach and applying it everywhere.

Filtering, sorting and searching belong in the query string, because they select from a collection rather than naming a different resource:

```http
GET /orders?status=shipped&sort=-created_at&limit=20 HTTP/1.1
Host: api.example.com
Accept: application/json
```

## Use methods and status codes the way HTTP defines them

HTTP methods have defined properties, and clients, proxies and libraries rely on them. Two matter most. A **safe** method does not change anything on the server. An **idempotent** method has the same effect whether it is sent once or several times, which means a client can retry it after a timeout without risk.

| Method | Typical use | Safe | Idempotent |
| --- | --- | --- | --- |
| `GET` | Read a resource or collection | Yes | Yes |
| `POST` | Create a resource, or trigger a process | No | No |
| `PUT` | Replace a resource completely | No | Yes |
| `PATCH` | Change part of a resource | No | Not guaranteed |
| `DELETE` | Remove a resource | No | Yes |

Two consequences follow. A `GET` must never change data: browsers prefetch links, crawlers follow them, and caches replay them. And `PUT` means a full replacement, so a field left out of a `PUT` body is a field removed; use `PATCH` when the client sends only the fields that change.

### Status codes clients can act on

The status code is the first thing client code looks at, and often the only thing its error handling looks at. Use the specific code:

| Code | When to return it |
| --- | --- |
| `200 OK` | A successful read or update that returns a body |
| `201 Created` | A resource was created; include a `Location` header with its URL |
| `202 Accepted` | The request was queued and will be processed later |
| `204 No Content` | Success with nothing to return, such as a delete |
| `400 Bad Request` | The request is malformed, for example invalid JSON |
| `401 Unauthorized` | No valid credentials were supplied |
| `403 Forbidden` | The credentials are valid but do not permit this action |
| `404 Not Found` | The resource does not exist |
| `409 Conflict` | The request conflicts with the current state, such as a duplicate |
| `422 Unprocessable Content` | The JSON is well formed but the values fail validation |
| `429 Too Many Requests` | The caller has exceeded a rate limit; include `Retry-After` |
| `500 Internal Server Error` | An unexpected failure on the server |
| `503 Service Unavailable` | Temporarily unable to respond; the client may retry later |

The division between the 4xx and 5xx ranges carries meaning. A 4xx code tells the client "this request will fail again if you resend it unchanged". A 5xx code says the fault is on the server and a retry may succeed. Monitoring and retry logic depend on that distinction being honest.

The pattern to avoid above all is returning `200 OK` with an error described in the body. Every generic tool, from load balancers to client libraries to dashboards, then records a success.

A well-formed creation looks like this:

```http
POST /orders HTTP/1.1
Host: api.example.com
Content-Type: application/json
Authorization: Bearer <token>

{"customer_id": "c_7f3a", "items": [{"sku": "TSHIRT-M", "quantity": 2}]}
```

```http
HTTP/1.1 201 Created
Location: /orders/o_91bd
Content-Type: application/json

{"id": "o_91bd", "status": "pending", "customer_id": "c_7f3a", "created_at": "2026-11-15T09:30:00Z"}
```

Verify the behaviour from the command line; `-i` prints the status line and headers:

```bash
curl -i -X POST https://api.example.com/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"customer_id": "c_7f3a", "items": [{"sku": "TSHIRT-M", "quantity": 2}]}'
```

## Return errors in one standard format

When something fails, the client developer needs to know what went wrong and what to do about it, and client code needs something stable to branch on. If every endpoint invents its own error shape, every client needs custom handling per endpoint.

There is a standard for this: [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html), "Problem Details for HTTP APIs". It defines a JSON object served with the media type `application/problem+json` and five standard members:

| Member | Purpose |
| --- | --- |
| `type` | A URI identifying the kind of problem; the stable value for code to check |
| `title` | A short, human-readable summary of the problem type |
| `status` | The HTTP status code, repeated for convenience |
| `detail` | An explanation specific to this occurrence |
| `instance` | A URI identifying this particular occurrence |

You may add your own members. A validation failure is the usual case for that:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.example.com/problems/validation-error",
  "title": "The request body failed validation",
  "status": 422,
  "detail": "2 fields are invalid.",
  "instance": "/orders",
  "request_id": "req_5c1e9a",
  "errors": [
    {"field": "items[0].quantity", "message": "must be at least 1"},
    {"field": "customer_id", "message": "is required"}
  ]
}
```

The choices here are deliberate:

- **Report every invalid field at once.** Returning only the first failure makes the user fix and resubmit repeatedly.
- **Give code a stable identifier.** Clients should branch on `type`, never on the wording of `title` or `detail`, so you remain free to improve the text.
- **Include a request id** that also appears in your server logs. A user can then quote one value in a support request and you can find the exact failure.
- **Never leak internals.** Stack traces, SQL statements, file paths and library versions help an attacker and no one else. Log them on the server, and return a generic 500 problem with the request id.

One subtle point concerns `404` and `403`. If a resource exists but belongs to another customer, answering `403` confirms that the id is valid. Returning `404` for both "does not exist" and "not yours" avoids revealing which ids are in use.

Check that every error path, including the ones your framework generates on its own, returns the same shape:

```bash
curl -s -X POST https://api.example.com/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{"items": [{"sku": "TSHIRT-M", "quantity": 0}]}' | jq '.type, .status, .errors'

curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://api.example.com/no-such-path
```

Malformed JSON, an unknown route and an unsupported method are the three paths most often left with a framework's default HTML or plain-text error.

## Paginate, filter and sort collections

An endpoint that returns a whole collection works in testing and fails in production, when the table has grown and one request ties up the database and the client's memory. Every collection endpoint needs a limit from its first release, because adding one later breaks clients that assumed they received everything.

There are two main designs:

| | Offset pagination | Cursor pagination |
| --- | --- | --- |
| Request | `?limit=20&offset=40` | `?limit=20&cursor=<opaque value>` |
| Jump to an arbitrary page | Yes | No |
| Stable while data changes | No: inserted rows shift pages, causing repeats or gaps | Yes |
| Cost on deep pages | Grows, since skipped rows are still read | Stays constant |
| Good for | Small, slowly changing lists; admin tables | Large or frequently changing collections, feeds |

For most public APIs, cursor pagination is the safer default. The cursor is an opaque string that encodes where the last page ended, and the response tells the client how to continue:

```http
GET /orders?limit=2 HTTP/1.1
Host: api.example.com
```

```json
{
  "data": [
    {"id": "o_91bd", "status": "pending"},
    {"id": "o_91bc", "status": "shipped"}
  ],
  "next_cursor": "b185MWJj",
  "has_more": true
}
```

Whichever design you use:

- **Set a default and a maximum for `limit`.** Without a maximum, `?limit=1000000` is a denial-of-service request.
- **Always sort by something unique**, for example creation time followed by id. Without a fixed order, pages can overlap.
- **Wrap the list in an object.** A top-level array leaves no room for pagination fields later; `{"data": [...]}` does.
- **Accept only documented filter and sort fields**, and reject unknown ones with a `400` rather than ignoring them. A silently ignored filter returns unfiltered data that looks correct.

To verify, walk the collection to the end and confirm that no id appears twice and that the count matches what you expect:

```bash
cursor=""
while :; do
  page=$(curl -s -H "Authorization: Bearer $API_TOKEN" \
    "https://api.example.com/orders?limit=100&cursor=$cursor")
  echo "$page" | jq -r '.data[].id'
  [ "$(echo "$page" | jq -r '.has_more')" = "true" ] || break
  cursor=$(echo "$page" | jq -r '.next_cursor')
done | sort | uniq -d
```

The pipeline prints only duplicated ids, so no output means the pages did not overlap.

## Version the API and retire old versions on purpose

Sooner or later a change is needed that existing clients cannot survive. A version scheme is the agreement about how that happens.

First, be precise about what breaks clients, because most changes do not need a new version:

| Compatible, no new version | Breaking, needs a new version |
| --- | --- |
| Adding an endpoint | Removing or renaming an endpoint or field |
| Adding an optional request field | Making an optional field required |
| Adding a field to a response | Changing a field's type or meaning |
| Adding an optional query parameter | Changing default behaviour, such as sort order |

This only holds if clients are told, in the documentation, to ignore response fields they do not recognise. Adding a new value to an enumerated field, such as a new order status, deserves care: clients that handle a fixed list of values may fail on it, so document from the start that new values can appear.

There are three common places to put the version:

| Scheme | Example | Trade-off |
| --- | --- | --- |
| URL path | `GET /v1/orders` | Visible in every log and link; simple to route and to test in a browser |
| Custom header | `Api-Version: 2` | Clean URLs, but easy to forget and harder to see when debugging |
| Media type | `Accept: application/vnd.example.v2+json` | Precise, but the least familiar to client developers |

For most teams the path prefix is the practical choice, because it is impossible to overlook. Use a whole number only, `/v1`, and increase it rarely. A version in the path is a promise to keep that entire surface stable, so compatible additions go into the current version without changing the number.

### Retiring a version

An old version costs maintenance for as long as it runs, so plan its end when you release its successor. HTTP has two response headers for announcing it. `Deprecation`, defined in [RFC 9745](https://www.rfc-editor.org/rfc/rfc9745.html), states when the resource became or will become deprecated, as a Unix timestamp prefixed with `@`. `Sunset`, defined in RFC 8594, states when it will stop responding. The sunset date must not be earlier than the deprecation date.

```http
HTTP/1.1 200 OK
Content-Type: application/json
Deprecation: @1798761600
Sunset: Thu, 01 Jul 2027 00:00:00 GMT
Link: <https://api.example.com/docs/migrate-to-v2>; rel="deprecation"; type="text/html"
```

Headers alone are not a migration plan, since few people read response headers. Announce the date to the owners of the API keys still calling the old version, measure that traffic, and switch the version off only when the numbers show who is left. After the sunset date, answer with `410 Gone` and a problem body that points to the migration guide.

## Make writes safe to retry

Networks fail in the worst possible place: after the server has processed a request but before the client receives the answer. The client cannot tell whether its order was created, and if it retries a `POST`, the customer may be charged twice.

The widely used remedy is an idempotency key. The client generates a unique value, such as a UUID, for each logical operation and sends it in an `Idempotency-Key` header. The header is a common convention, described in an IETF draft rather than a finished standard, and it is used by several large payment APIs.

```http
POST /orders HTTP/1.1
Host: api.example.com
Content-Type: application/json
Idempotency-Key: 6b1f0c9e-4a57-4d0b-9f53-2f0f9d3c1a77

{"customer_id": "c_7f3a", "items": [{"sku": "TSHIRT-M", "quantity": 2}]}
```

The server stores the key together with the response it produced. If the same key arrives again, it returns the stored response instead of creating a second order. If the same key arrives with a different body, that is a client bug, and a `422` or `409` is the honest answer. Stored keys can expire after a period you document, such as a day.

The opposite problem is two clients overwriting each other's changes. HTTP's conditional requests solve it. Return an `ETag` header, a value that changes whenever the resource changes, with each read, and have clients send it back with the update:

```http
PATCH /orders/o_91bd HTTP/1.1
Host: api.example.com
Content-Type: application/merge-patch+json
If-Match: "v7"

{"shipping_method": "express"}
```

If the order has changed since the client read it, the tag no longer matches and the server answers `412 Precondition Failed` instead of silently discarding someone else's edit.

Test idempotency by sending the same request twice and checking that only one order exists:

```bash
key=$(uuidgen)
for attempt in 1 2; do
  curl -s -X POST https://api.example.com/orders \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_TOKEN" \
    -H "Idempotency-Key: $key" \
    -d '{"customer_id": "c_7f3a", "items": [{"sku": "TSHIRT-M", "quantity": 2}]}' | jq -r '.id'
done
```

Both attempts should print the same id.

## Common mistakes

**Returning `200` for failures.** Error handling, retries, caching and monitoring all key off the status code. An error inside a successful response is invisible to all of them.

**Trusting the client's input.** Validate types, lengths, ranges and allowed values on the server for every field, whatever the front end already checks. Reject unknown fields in write requests so that a client cannot set properties you did not intend to expose, such as a role or a price.

**Checking authentication but not ownership.** Confirming that a token is valid is not the same as confirming that its owner may read `/orders/42`. The ownership check has to happen on every request for every object. The same care applies to any service you expose, including model endpoints; see [securing a self-hosted LLM API](/blog/secure-self-hosted-llm-api/).

**Secrets in URLs.** API keys and tokens in a query string end up in server logs, browser history and referrer headers. Send them in the `Authorization` header, and store the server side of them as described in [secrets management for small teams](/blog/secrets-management-guide/).

**No rate limit.** One misbehaving client can exhaust the service for everyone. Enforce a limit per credential and answer with `429` and a `Retry-After` header so well-behaved clients know when to try again.

**Timestamps without a time zone.** Use ISO 8601 format in UTC, such as `2026-11-15T09:30:00Z`. A bare local time is ambiguous the moment a client is in another zone.

**Money as floating-point numbers.** Binary floating point cannot represent most decimal fractions exactly. Send amounts as integers in the smallest currency unit, with the currency code in a separate field.

**Documentation written from memory.** Hand-written docs drift from the code. Maintain an OpenAPI description, generate the reference pages from it, and test the running API against it in the build pipeline.

## Frequently asked questions

### Should I use PUT or PATCH for updates?

Use `PUT` when the client sends the complete new representation and anything omitted should be removed. Use `PATCH` when the client sends only the fields to change. Most update forms want `PATCH`. If you offer only one, offer `PATCH` and state which format the body uses, such as JSON Merge Patch.

### Is 400 or 422 the right code for validation errors?

Both are in common use. A workable split is `400` for a request that cannot be parsed at all, such as broken JSON, and `422` for a request that parses but contains invalid values. What matters more than the choice is applying it consistently and returning the field-level details in the body.

### Do I need a version in the URL from the first release?

Yes, it costs nothing and avoids a problem later. Starting at `/v1` means the first breaking change has somewhere to go. Adding a prefix afterwards means the unversioned paths have to be supported indefinitely as a hidden version zero.

### How large should a page be?

Choose a default that renders one screen comfortably, often between 20 and 50 items, and a documented maximum that your database can serve quickly, commonly 100. Measure response time at the maximum before publishing it, because clients will use it.

### Should the API return every field or let clients choose?

Start by returning the full resource with a stable set of fields. Add a field-selection parameter only when measurements show that response size is a real problem, because every option you add is behaviour you have to document, test and keep working.

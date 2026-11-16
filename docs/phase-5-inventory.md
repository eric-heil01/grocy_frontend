# Phase 5: Intuitive inventory management

## Delivered behavior

Inventory is available at `/#inventory` from the shared desktop header and five-item phone navigation. Home's Running low card links to it. The three household activities are **What do I have?**, **I bought some**, and **I used some**.

The overview searches stocked product names and shows total stock quantities in their actual stock units. Each product retains its separate batches, storage places, package dates, no-expiry state, opened state and notes. Running low comes from Grocy's `stock/volatile` missing-products result, including Grocy's configured opened-stock and parent-product rules. Parent aggregate quantities are not added to their children's quantities. A product without its own entries is excluded from this stocked-only view.

Buying uses the shared product picker, a positive quantity, a real storage place, an explicit package date or **This has no expiry date**, and an optional note. The product's configured place is the only location default. If date tracking is disabled, date controls disappear and the field is omitted so Grocy applies its own configured defaults. If location tracking is disabled, additions use the product's configured place. No conversion factor, package content or future date is inferred.

Using stock requires choosing a product and a particular batch, described by place, quantity, date, opened state and note. The interface never silently chooses a batch or substitutes a child product. Ambiguous batches and special quantity configurations are deferred to Grocy. Both actions show a review with quantity, place, date and expected total before an explicit confirmation. After a confirmed write, fresh reads show the actual remaining quantity.

Product creation uses the same dialog and search as groceries. It preserves the inventory quantity, place, date and note, selects the saved product, announces success and restores focus. Saving that definition does not add stock or groceries. A separate stock review and confirmation are required. Cancelling creation preserves the draft. Visited screens retain session drafts through navigation; reload does not persist drafts.

## Application API

All paths below are relative to the frontend origin. Grocy credentials remain in FastAPI. Responses use `Cache-Control: no-store` through the shared dependency.

| Method | Route | Contract |
| --- | --- | --- |
| GET | `/api/inventory` | Household date, tracking flags and sorted stocked products with units, quantities, low-stock state and distinct entries |
| GET | `/api/inventory/products/{product_id}` | Fresh product stock, version fingerprint, available places and tracking flags; supports a product not yet stocked |
| POST | `/api/inventory/products/{product_id}/add` | `amount`, `unit_id`, `expected_version`, `location_id`; optional `best_before_date`, `never_expires`, `note`; returns `{ "ok": true }`, HTTP 201 |
| POST | `/api/inventory/products/{product_id}/consume` | `amount`, `unit_id`, `expected_version`, numeric public `entry_id`; returns `{ "ok": true }`, HTTP 200 |

Amounts must be finite positive JSON numbers up to 1,000,000,000. Boolean/string amounts, nonpositive IDs, extra fields, invalid dates and contradictory date choices are rejected. The public entry ID is never accepted as an arbitrary Grocy batch token. Dates use calendar strings, not timestamps. Year 2999 and later require the explicit no-expiry option. Existing stock entries must also fit the supported positive-quantity contract.

Before a mutation, the service reloads product, units, locations, flags and own-stock entries, checks the reviewed version/unit, verifies selected-entry availability and reads the API user's automatic-shopping setting. A process-local per-product lock serializes this application's stock submissions. A successful first request changes the version, so a replay of that reviewed snapshot is rejected. There is no general-purpose stock-object write route.

Known validation errors return 422. Stale/unsupported/configuration conflicts return 409; a removed product returns 404. Missing configuration returns 503 through the shared dependency. Unsupported upstream data/read failures return sanitized 502 responses. Any unsuccessful or unrecognized upstream write, empty log response, wrong product/place/batch, or unexpected recorded quantity is an uncertain 502. Raw upstream bodies are never shown.

The UI disables duplicate submissions while saving. Uncertain writes, stale data and failed post-save reads pause mutations until **Refresh inventory** succeeds. There are no automatic write retries or compensating writes. A refresh shows current quantities; it does not prove a timed-out request failed or finished. The submitted summary remains available for comparison after refreshing and through the next review. A known preflight validation/configuration rejection permits correction because no stock POST was made.

## Official Grocy mappings and assumptions

References inspected for this implementation:

- [v4.5.0 OpenAPI specification](https://github.com/grocy/grocy/blob/v4.5.0/grocy.openapi.json): stock overview, entries, volatile stock, add/consume and system configuration contracts.
- [v4.5.0 StockService](https://github.com/grocy/grocy/blob/v4.5.0/services/StockService.php): quantity/date handling, batch selection, stock logs and automatic shopping side effects.
- [upstream StockApiController](https://github.com/grocy/grocy/blob/master/controllers/Api/StockApiController.php) and [purchase UI](https://github.com/grocy/grocy/blob/master/public/viewjs/purchase.js): request defaults and conversion before posting stock-unit amounts.
- [upstream configuration defaults](https://github.com/grocy/grocy/blob/master/config-dist.php): tracking flags and user settings. Master links can change; they do not certify an installed version.

| Concern | Mapping used |
| --- | --- |
| Catalog/reference reads | `GET objects/products`, `objects/quantity_units`, `objects/locations`; generic APIs are read-only in the inventory service |
| Stock reads | `GET stock`, `stock/volatile`, `stock/products/{id}/entries?include_sub_products=false`; sum own entries rather than parent aggregates |
| Measurement unit | Add/consume `amount` is already in `qu_id_stock`. Purchase/consume display units and their conversions are not used here |
| Add stock | `POST stock/products/{id}/add`, `transaction_type: purchase`, explicit `location_id`, note, `stock_label_type: 0` |
| Dates | Explicit date when tracking is on; no expiry maps to `2999-12-31`. Omitted dates let Grocy apply ordinary/freezing/default-day rules only when date tracking is off |
| Other purchase defaults | Omit price, purchase date and store: inspected controller defaults are unknown price, Grocy-server today and no store. Household display timezone can differ from Grocy's server date |
| No labels | The inspected service/controller use zero for no label, one for a single label and two for per-unit labels. The inspected OpenAPI prose lists different numbers; this adapter follows executable source and requires disposable verification |
| Consume stock | `POST stock/products/{id}/consume`, explicit `stock_entry_id` batch token, explicit place, `spoiled: false`, `allow_subproduct_substitution: false`; ordinary consume transaction is the controller default |
| Entry identity | Despite the parameter name, inspected `ConsumeProduct` filters `stock_id`, not numeric row `id`. Backend resolves the selected row privately to this token. Duplicate token/place groups are not selectable |
| Stock ordering | Grocy returns entries in next-use order. The list preserves it, while requiring the user to choose the batch actually used |
| Unsupported products | Inactive, tare/gross-weight, no-own-stock, unknown required flags and missing units cannot be mutated here. Ordinary parents with their own stock can use their own entries, without substitution |
| Effective flags | Read `system/config`; accept `FEATURE_FLAG_*` or `GROCY_FEATURE_FLAG_*`, requiring consistent, recognized stock/location/date values. Unknown or missing settings block operations |
| Shopping automation | Read `user/settings` before every stock POST. Refuse when `shopping_list_auto_add_below_min_stock_amount` is enabled or unreadable. Never toggle it or write a grocery record automatically |
| Mutation confirmation | Require nonempty stock logs for the intended product/location and exact signed quantity; consume logs must match the selected batch token |

These checks are preflight checks, not atomic compare-and-swap. Another Grocy client or backend worker can change quantities, product flags or shopping automation between the read and POST. Grocy may partially consume an entry if its quantity changes during that interval. An unexpected returned log is reported as uncertain, without rollback or retry. Locks are process-local and not a distributed idempotency mechanism. Installed plugins, triggers, permissions and source/schema changes remain compatibility concerns.

## Files and integration

| Area | Files |
| --- | --- |
| Backend contracts/service/routes | `backend/app/inventory_models.py`, `inventory.py`, `routes/inventory.py`; registered in `main.py` |
| Inventory interface | `frontend/src/Inventory.tsx`, `Inventory.css`, typed stock contracts/client methods in `api.ts` |
| Shared product workflow | `ProductPicker.tsx`, `ProductPicker.css`, `Groceries.tsx`; `ProductCreationDialog.tsx` uses a portal to prevent nested form submissions |
| Navigation | `App.tsx`, `AppHeader.tsx`, `Icon.tsx`, `App.css` |
| Test infrastructure | `backend/tests/mock_grocy.py`, `preview.py`, `test_inventory.py`; frontend API tests and `tests/browser/inventory.spec.ts`; existing household/product navigation tests and CI label |
| Documentation | This report and README |

## Automated validation

The in-memory test transport and preview never contact a real Grocy installation. They model the expected contract, not Grocy's database or triggers.

- Backend: `.venv/Scripts/python -m unittest discover -s tests` from `backend` - **66 passed**, including 20 inventory cases.
- Frontend: `npm test` - **13 passed**.
- `npm run lint`, `npm run typecheck`, `npm run build` - passed.
- `npm run test:browser` - **96 passed** across desktop and mobile, including all grocery, meal, product and navigation regressions and 24 inventory test executions (12 cases in each project). Narrow 320px phone and 768px tablet review checks supplement the 390px mobile and 1280px desktop projects.
- Screenshots inspected for mobile overview and review, plus desktop review. Browser checks cover labels, keyboard/focus, confirmation, navigation and horizontal overflow; this is not a complete assistive-technology or physical-device audit.

Inventory coverage includes empty/search/multiple-place views, opened/date display, stock-unit additions, explicit batch consumption, insufficient stock, no-expiry and disabled tracking, contextual creation and preserved inputs, invalid/nonfinite quantities, stale quantity/unit/place/configuration, unsupported flags, ambiguous token groups, automatic-shopping protection, concurrent/replayed confirmations, timeout after persistence, malformed/partial/wrong-batch logs, explicit refresh locks, and unchanged grocery/product/meal records.

## Disposable Grocy verification before household mutations

**Stock mutations have not been exercised against a running Grocy installation.** Source inspection and passing mock tests do not establish real persistence or compatibility. No production installation was contacted.

Use an explicitly authorized disposable local/test instance and record evidence below before connecting household credentials. Keep production isolated. Record the installed Grocy version/source revision, backend worker count, enabled features, server/household timezones, API-user permissions, effective user settings, plugins and any required custom fields. Capture raw stock rows/logs, product settings, grocery lists and recipe quantities before and after each case; reload and restart to check persistence. Do not put credentials in the evidence.

| Check | Required evidence | Result |
| --- | --- | --- |
| Reads/configuration | Actual `system/config` shape/key names, effective settings, stock/entry/volatile fields and own versus aggregate quantities | Not run |
| Ordinary add | Integer and fractional stock amounts, explicit chosen place/date; returned log delta equals persisted delta, unrelated rows/settings unchanged | Not run |
| Unit differences | Product with different purchase/stock/consume units; entering two stock units records exactly two stock units without inferred conversion | Not run |
| Dates/defaults | Best-before/use-by, past package date, explicit `2999-12-31`, tracking off, ordinary/freezer defaults, default days -1/0/positive, server-date boundary | Not run |
| Price/labels | Omitted price/store/purchase date behavior; label type zero produces no print/webhook or per-unit split | Not run |
| Exact consume | Multiple dates/places, partial and full consumption, opened entries; only selected token/place changes; logs match signed amount and preserve other fields | Not run |
| Token ambiguity | Shared token across different places stays isolated; duplicate token within one place is refused here | Not run |
| Insufficient/races | Reduce/remove selected entry externally, including between preflight and POST, while other and child stock exist; no substitution; unexpected partial result stays uncertain | Not run |
| Unsupported setup | Inactive/tare/no-own-stock/missing-unit products defer; stock/date/place feature settings match behavior; custom requirements fail safely | Not run |
| Shopping isolation | Enabled API-user auto-add blocks both writes. With it disabled, every shopping list is unchanged after add/consume, including crossing minimum thresholds | Not run |
| Recovery/permissions | Rejected permissions, disconnect before/after persistence, delayed completion, unexpected success/log shapes and failed reload; no automatic repeat or rollback; compare refreshed quantities | Not run |
| Context creation | Create within inventory with draft intact; only product definition changes until separate confirmed addition; cancel changes no stock | Not run |
| Regression | Grocery, dinners, products, Home counts and navigation remain correct after fresh reads | Not run |

## Usability limits and Phase 6

The focused workflow handles one product and one batch per confirmation. It does not combine consumption across batches, convert package sizes, record prices/stores, open/freeze/transfer stock, mark spoilage, reconcile quantities or undo a transaction. Package dates are displayed generically as package dates rather than interpreting food safety. Special/ambiguous batches must be managed in Grocy. Units use configured names without pluralization rules. Search fetches the catalog; overview reads entries per stocked product and is not paginated, which may be slow for a large catalog. Add/use share the current draft values; review always shows the proposed action before saving.

A visited inventory page refreshes initially, explicitly, and after its own mutations; external changes and global product edits can leave overview text stale until refresh. The backend rechecks the selected stock before every write. Session draft/recovery state does not survive a page reload. A successful refresh cannot identify whether a delayed request caused a particular quantity change; compare the retained submitted summary with Grocy's stock log when needed.

Phase 6 should first record the disposable-instance matrix and gather household usability feedback. Prioritize version compatibility fixtures, clearer plural units, large-catalog performance, and a safe transaction-history/recovery view. Then evaluate guided multi-batch use and explicit unit conversions against actual Grocy rules. Keep barcode scanning, recipe consumption and inventory reconciliation separate until their confirmation, side effects and failure recovery have been designed and verified.

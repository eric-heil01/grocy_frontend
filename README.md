# Grocy Frontend

A simple, mobile-friendly household dashboard and interactive grocery manager for Grocy. Dinner, grocery lists, the next seven calendar days, and low-stock products come from Grocy's REST API. No separate database, authentication service, or TRMNL integration is included.

## Local development

Use Python 3.11+ and Node 22.18+ (Node 22.12+ for Vite). From the repository root:

```powershell
Copy-Item .env.example .env
python -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt
cd backend
.venv/Scripts/python -m uvicorn app.main:app --reload --env-file ../.env
```

On Linux/macOS use `python3`, `.venv/bin/python`, and `cp` equivalents. In another terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open the Vite URL printed in the terminal. Vite forwards relative `/api` requests to `127.0.0.1:8000`. Configure a **local/test** Grocy instance before trying live data; tests require no Grocy connection. Never put Grocy credentials in frontend variables.

## Configuration

Set these backend-only values in `.env` (ignored by Git):

| Variable | Meaning |
| --- | --- |
| `GROCY_URL` | Grocy installation base URL, including any subpath, without `/api` |
| `GROCY_API_KEY` | Grocy API key; sent only by FastAPI |
| `HOUSEHOLD_TIMEZONE` | IANA timezone, e.g. `America/Denver`; defaults to UTC; match the household/Grocy calendar |
| `GROCY_SHOPPING_LIST_ID` | Dashboard list ID and preferred initial grocery selection; blank means all lists on the dashboard. The grocery page always selects one list. |
| `GROCY_DINNER_SECTION_ID` | Optional section ID, including `-1` for unsectioned plans; blank selects a unique section named `Dinner` (case insensitive) |

Use Grocy's meal-plan section settings to identify the appropriate section. Missing/ambiguous dinner configuration displays unavailable, not an empty dinner. IDs can also be inspected through the relevant `/api/objects/shopping_lists` and `/api/objects/meal_plan_sections` endpoints on your test installation.

## API and architecture

- `/health` and `/api/health` remain configuration-independent liveness checks.
- `GET /api/dashboard` returns the Pydantic `Dashboard` contract; inspect `/docs` or `/openapi.json` locally.
- `grocy_client.py` handles HTTP transport and safe error wrapping, `dashboard.py` handles transformation, and `routes/dashboard.py` handles configuration and HTTP responses. Business logic can be reused by a future display integration.
- `dinner_tonight` and each `upcoming_meals` entry contain `date`, `available`, nullable `planned`, and `meals` (ID, name, optional recipe ID). The seven-day window includes today. Multiple entries in one dinner section are preserved.
- `shopping_list` contains availability, selected ID/name, outstanding/total entry counts, and items with list/product IDs, name, note, quantity, and completion state. Counts are records, not summed quantities. All-list mode retains per-item list IDs.
- `inventory` contains availability and `low_stock` (ID, name, amount missing), based on Grocy's minimum-stock calculation.
- Missing configuration returns a sanitized 503. Individual upstream or schema failures return a typed 200 with section availability false and a notice; unknown counts and planned state are null. No upstream bodies or API keys are exposed. There is no fake fallback data.
- The server owns today's date in the configured timezone. Meal dates are calendar dates and the browser formats them without applying its local timezone. Refresh reloads the dashboard; there is no background polling or midnight rollover.

## Grocy compatibility

Verified against the official [Grocy OpenAPI specification](https://github.com/grocy/grocy/blob/master/grocy.openapi.json), [meal-plan controller](https://github.com/grocy/grocy/blob/master/controllers/RecipesController.php), and [meal-plan UI source](https://github.com/grocy/grocy/blob/master/public/viewjs/mealplan.js). Only REST endpoints are called:

- `objects/shopping_list`, `objects/shopping_lists`, `objects/products`
- `objects/meal_plan` with inclusive `query[]` day bounds, `objects/recipes`, `objects/meal_plan_sections`
- `stock/volatile`, using its documented `missing_products` array

Grocy's OpenAPI entity schemas are incomplete: in particular shopping-item `done` is absent from that schema. The [official shopping-list UI](https://github.com/grocy/grocy/blob/master/public/viewjs/shoppinglist.js) writes it as 0/1; the new implementation accepts only 0/1 (numeric/string) or booleans and treats missing/unknown completion as unavailable. Verify this field on the target Grocy version using a local fixture or test installation. Also verify section IDs, recipe/product/note meal types, list IDs, and feature availability for that version. No production instance was contacted. A unique English `Dinner` name is only a convenience default; set the ID for localized/custom sections.

## Validation

```powershell
cd backend
.venv/Scripts/python -m unittest discover -s tests -v
cd ../frontend
npx tsc -b
npm test
npm run lint
npm run build
```

Backend tests use mocked HTTP responses and check transformations, empty/unavailable states, multiple lists/meals, request filtering, timeouts, safe errors, health, and route serialization. Frontend tests check relative API calls, errors, abort propagation, and timezone-safe date formatting. Browser layout/accessibility should also be reviewed manually at mobile and desktop widths before release.

## Containers

The existing Compose services and Nginx proxy are preserved. The frontend lockfile is committed and supports Docker's existing `npm ci` step. To build/run locally after filling `.env`:

```sh
docker compose up --build
```

Open `http://localhost:8088`. Grocy's address must be reachable from the API container; container localhost refers to that container, not the host. No deployment or production-container changes are needed. Do not expose the service publicly without separately evaluating access control.

## Limits and next milestone

Meals and inventory remain read-only. The grocery page supports existing products and free-text entries, edits, completion/undo, and individual removal. Product amounts are labeled in stock units; selecting or converting purchase/display units is not implemented. Product search fetches the current catalog and filters it in the backend (30 results maximum); very large catalogs may need a different search strategy. Concurrent household edits follow Grocy's last-write behavior; there is no optimistic concurrency or automatic polling. No recipe detail page or inventory editing is included. Next: recipe browsing and weekly meal-plan editing, keeping stock transactions separate.

This project is independently developed and is not officially affiliated with Grocy.

## Interactive grocery management (Phase 2)

Open **View grocery list** on the dashboard (or `/#groceries`). Select a Grocy list, search and select an existing product, enter its quantity and optional note, then add it. Use **Free-text item** for an entry whose name is stored as its note; this never creates an inventory product. Use each checkbox to complete/undo, and **Edit** to change quantity/note or remove a single entry with inline confirmation. There is no bulk-clear action.

Mutations wait for Grocy, then fetch current list entries and counts. Controls are locked while saving to prevent duplicate submissions. If a write or the subsequent reload cannot be confirmed, the page requires a refresh before another mutation. Writes are never retried automatically: a network timeout can occur after Grocy has already applied a change. Returning to the dashboard fetches its counts again, using the dashboard's configured list scope.

### Grocery API

All routes use backend-only Grocy credentials. Positive list/entry/product identifiers, finite positive quantities (maximum 1,000,000,000), notes up to 2,000 characters, and explicit boolean completion are validated. Unknown update fields, empty patches, and null changes are rejected. All public responses have Pydantic contracts in `grocery_models.py`.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/shopping-lists` | Available lists and optional configured default ID |
| GET | `/api/shopping-lists/{list_id}/items` | Entries, stock unit names, and outstanding/total counts |
| GET | `/api/products?q=milk` | Case-insensitive search of existing active products; up to 30 results |
| POST | `/api/shopping-lists/{list_id}/items` | Add `{product_id: 10, amount: 2, note: "Whole milk"}`; omit/null product ID for free text |
| PATCH | `/api/shopping-lists/{list_id}/items/{entry_id}` | Change only supplied `amount`, `note`, and/or `done` fields |
| DELETE | `/api/shopping-lists/{list_id}/items/{entry_id}` | Remove that entry only |

Mutations return `{ "ok": true }` only after upstream success (201 for creation, 200 for update/delete). Missing lists/entries return 404, invalid input 422, missing connection configuration 503, and upstream failures or unsupported schemas a sanitized 502. Reads and successful mutations use `Cache-Control: no-store`.

`dependencies.py` shares connection configuration and sanitizes grocery errors. `groceries.py` validates list membership and builds explicit Grocy payloads; it reuses dashboard shopping normalization so outstanding counts follow the same rules. `grocy_client.py` handles GET/POST/PUT/DELETE and Grocy's empty 204 responses. `Groceries.tsx` provides the dedicated page; `api.ts` owns all relative `/api` requests. Hash navigation requires no new routing dependency or proxy configuration.

### Units and compatibility

The [Grocy API specification](https://github.com/grocy/grocy/blob/master/grocy.openapi.json) defines shopping product amounts in stock units, while `qu_id` controls display. The grocery page resolves `products.qu_id_stock` against `objects/quantity_units` and labels the actual stored amount in stock units. It retains the entry's original `qu_id` as `display_unit_id`; edits do not write that field or change product/list relationships. Free-text entries use their stored unit when available. Unknown units are labeled unavailable rather than guessed.

Creation uses `POST objects/shopping_list`, also used by [Grocy's create-item form](https://github.com/grocy/grocy/blob/master/public/viewjs/shoppinglistitemform.js). Each add creates a separate entry, even for the same product. This keeps notes independent: the specialized `stock/shoppinglist/add-product` endpoint merges quantities and can replace existing notes, as shown in [Grocy's stock service](https://github.com/grocy/grocy/blob/master/services/StockService.php). Completion sends only `PUT objects/shopping_list/{entry_id}` with `done: 0/1`, exactly as [Grocy's shopping UI](https://github.com/grocy/grocy/blob/master/public/viewjs/shoppinglist.js) does. No purchase/consume/inventory endpoints are called.

These behaviors were verified against official source, not a live installation. The OpenAPI entity schema omits some fields, including `done` and `qu_id`. Before using mutations against a household installation, verify the target Grocy version with a local test instance: free-text records with null `product_id`, stock-unit amounts, partial object updates, and completion support. No production instance was contacted or modified.

### Mock browser preview

A disposable in-memory fixture is available for local browser checks without real Grocy credentials. In two terminals:

```powershell
cd backend
.venv/Scripts/python -m uvicorn preview:app --app-dir tests --host 127.0.0.1 --port 18001
```

```sh
cd frontend
npm run dev -- --config tests/vite.browser.config.ts
```

Open `http://127.0.0.1:15173/`. Data is test-only and resets when the preview backend restarts. The preview module is under tests and excluded from the backend image. Automated tests cover all mutations, list selection, unit/relationship preservation, completion counts, safe failures, and dashboard regression. Browser verification could not complete in this development session because Computer Use could not reliably determine the current browser URL; mobile/desktop layout, focus, and full browser interactions still need manual review.

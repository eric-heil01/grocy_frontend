# Grocy Frontend

A mobile-friendly household dashboard, grocery manager, dinner planner, and product catalog for Grocy. Grocy remains the source of truth; no separate database is used. Dinners can be planned using existing recipes; inventory remains read-only. Grocery entries can be added, edited, completed/undone, and removed without recording an inventory purchase.

## Native local development

Use Python 3.11+ and Node 22.18+. These commands run FastAPI and Vite **on the host**, without Docker. Configure only a local/test Grocy instance.

From the repository root, on Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
python -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt
# Fill .env.local with the URL and API key of your local/test Grocy.
cd backend
.venv/Scripts/python -m uvicorn app.main:app --reload --env-file ../.env.local
```

On Linux/macOS:

```sh
cp .env.example .env.local
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
# Fill .env.local with your local/test Grocy configuration.
cd backend
.venv/bin/python -m uvicorn app.main:app --reload --env-file ../.env.local
```

In a second terminal, from the repository root:

```sh
cd frontend
npm ci
npm run dev
```

Open the URL printed by Vite. Vite proxies `/api` to the native backend at `http://127.0.0.1:8000`. A Grocy host port such as `http://127.0.0.1:9283` is appropriate **for this native backend**. It is not the Grocy address for an API running inside a container.

## Containerized local setup

Use Docker Engine 20.10+ / Docker Desktop with Compose v2. No changes to Grocy itself are required by this repository. Choose the connection method matching your **test** Grocy setup. Do not reuse production credentials for development or tests.

Copy the Docker-specific example to Compose's `.env`, then edit it:

```powershell
Copy-Item .env.docker.example .env
```

On Linux/macOS use `cp .env.docker.example .env`. `.env.local` is for native Uvicorn; Compose reads `.env`. Both are ignored by Git and excluded from Docker build contexts. Existing `.env` files are not overwritten automatically: reconcile their Grocy URL with the chosen method.

### Option A: Grocy port published on the Docker host

The default Compose file maps `host.docker.internal` to Docker's host gateway on the API container. Set `.env` to the **host-published** test Grocy port, for example:

```dotenv
GROCY_URL=http://host.docker.internal:9283
GROCY_API_KEY=replace-with-your-test-key
```

Then run from the repository root:

```sh
docker compose config --quiet
docker compose up --build
```

On Linux Engine, a host port bound exclusively to `127.0.0.1` may not be reachable from the bridge gateway. The published endpoint must already be reachable from containers and permitted by the host firewall. Do not broaden a Grocy port's exposure just to use this method; use Option B when the test Grocy container is on an existing Docker network. Docker Desktop host routing can differ from native Linux Engine.

### Option B: existing Grocy Docker network

Use the optional `compose.grocy-network.yaml` override. It joins **only the API** to an existing network; the web/API default network remains intact. The network name is required configuration, with no household-specific default. Compose does not create or modify that external network or the Grocy container.

Set these values in `.env`, replacing placeholders with the test installation's existing network, Grocy service/network alias, and **internal container** HTTP port:

```dotenv
GROCY_DOCKER_NETWORK=your_existing_test_network
GROCY_URL=http://your-grocy-service-alias:80
GROCY_API_KEY=replace-with-your-test-key
```

Inspect the local test Grocy Compose configuration or `docker network ls` / `docker network inspect <test-network>` to identify its network and alias. Do not guess a Compose-generated network name or pin a container IP.

```sh
docker compose -f compose.yaml -f compose.grocy-network.yaml config --quiet
docker compose -f compose.yaml -f compose.grocy-network.yaml up --build
```

Use the same `-f` pair for subsequent `logs` or `down` commands. A blank network name fails validation rather than silently selecting another network. The alias must be unique on the network. This works only when both containers run on the same Docker daemon and Grocy is already attached to the selected network.

### URL and port reference

| Backend location | Grocy location | Backend `GROCY_URL` |
| --- | --- | --- |
| Native host process | Host-published test Grocy port | `http://127.0.0.1:<published-port>` |
| API container, Option A | Docker host's reachable published port | `http://host.docker.internal:<published-port>` |
| API container, Option B | Existing shared Docker network | `http://<Grocy-service-alias>:<internal-port>` |

Include any Grocy installation subpath, but omit `/api`; the backend appends it. `localhost` inside the API container refers to that API container. Published host ports and internal container ports are not interchangeable. These networking rules follow [Docker's Compose networking documentation](https://docs.docker.com/compose/how-tos/networking/).

For either container method, open `http://127.0.0.1:8088`. Nginx serves the built frontend and proxies `/api/` to `api:8000` without stripping the path. The API is not published on a host port. `/api/health` verifies the API process, **not** Grocy connectivity; load the dashboard/list to check the configured test Grocy connection. No deployment steps are included.

## Backend configuration

Set values in `.env.local` for native development or `.env` for Compose. No API key or Grocy hostname belongs in React/Vite environment variables.

| Variable | Meaning |
| --- | --- |
| `GROCY_URL` | Grocy base URL reachable from the backend's network context; include subpath, omit `/api` |
| `GROCY_API_KEY` | Backend-only test Grocy API key |
| `HOUSEHOLD_TIMEZONE` | IANA timezone, such as `America/Denver`; default UTC; match Grocy's calendar |
| `GROCY_SHOPPING_LIST_ID` | Optional dashboard list scope and initial grocery selection; blank means all dashboard lists |
| `GROCY_DINNER_SECTION_ID` | Optional dinner section ID, including `-1` for unsectioned plans; blank requires a unique section named `Dinner` |
| `GROCY_DOCKER_NETWORK` | Compose-only existing external network name; required only for Option B |

Missing/ambiguous dinner configuration displays unavailable rather than an empty dinner. Grocery list IDs and dinner section IDs must match the selected test installation.

## Application and API

Open **View grocery list** or `/#groceries`. Choose a list, search/select an existing product, and enter quantity and an optional note. **Free-text item** stores the name as the note; it never creates an inventory product. Checkboxes complete/undo entries. **Edit** changes quantity/note or removes a single item with inline confirmation. Each add creates a separate record, including repeated products; quantities and notes are not merged. Product amounts use stock units; the original preferred display-unit ID is preserved during edits. There is no unit-conversion UI or bulk clear action.

Writes wait for Grocy and then reload current counts. Controls lock while saving. A failed/uncertain write or a saved write whose reload fails requires refresh before another mutation. Writes are never retried automatically, since a timeout may occur after a write took effect. Returning to the dashboard refetches its configured count scope.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/health`, `/api/health` | Configuration-independent liveness |
| GET | `/api/dashboard` | Tonight, today plus six days, grocery counts/entries, low stock, availability notices |
| GET | `/api/shopping-lists` | Lists and optional configured default ID |
| GET | `/api/shopping-lists/{list_id}/items` | Selected entries with units and outstanding/total counts |
| GET | `/api/products?q=milk` | Existing active products; at most 30 case-insensitive name matches |
| POST | `/api/shopping-lists/{list_id}/items` | Add `{product_id: 10, amount: 2, note: "Whole milk"}`; omit/null product ID for free text |
| PATCH | `/api/shopping-lists/{list_id}/items/{entry_id}` | Supplied `amount`, `note`, and/or boolean `done` only |
| DELETE | `/api/shopping-lists/{list_id}/items/{entry_id}` | Remove that entry only |

Pydantic validates positive IDs, finite positive quantities up to 1,000,000,000, notes up to 2,000 characters, and boolean completion. Unknown update fields, null changes, and empty patches are rejected. Missing records return 404, invalid requests 422, missing configuration 503, and grocery upstream/schema failures a sanitized 502. Successful mutations return `{ "ok": true }` (201 for creation, 200 for update/delete). Dashboard section failures return typed unavailable states and null unknown counts. No upstream bodies or keys are exposed. See native FastAPI `/docs` for full schemas.

`grocy_client.py` owns HTTP transport; `groceries.py` and `dashboard.py` normalize data and apply business rules; route modules define HTTP contracts. The dashboard and grocery page share shopping-entry normalization. `create_app()` creates isolated app instances without changing production routes. Test preview instances inject only an in-memory HTTP transport, retaining real route validation and error handling. React uses relative `/api/` requests through `api.ts`, with hash navigation and no additional routing library.

## Validation and CI

Run backend tests from `backend`:

```powershell
.venv/Scripts/python -m unittest discover -s tests -v
```

On Linux/macOS use `.venv/bin/python`. From `frontend`:

```sh
npm ci
npm test
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:browser
```

On Linux, `npx playwright install --with-deps chromium` also installs required browser system libraries. Backend dependencies must already be installed. The browser launcher chooses `backend/.venv/Scripts/python.exe` on Windows, `backend/.venv/bin/python` on POSIX, or `python` when there is no virtualenv. Override `E2E_PYTHON` with your Python executable path if needed (PowerShell: `$env:E2E_PYTHON = 'C:\path\to\python.exe'`; POSIX: `E2E_PYTHON=/path/to/python npm run test:browser`).

Browser tests start and stop their own mock backend on `127.0.0.1:18001` and Vite on `127.0.0.1:15173`. Stop any manual mock preview first: occupied ports fail rather than reusing an unknown server. There is no configurable production base URL and no real Grocy network transport. A single worker resets the fixture before every test to avoid cross-test state leaks. Chromium runs each workflow at desktop and mobile widths. Tests cover navigation, list switching, names/units, product/free-text creation, persisted edits, completion/undo, confirmed deletion, empty lists, dashboard counts, pending controls, write failures, and saved-write/reload failures. Browser results are regression checks, not proof of compatibility with actual Grocy or a complete accessibility audit.

`.github/workflows/ci.yml` runs on pushes and pull requests with read-only repository permissions. It runs backend tests, Compose configuration validation for both connection methods, frontend unit tests, lint, TypeScript (including browser specs), production build, and Chromium browser tests. CI uses disposable configuration and mock data; no household secrets or Grocy instance are required. Failure reports, screenshots, and traces are uploaded for seven days. Adding this workflow does not run GitHub-hosted CI until the changes are committed/pushed by a maintainer; no deployment or commit automation is included.

### Manual mock preview

For exploration without any Grocy credentials, run these in separate terminals:

```powershell
cd backend
.venv/Scripts/python -m uvicorn preview:app --app-dir tests --host 127.0.0.1 --port 18001
```

```sh
cd frontend
npm run dev -- --config tests/vite.browser.config.ts
```

Open `http://127.0.0.1:15173`. Data is disposable and resets on restart. Only the test preview exposes `/_test/reset`, `/_test/state`, and `/_test/failure/{write|reload}`; they are absent from the application and the backend image. They are test-only controls, not application features. Keep this preview bound to loopback and stop it before automated browser tests.

## Grocy verification still required

The implementation is based on the official [API specification](https://github.com/grocy/grocy/blob/master/grocy.openapi.json), [create/edit form](https://github.com/grocy/grocy/blob/master/public/viewjs/shoppinglistitemform.js), [shopping UI](https://github.com/grocy/grocy/blob/master/public/viewjs/shoppinglist.js), and [stock service](https://github.com/grocy/grocy/blob/master/services/StockService.php). The entity schemas omit some used fields, including `done` and `qu_id`. Mock tests verify our requests and UI behavior; they do not verify Grocy's persistence, triggers, version-specific behavior, or permissions.

**All shopping mutations remain unverified against a running Grocy installation in this work.** Before enabling them for household use, run the following on an explicitly authorized, disposable local/test Grocy installation and record its version and enabled features. Do not use production for this check.

| Mutation | Upstream request | What an actual Grocy test must confirm |
| --- | --- | --- |
| Add product | `POST objects/shopping_list` with selected list/product, stock-unit amount, stock `qu_id`, note, `done: 0` | Record persists in the selected list, quantities use stock units, display unit is correct, repeated adds create separate entries and preserve existing notes |
| Add free text | Same POST with null `product_id` and a nonempty note | Null product ID is accepted, note/amount persist, no inventory product is created |
| Complete / undo | `PUT objects/shopping_list/{entry_id}` with only `done: 1/0` | Both states persist after refetch/restart, counts agree, no purchase or stock transaction occurs, other fields are unchanged |
| Edit quantity | Same PUT with only `amount` | Fractional stock-unit amount persists; stored display `qu_id`, product/list IDs, completion, notes, and userfields survive |
| Edit / clear note | Same PUT with only `note` | Text persists; empty notes work for product entries; free-text entries retain a nonempty name; no unrelated field resets |
| Remove entry | `DELETE objects/shopping_list/{entry_id}` | Only the selected record is removed, including with repeated products or multiple lists; stock remains unchanged; response status/body are compatible |

Also verify read-side fields, existing `qu_id`/stock-unit relationships, `done` representations, inactive-product behavior, feature flags, selected list/section IDs, and your API key's permissions. In the disposable test installation, compare before/after stock and userfields as well as shopping entries. Successful mock CI must not be treated as a substitute for this verification.

## Current limits

No recipe creation, barcode scanning, stock purchases, authentication service, TRMNL integration, or deployment automation is included. Product search fetches the catalog server-side and returns at most 30 matches. Concurrent edits follow Grocy's existing last-write behavior. There is no automatic polling, midnight rollover, or unit-conversion selector. Manual accessibility review and actual-Grocy verification remain release checks.

This project is independently developed and is not officially affiliated with Grocy.


## Interactive dinner planning (Phase 3)

Open **Plan dinners** from Dinner Tonight, **Open meal planner** from Upcoming Dinners, or `/#meals`. The current period starts on today in `HOUSEHOLD_TIMEZONE` and includes the next six calendar dates; previous/next move exactly seven dates, and Current week returns to household today. Browser timezone and daylight saving changes do not shift those dates. The page does not automatically roll over at midnight; refresh to update today.

Each day supports multiple independent recipe entries. Choose Add dinner, search by name, select an existing recipe, adjust servings, and save. Edit changes the date, selected recipe, and/or servings of one entry. Remove asks for confirmation for that entry only. Existing product and note entries stay visible and can be individually removed; their editing and new note creation are deferred. Leaving an unsaved form or changing periods discards its draft. Returning home refetches the dashboard.

The planner locks editing and period navigation during writes. A failed/uncertain write or failed reload locks all further mutations until **Refresh dinners** successfully reloads the displayed period; no write retries occur automatically. This lock is local to the mounted page, as with groceries; returning/reopening loads data again before enabling writes. There is no offline write queue. Search requests are debounced and obsolete requests cancelled. Empty plans show Nothing planned; upstream/configuration errors show an unavailable message and disable mutation controls.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/recipes?q=pasta` | Case-insensitive recipe-name search, at most 30 results, with ID/name/base servings; only `type=normal` is selectable |
| GET | `/api/meals?start=2026-12-31` | Seven consecutive dinner dates; omitted start uses household today; includes product and note entries |
| POST | `/api/meals` | Add `{day: "2026-12-31", recipe_id: 20, recipe_servings: 2}` without removing existing dinners |
| PATCH | `/api/meals/{entry_id}` | Supplied `day`, `recipe_id`, and/or `recipe_servings` only; recipe entries only |
| DELETE | `/api/meals/{entry_id}` | Remove one entry after checking dinner-section ownership |

All dates must be ISO calendar dates (no timestamps), recipe/entry IDs positive, servings finite and positive up to 1,000,000,000. Empty patches, unknown fields, null changes, boolean quantities and internal/missing recipes are rejected. Creation defaults servings to 1 if omitted; the UI offers the recipe's base servings when selecting it. Recipe selection never writes to the recipe itself. Missing/ambiguous dinner sections fail closed; explicitly configured `-1` selects Grocy's built-in unsectioned calendar even when no section row exists. Breakfast/lunch are never fallback dinner sections. Errors use the existing sanitized 404/422/502/503 contracts. Meal reads that fail return an error rather than an empty success; dashboard reads retain their typed per-section unavailable states. Responses use no-store.

`calendar_config.py` shares household date and dinner resolution; `meal_models.py` defines contracts; `meal_planning.py` owns business rules; `routes/meals.py` supplies the HTTP interface. Dashboard and planner use the same meal normalization in `dashboard.py`. Transport remains exclusively in `grocy_client.py`. Existing dashboard response fields remain available for future read-only consumers, with additive `type` and `recipe_servings` meal fields. No database, dependencies, stock consumption, shopping generation, authentication or TRMNL integration was added.

### Meal API compatibility and local verification

The field mappings and update behavior were reviewed against the official [Grocy OpenAPI specification](https://github.com/grocy/grocy/blob/master/grocy.openapi.json), [meal planner JavaScript](https://github.com/grocy/grocy/blob/master/public/viewjs/mealplan.js), [meal form](https://github.com/grocy/grocy/blob/master/views/mealplan.blade.php), and [generic API controller](https://github.com/grocy/grocy/blob/master/controllers/Api/GenericEntityApiController.php). Upstream `EditObject` updates only the supplied request fields. These are upstream master references reviewed during development, not evidence of the installed household version. Incompatible or unknown recipe types are excluded rather than assumed normal.

| Operation | Upstream mapping | Required disposable local Grocy verification |
| --- | --- | --- |
| Create | `POST objects/meal_plan` with `day`, `type: recipe`, `recipe_id`, `recipe_servings`, `section_id` | Separate entries persist on the same date, including repeated recipes; fractional servings and chosen dinner section survive reload/restart |
| Edit | `PUT objects/meal_plan/{id}` with supplied changed fields only | Date moves, recipe replacement and servings persist; done, note, product relationships, section and userfields remain unchanged |
| Delete | `DELETE objects/meal_plan/{id}` | Only the selected entry disappears; other dinners, product/note entries and other sections survive |
| Unsectioned | Explicit `section_id: -1` | Installed version accepts this sentinel without a meal_plan_sections row |
| Search/read | `objects/recipes`, `objects/products`, `objects/meal_plan_sections`, filtered `objects/meal_plan` | Installed recipe type names/base_servings, calendar fields, permissions and enabled features match; internal recipes stay unselectable |

**Meal mutations have not been verified against a running Grocy installation.** Before household use, record the version and enabled features of an explicitly authorized disposable local/test Grocy. Exercise each row above, compare raw before/after records and confirm inventory and shopping entries are unchanged. Grocy can maintain internal meal-plan recipes through its own triggers; this app does not create or modify recipe objects directly. Test API-key permissions, failed connections, and dashboard refresh as well. Never use production for these checks. Section ownership is checked before writes, but Grocy offers no atomic compare-and-swap here: concurrent external changes follow upstream last-write behavior.

Local automated coverage includes backend empty/multiple dinners, search/internal exclusion, add/move/replace/servings/delete, section protection, -1, malformed data, invalid input, timezone/year boundaries, product/note preservation, upstream failures, and timeouts after persistence. Frontend API tests check paths, fields, sanitization and date arithmetic. Playwright runs the complete recipe workflow and failure/recovery/pending-write cases on desktop and mobile alongside all grocery tests. The existing CI discovery includes these files automatically. The preview remains entirely in memory; `/_test/state` now includes `meals`. Automated mocks cannot verify Grocy triggers, installed-version permissions or real persistence.

Recommended next phase: complete and record disposable Grocy compatibility verification, then improve recipe details and note editing based on household feedback before adding TRMNL delivery.


## Simple product management (Phase 4)

Open **Manage products** on the dashboard or `/#products`. Browse or search the household catalog, including inactive products, and open an item to see its usual storage place, measurement unit, and basic settings. Select **Edit product** to change its name, usual place, low-supply reminder, or suggested due days. Names update wherever the product is referenced; changing the usual place does not relocate existing stock. Measurement units are read-only on existing products because Grocy can cascade unit changes into stock, recipe and shopping quantities. There is no product deletion or activation control here.

**Add a product** asks three questions: What is it called? How do you count or measure it? Where do you normally keep it? Unit and place choices come from Grocy, without preselecting an arbitrary ID. If either list is empty, an explanation asks a household administrator to configure it first. Under **More options**, users can set a low-supply threshold and suggested due days, or mark the product as never overdue. Zero threshold disables the reminder; zero due days suggests the day of a future addition, not an unlimited shelf life. These settings do not change existing quantities or due dates. Follow package dates; no food-safety inference is made.

Saving a product creates only its definition. It does not put anything in stock or on the shopping list. When a grocery search has no matches, **Create this product** opens the same product form within the grocery view. After a confirmed save, **Continue with this product** returns to the same shopping list with the new product selected and the existing quantity/note draft retained. The user must still choose **Add to list**. They can instead choose an existing active product offered by duplicate detection. Inactive definitions are shown to prevent accidental recreation, but cannot be selected for groceries. Cancelling creation leaves the grocery draft intact.

Exact name duplicates are blocked server-side after Unicode NFKC normalization, case folding, and whitespace normalization, including inactive products. Substring and close-spelling candidates require an explicit **This is a different product** acknowledgement; exact duplicates cannot be overridden. The browser shows immediate substring suggestions and the server also checks spelling similarity before every relevant write. Suggestions are heuristic, not proof that two products are the same. Use descriptive names for genuinely different sizes or varieties; selecting a unit never infers package contents.

### Product API

The existing grocery `GET /api/products?q=...` contract is unchanged. Product management uses a dedicated namespace:

| Method | Route | Contract |
| --- | --- | --- |
| GET | `/api/product-catalog` | Sorted product definitions, including inactive ones; optional `q` name filter |
| GET | `/api/product-catalog/options` | Existing quantity units and storage locations |
| GET | `/api/product-catalog/{product_id}` | Current basic details and version token |
| POST | `/api/product-catalog` | Required `name`, positive `unit_id`, positive `location_id`; optional `min_stock_amount`, `default_best_before_days`, `allow_similar_name`; returns created details with HTTP 201 |
| PATCH | `/api/product-catalog/{product_id}` | Required `expected_version` plus supplied name/location/minimum/due-day changes only; optional `allow_similar_name`; returns current details |

Names must be nonblank, at most 200 characters, without control characters. Minimum amounts are finite numbers from zero to 1,000,000,000; due days are integers from -1 to 36,500 (-1 is the UI's never-overdue checkbox). Boolean numbers, unknown fields, invalid references, null changes and empty patches are rejected. There is no DELETE endpoint or writable stock/unit-conversion field. HTTP 409 carries an application-owned duplicate/similarity, stale-edit, or automatic-shopping configuration result; 422 covers invalid requests, 404 missing records, and 502/503 sanitized upstream/configuration failures. Raw upstream response text and API credentials never reach React.

Writes send only the changed supported fields. A version fingerprint detects changes between opening an item and saving it. Grocy's inconsistent inclusion of `userfields: null` between collection and single-record responses is excluded from the fingerprint; userfields are never written here. The editor refetches details when opening a product. This preflight check cannot provide atomic concurrency control across Grocy's separate GET/PUT calls, nor eliminate simultaneous duplicate-name races. Grocy's own uniqueness constraints remain the final exact-name safeguard; no automatic write retries are used.

A failed/uncertain write, failed post-save read, or stale edit pauses saving until **Refresh products** successfully reloads the catalog and setup. Refresh discards the old edit draft so it cannot silently overwrite newer data. After an uncertain creation, review the refreshed catalog for the product before opening another creation form. These locks are local to the mounted view; reopening also loads current data before enabling writes. Known preflight validation and duplicate conflicts keep the form available for correction because no upstream write was attempted.

### Verified upstream mappings and compatibility limits

Implementation references the official [v4.5.0 product form](https://github.com/grocy/grocy/blob/v4.5.0/views/productform.blade.php), [OpenAPI specification](https://github.com/grocy/grocy/blob/v4.5.0/grocy.openapi.json), [generic entity controller](https://github.com/grocy/grocy/blob/v4.5.0/controllers/Api/GenericEntityApiController.php), and [product migrations](https://github.com/grocy/grocy/tree/v4.5.0/migrations), plus the equivalent upstream master form/controller. Source inspection is not verification of any installed household version.

Migration `0207.sql` defines the required name, location, purchase-unit and stock-unit columns; other required columns have database defaults. Migrations `0210.sql` and `0219.sql` add consume and price units, which the native form also requires. Creation explicitly supplies all four unit IDs, using the single user-chosen unit for each. This is one consistent unit, not a conversion between a package and its contents. Migration `0231.sql` would otherwise create 1:1 conversions when different unit IDs lack conversions; our new-product mapping avoids that condition. Legacy pre-4.x schemas that require `qu_factor_purchase_to_stock` are not supported by this creation mapping.

Creation supplies active=1, minimum=0, and due days=0 unless the optional values were provided. Other fields retain the verified v4.5.0 database defaults: for example due_type=1, no_own_stock=0, tare handling=0, and opened/freezing/thawing due days=0. We do not change parent products, conversions, recipe positions, purchase prices, descriptions, userfields, existing dates or stock transactions. Existing units remain untouched on every edit. Product, unit, and location references are validated through the generic object API.

Grocy's generic product POST/PUT can call its automatic missing-product shopping generation when the API user's `shopping_list_auto_add_below_min_stock_amount` setting is enabled. The service reads `GET user/settings` before every product write and refuses to save while this setting is true or cannot be interpreted safely. It never changes the setting itself. This prevents the known side effect under stable configuration; changing that setting concurrently with a write cannot be made atomic through this API. Other installed-version extensions/triggers still require local verification.

**Product mutations have not been tested against a running Grocy installation.** On an explicitly authorized disposable local/test instance, record its version, feature flags, API-user permissions and settings, then verify:

- Create with an existing unit/location, including fractional thresholds and each due-date option. Confirm all four unit references and defaults persist after reload/restart and no conversion is invented.
- Compare stock amounts, stock-log entries, recipe ingredient quantities, shopping entries and unrelated product properties before/after each create and edit. Confirm changing default location does not move existing stock, and due-day edits do not rewrite existing dates. Include products with parents, inherited thresholds, tare handling and custom fields because Grocy has its own triggers.
- Confirm exact duplicate rejection, similar-name acknowledgement, inactive-product visibility, stale-edit conflicts, and safe behavior after connection failures or permission errors.
- Verify the API user's effective automatic-shopping setting is returned by `user/settings`, writes are blocked when enabled, and no shopping entries change while saving with it disabled.
- Test the complete grocery handoff on a nondefault list: create, continue with the selected product, and add separately. Confirm settings, feature flags, unit/location tracking and custom required fields match the assumed schemas.

No production installation was contacted. Existing Compose files, license, credentials, meal behavior and grocery API contracts are preserved. The in-memory preview adds product POST/PUT, locations and API-user settings; `/_test/state` includes products. Backend, frontend API and desktop/mobile Playwright suites cover product creation, reference selection, duplicate handling, partial edits, stale data, missing setup, failures, keyboard/label access and grocery return alongside prior regressions. CI discovers these tests automatically. Automated accessibility checks cover form labels, focus, keyboard flow and overflow; they are not a full assistive-technology audit.

Potential confusion to address in household onboarding: a saved product is not current stock; a bottle is not a known number of grams or cartons; zero due days means the addition day; an inactive existing product cannot be used for groceries here. Larger catalogs are fetched server-side and browsed in full without pagination; specialized unit conversions, activation, images, barcodes and advanced parent-product settings remain in Grocy.

For Phase 5, first record disposable-instance compatibility results. Then add a separate, explicit **Add what you have** journey with quantity, actual storage place and package date, a review step before stock transactions, and the same uncertain-write recovery. Keep product setup distinct from purchases, consumption and inventory corrections, and resolve unit conversions explicitly before supporting mixed purchase/stock units.

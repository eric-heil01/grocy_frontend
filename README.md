# Grocy Frontend

A simple, mobile-friendly, read-only household dashboard for Grocy. Dinner, grocery lists, the next seven calendar days, and low-stock products come from Grocy's REST API. No separate database, authentication service, or TRMNL integration is included.

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
| `GROCY_SHOPPING_LIST_ID` | Optional list ID; blank means all lists, never assumed to be a weekly list |
| `GROCY_DINNER_SECTION_ID` | Optional section ID, including `-1` for unsectioned plans; blank selects a unique section named `Dinner` (case insensitive) |

Use Grocy's meal-plan section settings to identify the appropriate section. Missing/ambiguous dinner configuration displays unavailable, not an empty dinner. IDs can also be inspected through the relevant `/api/objects/shopping_lists` and `/api/objects/meal_plan_sections` endpoints on your test installation.

## API and architecture

- `/health` and `/api/health` remain configuration-independent liveness checks.
- `GET /api/dashboard` returns the Pydantic `Dashboard` contract; inspect `/docs` or `/openapi.json` locally.
- `grocy_client.py` handles HTTP transport and safe error wrapping, `dashboard.py` handles transformation, and `routes/dashboard.py` handles configuration and HTTP responses. Business logic can be reused by a future display integration.
- `dinner_tonight` and each `upcoming_meals` entry contain `date`, `available`, nullable `planned`, and `meals` (ID, name, optional recipe ID). The seven-day window includes today. Multiple entries in one dinner section are preserved.
- `shopping_list` contains availability, selected ID/name, outstanding/total entry counts, and read-only items with list/product IDs, name, note, quantity, and completion state. Counts are records, not summed quantities. All-list mode retains per-item list IDs.
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

This MVP is read-only. Quantities are displayed without unit labels until unit resolution is implemented; unavailable recipe names retain their identifiers. There is no recipe detail page, inventory editing, caching, or automatic refresh. Next: add grocery completion with explicit list selection, backend mutation validation, and focused interaction tests.

This project is independently developed and is not officially affiliated with Grocy.

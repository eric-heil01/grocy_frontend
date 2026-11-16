# Phase 4.5 household UX report

## User experience

Home, Groceries, Meals, and Products share one header. Phones use a persistent bottom bar with icons and text, active-section styling, large touch targets, and device safe-area padding. Add product stays in the header. Refresh and recovery actions are secondary. The dashboard offers three large household shortcuts, with dinner, groceries, upcoming dinners, and read-only low-stock information below.

Product creation asks for a name, an existing Grocy unit, and an existing Grocy location. Additional supported settings stay under More options. The same form, validation, duplicate checks, and save/recovery logic support global and contextual creation. Phones use a full-screen dialog; wider screens use a focused panel. No unit or location IDs are assumed.

## Before and after

| Journey | Before | After |
| --- | --- | --- |
| Find a household task | Header links plus different page-level back links | Shared sections, dashboard shortcuts, and a persistent phone navigation bar |
| Create from groceries | Search, create, save, then Continue with this product | Search, create, save; the dialog closes and the new product is selected immediately |
| Finish the grocery action | A separate Add to list action | Still a separate Add to list action, with quantity, note, and selected list preserved |
| Move between screens | Changing routes unmounted forms | Visited screens retain their forms while hidden |
| Switch shopping lists | The add-item draft reset | Each list keeps its own draft during the browser session |
| Recover an uncertain creation | Refresh required before another write | Same safeguard; the refreshed form can identify and select the existing product without repeating the write |

## Components and files

- `frontend/src/AppHeader.tsx`: shared desktop and mobile navigation, skip link, and global creation action.
- `frontend/src/Icon.tsx`: small local SVG icon set; no additional framework.
- `frontend/src/App.tsx`: dashboard shortcuts, visited-screen retention, route focus, page titles, and global success announcements.
- `frontend/src/ProductCreationDialog.tsx`: modal semantics, focus wrapping/restoration, and immediate handoff after confirmed saves.
- `frontend/src/ProductForm.tsx`: three primary questions, concise help, unique description IDs, and optional advanced settings.
- `frontend/src/Products.tsx`: existing shared save/recovery behavior with reduced creation-panel controls.
- `frontend/src/Groceries.tsx`: automatic selection, confirmation and focus handoff, and per-list session drafts.
- `frontend/index.html`: device safe-area viewport support.
- `frontend/src/Meals.tsx`: consistent toolbar and protection for unfinished dinner forms when changing weeks or refreshing.
- `frontend/src/useUnsavedChanges.ts`: browser unload protection for unsaved input.
- `frontend/src/{index,App,Groceries,Meals,Products}.css`: shared controls, spacing, cards, green primary actions, responsive navigation and dialogs.
- `frontend/tests/browser/household.spec.ts`: new household workflow and layout coverage; existing grocery, meal, and product specs retain their regressions with updated navigation/handoff expectations.
- `README.md`: updated household workflows and session-draft behavior.

## Data and recovery

No backend, API, database, Compose, credential, or production changes are part of this phase. Product creation still requires the existing server validation and safe-write checks. It never adds groceries, inventory, or recipe ingredients. The dialog closes only after the write response and required catalog reload succeed. Failed/uncertain writes stay locked until an explicit refresh; no automatic write retry was added. Existing stale-edit and duplicate protections remain in place.

## Accessibility

Controls have visible focus states and comfortable touch targets. Navigation includes text as well as icons, `aria-current`, and a keyboard skip link. Route changes focus the screen heading. Native modal semantics are supplemented by explicit Tab/Shift+Tab containment, Escape cancellation, and focus restoration. Successful grocery creation focuses Add to list and announces the saved product. Inactive screens use `hidden`, keeping their controls out of the tab order and accessibility tree. Error and success messages use alert/status regions. The interface respects reduced-motion preferences.

## Verification and limitations

Validation uses the existing in-memory mock Grocy environment only. Browser checks cover navigation, global and contextual saves, immediate search/catalog availability, cancellation, drafts, list selection, duplicate handling, missing setup/catalog, uncertain writes, focus, and unintended-write checks. Layout checks also exercise 320px phones and 768px tablets; screenshots are produced under `frontend/test-results/`.

| Check | Result |
| --- | --- |
| Backend `unittest` | 46 passed |
| Frontend API/unit tests | 11 passed |
| Full desktop/mobile Chromium suite | 72 passed |
| Final keyboard skip-link/navigation recheck | 2 passed |
| Lint and TypeScript | Passed |
| Vite production build | Passed |

Some sandboxed runs finished their browser checks but stalled during test-process shutdown. The final full run and focused recheck exited successfully using the existing approved browser-test process permissions. No commit, push, or deployment was performed.

The supplied shared mockup link could not be fetched, and browser access was unavailable. The repository did not contain `docs/design/product-workflow-mockup.png`, so the written design brief and existing green palette guided the design.

Drafts remain in memory and do not survive closing/reloading the page. Browser unload warnings depend on browser support and user interaction. Catalog browsing still loads the full catalog. Automated browser coverage uses Chromium; it is not a complete screen-reader or device audit. No production Grocy installation was accessed, and mock tests do not validate installed-version triggers or persistence.

## Phase 5 recommendations

Validate the supported Grocy version on an authorized disposable installation first. Introduce inventory as a separate explicit journey: choose/create a product, enter actual quantity, storage place and package date, review, then record stock. Keep setup distinct from stock transactions, grocery additions, and recipe changes. Resolve unit conversions explicitly and carry forward duplicate-submit prevention, context preservation, and uncertain-write recovery.

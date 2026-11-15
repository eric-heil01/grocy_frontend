# Grocy Frontend UI

React + TypeScript + Vite. See the [repository README](../README.md) for native versus Docker configuration and mock-only test setup.

```sh
npm ci
npm run dev
npm test
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:browser
```

`npm run dev` proxies `/api` to the native backend at `127.0.0.1:8000`. The browser-test configuration starts its own mock backend and Vite servers on loopback ports 18001 and 15173. Backend Python dependencies must be installed first. Browser specs run in Chromium at desktop and mobile widths and never use household credentials. Do not run the manual preview at the same time as the automated suite.

All frontend requests use relative `/api` paths. Grocy URLs and API keys belong only in backend configuration.

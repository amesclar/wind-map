# Automated Testing Policies

You must automatically create or update unit tests for every functional code change you make. Do not wait for explicit user instructions to write tests. Follow the specific frameworks, directory structures, and verification loops below:

## 1. Backend (Python / FastAPI)
- **Frameworks:** Use `pytest` and `pytest-asyncio` for all backend unit and integration tests.
- **Location:** Place tests inside the `tests/` directory mirroring the `app/` folder structure.
- **Mocking:** Always mock external network calls (such as `httpx` requests to the Open-Meteo API) and use SQLite test fixtures or memory databases to avoid altering production cache states.
- **Verification Loop:** Run your backend tests autonomously before completing a task by executing:
  ```bash
  pytest
  ```

## 2. Frontend (React / TypeScript)
- **Frameworks:** Use `Vitest` and `React Testing Library` for component and integration testing.
- **Location:** Place tests in the same directory as the component using the `.test.tsx` or `.spec.tsx` naming convention.
- **Leaflet & Maps Mocking:** If a component renders `Leaflet.js` maps, ensure the map container or tiles are mocked properly to prevent DOM measurement runtime errors during test execution.
- **Verification Loop:** Run your frontend tests autonomously before completing a task by executing:
  ```bash
  npm run test -- --run  # or 'yarn test' / 'vitest run' depending on package.json setup
  ```

## 3. Strict Task Completion Gate
- A task is not considered complete unless the relevant test files are created/modified, and the verification commands exit with a code `0` (success).


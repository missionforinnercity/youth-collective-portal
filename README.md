# Youth Collective portal

A small Node.js portal for anonymous youth surveys, community insights, Youth Collective sign-ups, and a map of third spaces.

## Run it

Use Node.js 20 or newer. The project reads configuration from the existing `.env` file.

```sh
npm install
npm start
```

Open `http://localhost:3000`. For development with automatic server restarts, use `npm run dev`.

## Environment

The app uses the existing variables `MONGODB_URI`, `MONGODB_USERNAME`, `MONGODB_PASSWORD`, `GEMINI_API_KEY`, and `CARTO_API`. Keep `.env` private; it is excluded from Git.

- `MONGODB_URI` may be a full `mongodb://` or `mongodb+srv://` URI, or an Atlas cluster hostname. If it has no username, the app uses `MONGODB_USERNAME` and `MONGODB_PASSWORD`.
- `GEMINI_API_KEY` is used by the “Create a Gemini summary” button. The default model is `gemini-2.5-flash`; set `GEMINI_MODEL` to choose another model.
- `CARTO_API` is sent to the browser for CARTO tile requests. CARTO basemap keys are public map keys; restrict the key to the deployed site in the CARTO dashboard.
- Optional: `PORT` (defaults to `3000`), `MONGODB_DATABASE` (defaults to `youth_collective`), `CITY_NAME`, `CITY_LAT`, and `CITY_LNG` (defaults to Cape Town CBD).

The server creates these MongoDB collections as needed: `surveys`, `members`, `third_spaces`, `insight_summaries`, and `survey_questions`. Collection names can be changed with `MONGODB_SURVEYS_COLLECTION`, `MONGODB_MEMBERS_COLLECTION`, `MONGODB_SPACES_COLLECTION`, `MONGODB_SUMMARIES_COLLECTION`, and `MONGODB_QUESTIONS_COLLECTION`.

## Admin portal

The local `.env` now contains a generated admin password. View it there to sign in at `/admin.html`, or replace it with your own unique password of at least 12 characters. The signed login cookie expires after eight hours. Set `NODE_ENV=production` and serve the site over HTTPS in production so the cookie is marked Secure.

The portal shows the latest 500 survey responses, lets an administrator reorder, edit, add, or remove active questions, and add, edit, or delete map locations. Removed questions are archived so their previous responses stay in the database. New response records save the question wording used at the time of submission.

## Features

- The QR-friendly survey asks one question at a time and stores anonymous answers without contact details.
- The insights page shows response totals and frequent words, not individual answers. Gemini receives up to 500 survey responses when a summary is explicitly requested. The server removes email addresses, phone-like number strings, and links before sending them.
- Youth Collective sign-ups store email and phone separately. There is no public endpoint for reading sign-up details.
- The third-space map uses CARTO Voyager tiles. Administrators manage places in the admin portal; the public map is read-only.

## QR code

After deploying the app, make a QR code that points directly to the survey page, for example `https://your-domain.example/survey.html`. The map, insights, and sign-up are available on their own pages and from the navigation menu.

## API routes

- `GET /api/health`
- `GET /api/config`
- `POST /api/surveys`
- `POST /api/members`
- `GET /api/spaces`
- `GET /api/questions`
- `GET /api/insights` and `POST /api/insights/summary`
- `/api/admin/*` routes require an administrator session

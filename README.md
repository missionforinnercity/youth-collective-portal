# Youth Collective portal

A small Node.js portal for the Youth Collective survey, sign-ups, and third-space map.

## Run it

Use Node.js 20 or newer. The project reads configuration from the existing `.env` file.

```sh
npm install
npm start
```

Open `http://localhost:3000`. For development with automatic server restarts, use `npm run dev`.

## Environment

The app uses `MONGODB_URI`, `MONGODB_USERNAME`, and `MONGODB_PASSWORD`. Keep `.env` private; it is excluded from Git.

- `MONGODB_URI` may be a full `mongodb://` or `mongodb+srv://` URI, or an Atlas cluster hostname. If it has no username, the app uses `MONGODB_USERNAME` and `MONGODB_PASSWORD`.
- MongoDB connection attempts retry with exponential backoff. The server pings the database every 30 seconds and `/api/health` performs a live ping.
- Optional: `PORT` (defaults to `3000`), `MONGODB_DATABASE` (defaults to `youth_collective`), `CITY_NAME`, `CITY_LAT`, and `CITY_LNG` (defaults to Cape Town CBD).

The server uses the MongoDB collections `surveys`, `members`, `third_spaces`, and `survey_questions`. Their names can be changed with `MONGODB_SURVEYS_COLLECTION`, `MONGODB_MEMBERS_COLLECTION`, `MONGODB_SPACES_COLLECTION`, and `MONGODB_QUESTIONS_COLLECTION`.

## Admin portal

Set `ADMIN_PASSWORD` to a unique password of at least 12 characters, then sign in at `/admin.html`. The signed login cookie expires after eight hours. Set `NODE_ENV=production` and serve the site over HTTPS in production so the cookie is marked Secure.

The portal shows the latest 500 survey responses, lets an administrator reorder, edit, add, or remove active questions, and add, edit, or delete map locations. Removed questions are archived so their previous responses stay in the database. Survey responses include the respondent's name, surname, and selected third space.

## Features

- The survey presents one question at a time and asks for a name, surname, and third space before starting.
- Youth Collective sign-ups ask for a name and email address. There is no public endpoint for reading sign-up details.
- The third-space map uses OpenStreetMap tiles. Administrators manage places in the admin portal; the public map is read-only.
- The home page includes an animated wordmark headline and a space carousel connected to its map location.

## QR code

After deploying the app, make a QR code that points directly to `/survey.html`. Third spaces, About, and sign-up are available from the navigation menu.

## API routes

- `GET /api/health`
- `GET /api/config`
- `POST /api/surveys`
- `POST /api/members`
- `GET /api/spaces`
- `GET /api/questions`
- `/api/admin/*` routes require an administrator session

## Design reference

https://www.byooooob.com/

##improvements

fix bubble centre etxt and remove random objects in word clouds
remove green card from selector

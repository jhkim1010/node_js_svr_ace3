## Node.js + PostgreSQL API with Sequelize (port 3030)

### Setup

1. Copy `env.example` to `.env` and update values.
2. Install deps (already installed): `npm i`
3. Start in dev: `npm run dev` or prod: `npm start`

### API

- GET `/api/health` → health status
- GET `/api/items` → list last 100 items
- POST `/api/items` with JSON `{ "name": "foo" }` → create item

### Database / Sequelize

Example table:

This project uses Sequelize. On start, it will `authenticate()` and `sync()`.
Model: `Item { id: INTEGER PK, name: TEXT NOT NULL }` mapped to table `items`.



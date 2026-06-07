# ---- Kanban web (static frontend) ----
# Serves the prototype's HTML/JSX/CSS as static files via nginx.
# The app currently transpiles JSX in-browser via Babel (fine for a
# prototype). For production, migrate to Vite (see ARCHITECTURE.md) and
# replace this with a build step + nginx serving the dist/ output.

FROM nginx:1.27-alpine

# Static assets (copied from the project root by docker-compose build context).
# *.js picks up both data.js and api.js (the camelCase<->snake_case translator).
COPY Kanban.html /usr/share/nginx/html/index.html
COPY *.jsx *.js *.css /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

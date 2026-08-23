# Helpdesk Anywhere backend — Cloud Run container
# Build:  gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT/helpdesk/backend infra/gcp -f infra/gcp/backend.Dockerfile
FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
RUN npm ci --workspace packages/shared --workspace apps/backend --include-workspace-root --no-audit --no-fund
COPY packages packages
COPY apps/backend apps/backend
RUN npm run build -w packages/shared && npm run build -w apps/backend

FROM node:22-bookworm-slim AS run
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/package.json package.json
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/shared packages/shared
COPY --from=build /repo/apps/backend apps/backend
ENV SQLITE_PATH=/tmp/helpdesk.sqlite
EXPOSE 8080
ENV PORT=8080
CMD ["node", "apps/backend/dist/main.js"]

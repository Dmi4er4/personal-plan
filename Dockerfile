FROM node:24-bookworm-slim
WORKDIR /app
COPY apps/relay/node-server.mjs ./apps/relay/node-server.mjs
COPY apps/web/dist ./apps/web/dist
EXPOSE 8787
CMD ["node", "apps/relay/node-server.mjs", "--db", "/state/node-relay.sqlite", "--legacy", "/state/v3/do/personal-plan-relay-VaultObject", "--static", "/app/apps/web/dist", "--host", "0.0.0.0", "--port", "8787"]

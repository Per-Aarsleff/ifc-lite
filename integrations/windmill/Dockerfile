FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
WORKDIR /app
COPY integrations/windmill/*.mjs integrations/windmill/profiles.json ./integrations/windmill/
COPY apps/viewer/dist ./apps/viewer/dist
USER node
ENV BIND_HOST=0.0.0.0 PORT=8091
EXPOSE 8091
CMD ["node", "integrations/windmill/server.mjs"]

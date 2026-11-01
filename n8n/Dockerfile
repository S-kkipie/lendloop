FROM n8nio/n8n:2.45.7
# Hardening defaults live in the image, so every deployment (local compose,
# Railway) gets them without repeating them; compose overrides only what is
# local-only (N8N_SECURE_COOKIE=false over plain http, the Postgres host).
ENV DB_TYPE=postgresdb \
    N8N_SECURE_COOKIE=true \
    N8N_INSTANCE_OWNER_MANAGED_BY_ENV=true \
    N8N_BLOCK_ENV_ACCESS_IN_NODE=true \
    N8N_PUBLIC_API_DISABLED=true \
    EXECUTIONS_DATA_SAVE_ON_SUCCESS=none \
    EXECUTIONS_DATA_SAVE_ON_ERROR=all \
    EXECUTIONS_DATA_MAX_AGE=168 \
    EXECUTIONS_DATA_PRUNE=true \
    N8N_DIAGNOSTICS_ENABLED=false \
    N8N_PERSONALIZATION_ENABLED=false \
    N8N_VERSION_NOTIFICATIONS_ENABLED=false \
    N8N_TEMPLATES_ENABLED=false
USER root
COPY --chown=node:node workflows /opt/lendloop/workflows
COPY --chown=node:node entrypoint.sh /opt/lendloop/entrypoint.sh
RUN chmod 0555 /opt/lendloop/entrypoint.sh
USER node
ENTRYPOINT ["tini", "--", "/opt/lendloop/entrypoint.sh"]

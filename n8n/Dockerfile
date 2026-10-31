FROM n8nio/n8n:2.45.7
USER root
COPY --chown=node:node workflows /opt/lendloop/workflows
COPY --chown=node:node entrypoint.sh /opt/lendloop/entrypoint.sh
RUN chmod 0555 /opt/lendloop/entrypoint.sh
USER node
ENTRYPOINT ["tini", "--", "/opt/lendloop/entrypoint.sh"]

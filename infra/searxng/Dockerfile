FROM searxng/searxng:latest

COPY infra/searxng/settings.yml /opt/foremention-searxng/settings.yml
COPY infra/searxng/runtime-entrypoint.sh /usr/local/bin/foremention-searxng-entrypoint

USER root
RUN chmod 0755 /usr/local/bin/foremention-searxng-entrypoint

ENTRYPOINT ["/usr/local/bin/foremention-searxng-entrypoint"]

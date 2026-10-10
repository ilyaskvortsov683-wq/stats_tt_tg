# Образ API / воркера / бота (один образ, разные команды в docker-compose).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN pip install uv==0.4.29

WORKDIR /srv
COPY apps/api/pyproject.toml apps/api/pyproject.toml
RUN uv pip install --system -r apps/api/pyproject.toml --extra google

COPY apps/api apps/api
COPY config config
COPY dictionaries dictionaries
COPY packages/design-tokens packages/design-tokens
COPY docs/guides docs/guides

WORKDIR /srv/apps/api
RUN useradd -r -u 10001 app && mkdir -p data/reports && chown -R app data
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]

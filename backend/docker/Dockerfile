# syntax=docker/dockerfile:1.6
# Backend image (Django). Build context: this folder (heroes_api/).
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# mssql-django uses Microsoft's ODBC driver through pyodbc.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg unixodbc-dev \
    && curl -fsSLO https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb \
    && dpkg -i packages-microsoft-prod.deb \
    && rm packages-microsoft-prod.deb \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 \
    && rm -rf /var/lib/apt/lists/*

# Use production dependencies by default. docker-compose.yml explicitly selects
# dev for local development; docker-compose.prod.yml explicitly selects prod.
ARG REQUIREMENTS=prod
COPY requirements/ /app/requirements/
RUN pip install -r requirements/${REQUIREMENTS}.txt \
    && python -c "import daphne; print('Daphne installed:', daphne.__version__)"

COPY . /app/

COPY docker/entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["sh", "-c", "daphne -b 0.0.0.0 -p ${PORT:-8000} config.asgi:application"]

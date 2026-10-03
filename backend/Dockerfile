FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .
COPY alembic.ini ./
COPY migrations ./migrations

CMD ["uvicorn", "assistant_backend.main:app", "--host", "0.0.0.0", "--port", "8000"]

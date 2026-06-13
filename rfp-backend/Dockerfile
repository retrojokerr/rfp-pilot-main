FROM python:3.12-slim

WORKDIR /app

# System deps for cryptography / grpc wheels
RUN apt-get update && apt-get install -y --no-install-recommends gcc g++ && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the embedding model into the image layer so first boot is
# fast and the container works in air-gapped networks. The HF_HOME volume
# in compose overrides this cache if you prefer a shared volume instead.
ENV HF_HOME=/models
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-small-en-v1.5')"

COPY . .

EXPOSE 8000
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000"]

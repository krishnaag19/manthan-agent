FROM python:3.11-slim
WORKDIR /app
COPY . /app
RUN pip install --no-cache-dir -r requirements.txt
CMD ["python", "pipeline.py"]

ENV OPENROUTER_API_KEY=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
ENV GMAIL_USER = money.cassata@gmail.com
ENV GMAIL_APP_PASSWORD = MoneyCassata1@3$
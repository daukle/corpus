FROM node:24-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends git openjdk-17-jdk-headless ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

ARG DAUKLE_VERSION=0.18.0
ARG DAUKLE_SHA256=3d3a23aa3d24245c2644bb19688fda421a4546c5928a97550bbd1e5e0d4cb010
RUN curl -fsSL -o /usr/local/bin/daukle \
        "https://github.com/daukle/daukle/releases/download/${DAUKLE_VERSION}/daukle-linux-x86_64" \
    && echo "${DAUKLE_SHA256}  /usr/local/bin/daukle" | sha256sum -c - \
    && chmod +x /usr/local/bin/daukle

RUN useradd --create-home corpus
USER corpus
WORKDIR /home/corpus

FROM eclipse-temurin:8-jdk AS jdk8
FROM eclipse-temurin:11-jdk AS jdk11
FROM eclipse-temurin:21-jdk AS jdk21

FROM node:24-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends git openjdk-17-jdk-headless ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Gradle finds a toolchain in /usr/lib/jvm by itself, and popular builds ask for 8, 11 and 21 beside 17.
COPY --from=jdk8 /opt/java/openjdk /usr/lib/jvm/temurin-8
COPY --from=jdk11 /opt/java/openjdk /usr/lib/jvm/temurin-11
COPY --from=jdk21 /opt/java/openjdk /usr/lib/jvm/temurin-21

ARG DAUKLE_VERSION=0.18.0
ARG DAUKLE_SHA256=3d3a23aa3d24245c2644bb19688fda421a4546c5928a97550bbd1e5e0d4cb010
RUN curl -fsSL -o /usr/local/bin/daukle \
        "https://github.com/daukle/daukle/releases/download/${DAUKLE_VERSION}/daukle-linux-x86_64" \
    && echo "${DAUKLE_SHA256}  /usr/local/bin/daukle" | sha256sum -c - \
    && chmod +x /usr/local/bin/daukle

ARG ANDROID_TOOLS=commandlinetools-linux-11076708_latest.zip
ARG ANDROID_TOOLS_SHA256=2d2d50857e4eb553af5a6dc3ad507a17adf43d115264b1afc116f95c92e5e258
ENV ANDROID_HOME=/opt/android-sdk
RUN apt-get update && apt-get install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists/*     && curl -fsSL -o /tmp/tools.zip "https://dl.google.com/android/repository/${ANDROID_TOOLS}"     && echo "${ANDROID_TOOLS_SHA256}  /tmp/tools.zip" | sha256sum -c -     && mkdir -p "${ANDROID_HOME}/cmdline-tools"     && unzip -q /tmp/tools.zip -d "${ANDROID_HOME}/cmdline-tools"     && mv "${ANDROID_HOME}/cmdline-tools/cmdline-tools" "${ANDROID_HOME}/cmdline-tools/latest"     && rm /tmp/tools.zip     && yes | JAVA_HOME=/usr/lib/jvm/temurin-21 "${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager" --licenses >/dev/null

RUN useradd --create-home corpus && chown -R corpus "${ANDROID_HOME}"
USER corpus
WORKDIR /home/corpus
